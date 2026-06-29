import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '../lib/prisma';
import { HttpError } from '../utils/httpError';
import { createFeedPost, FeedScope } from './feedService';
import { getStorage } from './storage';
import { hasPrivilege, PrivilegeActor } from '../utils/privilegeAccess';
import { TASK_DATA_EDITABLE_STATUSES } from '../constants/taskStatus';
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
export const ATTACHMENT_CAPTION_UPDATED = 'ATTACHMENT_CAPTION_UPDATED';

/** Caption is a short label, not a description field — kept well under TaskData's own limits. */
export const ATTACHMENT_CAPTION_MAX_LENGTH = 300;

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
    case 'FEED_POST':
      // A feed COMMENT the file is attached to. FeedPost is immutable (no
      // deletedAt); only COMMENTs accept attachments.
      found = await client.feedPost.findUnique({ where: { id: numericId }, select: { id: true, type: true } })
        .then((p) => (p && p.type === 'COMMENT' ? { id: p.id } : null));
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
  /** Path to the multipart temp file on disk (consumed by the storage adapter). */
  sourcePath: string;
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

  // Move the temp file into storage first; if the DB write fails we remove the
  // orphan object below. Streaming from a path keeps large uploads off the heap.
  await getStorage().putFile(bucket, storageKey, input.sourcePath, input.mimeType);

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
export async function deleteAttachmentService(
  actor: { userId: number } & PrivilegeActor,
  id: number
) {
  const attachment = await prisma.attachment.findFirst({ where: { id, deletedAt: null } });
  if (!attachment) throw new HttpError(404, 'Attachment not found');

  // The uploader may always remove their own file; otherwise the actor needs the
  // DB-driven attachment:delete_any privilege (Phase 7 matrix, not a role array).
  const canDeleteAny = hasPrivilege(actor, 'attachment:delete_any');
  if (attachment.uploadedById !== actor.userId && !canDeleteAny) {
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

// ─── Caption update ────────────────────────────────────────────────────────────

/**
 * Updates an attachment's caption (a short, user-editable label distinct from
 * the original fileName — used by report_block galleries). Allowed for:
 *  - a holder of attachment:delete_any (no status restriction — mirrors the
 *    existing delete-any override), or
 *  - on a TASK attachment, the task's assigned user, but only while the task
 *    is still in an editable status (TASK_DATA_EDITABLE_STATUSES — same gate
 *    as saveTaskData, so caption edits can't outlive the form they describe), or
 *  - on any other entity type, the original uploader (same rule as delete).
 */
export async function updateCaptionService(
  actor: { userId: number } & PrivilegeActor,
  id: number,
  caption: string | null
) {
  if (caption !== null && caption.length > ATTACHMENT_CAPTION_MAX_LENGTH) {
    throw new HttpError(400, `Caption must be ${ATTACHMENT_CAPTION_MAX_LENGTH} characters or fewer`);
  }

  const attachment = await prisma.attachment.findFirst({ where: { id, deletedAt: null } });
  if (!attachment) throw new HttpError(404, 'Attachment not found');

  const canEditAny = hasPrivilege(actor, 'attachment:delete_any');
  if (!canEditAny) {
    if (attachment.entityType === 'TASK') {
      const task = await prisma.task.findFirst({
        where: { id: Number(attachment.entityId), deletedAt: null },
        select: { assignedToUserId: true, status: true },
      });
      const isEditableByAssignee =
        !!task &&
        task.assignedToUserId === actor.userId &&
        TASK_DATA_EDITABLE_STATUSES.includes(task.status);
      if (!isEditableByAssignee) {
        throw new HttpError(403, 'You do not have permission to caption this attachment');
      }
    } else if (attachment.uploadedById !== actor.userId) {
      throw new HttpError(403, 'You do not have permission to caption this attachment');
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.attachment.update({ where: { id }, data: { caption } });

    await tx.auditLog.create({
      data: {
        actionType: ATTACHMENT_CAPTION_UPDATED,
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        performedByUserId: actor.userId,
        comment: attachment.fileName,
        details: { attachmentId: attachment.id, caption },
      },
    });

    const scope = feedScopeFor(attachment.entityType as AttachmentEntityType);
    if (scope) {
      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT',
        scope,
        scopeId: Number(attachment.entityId),
        content: `✏️ Caption updated for ${attachment.fileName}`,
      });
    }

    return updated;
  });
}
