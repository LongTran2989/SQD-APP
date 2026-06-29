'use client';

import { useRef } from 'react';
import { Paperclip, X } from 'lucide-react';

interface AttachmentPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

// Composer affordance for staging files to attach to a comment (Phase F). The
// files are held here and uploaded by the parent AFTER the comment is created
// (the upload needs the new post id). Validation (type/size/quota) is enforced
// server-side on upload.
export default function AttachmentPicker({ files, onChange, disabled }: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onChange([...files, ...Array.from(list)]);
    if (inputRef.current) inputRef.current.value = ''; // allow re-selecting the same file
  };
  const remove = (i: number) => onChange(files.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] max-w-[180px]">
          <Paperclip className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{f.name}</span>
          <button type="button" onClick={() => remove(i)} disabled={disabled} className="hover:text-slate-900 flex-shrink-0" aria-label={`Remove ${f.name}`}>
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 text-[11px] disabled:opacity-50"
      >
        <Paperclip className="w-3 h-3" /> Attach
      </button>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
    </div>
  );
}
