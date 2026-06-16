/**
 * Validated access to file-storage configuration (mirrors the fail-fast pattern
 * of config/env.ts). Storage is pluggable behind `StorageAdapter`; the driver is
 * selected here so switching to MinIO / S3 later is a one-adapter change.
 *
 * See CLAUDE_HANDOVER.md §3.5. The default driver is `local` (files on the VPS
 * filesystem) — chosen over a MinIO daemon because downloads are proxied through
 * the backend, so the S3 API / presigned-URL features are never used and the
 * extra daemon RAM is unjustified on the VPS.
 */
import path from 'path';

export type StorageDriver = 'local' | 'minio';

export const STORAGE_DRIVER: StorageDriver = (() => {
  const raw = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (raw !== 'local' && raw !== 'minio') {
    throw new Error(
      `FATAL: STORAGE_DRIVER='${raw}' is not supported. Use 'local' or 'minio'.`
    );
  }
  return raw;
})();

/**
 * Root directory for the local-disk driver. Defaults to <cwd>/storage so a
 * dev / test run needs no extra env. In production deploy.sh sets an absolute
 * path on a persistent volume.
 */
export const STORAGE_LOCAL_ROOT: string =
  process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), 'storage');
