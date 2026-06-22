'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FindingDetail, FeedPostEnriched } from '../../types';
import { getFindingById } from '../../api/findingApi';
import { getFeed } from '../../api/feedApi';
import { SeverityBadge, FindingStatusBadge } from '../findings/FindingBadges';
import { formatTimestamp } from '../../utils/feedHelpers';
import { X, ExternalLink, AlertTriangle, Flag } from 'lucide-react';

interface Props {
  findingId: number;
  onClose: () => void;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Preview a finding inline anywhere it is referenced — no navigation. Shows the
// content, who raised it, and the optional context filled at raise time, so a
// reviewer can judge (e.g.) a duplicate candidate without leaving the page.
// Mirrors Task/WpQuickViewPanel; mounted once by QuickViewProvider.
export default function FindingQuickViewPanel({ findingId, onClose }: Props) {
  const [finding, setFinding] = useState<FindingDetail | null>(null);
  const [feed, setFeed] = useState<FeedPostEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      getFindingById(findingId),
      getFeed('FINDING', findingId).catch(() => [] as FeedPostEnriched[]),
    ])
      .then(([f, posts]) => { if (active) { setFinding(f); setFeed(posts); setError(null); } })
      .catch(() => { if (active) setError('Failed to load finding'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [findingId]);

  // Most recent few entries, newest first.
  const recent = feed.slice(-5).reverse();
  const hazardLabels = finding?.hazardTags.map((h) => h.hazardTag.label).join(', ') ?? '';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Flag className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <h3 className="text-base font-bold text-slate-800 truncate">
              {finding ? `Finding #${finding.id}` : 'Finding'}
            </h3>
            {finding && <FindingStatusBadge status={finding.status} />}
            {finding?.severity && <SeverityBadge severity={finding.severity} />}
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-7 w-7 border-t-2 border-b-2 border-amber-500" />
            </div>
          ) : error || !finding ? (
            <div className="text-center py-10">
              <AlertTriangle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">{error ?? 'Finding not found.'}</p>
            </div>
          ) : (
            <>
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Description</h4>
                <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{finding.description}</p>
              </div>

              <dl className="space-y-3 text-sm">
                <Row label="Event Type" value={finding.eventType} />
                <Row label="Reported by" value={finding.reportedByUser?.name ?? '—'} />
                <Row label="Raised" value={formatDate(finding.createdAt)} />
                <Row label="Department" value={finding.department?.name ?? '—'} />
                <Row label="Due date" value={formatDate(finding.dueDate)} />
                <Row label="ATA Chapter" value={finding.ataChapter ? `${finding.ataChapter.code} — ${finding.ataChapter.title}` : '—'} />
                <Row label="Hazard Tags" value={hazardLabels || '—'} />
                <Row label="Aircraft" value={finding.aircraftRegistration?.registration ?? finding.aircraftRegistrationCode ?? '—'} />
                <Row label="Regulatory Ref" value={finding.regulatoryReference ?? '—'} />
                <Row label="Field Ref" value={finding.fieldId ?? '—'} />
              </dl>

              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Latest activity</h4>
                {recent.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No activity yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {recent.map((entry) => (
                      <li key={entry.id} className="text-xs">
                        <p className={`leading-relaxed break-words ${entry.type === 'SYSTEM_EVENT' ? 'text-slate-500 italic' : 'text-slate-700'}`}>
                          {entry.type !== 'SYSTEM_EVENT' && (
                            <span className="font-semibold text-slate-600">{entry.author?.name ?? 'Unknown'}: </span>
                          )}
                          {entry.content}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{formatTimestamp(entry.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">Close</button>
          <Link
            href={`/dashboard/findings/${findingId}`}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Open full finding
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-slate-700 flex-1 break-words">{value}</dd>
    </div>
  );
}
