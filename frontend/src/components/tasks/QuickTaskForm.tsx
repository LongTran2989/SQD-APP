'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { createQuickTask, getDatasource } from '../../api/taskApi';
import { useAuthStore } from '../../store/authStore';
import AsyncSearchableSelect from '../ui/AsyncSearchableSelect';
import { SearchableSelectOption } from '../ui/SearchableSelect';

export default function QuickTaskForm() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [skillLevel, setSkillLevel] = useState(0);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [estimatedHours, setEstimatedHours] = useState<number | ''>('');
  const [targetDivisionId, setTargetDivisionId] = useState<number | ''>(user?.divisionId ?? '');
  const [assignedToUserId, setAssignedToUserId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);

  const fetchDivisionOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('divisions', { q, limit: 20 });

  const fetchAssigneeOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('users', { q, limit: 20, divisionId: targetDivisionId || undefined });

  const handleDivisionChange = (val: string) => {
    setTargetDivisionId(val ? Number(val) : '');
    setAssignedToUserId('');
  };

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSubmitting(true);
    try {
      const task = await createQuickTask({
        title: title.trim(),
        issuanceNote: note.trim() || undefined,
        deadline: deadline || undefined,
        skillLevel,
        requiresApproval,
        estimatedHours: estimatedHours === '' ? undefined : Number(estimatedHours),
        targetDivisionId: targetDivisionId ? Number(targetDivisionId) : undefined,
        assignedToUserId: assignedToUserId ? Number(assignedToUserId) : undefined,
      });
      toast.success(`Quick task ${task.taskId} created`);
      router.push(`/dashboard/tasks/${task.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create quick task');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-title">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id="qt-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-note">
            Instruction / Note
          </label>
          <textarea
            id="qt-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional context or guidance"
            className={`${inputCls} resize-none`}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-division">
              Target Division
            </label>
            <AsyncSearchableSelect
              id="qt-division"
              value={targetDivisionId ? String(targetDivisionId) : ''}
              onChange={handleDivisionChange}
              fetchOptions={fetchDivisionOptions}
              placeholder="Search for division…"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-assignee">
              Assignee
            </label>
            <AsyncSearchableSelect
              id="qt-assignee"
              value={assignedToUserId ? String(assignedToUserId) : ''}
              onChange={(val) => setAssignedToUserId(val ? Number(val) : '')}
              fetchOptions={fetchAssigneeOptions}
              placeholder={targetDivisionId ? 'Search for assignee…' : 'Select a division first'}
              disabled={!targetDivisionId}
              clearable
              clearLabel="No assignee (Unassigned)"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-deadline">
              Deadline
            </label>
            <input
              id="qt-deadline"
              type="date"
              value={deadline}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => setDeadline(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-skill">
              Skill Level
            </label>
            <select
              id="qt-skill"
              value={skillLevel}
              onChange={(e) => setSkillLevel(Number(e.target.value))}
              className={inputCls}
            >
              {[0, 1, 2, 3, 4].map((l) => (
                <option key={l} value={l}>Level {l}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-hours">
            Estimated Hours
          </label>
          <input
            id="qt-hours"
            type="number"
            min="0"
            step="0.5"
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="Optional"
            className={inputCls}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <span className="text-sm font-medium text-slate-700">Requires Approval</span>
        </label>
        <button
          onClick={handleSubmit}
          disabled={submitting || !title.trim()}
          className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Creating…' : 'Issue Task'}
        </button>
      </div>
    </div>
  );
}
