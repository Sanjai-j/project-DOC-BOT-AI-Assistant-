import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBox, OkBox, Spinner } from '../components/ui';

interface Settings {
  emergency_number: string;
  default_slot_minutes: number;
  video_reminder_30: boolean;
  video_reminder_10: boolean;
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: Settings }>('/api/admin/settings').then((r) => setSettings(r.settings)).catch((e) => setError(e.message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api('/api/admin/settings', { method: 'PUT', body: settings });
      setOk('Settings saved. The emergency number is used app-wide immediately.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return error ? <ErrorBox message={error} /> : <Spinner />;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Application settings</h1>
        <p className="text-sm text-slate-500">Platform-wide configuration.</p>
      </div>

      <form onSubmit={save} className="card space-y-5 p-6">
        <div>
          <label className="label">Emergency phone number *</label>
          <input
            className="input"
            required
            value={settings.emergency_number}
            onChange={(e) => setSettings((s) => ({ ...s!, emergency_number: e.target.value }))}
          />
          <p className="mt-1 text-xs text-slate-400">
            Used by every Emergency button (tel: links) — verify it is correct for your region.
          </p>
        </div>

        <div>
          <label className="label">Default appointment duration (minutes)</label>
          <select
            className="input"
            value={settings.default_slot_minutes}
            onChange={(e) => setSettings((s) => ({ ...s!, default_slot_minutes: Number(e.target.value) }))}
          >
            {[15, 20, 30, 45, 60].map((n) => (
              <option key={n} value={n}>{n} minutes</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={settings.video_reminder_30}
              onChange={(e) => setSettings((s) => ({ ...s!, video_reminder_30: e.target.checked }))}
            />
            Send video reminders 30 minutes before
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={settings.video_reminder_10}
              onChange={(e) => setSettings((s) => ({ ...s!, video_reminder_10: e.target.checked }))}
            />
            Send video reminders 10 minutes before
          </label>
        </div>

        {error && <ErrorBox message={error} />}
        {ok && <OkBox message={ok} />}
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </form>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        Important: double-check the emergency number. Every Emergency button dials it directly via the browser.
      </div>
    </div>
  );
}
