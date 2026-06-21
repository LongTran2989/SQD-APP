'use client';

import { useState } from 'react';
import RichTextEditor, { type JSONContent } from '../ui/RichTextEditor';
import FileUploadField from '../ui/FileUploadField';
import { Attachment } from '../../types';

export interface ReportBlockValue {
  content: JSONContent | null;
  imageIds: number[];
}

interface ReportBlockFieldProps {
  taskId: number;
  fieldId: string;
  value: ReportBlockValue | undefined;
  onChange: (value: ReportBlockValue) => void;
  disabled: boolean;
}

// Combines a JSON-mode narrative editor with a captioned image gallery, stored
// together as one TaskData value: { content, imageIds }. imageIds mirrors the
// file_upload convention (id list, used only for required-field validation) —
// live captions/metadata always come from the Attachment table. The editor can
// also cite a gallery image inline (an imageRef node storing the attachment
// id) — the gallery's live attachment list is mirrored here so the editor can
// resolve those references to a caption/filename for its chip labels.
export default function ReportBlockField({ taskId, fieldId, value, onChange, disabled }: ReportBlockFieldProps) {
  const content = value?.content ?? undefined;
  const imageIds = value?.imageIds ?? [];
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const imageAttachments = attachments.filter((a) => a.fileType.startsWith('image/'));

  return (
    <div className="space-y-3">
      <RichTextEditor
        outputJson
        jsonValue={content}
        onChangeJson={disabled ? undefined : (json) => onChange({ content: json, imageIds })}
        disabled={disabled}
        attachments={imageAttachments}
      />
      <FileUploadField
        entityType="TASK"
        entityId={taskId}
        fieldId={fieldId}
        disabled={disabled}
        captionable
        onChange={(ids) => onChange({ content: content ?? null, imageIds: ids })}
        onAttachmentsChange={setAttachments}
      />
    </div>
  );
}
