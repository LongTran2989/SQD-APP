import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { StorageAdapter, ObjectNotFoundError } from './StorageAdapter';

/**
 * Stores objects on the local filesystem under <root>/<bucket>/<key>.
 *
 * Path safety: every (bucket, key) is resolved and asserted to stay within the
 * configured root, so a maliciously crafted key (e.g. containing `..`) can never
 * escape the storage tree. Keys are generated server-side (uuid-based) anyway,
 * but this is defence in depth.
 */
export class LocalDiskAdapter implements StorageAdapter {
  constructor(private readonly root: string) {}

  private resolveSafe(bucket: string, key: string): string {
    const bucketRoot = path.resolve(this.root, bucket);
    const full = path.resolve(bucketRoot, key);
    if (full !== bucketRoot && !full.startsWith(bucketRoot + path.sep)) {
      throw new Error('Refusing to access a path outside the storage root');
    }
    return full;
  }

  async ensureReady(buckets: readonly string[]): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true });
    for (const bucket of buckets) {
      await fsp.mkdir(path.resolve(this.root, bucket), { recursive: true });
    }
  }

  async putFile(bucket: string, key: string, sourcePath: string, _contentType: string): Promise<void> {
    const full = this.resolveSafe(bucket, key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    try {
      // Fast path: same filesystem — atomic move, no buffering.
      await fsp.rename(sourcePath, full);
    } catch (err: unknown) {
      // Cross-device (e.g. tmp on a different mount): stream-copy then unlink.
      if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
        await fsp.copyFile(sourcePath, full);
        await fsp.unlink(sourcePath).catch(() => undefined);
      } else {
        throw err;
      }
    }
  }

  async getStream(bucket: string, key: string): Promise<Readable> {
    const full = this.resolveSafe(bucket, key);
    // Open via the stream itself (one syscall) instead of a separate access()
    // stat; map ENOENT on 'open' failure to ObjectNotFoundError for a clean 404.
    const stream = fs.createReadStream(full);
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve());
      stream.once('error', (err: NodeJS.ErrnoException) =>
        reject(err.code === 'ENOENT' ? new ObjectNotFoundError() : err)
      );
    });
    return stream;
  }

  async remove(bucket: string, key: string): Promise<void> {
    const full = this.resolveSafe(bucket, key);
    try {
      await fsp.unlink(full);
    } catch (err: unknown) {
      // Idempotent: a missing object is not an error.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  }
}
