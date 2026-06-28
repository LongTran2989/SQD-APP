import { Request, Response } from 'express';
import fsp from 'fs/promises';
import { Attachment } from '@prisma/client';
import prisma from '../lib/prisma';
import { isHttpError } from '../utils/httpError';
import { getStorage, ObjectNotFoundError } from '../services/storage';
import {
  createAttachmentService,
  deleteAttachmentService,
  updateCaptionService,
  loadFileUploadConfig,
} from '../services/attachmentService';
import { isAttachmentEntityType } from '../constants/fileUpload';

// Metadata returned to clients — never exposes the internal storageKey / bucket.
const PUBLIC_SELECT = {
  id: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  caption: true,
  entityType: true,
  entityId: true,
  fieldId: true,
  uploadedById: true,
  createdAt: true,
} as const;

// Single JS projector for the write path (service returns the full row). Mirrors
// PUBLIC_SELECT so the upload response and the list response share one shape.
function toPublic(a: Attachment) {
  return {
    id: a.id,
    fileName: a.fileName,
    fileType: a.fileType,
    fileSize: a.fileSize,
    caption: a.caption,
    entityType: a.entityType,
    entityId: a.entityId,
    fieldId: a.fieldId,
    uploadedById: a.uploadedById,
    createdAt: a.createdAt,
  };
}

function fail(res: Response, error: unknown, context: string): void {
  if (isHttpError(error)) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  console.error(context, error);
  res.status(500).json({ message: 'Internal server error' });
}

// ─── GET /api/attachments/config ───────────────────────────────────────────────
// Exposes the active upload policy so the UI can validate before sending bytes.
export const getUploadConfig = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await loadFileUploadConfig());
  } catch (error) {
    fail(res, error, 'Error loading upload config:');
  }
};

// ─── POST /api/attachments ─────────────────────────────────────────────────────
// Multipart: `file` part + `entityType`, `entityId`, optional `fieldId` fields.
export const uploadAttachment = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  try {
    const { userId } = req.user!;
    if (!file) {
      res.status(400).json({ message: 'No file provided (expected multipart field "file")' });
      return;
    }

    const { entityType, entityId, fieldId } = req.body as Record<string, string>;
    if (!isAttachmentEntityType(entityType)) {
      res.status(400).json({ message: 'entityType must be one of TASK, FINDING, TEMPLATE, WP, FEED_POST' });
      return;
    }
    if (!entityId || typeof entityId !== 'string') {
      res.status(400).json({ message: 'entityId is required' });
      return;
    }

    const attachment = await createAttachmentService(
      { userId },
      {
        entityType,
        entityId,
        fieldId: typeof fieldId === 'string' && fieldId.length ? fieldId : null,
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        sourcePath: file.path,
      }
    );

    res.status(201).json(toPublic(attachment));
  } catch (error) {
    fail(res, error, 'Error uploading attachment:');
  } finally {
    // Remove the multipart temp file. On success the storage adapter already
    // moved it (unlink → ENOENT, ignored); on any rejection this is the cleanup.
    if (file?.path) await fsp.unlink(file.path).catch(() => undefined);
  }
};

// ─── GET /api/attachments?entityType=&entityId=&fieldId= ───────────────────────
export const listAttachments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { entityType, entityId, fieldId } = req.query;
    if (!isAttachmentEntityType(entityType)) {
      res.status(400).json({ message: 'entityType must be one of TASK, FINDING, TEMPLATE, WP, FEED_POST' });
      return;
    }
    if (typeof entityId !== 'string' || !entityId.length) {
      res.status(400).json({ message: 'entityId is required' });
      return;
    }

    const attachments = await prisma.attachment.findMany({
      where: {
        entityType,
        entityId,
        deletedAt: null,
        ...(typeof fieldId === 'string' && fieldId.length ? { fieldId } : {}),
      },
      select: PUBLIC_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    res.json(attachments);
  } catch (error) {
    fail(res, error, 'Error listing attachments:');
  }
};

// ─── GET /api/attachments/:id/download ─────────────────────────────────────────
// Streams the object through the backend so storage stays private and access is
// re-checked on every download (no public/presigned URL).
export const downloadAttachment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: 'Invalid attachment id' });
      return;
    }

    const attachment = await prisma.attachment.findFirst({ where: { id, deletedAt: null } });
    if (!attachment) {
      res.status(404).json({ message: 'Attachment not found' });
      return;
    }

    let stream;
    try {
      stream = await getStorage().getStream(attachment.bucket, attachment.storageKey);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ message: 'File content is no longer available' });
        return;
      }
      throw err;
    }

    res.setHeader('Content-Type', attachment.fileType || 'application/octet-stream');
    res.setHeader('Content-Length', String(attachment.fileSize));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${attachment.fileName.replace(/"/g, '')}"`
    );

    stream.on('error', (err: Error) => {
      console.error('Error streaming attachment:', err);
      if (!res.headersSent) res.status(500).json({ message: 'Error streaming file' });
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (error) {
    fail(res, error, 'Error downloading attachment:');
  }
};

// ─── DELETE /api/attachments/:id ───────────────────────────────────────────────
export const deleteAttachment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, permissions } = req.user!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: 'Invalid attachment id' });
      return;
    }

    await deleteAttachmentService({ userId, role, permissions }, id);
    res.json({ message: 'Attachment deleted' });
  } catch (error) {
    fail(res, error, 'Error deleting attachment:');
  }
};

// ─── PATCH /api/attachments/:id ─────────────────────────────────────────────────
// Body: { caption: string | null }. See updateCaptionService for the permission rule.
export const updateAttachment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, permissions } = req.user!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: 'Invalid attachment id' });
      return;
    }

    const { caption } = req.body as { caption?: unknown };
    if (caption !== null && typeof caption !== 'string') {
      res.status(400).json({ message: 'caption must be a string or null' });
      return;
    }
    const trimmed = caption === null ? null : caption.trim() || null;

    const updated = await updateCaptionService({ userId, role, permissions }, id, trimmed);
    res.json(toPublic(updated));
  } catch (error) {
    fail(res, error, 'Error updating attachment caption:');
  }
};
