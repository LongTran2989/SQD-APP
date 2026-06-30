import { Request, Response } from 'express';
import {
  fetchAndParseSheet,
  getPreviewData,
  executeSync,
  PreviewData,
  PreviewDataSchema,
  SyncOptions,
} from '../services/googleSheetSync.service';

// GET /api/sheet-sync/preview
// Fetches the configured Google Sheet, validates + diffs it against existing
// Work Packages, and returns the preview for the confirm-then-sync UI.
export const getPreview = async (req: Request, res: Response): Promise<void> => {
  try {
    const url = process.env.GOOGLE_SHEET_CSV_URL;
    if (!url) {
      res.status(500).json({ message: 'GOOGLE_SHEET_CSV_URL is not configured' });
      return;
    }
    const rows = await fetchAndParseSheet(url);
    const preview = await getPreviewData(rows);
    res.json(preview);
  } catch (error) {
    console.error('[SheetSync] Preview error:', error);
    res.status(500).json({ message: error instanceof Error ? error.message : 'Preview failed' });
  }
};

// POST /api/sheet-sync/execute
// Applies the previously-previewed diff. The frontend echoes the preview back so
// we avoid a second external fetch; the service re-queries each toUpdate WP under
// a race-condition guard before touching anything.
export const executeSyncHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { previewData, collisionDecisions } = req.body as {
      previewData?: PreviewData;
      collisionDecisions?: Record<string, 'skip' | 'create-new'>;
    };
    if (!previewData) {
      res.status(400).json({ message: 'previewData is required' });
      return;
    }
    // B1: validate the echoed-back body to prevent forged payloads bypassing fetchAndParseSheet filters.
    const bodyResult = PreviewDataSchema.safeParse(previewData);
    if (!bodyResult.success) {
      res.status(400).json({ message: 'Invalid previewData structure', errors: bodyResult.error.issues });
      return;
    }
    const options: SyncOptions = { collisionDecisions: collisionDecisions ?? {} };
    const result = await executeSync(bodyResult.data as PreviewData, { userId }, options);
    res.json(result);
  } catch (error) {
    console.error('[SheetSync] Execute error:', error);
    res.status(500).json({ message: error instanceof Error ? error.message : 'Sync execution failed' });
  }
};
