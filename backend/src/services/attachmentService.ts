import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '../lib/prisma';
import { HttpError } from '../utils/httpError';
import { createFeedPost, FeedScope } from './feedService';
import { getStorage } from './storage';
import {
  FILE_UPLOAD_CONFIG_KEY,
  DEFAULT_FILE_UPLOAD_CONFIG,
  parseFileUploadConfig,
  categoryForMimeType,
  FileUploadConfig,
  AttachmentEntityType,
  ENTITY_BUCKET,
} from '../constants/fileUpload';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const ATTACHMENT_UPLOADED = 'ATTACHMENT_UPLOADED';
export const ATTACHMENT_DELETED = 'ATTACHMENT_DELETED';

/** Roles that may delete any attachment (not just their own uploads). */
const ELEVATED_DELETE_ROLES = ['Director', 'Admin', 'Manager'];

// ─── Config ─────────────────────────────────────────────────────────────────

/**
 * Reads the Admin-configurable upload policy from SystemSetting (Rule 10),
 * falling back to DEFAULT_FILE_UPLOAD_CONFIG when the row is absent or invalid.
 */
export async function loadFileUploadConfig(client: PrismaLike = prisma): Promise<FileUploadConfig> {
  const row = await client.systemSetting.findUnique({ where: { key: FILE_UPLOAD_CONFIG_KEY } });
  if (!row) return DEFAULT_FILE_UPLOAD_CONFIG;
  try {
    return parseFileUploadConfig(JSON.parse(row.value)) ?? DEFAULT_FILE_UPLOAD_CONFIG;
  } catch {
    return DEFAULT_FILE_UPLOAD_CONFIG;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Strips any path component and unsafe characters from a client filename. */
function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? 'file').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 200);
  return base.length ? base : 'file';
}

/** The feed scope an entity posts to, or null when it has no feed (TEMPLATE). */
function feedScopeFor(entityType: AttachmentEntityType): FeedScope | null {
  switch (entityType) {
    case 'TASK':
      return 'TASK';
    case 'WP':
      return 'WP';
    case 'FINDING':
      return 'FINDING';
    default:
      return null;
  }
}

/**
 * Confirms the owning entity exists (soft-delete filtered for the protected
 * models) and returns its numeric id. Throws 400 on a non-numeric entityId and
 * 404 when the entity is missing or deleted.
 */
async function assertEntityExists(
  client: PrismaLike,
  entityType: AttachmentEntityType,
  entityId: string
): Promise<number> {
  const numericId = Number(entityId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new HttpError(400, 'entityId must be a positive integer');
  }

  let found: { id: number } | null = null;
  switch (entityType) {
    case 'TASK':
      found = await client.task.findFirst({ where: { id: numericId, deletedAt: null }, select: { id: true } });
      break;
    case 'FINDING':
      found = await client.finding.findFirst({ where: { id: numericId, deletedAt: null }, select: { id: true } });
      break;
    case 'WP':
      found = await client.workPackage.findFirst({ where: { id: numericId, deletedAt: null }, select: { id: true } });
      break;
    case 'TEMPLATE':
      found = await client.template.findUnique({ where: { id: numericId }, select: { id: true } });
      break;
  }
  if (!found) throw new HttpError(404, `${entityType} not found`);
  return numericId;
}

// ─── Upload ─────────────────────────────────────────────────────────────────

export interface UploadFileInput {
  entityType: AttachmentEntityType;
  entityId: string;
  fieldId?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

/**
 * Validates a file against the active policy + per-entity quota, stores the
 * bytes, then atomically creates the Attachment row, the AuditLog entry, and (for
 * entities with a feed) a SYSTEM_EVENT FeedPost. The stored object is rolled back
 * on a DB failure, so a committed row always has its bytes.
 */
export async function createAttachmentService(actor: { userId: number }, input: UploadFileInput) {
  const config = await loadFileUploadConfig();

  const category = categoryForMimeType(config, input.mimeType);
  if (!category) throw new HttpError(415, `File type not allowed: ${input.mimeType || 'unknown'}`);

  if (!Number.isFinite(input.size) || input.size <= 0) throw new HttpError(400, 'Empty file');
  if (input.size > category.maxSizeBytes) {
    throw new HttpError(413, `${category.label} files must be ${formatBytes(category.maxSizeBytes)} or smaller`);
  }

  await assertEntityExists(prisma, input.entityType, input.entityId);

  // Per-entity total cap. Best-effort against concurrent uploads (no row lock —
  // acceptable for an internal tool; a tiny over-limit is possible under a race).
  const agg = await prisma.attachment.aggregate({
    where: { entityType: input.entityType, entityId: input.entityId, deletedAt: null },
    _sum: { fileSize: true },
  });
  const used = agg._sum.fileSize ?? 0;
  if (used + input.size > config.totalPerEntityBytes) {
    throw new HttpError(
      413,
      `Adding this file would exceed the ${formatBytes(config.totalPerEntityBytes)} total limit for this record`
    );
  }

  const bucket = ENTITY_BUCKET[input.entityType];
  const safeName = sanitizeFilename(input.fileName);
  const storageKey = `${input.entityType}/${input.entityId}/${randomUUID()}-${safeName}`;

  // Store bytes first; if the DB write fails we remove the orphan object below.
  await getStorage().put(bucket, storageKey, input.buffer, input.mimeType);

  try {
    return await prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          fileName: safeName,
          fileType: input.mimeType,
          fileSize: input.size,
          bucket,
          storageKey,
          entityType: input.entityType,
          entityId: input.entityId,
          fieldId: input.fieldId ?? null,
          uploadedById: actor.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          actionType: ATTACHMENT_UPLOADED,
          entityType: input.entityType,
          entityId: input.entityId,
          performedByUserId: actor.userId,
          comment: safeName,
          details: { attachmentId: attachment.id, fileType: input.mimeType, fileSize: input.size, fieldId: input.fieldId ?? null },
        },
      });

      const scope = feedScopeFor(input.entityType);
      if (scope) {
        await createFeedPost(tx, {
          type: 'SYSTEM_EVENT',
          scope,
          scopeId: Number(input.entityId),
          content: `📎 File attached: ${safeName}`,
        });
      }

      return attachment;
    });
  } catch (err) {
    await getStorage().remove(bucket, storageKey).catch(() => undefined);
    throw err;
  }
}

// ─── Delete (soft) ────────────────────────────────────────────────────────────

/**
 * Soft-deletes an attachment (sets deletedAt). The stored object is intentionally
 * NOT removed — evidence files are an aviation compliance record. Allowed for the
 * original uploader or an elevated role.
 */
export async function deleteAttachmentService(actor: { userId: number; role: string }, id: number) {
  const attachment = await prisma.attachment.findFirst({ where: { id, deletedAt: null } });
  if (!attachment) throw new HttpError(404, 'Attachment not found');

  const elevated = ELEVATED_DELETE_ROLES.includes(actor.role);
  if (attachment.uploadedById !== actor.userId && !elevated) {
    throw new HttpError(403, 'You do not have permission to delete this attachment');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.attachment.update({ where: { id }, data: { deletedAt: new Date() } });

    await tx.auditLog.create({
      data: {
        actionType: ATTACHMENT_DELETED,
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        performedByUserId: actor.userId,
        comment: attachment.fileName,
        details: { attachmentId: attachment.id },
      },
    });

    const scope = feedScopeFor(attachment.entityType as AttachmentEntityType);
    if (scope) {
      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT',
        scope,
        scopeId: Number(attachment.entityId),
        content: `🗑️ File removed: ${attachment.fileName}`,
      });
    }

    return updated;
  });
}
