'use client';

import { Paperclip, Download } from 'lucide-react';
import { FeedAttachment } from '../../types';
import { downloadAttachment } from '../../api/attachmentApi';

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// Renders download chips for a comment's attachments (Phase F). Bytes stream via
// the authenticated /api/attachments/:id/download endpoint — never a public URL.
export default function CommentAttachments({ attachments }: { attachments?: FeedAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => { void downloadAttachment(a.id, a.fileName).catch(() => {}); }}
          title={`${a.fileName} (${fmtBytes(a.fileSize)})`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] text-slate-600 max-w-[220px]"
        >
          <Paperclip className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{a.caption || a.fileName}</span>
          <span className="text-slate-400 flex-shrink-0">{fmtBytes(a.fileSize)}</span>
          <Download className="w-3 h-3 flex-shrink-0 text-slate-400" />
        </button>
      ))}
    </div>
  );
}
