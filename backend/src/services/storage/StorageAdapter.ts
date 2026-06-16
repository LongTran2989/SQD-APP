import { Readable } from 'stream';

/**
 * Driver-agnostic object storage. Implementations: LocalDiskAdapter (default)
 * and a future MinioAdapter (S3-compatible). The attachment service only ever
 * talks to this interface, so the storage backend is a configuration choice.
 */
export interface StorageAdapter {
  /** Create buckets / root dirs if missing. Called once at startup. */
  ensureReady(buckets: readonly string[]): Promise<void>;

  /**
   * Store an object by ingesting a file already written to a local path (the
   * multipart temp file). The source path is consumed (moved) — callers must not
   * reuse it afterwards. Overwrites any object already at (bucket, key). Taking a
   * path rather than a Buffer keeps large uploads off the Node heap.
   */
  putFile(bucket: string, key: string, sourcePath: string, contentType: string): Promise<void>;

  /**
   * Open a readable stream for an object. Rejects with an Error whose `code` is
   * 'NOT_FOUND' when the object does not exist.
   */
  getStream(bucket: string, key: string): Promise<Readable>;

  /** Remove an object. Resolves quietly when the object is already absent. */
  remove(bucket: string, key: string): Promise<void>;
}

/** Error raised by adapters when an object is missing. */
export class ObjectNotFoundError extends Error {
  code = 'NOT_FOUND' as const;
  constructor(message = 'Object not found') {
    super(message);
    this.name = 'ObjectNotFoundError';
  }
}
