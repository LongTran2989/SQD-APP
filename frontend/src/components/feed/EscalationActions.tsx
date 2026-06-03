'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { actionEscalation } from '../../api/escalationApi';
import { getApiErrorMessage } from '../../utils/apiError';
import EscalationActionModal, { ModalAction } from './EscalationActionModal';

interface EscalationActionsProps {
  flagId: number;
  sourceTaskId: number | null;
  sourceWpId: number | null;
  // Raise Finding / Reassign only make sense when the escalation came from a task.
  canRaiseFinding: boolean;
  onActioned?: () => void;
}

// The full lifecycle-action cluster for a PENDING flag (Acknowledge / Dismiss are
// one-click; the rest open the card-local payload modal). Shared by EscalationCard
// (on a feed) and the dedicated escalations page so the action logic lives once.
export default function EscalationActions({ flagId, sourceTaskId, sourceWpId, canRaiseFinding, onActioned }: EscalationActionsProps) {
  const [busy, setBusy] = useState(false);
  const [modalAction, setModalAction] = useState<ModalAction | null>(null);

  const runSimple = async (action: 'ACKNOWLEDGE' | 'DISMISS') => {
    setBusy(true);
    try {
      await actionEscalation(flagId, action);
      toast.success(action === 'ACKNOWLEDGE' ? 'Escalation acknowledged' : 'Escalation dismissed');
      onActioned?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Action failed'));
    } finally {
      setBusy(false);
    }
  };

  const btn = 'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50';

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => runSimple('ACKNOWLEDGE')} disabled={busy} className={`${btn} border-green-300 text-green-700 hover:bg-green-100`}>
          Acknowledge
        </button>
        <button onClick={() => runSimple('DISMISS')} disabled={busy} className={`${btn} border-slate-300 text-slate-600 hover:bg-slate-100`}>
          Dismiss
        </button>
        {canRaiseFinding && (
          <button onClick={() => setModalAction('RAISE_FINDING')} disabled={busy} className={`${btn} border-rose-300 text-rose-700 hover:bg-rose-100`}>
            Raise Finding
          </button>
        )}
        <button onClick={() => setModalAction('CREATE_TASK')} disabled={busy} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-100`}>
          Create Task
        </button>
        {sourceTaskId != null && (
          <button onClick={() => setModalAction('REASSIGN_TASK')} disabled={busy} className={`${btn} border-indigo-300 text-indigo-700 hover:bg-indigo-100`}>
            Reassign
          </button>
        )}
        <button onClick={() => setModalAction('DISSEMINATE')} disabled={busy} className={`${btn} border-purple-300 text-purple-700 hover:bg-purple-100`}>
          Disseminate
        </button>
      </div>

      {modalAction && (
        <EscalationActionModal
          flagId={flagId}
          action={modalAction}
          sourceTaskId={sourceTaskId}
          sourceWpId={sourceWpId}
          onClose={() => setModalAction(null)}
          onDone={() => { setModalAction(null); onActioned?.(); }}
        />
      )}
    </>
  );
}
