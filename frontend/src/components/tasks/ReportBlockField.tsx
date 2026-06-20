'use client';

import RichTextEditor, { type JSONContent } from '../ui/RichTextEditor';
import FileUploadField from '../ui/FileUploadField';

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
// live captions/metadata always come from the Attachment table.
export default function ReportBlockField({ taskId, fieldId, value, onChange, disabled }: ReportBlockFieldProps) {
  const content = value?.content ?? undefined;
  const imageIds = value?.imageIds ?? [];

  return (
    <div className="space-y-3">
      <RichTextEditor
        outputJson
        jsonValue={content}
        onChangeJson={disabled ? undefined : (json) => onChange({ content: json, imageIds })}
        disabled={disabled}
      />
      <FileUploadField
        entityType="TASK"
        entityId={taskId}
        fieldId={fieldId}
        disabled={disabled}
        captionable
        onChange={(ids) => onChange({ content: content ?? null, imageIds: ids })}
      />
    </div>
  );
}
