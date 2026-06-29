'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, ImagePlus } from 'lucide-react';
import { ImageRefNode, ImageRefContext, type ImageRefAttachment } from './ImageRefNode';

export type { JSONContent };
export type { ImageRefAttachment };

interface RichTextEditorProps {
  // HTML mode (default): value/onChange carry the editor content as an HTML string.
  value?: string;
  onChange?: (html: string) => void;
  // JSON mode (opt-in, used by report_block): set outputJson to seed from jsonValue
  // and emit Tiptap/ProseMirror JSON via onChangeJson instead of HTML. value/onChange
  // are ignored in this mode.
  outputJson?: boolean;
  jsonValue?: JSONContent;
  onChangeJson?: (json: JSONContent) => void;
  disabled?: boolean;
  // Images available for inline reference (report_block only). Passing this
  // enables the "insert image" toolbar button and resolves chip/figure labels
  // by attachment id. Omit for plain rich_text fields.
  attachments?: ImageRefAttachment[];
  // 'chip' (default) shows a compact inline marker while editing; 'figure'
  // (the printed/exported report) renders the full image at that point.
  imageMode?: 'chip' | 'figure';
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault(); // prevent editor losing focus
        onClick();
      }}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

function InsertImageRefButton({
  attachments,
  onInsert,
}: {
  attachments: ImageRefAttachment[];
  onInsert: (attachmentId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <ToolbarButton title="Insert image reference" onClick={() => setOpen((o) => !o)} active={open}>
        <ImagePlus className="w-3.5 h-3.5" />
      </ToolbarButton>
      {open && (
        <div className="absolute z-10 top-full left-0 mt-1 w-56 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {attachments.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">No images uploaded yet.</p>
          ) : (
            attachments.map((a) => (
              <button
                key={a.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onInsert(a.id);
                  setOpen(false);
                }}
                className="block w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 truncate"
              >
                {a.caption || a.fileName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  outputJson = false,
  jsonValue,
  onChangeJson,
  disabled = false,
  attachments,
  imageMode = 'chip',
}: RichTextEditorProps) {
  const initialContent = outputJson ? jsonValue || '' : value || '';
  const editor = useEditor({
    extensions: [StarterKit, ImageRefNode],
    content: initialContent,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      if (outputJson) {
        onChangeJson?.(editor.getJSON());
      } else {
        onChange?.(editor.getHTML());
      }
    },
    // Keep content in sync when the seed prop changes externally (e.g. initial load)
    onCreate: ({ editor }) => {
      if (initialContent && editor.isEmpty) {
        editor.commands.setContent(initialContent, { emitUpdate: false });
      }
    },
  });

  if (!editor) return null;

  const contextValue = { attachments: attachments ?? [], mode: imageMode };

  if (disabled) {
    return (
      <ImageRefContext.Provider value={contextValue}>
        <div className="w-full min-h-[80px] px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-sm text-slate-600 prose prose-sm max-w-none">
          <EditorContent editor={editor} />
        </div>
      </ImageRefContext.Provider>
    );
  }

  return (
    <ImageRefContext.Provider value={contextValue}>
      <div className="border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50">
          <ToolbarButton
            title="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')}
          >
            <Bold className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')}
          >
            <Italic className="w-3.5 h-3.5" />
          </ToolbarButton>
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <ToolbarButton
            title="Bullet list"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
          >
            <List className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Numbered list"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </ToolbarButton>
          {attachments && (
            <>
              <div className="w-px h-4 bg-slate-200 mx-1" />
              <InsertImageRefButton
                attachments={attachments}
                onInsert={(attachmentId) =>
                  editor.chain().focus().insertContent({ type: 'imageRef', attrs: { attachmentId } }).run()
                }
              />
            </>
          )}
        </div>

        {/* Editor area. The ProseMirror node only grows to its content's height, so on
            short content most of this min-h-[100px] box is empty padding outside the
            contenteditable element. Without this handler, clicking that empty area does
            nothing (the editor never gains focus and the click is lost) — so we forward
            it to the editor, placing the cursor at the end. */}
        <div
          className="px-3 py-2 min-h-[100px] text-sm text-slate-800 bg-white cursor-text [&_.ProseMirror]:outline-none [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-slate-400 [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              editor.chain().focus('end').run();
            }
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </ImageRefContext.Provider>
  );
}
