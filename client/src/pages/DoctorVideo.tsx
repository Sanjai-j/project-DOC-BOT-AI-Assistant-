import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, StatusBadge, Spinner, EmptyState } from '../components/ui';

interface VConsult {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  video_status: string;
  patient_name: string;
  reason: string | null;
}

function fmt12(t: string): string {
  let [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function doctorWindow(date: string, start: string, end: string): boolean {
  const s = new Date(`${String(date).slice(0, 10)}T${start.slice(0, 5)}:00`).getTime();
  const e = new Date(`${String(date).slice(0, 10)}T${end.slice(0, 5)}:00`).getTime();
  const now = Date.now();
  return now >= s - 15 * 60_000 && now <= e + 30 * 60_000;
}

export default function DoctorVideo() {
  const navigate = useNavigate();
  const [items, setItems] = useState<VConsult[] | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const r = await api<{ consultations: VConsult[] }>('/api/video/mine').catch(() => ({ consultations: [] }));
    setItems(r.consultations);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [load]);

  async function accept(v: VConsult) {
    try {
      await api('/api/video/accept', { method: 'POST', body: { appointmentId: v.id } });
      setOk('Video consultation confirmed. The patient can join at the appointment time — you start the call.');
    } catch (err: any) {
      setError(err.message);
    }
    load();
  }

  async function reject(v: VConsult) {
    try {
      await api('/api/video/reject', { method: 'POST', body: { appointmentId: v.id } });
      setOk('Video request rejected. The patient has been notified.');
    } catch (err: any) {
      setError(err.message);
    }
    load();
  }

  async function startCall(v: VConsult) {
    try {
      await api(`/api/video/${v.id}/start`, { method: 'POST' });
      navigate(`/doctor/video/${v.id}`);
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Video consultations</h1>
        <p className="text-sm text-slate-500">
          Accept requests, get reminders, then use <b>Start Call</b> — only doctors can start calls.
        </p>
      </div>

      {ok && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{ok}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="video" title="No video consultations" hint="Patient video requests will appear here." />
      ) : (
        <div className="space-y-3">
          {items.map((v) => {
            const confirmed = v.status === 'CONFIRMED';
            const inWindow = doctorWindow(String(v.date).slice(0, 10), String(v.start_time), String(v.end_time));
            return (
              <div key={v.id} className="card flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-slate-900">{v.patient_name}</b>
                    <StatusBadge status={v.status} />
                    {v.video_status === 'IN_PROGRESS' && <span className="badge-emergency">LIVE NOW</span>}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {String(v.date).slice(0, 10)} · {fmt12(String(v.start_time).slice(0, 5))} – {fmt12(String(v.end_time).slice(0, 5))}
                  </p>
                  {v.reason && <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">“{v.reason}”</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {v.status === 'PENDING' && (
                    <>
                      <button className="btn-success" onClick={() => accept(v)}>Accept</button>
                      <button className="btn-danger" onClick={() => reject(v)}>Reject</button>
                    </>
                  )}
                  {confirmed && (
                    <button className="btn-primary" disabled={!inWindow} onClick={() => startCall(v)}>
                      Start Call
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
