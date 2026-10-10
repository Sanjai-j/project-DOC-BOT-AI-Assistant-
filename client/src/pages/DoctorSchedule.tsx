import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner, ErrorBox, OkBox } from '../components/ui';

interface Availability {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  break_start: string | null;
  break_end: string | null;
  is_active: boolean;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Row {
  weekday: number;
  enabled: boolean;
  start: string;
  end: string;
  slot: number;
  breakStart: string;
  breakEnd: string;
}

function toRows(avail: Availability[]): Row[] {
  return DAYS.map((_, i) => {
    const a = avail.find((x) => x.weekday === i);
    return {
      weekday: i,
      enabled: Boolean(a),
      start: a?.start_time?.slice(0, 5) ?? '09:00',
      end: a?.end_time?.slice(0, 5) ?? '17:00',
      slot: a?.slot_minutes ?? 30,
      breakStart: a?.break_start ? String(a.break_start).slice(0, 5) : '',
      breakEnd: a?.break_end ? String(a.break_end).slice(0, 5) : '',
    };
  });
}

export default function DoctorSchedule() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [leave, setLeave] = useState<{ date: string; reason: string | null }[]>([]);
  const [newLeave, setNewLeave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api<{ user: any }>('/api/auth/me');
      const s = await api<{ weekly: Availability[] }>(`/api/doctors/${me.user.id}/slots`);
      setRows(toRows(s.weekly));
      const lv = await api<{ unavailable?: any[] }>(`/api/doctors/${me.user.id}/unavailable`).catch(() => ({ unavailable: [] }));
      setLeave(lv.unavailable ?? []);
    } catch (err: any) {
      setError(err.message);
      setRows(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api(`/api/doctors/${(await api<{ user: any }>('/api/auth/me')).user.id}/availability`, {
        method: 'PUT',
        body: {
          rows: rows.map((r) => ({
            weekday: r.weekday,
            enabled: r.enabled,
            start: r.start,
            end: r.end,
            slotMinutes: r.slot,
            breakStart: r.breakStart || undefined,
            breakEnd: r.breakEnd || undefined,
          })),
        },
      });
      setOk('Schedule saved. Slots are regenerated automatically and double-booking is prevented.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addLeave() {
    if (!newLeave) return;
    try {
      await api(`/api/doctors/${(await api<{ user: any }>('/api/auth/me')).user.id}/unavailable`, {
        method: 'POST',
        body: { date: newLeave },
      });
      setNewLeave('');
      const me = await api<{ user: any }>('/api/auth/me');
      const lv = await api<{ unavailable?: any[] }>(`/api/doctors/${me.user.id}/unavailable`);
      setLeave(lv.unavailable ?? []);
      setOk('Leave date added — slots on that date are now hidden.');
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (rows === null) {
    return error ? <ErrorBox message={error} /> : <Spinner />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Schedule management</h1>
        <p className="text-sm text-slate-500">
          Working days, hours, consultation duration and breaks. Booked slots are never offered twice.
        </p>
      </div>

      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      <div className="card divide-y divide-slate-100">
        {rows.map((r) => {
          const idx = rows.indexOf(r);
          const upd = (patch: Partial<Row>) =>
            setRows((cur) => cur!.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
          return (
            <div key={r.weekday} className="flex flex-wrap items-center gap-3 p-4">
              <label className="flex w-32 items-center gap-2 font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  checked={r.enabled}
                  onChange={(e) => upd({ enabled: e.target.checked })}
                />
                {DAYS[r.weekday]}
              </label>
              {r.enabled ? (
                <>
                  <input type="time" className="input !w-28" value={r.start} onChange={(e) => upd({ start: e.target.value })} />
                  <span className="text-slate-400">–</span>
                  <input type="time" className="input !w-28" value={r.end} onChange={(e) => upd({ end: e.target.value })} />
                  <select className="input !w-32" value={r.slot} onChange={(e) => upd({ slot: Number(e.target.value) })}>
                    <option value={15}>15 min slots</option>
                    <option value={30}>30 min slots</option>
                    <option value={45}>45 min slots</option>
                    <option value={60}>60 min slots</option>
                  </select>
                  <div className="flex items-center gap-1 text-sm text-slate-500">
                    Break
                    <input type="time" className="input !w-24" value={r.breakStart} onChange={(e) => upd({ breakStart: e.target.value })} />
                    <input type="time" className="input !w-24" value={r.breakEnd} onChange={(e) => upd({ breakEnd: e.target.value })} />
                  </div>
                </>
              ) : (
                <span className="text-sm text-slate-400">Unavailable</span>
              )}
            </div>
          );
        })}
      </div>

      <button className="btn-primary" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save schedule'}
      </button>

      <section className="card p-5">
        <h2 className="font-bold text-slate-900">Leave / unavailable dates</h2>
        <div className="mt-3 flex gap-2">
          <input type="date" className="input !w-44" value={newLeave} onChange={(e) => setNewLeave(e.target.value)} />
          <button className="btn-outline" onClick={addLeave}>Add</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {leave.map((l) => (
            <span key={l.date} className="badge bg-slate-100 text-slate-600">
              {String(l.date).slice(0, 10)}{l.reason ? ` — ${l.reason}` : ''}
            </span>
          ))}
          {leave.length === 0 && <p className="text-sm text-slate-400">No leave dates.</p>}
        </div>
      </section>
    </div>
  );
}
