'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Download, Trash2, Loader2, UploadCloud, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { Attachment, AttachmentEntityType, FileUploadConfig } from '../../types';
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  downloadAttachment,
  getUploadConfig,
} from '../../api/attachmentApi';
import { apiErrorMessage } from '../../api/errorMessage';

interface FileUploadFieldProps {
  entityType: AttachmentEntityType;
  entityId: string | number;
  /** Scopes uploads/listing to a single form field (TASK form uploads). */
  fieldId?: string;
  /** Hides upload/delete controls (read-only contexts). */
  disabled?: boolean;
  /** Notifies the parent of the current attachment id list (e.g. to store in TaskData). */
  onChange?: (attachmentIds: number[]) => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function FileUploadField({
  entityType,
  entityId,
  fieldId,
  disabled = false,
  onChange,
}: FileUploadFieldProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [config, setConfig] = useState<FileUploadConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const emit = useCallback(
    (list: Attachment[]) => onChange?.(list.map((a) => a.id)),
    [onChange]
  );

  useEffect(() => {
    let active = true;
    // `loading` starts true; we don't re-set it synchronously here (the file set
    // is keyed by entity, so this effect effectively runs once per mount).
    Promise.all([
      listAttachments(entityType, entityId, fieldId),
      getUploadConfig().catch(() => null),
    ])
      .then(([list, cfg]) => {
        if (!active) return;
        setAttachments(list);
        setConfig(cfg);
        emit(list);
      })
      .catch(() => active && setError('Failed to load attachments'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // entityId/fieldId identify the file set; re-run only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, fieldId]);

  const acceptTypes = config?.categories.flatMap((c) => c.mimeTypes).join(',');

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      // Upload sequentially so the per-entity total quota is checked file-by-file.
      let current = attachments;
      for (const file of Array.from(files)) {
        setProgress(0);
        const created = await uploadAttachment(file, { entityType, entityId, fieldId }, setProgress);
        current = [...current, created];
        setAttachments(current);
        toast.success(`Uploaded ${created.fileName}`);
      }
      emit(current);
    } catch (err) {
      const msg = apiErrorMessage(err, 'Upload failed');
      setError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    setError(null);
    try {
      await deleteAttachment(id);
      const next = attachments.filter((a) => a.id !== id);
      setAttachments(next);
      emit(next);
      toast.success('File removed');
    } catch (err) {
      const msg = apiErrorMessage(err, 'Could not remove file');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownload(att: Attachment) {
    setBusyId(att.id);
    try {
      await downloadAttachment(att.id, att.fileName);
    } catch (err) {
      const msg = apiErrorMessage(err, 'Download failed');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading files…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Existing files */}
      {attachments.length > 0 && (
        <ul className="space-y-2">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-3 px-3 py-2 bg-white border border-slate-200 rounded-lg"
            >
              <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-700 truncate">{att.fileName}</p>
                <p className="text-xs text-slate-400">{formatBytes(att.fileSize)}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDownload(att)}
                disabled={busyId === att.id}
                title="Download"
                className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
              >
                {busyId === att.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              </button>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleDelete(att.id)}
                  disabled={busyId === att.id}
                  title="Remove"
                  className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Uploader */}
      {!disabled && (
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={acceptTypes}
            onChange={(e) => handleFiles(e.target.files)}
            disabled={uploading}
            className="hidden"
            id={`file-input-${fieldId ?? entityType}-${entityId}`}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Uploading… {progress > 0 ? `${progress}%` : ''}
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" /> Add file
              </>
            )}
          </button>
          {config && (
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <Paperclip className="w-3 h-3" />
              {config.categories.map((c) => `${c.label} ≤ ${formatBytes(c.maxSizeBytes)}`).join(' · ')} ·{' '}
              {formatBytes(config.totalPerEntityBytes)} total
            </p>
          )}
        </div>
      )}

      {disabled && attachments.length === 0 && (
        <p className="text-sm text-slate-400">No files attached.</p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
