'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import TaskCreateForm from './TaskCreateForm';

interface CreateTaskModalProps {
  onClose: () => void;
  onSaved: (id: number) => void;
}

export default function CreateTaskModal({ onClose, onSaved }: CreateTaskModalProps) {
  // Dismiss on Escape — standard dialog affordance (WCAG 2.1.2, no keyboard trap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      {/* Stop backdrop clicks inside the dialog from closing it. */}
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-800">Create New Task</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <TaskCreateForm onSaved={onSaved} onCancel={onClose} />
        </div>
      </div>
    </div>
  );
}
