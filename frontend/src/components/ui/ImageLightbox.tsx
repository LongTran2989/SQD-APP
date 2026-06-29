'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  alt: string;
  caption?: string | null;
  onClose: () => void;
}

export default function ImageLightbox({ src, alt, caption, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
        title="Close"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="max-w-4xl max-h-full flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, not eligible for next/image optimization */}
        <img src={src} alt={alt} className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl" />
        {caption && <p className="mt-3 text-sm text-white/90 text-center max-w-2xl break-words">{caption}</p>}
      </div>
    </div>
  );
}
