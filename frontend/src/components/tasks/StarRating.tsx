'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number | null;
  onChange?: (rating: number) => void;
  readOnly?: boolean;
}

// Rating scale: 0-5 (rendered as 5 stars)
export default function StarRating({ value, onChange, readOnly = false }: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const display = hovered ?? value ?? 0;

  const handleClick = (star: number) => {
    if (readOnly || !onChange) return;
    onChange(star);
  };

  return (
    <div
      className="inline-flex items-center gap-0.5"
      role={readOnly ? 'img' : 'group'}
      aria-label={`Rating: ${value ?? 0} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          id={`star-${star}`}
          disabled={readOnly}
          onClick={() => handleClick(star)}
          onMouseEnter={() => !readOnly && setHovered(star)}
          onMouseLeave={() => !readOnly && setHovered(null)}
          className={`p-0.5 transition-all ${
            readOnly
              ? 'cursor-default'
              : 'cursor-pointer hover:scale-110'
          } ${display >= star ? 'text-amber-400' : 'text-slate-300'}`}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
        >
          <Star
            className="w-5 h-5"
            fill={display >= star ? 'currentColor' : 'none'}
            strokeWidth={1.5}
          />
        </button>
      ))}
      {!readOnly && (
        <span className="ml-1.5 text-xs text-slate-400 font-medium">
          {hovered ?? value ?? 0}/5
        </span>
      )}
    </div>
  );
}
