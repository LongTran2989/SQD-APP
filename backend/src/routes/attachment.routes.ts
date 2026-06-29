import os from 'os';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  uploadAttachment,
  listAttachments,
  downloadAttachment,
  deleteAttachment,
  updateAttachment,
  getUploadConfig,
} from '../controllers/attachment.controller';
import { ABSOLUTE_MAX_UPLOAD_BYTES } from '../constants/fileUpload';

const router = Router();

// Uploads stream to a temp file on disk (NOT buffered in memory) — important on
// a small VPS where many concurrent uploads would otherwise pin RAM. The storage
// adapter moves the temp file into place; the controller unlinks it on any error
// path. The size limit here is the fixed infrastructure memory-safety ceiling
// (NOT the configurable policy limit — that is enforced per-category in
// attachmentService). A single `file` part is accepted per request.
const upload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: ABSOLUTE_MAX_UPLOAD_BYTES, files: 1 },
});

// Translates multer's own errors (e.g. file exceeds the memory ceiling) into a
// clean 4xx instead of bubbling to the generic 500 handler.
const handleUpload = (req: Request, res: Response, next: NextFunction): void => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ message: `Upload rejected: ${err.message}` });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
};

router.use(authenticateJWT);

router.get('/config', getUploadConfig);
router.get('/', listAttachments);
router.post('/', handleUpload, uploadAttachment);
router.get('/:id/download', downloadAttachment);
router.patch('/:id', updateAttachment);
router.delete('/:id', deleteAttachment);

export default router;
