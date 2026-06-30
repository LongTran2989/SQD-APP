import { apiClient } from './client';
import { PreviewData, SyncResult, CollisionDecision } from './sheetSyncTypes';

export const getSheetSyncPreview = (): Promise<PreviewData> =>
  apiClient.get('/sheet-sync/preview').then((r) => r.data);

export const executeSheetSync = (
  previewData: PreviewData,
  collisionDecisions: Record<string, CollisionDecision>
): Promise<SyncResult> =>
  apiClient.post('/sheet-sync/execute', { previewData, collisionDecisions }).then((r) => r.data);
