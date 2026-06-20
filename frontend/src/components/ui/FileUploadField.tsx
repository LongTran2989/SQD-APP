'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Download, Trash2, Loader2, UploadCloud, FileText, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { Attachment, AttachmentEntityType, FileUploadConfig } from '../../types';
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  downloadAttachment,
  fetchAttachmentBlobUrl,
  updateAttachmentCaption,
  getUploadConfig,
} from '../../api/attachmentApi';
import { apiErrorMessage } from '../../api/errorMessage';
import ImageLightbox from './ImageLightbox';

const CAPTION_MAX_LENGTH = 300;

interface FileUploadFieldProps {
  entityType: AttachmentEntityType;
  entityId: string | number;
  /** Scopes uploads/listing to a single form field (TASK form uploads). */
  fieldId?: string;
  /** Hides upload/delete controls (read-only contexts). */
  disabled?: boolean;
  /** Notifies the parent of the current attachment id list (e.g. to store in TaskData). */
  onChange?: (attachmentIds: number[]) => void;
  /** Shows an inline caption input under each image (report_block galleries only). */
  captionable?: boolean;
}

// Rounding matches the backend formatBytes (attachmentService.ts) so the limit
// strings in server 4xx messages and the UI hint never disagree.
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function FileUploadField({
  entityType,
  entityId,
  fieldId,
  disabled = false,
  onChange,
  captionable = false,
}: FileUploadFieldProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [config, setConfig] = useState<FileUploadConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
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
    // NOTE: do NOT emit() here — pushing ids to the parent on a pure read would
    // mark the host task form dirty before any user action (and clobber saved
    // TaskData). Only upload/delete emit.
    Promise.all([
      listAttachments(entityType, entityId, fieldId),
      getUploadConfig().catch(() => null),
    ])
      .then(([list, cfg]) => {
        if (!active) return;
        setAttachments(list);
        setConfig(cfg);
      })
      .catch(() => active && toast.error('Failed to load attachments'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [entityType, entityId, fieldId]);

  const acceptTypes = config?.categories.flatMap((c) => c.mimeTypes).join(',');

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
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
      toast.error(apiErrorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    try {
      await deleteAttachment(id);
      const next = attachments.filter((a) => a.id !== id);
      setAttachments(next);
      emit(next);
      toast.success('File removed');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not remove file'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownload(att: Attachment) {
    setBusyId(att.id);
    try {
      await downloadAttachment(att.id, att.fileName);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Download failed'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCaptionSave(id: number, caption: string) {
    const trimmed = caption.trim();
    try {
      const updated = await updateAttachmentCaption(id, trimmed === '' ? null : trimmed);
      setAttachments((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save caption'));
      throw err;
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
            <AttachmentRow
              key={att.id}
              attachment={att}
              disabled={disabled}
              captionable={captionable}
              busy={busyId === att.id}
              onDownload={() => handleDownload(att)}
              onDelete={() => handleDelete(att.id)}
              onCaptionSave={(caption) => handleCaptionSave(att.id, caption)}
            />
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
    </div>
  );
}

interface AttachmentRowProps {
  attachment: Attachment;
  disabled: boolean;
  captionable: boolean;
  busy: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onCaptionSave: (caption: string) => Promise<void>;
}

function AttachmentRow({
  attachment,
  disabled,
  captionable,
  busy,
  onDownload,
  onDelete,
  onCaptionSave,
}: AttachmentRowProps) {
  const isImage = attachment.fileType.startsWith('image/');
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!isImage) return;
    let active = true;
    let url: string | null = null;
    fetchAttachmentBlobUrl(attachment.id).then((u) => {
      if (!active) {
        window.URL.revokeObjectURL(u);
        return;
      }
      url = u;
      setThumbUrl(u);
    });
    return () => {
      active = false;
      if (url) window.URL.revokeObjectURL(url);
    };
  }, [isImage, attachment.id]);

  return (
    <li className="flex items-start gap-3 px-3 py-2 bg-white border border-slate-200 rounded-lg">
      {isImage && thumbUrl ? (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="w-10 h-10 flex-shrink-0 rounded-md overflow-hidden border border-slate-200"
          title="View image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL thumbnail, not eligible for next/image */}
          <img src={thumbUrl} alt={attachment.fileName} className="w-full h-full object-cover" />
        </button>
      ) : (
        <FileText className="w-4 h-4 mt-1 text-slate-400 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-700 truncate">{attachment.fileName}</p>
        <p className="text-xs text-slate-400">{formatBytes(attachment.fileSize)}</p>
        {captionable && isImage && (
          <CaptionInput
            key={attachment.caption ?? ''}
            caption={attachment.caption ?? ''}
            disabled={disabled}
            onSave={onCaptionSave}
          />
        )}
        {!captionable && attachment.caption && (
          <p className="text-xs text-slate-500 italic truncate">{attachment.caption}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        title="Download"
        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      </button>
      {!disabled && (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          title="Remove"
          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
      {lightboxOpen && thumbUrl && (
        <ImageLightbox
          src={thumbUrl}
          alt={attachment.fileName}
          caption={attachment.caption}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </li>
  );
}

function CaptionInput({
  caption,
  disabled,
  onSave,
}: {
  caption: string;
  disabled: boolean;
  onSave: (caption: string) => Promise<void>;
}) {
  // Remounts (resetting draft state to the server-confirmed value) whenever
  // `caption` changes externally, i.e. right after a successful save.
  const [value, setValue] = useState(caption);
  const [saving, setSaving] = useState(false);
  const dirty = value !== caption;

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSave(value);
    } catch {
      // error toast already shown by the caller; keep the draft so the user can retry
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1 flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
          }
        }}
        placeholder="Add a caption…"
        maxLength={CAPTION_MAX_LENGTH}
        disabled={disabled || saving}
        className="w-full text-xs px-2 py-1 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
      />
      {dirty && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          title="Save caption"
          className="flex-shrink-0 p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}
