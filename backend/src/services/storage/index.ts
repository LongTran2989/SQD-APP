import { STORAGE_DRIVER, STORAGE_LOCAL_ROOT } from '../../config/storage';
import { ALL_BUCKETS } from '../../constants/fileUpload';
import { StorageAdapter } from './StorageAdapter';
import { LocalDiskAdapter } from './LocalDiskAdapter';

export { ObjectNotFoundError } from './StorageAdapter';
export type { StorageAdapter } from './StorageAdapter';

let adapter: StorageAdapter | null = null;

/**
 * Returns the process-wide storage adapter for the configured driver.
 * Cached after first construction.
 */
export function getStorage(): StorageAdapter {
  if (adapter) return adapter;

  switch (STORAGE_DRIVER) {
    case 'local':
      adapter = new LocalDiskAdapter(STORAGE_LOCAL_ROOT);
      break;
    case 'minio':
      // Intentionally not wired yet. To enable: add the `minio` dependency,
      // implement MinioAdapter against StorageAdapter, and construct it here.
      throw new Error(
        "STORAGE_DRIVER='minio' selected but the MinIO adapter is not wired. " +
          'Implement services/storage/MinioAdapter.ts and register it here.'
      );
    default:
      throw new Error(`Unhandled STORAGE_DRIVER: ${STORAGE_DRIVER}`);
  }

  return adapter;
}

/** Creates the storage buckets / root directories. Best-effort at startup. */
export async function initStorage(): Promise<void> {
  await getStorage().ensureReady(ALL_BUCKETS);
}
