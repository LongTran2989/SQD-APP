'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { getPrivileges, publishPrivileges } from '../../api/privilegeApi';
import { PrivilegeCatalogItem, PrivilegeMap, RolePrivileges } from '../../types';
import { apiErrorMessage } from '../../api/errorMessage';

const ADMIN_FLOOR = ['settings:privileges'];

type DraftState = Record<string, PrivilegeMap>;

export default function PrivilegesSettings() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'Admin';

  const [catalog, setCatalog] = useState<PrivilegeCatalogItem[]>([]);
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [original, setOriginal] = useState<DraftState>({});
  const [draft, setDraft] = useState<DraftState>({});
  const [loading, setLoading] = useState(isAdmin);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    getPrivileges()
      .then((matrix) => {
        if (cancelled) return;
        setCatalog(matrix.catalog);
        setRoleNames(matrix.roles.map((r) => r.roleName));
        const state: DraftState = {};
        for (const r of matrix.roles) state[r.roleName] = { ...r.permissions };
        setOriginal(state);
        setDraft(JSON.parse(JSON.stringify(state)));
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Failed to load privileges.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isAdmin]);

  const groups = useMemo(() => {
    const map = new Map<string, PrivilegeCatalogItem[]>();
    for (const item of catalog) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return Array.from(map.entries());
  }, [catalog]);

  const isLocked = (roleName: string, key: string) => roleName === 'Admin' && ADMIN_FLOOR.includes(key);

  const dirty = useMemo(() => JSON.stringify(original) !== JSON.stringify(draft), [original, draft]);

  const changedCount = useMemo(() => {
    let n = 0;
    for (const role of roleNames) {
      for (const item of catalog) {
        if (original[role]?.[item.key] !== draft[role]?.[item.key]) n++;
      }
    }
    return n;
  }, [original, draft, roleNames, catalog]);

  const toggle = (roleName: string, key: string) => {
    if (isLocked(roleName, key)) return;
    setDraft((prev) => ({
      ...prev,
      [roleName]: { ...prev[roleName], [key]: !prev[roleName]?.[key] },
    }));
  };

  const handlePublish = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: RolePrivileges[] = roleNames.map((roleName) => ({
        roleName,
        permissions: draft[roleName],
      }));
      await publishPrivileges(payload);
      window.location.reload();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to publish privileges.'));
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <Lock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-800">Access restricted</h1>
          <p className="text-sm text-slate-500 mt-1">
            Only an Administrator can manage the global privilege matrix.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading privileges…
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">Global Privileges</h2>
            <p className="text-sm text-slate-500">
              Configure what each role can do system-wide. Changes take effect only after you publish.
            </p>
          </div>
        </div>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!dirty}
          className={`px-4 py-2.5 rounded-xl font-medium transition-colors ${
            dirty
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          {dirty ? `Publish Changes (${changedCount})` : 'No changes'}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center space-x-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left font-semibold text-slate-600 px-5 py-3 sticky left-0 bg-white">Permission</th>
              {roleNames.map((role) => (
                <th key={role} className="text-center font-semibold text-slate-600 px-4 py-3 whitespace-nowrap">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, items]) => (
              <GroupRows
                key={group}
                group={group}
                items={items}
                roleNames={roleNames}
                draft={draft}
                isLocked={isLocked}
                toggle={toggle}
              />
            ))}
          </tbody>
        </table>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Publish privilege changes?</h2>
            <p className="text-sm text-slate-500 mb-5">
              You are about to change <strong>{changedCount}</strong> privilege
              {changedCount === 1 ? '' : 's'} system-wide. This takes effect immediately for all
              users of the affected roles and is recorded in the audit log.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-medium flex items-center"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Confirm & Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRows({
  group,
  items,
  roleNames,
  draft,
  isLocked,
  toggle,
}: {
  group: string;
  items: PrivilegeCatalogItem[];
  roleNames: string[];
  draft: DraftState;
  isLocked: (roleName: string, key: string) => boolean;
  toggle: (roleName: string, key: string) => void;
}) {
  return (
    <>
      <tr className="bg-slate-50/70">
        <td colSpan={roleNames.length + 1} className="px-5 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          {group}
        </td>
      </tr>
      {items.map((item) => (
        <tr key={item.key} className="border-b border-slate-50 hover:bg-slate-50/40">
          <td className="px-5 py-3 sticky left-0 bg-white">
            <div className="text-slate-700">{item.label}</div>
            <div className="text-xs text-slate-400 font-mono">{item.key}</div>
          </td>
          {roleNames.map((role) => {
            const locked = isLocked(role, item.key);
            const checked = !!draft[role]?.[item.key];
            return (
              <td key={role} className="text-center px-4 py-3">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  onChange={() => toggle(role, item.key)}
                  title={locked ? 'Always enabled for Admin' : undefined}
                  className={`w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 ${
                    locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
