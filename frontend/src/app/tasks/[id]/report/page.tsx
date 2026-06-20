'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, AlertTriangle } from 'lucide-react';
import { TaskEnriched, FormField, Attachment } from '../../../../types';
import { getTaskById } from '../../../../api/taskApi';
import { listAttachments, fetchAttachmentBlobUrl } from '../../../../api/attachmentApi';
import RichTextEditor from '../../../../components/ui/RichTextEditor';
import type { ReportBlockValue } from '../../../../components/tasks/ReportBlockField';

function formatPlainValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

// Owns one image's blob-URL lifecycle (fetched authenticated, revoked on unmount)
// so the gallery can render full-size, always-visible (no click-to-enlarge —
// this is the print view) captioned images.
function ReportImage({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objUrl: string | null = null;
    fetchAttachmentBlobUrl(attachment.id).then((u) => {
      if (!active) {
        window.URL.revokeObjectURL(u);
        return;
      }
      objUrl = u;
      setUrl(u);
    });
    return () => {
      active = false;
      if (objUrl) window.URL.revokeObjectURL(objUrl);
    };
  }, [attachment.id]);

  return (
    <figure className="border border-slate-200 rounded-lg overflow-hidden break-inside-avoid">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: URL, not eligible for next/image
        <img
          src={url}
          alt={attachment.caption || attachment.fileName}
          className="w-full object-contain max-h-[500px] bg-slate-50"
        />
      ) : (
        <div className="h-40 flex items-center justify-center text-slate-300 text-sm">Loading…</div>
      )}
      <figcaption className="px-3 py-2 text-sm text-slate-600 border-t border-slate-100 break-words">
        {attachment.caption || attachment.fileName}
      </figcaption>
    </figure>
  );
}

function ReportImageGallery({ taskId, fieldId }: { taskId: number; fieldId: string }) {
  const [images, setImages] = useState<Attachment[] | null>(null);

  useEffect(() => {
    let active = true;
    listAttachments('TASK', taskId, fieldId).then((list) => {
      if (active) setImages(list.filter((a) => a.fileType.startsWith('image/')));
    });
    return () => {
      active = false;
    };
  }, [taskId, fieldId]);

  if (images === null) return <p className="text-sm text-slate-400">Loading images…</p>;
  if (images.length === 0) return <p className="text-sm text-slate-400">No images attached.</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-1">
      {images.map((img) => (
        <ReportImage key={img.id} attachment={img} />
      ))}
    </div>
  );
}

function ReportFileList({ taskId, fieldId }: { taskId: number; fieldId: string }) {
  const [files, setFiles] = useState<Attachment[] | null>(null);

  useEffect(() => {
    let active = true;
    listAttachments('TASK', taskId, fieldId).then((list) => active && setFiles(list));
    return () => {
      active = false;
    };
  }, [taskId, fieldId]);

  if (files === null) return <p className="text-sm text-slate-400">Loading files…</p>;
  if (files.length === 0) return <p className="text-sm text-slate-400">No files attached.</p>;

  return (
    <ul className="text-sm text-slate-700 list-disc pl-5 space-y-1">
      {files.map((f) => (
        <li key={f.id}>{f.fileName}</li>
      ))}
    </ul>
  );
}

export default function TaskReportPage() {
  const params = useParams();
  const taskId = Number(params.id);

  const [task, setTask] = useState<TaskEnriched | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;
    getTaskById(taskId)
      .then(setTask)
      .catch((err: unknown) => {
        const status =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;
        if (status === 403) setError('You do not have permission to view this task.');
        else if (status === 404) setError('Task not found.');
        else setError('Failed to load task report.');
      })
      .finally(() => setLoading(false));
  }, [taskId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4 p-6">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
        <h1 className="text-xl font-bold text-slate-800">{error ?? 'Something went wrong'}</h1>
        <Link href={`/dashboard/tasks/${taskId}`} className="text-blue-600 hover:underline text-sm">
          ← Back to task
        </Link>
      </div>
    );
  }

  const formData = task.taskData?.data ?? {};
  const schema: FormField[] = task.schemaSnapshot ?? [];

  return (
    <div className="max-w-3xl mx-auto p-8 print:p-0 print:max-w-none">
      {/* Chrome — hidden when printing */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link
          href={`/dashboard/tasks/${task.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="w-4 h-4" /> Back to task
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors"
        >
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      {/* Report header */}
      <div className="mb-8 pb-4 border-b border-slate-200">
        <p className="text-xs font-mono font-bold text-slate-400">{task.taskId}</p>
        <h1 className="text-2xl font-bold text-slate-800">{task.template?.title ?? 'Task Report'}</h1>
        <div className="mt-2 text-sm text-slate-500 space-y-0.5">
          <p>Status: {task.status}</p>
          {task.assignedToUser && <p>Assigned to: {task.assignedToUser.name}</p>}
          {task.wp && <p>Work Package: {task.wp.wpId} — {task.wp.name}</p>}
          {task.completedAt && <p>Completed: {new Date(task.completedAt).toLocaleString()}</p>}
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-8">
        {schema.map((field, idx) => {
          const value = formData[field.fieldId];
          return (
            <section key={field.fieldId ?? `field-${idx}`} className="break-inside-avoid">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">{field.label}</h2>

              {field.type === 'rich_text' && (
                <div className="prose prose-sm max-w-none">
                  <RichTextEditor value={(value as string) ?? ''} disabled />
                </div>
              )}

              {field.type === 'report_block' && (
                <div className="space-y-4">
                  <div className="prose prose-sm max-w-none">
                    <RichTextEditor
                      outputJson
                      jsonValue={(value as ReportBlockValue | undefined)?.content ?? undefined}
                      disabled
                    />
                  </div>
                  <ReportImageGallery taskId={task.id} fieldId={field.fieldId} />
                </div>
              )}

              {field.type === 'file_upload' && <ReportFileList taskId={task.id} fieldId={field.fieldId} />}

              {!['rich_text', 'report_block', 'file_upload'].includes(field.type) && (
                <p className="text-sm text-slate-800">{formatPlainValue(value)}</p>
              )}
            </section>
          );
        })}
        {schema.length === 0 && <p className="text-sm text-slate-400">This task has no form fields.</p>}
      </div>
    </div>
  );
}
