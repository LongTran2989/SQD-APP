'use client';

import { useState } from 'react';
import { Send, X } from 'lucide-react';

interface PublishModalProps {
  draftCount: number;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}

export default function PublishModal({ draftCount, onConfirm, onClose }: PublishModalProps) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onConfirm(note);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-600" />
            Publish Schedule
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-600 mb-4">
          You are about to publish <strong>{draftCount}</strong> draft entr{draftCount === 1 ? 'y' : 'ies'}.
          Published entries will be visible to all division members.
        </p>

        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Publish note <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Schedule for week of 16 Jun — new rotation applied"
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-medium text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm shadow-sm transition-all flex items-center gap-2"
          >
            {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}
