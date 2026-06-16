'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { getNotificationConfig, updateNotificationConfig } from '../../api/notificationConfigApi';
import { NotificationEventCatalogItem } from '../../types';
import { apiErrorMessage } from '../../api/errorMessage';

const ADMIN_DIRECTOR = ['Admin', 'Director'];

type ConfigState = Record<string, { enabled: boolean; ccManagers: boolean }>;

export default function NotificationConfigSettings() {
  const user = useAuthStore((s) => s.user);
  const canManage = user ? ADMIN_DIRECTOR.includes(user.role) : false;

  const [catalog, setCatalog] = useState<NotificationEventCatalogItem[]>([]);
  const [original, setOriginal] = useState<ConfigState>({});
  const [draft, setDraft] = useState<ConfigState>({});
  const [loading, setLoading] = useState(canManage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    getNotificationConfig()
      .then((res) => {
        if (cancelled) return;
        setCatalog(res.catalog);
        const state: ConfigState = {};
        for (const c of res.configs) state[c.eventKey] = { enabled: c.enabled, ccManagers: c.ccManagers };
        setOriginal(state);
        setDraft(JSON.parse(JSON.stringify(state)));
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Failed to load notification config.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canManage]);

  const groups = useMemo(() => {
    const map = new Map<string, NotificationEventCatalogItem[]>();
    for (const item of catalog) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return Array.from(map.entries());
  }, [catalog]);

  const changedKeys = useMemo(
    () =>
      catalog
        .map((c) => c.key)
        .filter(
          (k) =>
            original[k]?.enabled !== draft[k]?.enabled ||
            original[k]?.ccManagers !== draft[k]?.ccManagers
        ),
    [catalog, original, draft]
  );
  const dirty = changedKeys.length > 0;

  const toggle = (key: string, field: 'enabled' | 'ccManagers') => {
    setDraft((prev) => ({ ...prev, [key]: { ...prev[key], [field]: !prev[key]?.[field] } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const key of changedKeys) {
        await updateNotificationConfig(key, draft[key]);
      }
      setOriginal(JSON.parse(JSON.stringify(draft)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to save notification config.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <Lock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-800">Access restricted</h1>
          <p className="text-sm text-slate-500 mt-1">
            Only an Administrator or Director can configure notifications.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading notification config…
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Bell className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">Notifications</h2>
            <p className="text-sm text-slate-500">
              Choose which events send notifications and whether to CC division managers.
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className={`px-4 py-2.5 rounded-xl font-medium transition-colors flex items-center ${
            dirty && !saving
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {dirty ? `Save Changes (${changedKeys.length})` : 'No changes'}
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
              <th className="text-left font-semibold text-slate-600 px-5 py-3">Event</th>
              <th className="text-center font-semibold text-slate-600 px-4 py-3 whitespace-nowrap">Enabled</th>
              <th className="text-center font-semibold text-slate-600 px-4 py-3 whitespace-nowrap">CC division managers</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, items]) => (
              <GroupRows key={group} group={group} items={items} draft={draft} toggle={toggle} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({
  group,
  items,
  draft,
  toggle,
}: {
  group: string;
  items: NotificationEventCatalogItem[];
  draft: ConfigState;
  toggle: (key: string, field: 'enabled' | 'ccManagers') => void;
}) {
  return (
    <>
      <tr className="bg-slate-50/70">
        <td colSpan={3} className="px-5 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          {group}
        </td>
      </tr>
      {items.map((item) => {
        const value = draft[item.key] ?? { enabled: true, ccManagers: false };
        return (
          <tr key={item.key} className="border-b border-slate-50 hover:bg-slate-50/40">
            <td className="px-5 py-3">
              <div className="text-slate-700 font-medium">{item.label}</div>
              <div className="text-xs text-slate-400">{item.description}</div>
              {item.recipientsFromPrivileges && (
                <div className="text-xs text-slate-400 mt-1">
                  Base recipients are governed by the{' '}
                  <a href="/dashboard/settings?tab=privileges" className="text-blue-600 hover:underline">
                    Privileges
                  </a>{' '}
                  tab.
                </div>
              )}
            </td>
            <td className="text-center px-4 py-3">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={() => toggle(item.key, 'enabled')}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            </td>
            <td className="text-center px-4 py-3">
              <input
                type="checkbox"
                checked={value.ccManagers}
                disabled={!value.enabled}
                onChange={() => toggle(item.key, 'ccManagers')}
                title={!value.enabled ? 'Enable the event first' : undefined}
                className={`w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 ${
                  value.enabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
                }`}
              />
            </td>
          </tr>
        );
      })}
    </>
  );
}
