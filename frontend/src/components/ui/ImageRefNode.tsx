'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Image as ImageIcon } from 'lucide-react';
import { fetchAttachmentBlobUrl } from '../../api/attachmentApi';

export interface ImageRefAttachment {
  id: number;
  caption?: string | null;
  fileName: string;
}

// Supplies the imageRef NodeView with the attachments belonging to the current
// report_block field (for resolving the chip/figure label by id) and whether
// to render a compact editing chip or the full inline image (print/export).
export const ImageRefContext = createContext<{
  attachments: ImageRefAttachment[];
  mode: 'chip' | 'figure';
}>({ attachments: [], mode: 'chip' });

function FigureView({ attachmentId, label, missing }: { attachmentId: number; label: string; missing: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (missing) return;
    let active = true;
    let objUrl: string | null = null;
    fetchAttachmentBlobUrl(attachmentId).then((u) => {
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
  }, [attachmentId, missing]);

  if (missing) {
    return <span className="block my-2 text-sm text-red-500 italic">[Image removed: {label}]</span>;
  }

  return (
    <figure className="my-3 border border-slate-200 rounded-lg overflow-hidden break-inside-avoid">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: URL, not eligible for next/image
        <img src={url} alt={label} className="w-full object-contain max-h-[500px] bg-slate-50" />
      ) : (
        <div className="h-32 flex items-center justify-center text-slate-300 text-sm">Loading…</div>
      )}
      <figcaption className="px-3 py-2 text-sm text-slate-600 border-t border-slate-100 break-words">{label}</figcaption>
    </figure>
  );
}

function ImageRefView({ node }: NodeViewProps) {
  const { attachments, mode } = useContext(ImageRefContext);
  const attachmentId = node.attrs.attachmentId as number;
  const attachment = attachments.find((a) => a.id === attachmentId);
  const label = attachment ? attachment.caption || attachment.fileName : 'Image removed';

  if (mode === 'figure') {
    return (
      <NodeViewWrapper as="span" className="block">
        <FigureView attachmentId={attachmentId} label={label} missing={!attachment} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-md text-xs align-middle select-none ${
        attachment ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-red-50 text-red-600 border border-red-200'
      }`}
    >
      <ImageIcon className="w-3 h-3" />
      {label}
    </NodeViewWrapper>
  );
}

export const ImageRefNode = Node.create({
  name: 'imageRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('data-attachment-id')) || null,
        renderHTML: (attrs) => ({ 'data-attachment-id': attrs.attachmentId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="image-ref"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'image-ref' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageRefView);
  },
});

// Walks Tiptap JSON content and collects every attachment id referenced by an
// imageRef node, so callers (the print view) can show uploaded-but-uncited
// images separately instead of silently dropping them.
export function collectReferencedAttachmentIds(content: JSONContent | null | undefined): Set<number> {
  const ids = new Set<number>();
  function walk(node: JSONContent) {
    if (node.type === 'imageRef' && typeof node.attrs?.attachmentId === 'number') {
      ids.add(node.attrs.attachmentId);
    }
    node.content?.forEach(walk);
  }
  if (content) walk(content);
  return ids;
}
