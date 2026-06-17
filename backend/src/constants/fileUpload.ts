/**
 * File-upload policy constants.
 *
 * Per NON-NEGOTIABLE RULE 10, the *policy* limits (allowed MIME types + max
 * sizes) are Admin-configurable and are NOT hardcoded as the enforced value —
 * they live in the `SystemSetting` row keyed `FILE_UPLOAD_CONFIG` (JSON) and are
 * read at request time. The `DEFAULT_FILE_UPLOAD_CONFIG` below is only the seed /
 * fallback used when that row is missing; it mirrors CLAUDE_HANDOVER.md §3.5.
 *
 * `ABSOLUTE_MAX_UPLOAD_BYTES` is a different thing: a fixed infrastructure
 * memory-safety ceiling for the multipart parser (the VPS buffers each upload in
 * memory). It is deliberately far above any sane policy size and is NOT the
 * business limit — the per-category policy limit (which an Admin may raise or
 * lower) is enforced separately in `attachmentService`.
 */

export const FILE_UPLOAD_CONFIG_KEY = 'FILE_UPLOAD_CONFIG';

const MB = 1024 * 1024;

/** Hard memory-safety ceiling for the multipart parser. Not the policy limit. */
export const ABSOLUTE_MAX_UPLOAD_BYTES = 100 * MB;

/** Entity types a file may be attached to. */
export const ATTACHMENT_ENTITY_TYPES = ['TASK', 'FINDING', 'TEMPLATE', 'WP'] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export function isAttachmentEntityType(value: unknown): value is AttachmentEntityType {
  return typeof value === 'string' && (ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Logical storage bucket per entity type (mirrors the §3.5 bucket structure). */
export const ENTITY_BUCKET: Record<AttachmentEntityType, string> = {
  TASK: 'sqd-tasks',
  WP: 'sqd-tasks',
  FINDING: 'sqd-findings',
  TEMPLATE: 'sqd-templates',
};

// Derived from ENTITY_BUCKET so a new entity→bucket mapping is initialised by
// storage.ensureReady() automatically (single source of truth).
export const ALL_BUCKETS: string[] = Array.from(new Set(Object.values(ENTITY_BUCKET)));

export interface FileCategoryRule {
  label: string;
  /** Lower-cased MIME types accepted for this category. */
  mimeTypes: string[];
  /** Per-file max size in bytes. */
  maxSizeBytes: number;
}

export interface FileUploadConfig {
  categories: FileCategoryRule[];
  /** Combined size cap across all (non-deleted) attachments on one entity. */
  totalPerEntityBytes: number;
}

/** Seed / fallback policy. Mirrors CLAUDE_HANDOVER.md §3.5. */
export const DEFAULT_FILE_UPLOAD_CONFIG: FileUploadConfig = {
  categories: [
    {
      label: 'Documents',
      mimeTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'text/plain',
      ],
      maxSizeBytes: 20 * MB,
    },
    {
      label: 'Images',
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxSizeBytes: 10 * MB,
    },
  ],
  totalPerEntityBytes: 50 * MB,
};

/**
 * Validates an arbitrary parsed JSON value as a FileUploadConfig. Returns the
 * typed config, or null when the shape is invalid (caller falls back to default).
 */
export function parseFileUploadConfig(value: unknown): FileUploadConfig | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.categories)) return null;
  if (typeof v.totalPerEntityBytes !== 'number' || v.totalPerEntityBytes <= 0) return null;

  const categories: FileCategoryRule[] = [];
  for (const raw of v.categories) {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    if (typeof c.label !== 'string') return null;
    if (!Array.isArray(c.mimeTypes) || c.mimeTypes.some((m) => typeof m !== 'string')) return null;
    if (typeof c.maxSizeBytes !== 'number' || c.maxSizeBytes <= 0) return null;
    categories.push({
      label: c.label,
      mimeTypes: (c.mimeTypes as string[]).map((m) => m.toLowerCase()),
      // Clamp to the hard infrastructure ceiling. A larger Admin-set value can
      // never take effect — the multipart parser and nginx reject the request
      // before the policy is consulted — so we surface the effective limit here
      // instead of silently advertising one the server can't honour.
      maxSizeBytes: Math.min(c.maxSizeBytes, ABSOLUTE_MAX_UPLOAD_BYTES),
    });
  }
  if (categories.length === 0) return null;

  return { categories, totalPerEntityBytes: v.totalPerEntityBytes };
}

/**
 * Resolves the category rule matching a MIME type, or null when the type is not
 * permitted by any category in the active config.
 */
export function categoryForMimeType(config: FileUploadConfig, mimeType: string): FileCategoryRule | null {
  const mt = mimeType.toLowerCase();
  return config.categories.find((c) => c.mimeTypes.includes(mt)) ?? null;
}
