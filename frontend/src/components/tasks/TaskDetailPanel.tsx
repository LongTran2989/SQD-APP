'use client';

import Link from 'next/link';
import { TaskEnriched, User } from '../../types';
import TaskStatusBadge from './TaskStatusBadge';
import StarRating from './StarRating';
import { AlertTriangle, Calendar, Clock, User as UserIcon, Link as LinkIcon, Briefcase } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0 pt-0.5">
        {label}
      </span>
      <div className="flex-1 text-sm text-slate-700 min-w-0">{children}</div>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskDetailPanelProps {
  task: TaskEnriched;
  currentUser: User;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TaskDetailPanel({ task, currentUser }: TaskDetailPanelProps) {
  const isOverdue = task.isOverdue;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Status header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded font-bold font-mono text-xs border border-slate-200">
            {task.taskId}
          </span>
          <TaskStatusBadge status={task.status} />
          {isOverdue && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-[10px] font-bold border border-red-200">
              <AlertTriangle className="w-2.5 h-2.5" />
              OVERDUE
            </span>
          )}
        </div>
      </div>

      {/* Detail rows */}
      <div className="px-5 py-3">
        {/* Template */}
        <DetailRow label="Template">
          {task.template ? (
            <Link
              href={`/dashboard/templates/${task.template.id}`}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
            >
              <LinkIcon className="w-3.5 h-3.5" />
              {task.template.templateId} — {task.template.title}
            </Link>
          ) : '—'}
        </DetailRow>

        {/* Issuer */}
        <DetailRow label="Issuer">
          <span className="flex items-center gap-1.5">
            <UserIcon className="w-3.5 h-3.5 text-slate-400" />
            {task.issuer?.name ?? '—'}
            {task.issuerId === currentUser.id && (
              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">YOU</span>
            )}
          </span>
        </DetailRow>

        {/* Assignee */}
        <DetailRow label="Assignee">
          {task.assignedToUser ? (
            <span className="flex items-center gap-1.5">
              <UserIcon className="w-3.5 h-3.5 text-slate-400" />
              {task.assignedToUser.name}
              {task.assignedToUserId === currentUser.id && (
                <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold">YOU</span>
              )}
            </span>
          ) : (
            <span className="text-slate-400 italic">Unassigned</span>
          )}
        </DetailRow>

        {/* Division */}
        <DetailRow label="Division">
          {task.targetDivision?.name ?? '—'}
        </DetailRow>

        {/* Work Package */}
        {task.wp && (
          <DetailRow label="Work Package">
            <span className="flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-slate-400" />
              {task.wp.wpId} — {task.wp.name}
            </span>
          </DetailRow>
        )}

        {/* Deadline */}
        <DetailRow label="Deadline">
          <span className={`flex items-center gap-1.5 ${isOverdue ? 'text-red-600 font-semibold' : ''}`}>
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            {formatDate(task.deadline)}
            {isOverdue && ' (OVERDUE)'}
          </span>
        </DetailRow>

        {/* Estimated hours */}
        {task.estimatedHours != null && (
          <DetailRow label="Est. Hours">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {task.estimatedHours}h
            </span>
          </DetailRow>
        )}

        {/* Completed */}
        {task.completedAt && (
          <DetailRow label="Completed">
            {formatDate(task.completedAt)}
          </DetailRow>
        )}

        {/* Rating */}
        {task.rating != null && (
          <DetailRow label="Rating">
            <StarRating value={task.rating} readOnly />
          </DetailRow>
        )}

        {/* Rejection reason */}
        {task.rejectionReason && (
          <DetailRow label="Rejection">
            <p className="text-rose-700 bg-rose-50 border border-rose-100 px-3 py-2 rounded-lg text-xs">
              {task.rejectionReason}
            </p>
          </DetailRow>
        )}

        {/* Inactivation log */}
        {task.status === 'Inactive' && task.inactivationLog && (
          <DetailRow label="Inactive Reason">
            <p className="text-slate-500 bg-slate-50 border border-slate-100 px-3 py-2 rounded-lg text-xs">
              {task.inactivationLog.reason}
            </p>
          </DetailRow>
        )}

        {/* Deadline extensions pending */}
        {task.deadlineExtensions && Array.isArray(task.deadlineExtensions) && (
          (() => {
            const pending = (task.deadlineExtensions as any[]).find((e) => !e.decision);
            if (!pending) return null;
            return (
              <DetailRow label="Ext. Request">
                <div className="bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg text-xs text-amber-700">
                  <p className="font-semibold mb-0.5">Extension requested</p>
                  <p className="text-amber-600">{pending.reason}</p>
                </div>
              </DetailRow>
            );
          })()
        )}

        {/* Timestamps */}
        <DetailRow label="Created">
          {formatDate(task.createdAt)}
        </DetailRow>
      </div>
    </div>
  );
}
