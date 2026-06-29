'use client';

import { AtSign } from 'lucide-react';
import { MentionUser } from '../../types';

// Renders the "@mentioned" people under a comment, resolved to names server-side.
export default function MentionsLine({ mentions }: { mentions?: MentionUser[] }) {
  if (!mentions || mentions.length === 0) return null;
  return (
    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-blue-500">
      <AtSign className="w-2.5 h-2.5" />
      <span>{mentions.map((m) => m.name ?? 'Unknown').join(', ')}</span>
    </div>
  );
}
