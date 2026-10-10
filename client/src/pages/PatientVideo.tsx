import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { StatusBadge, Spinner, EmptyState } from '../components/ui';

interface VConsult {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  video_status: string;
  doctor_name: string;
  specialization: string;
  reason: string | null;
}

function fmt12(t: string): string {
  let [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function windowOpen(date: string, start: string, end: string): boolean {
  const s = new Date(`${String(date).slice(0, 10)}T${start.slice(0, 5)}:00`).getTime();
  const e = new Date(`${String(date).slice(0, 10)}T${end.slice(0, 5)}:00`).getTime();
  const now = Date.now();
  return now >= s - 10 * 60_000 && now <= e + 15 * 60_000;
}

export default function PatientVideo() {
  const navigate = useNavigate();
  const [items, setItems] = useState<VConsult[] | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api<{ consultations: VConsult[] }>('/api/video/mine');
      setItems(r.consultations);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [load]);

  async function join(v: VConsult) {
    try {
      await api(`/api/video/room/${v.id}`);
      navigate(`/patient/video/${v.id}`);
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Video consultations</h1>
        <p className="text-sm text-slate-500">
          The <b>Join</b> button activates when the doctor has confirmed and the appointment time arrives — patients
          cannot start calls.
        </p>
      </div>

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="video" title="No video consultations" hint="Request one from any doctor profile." />
      ) : (
        <div className="space-y-3">
          {items.map((v) => {
            const confirmed = v.status === 'CONFIRMED';
            const inWindow = windowOpen(String(v.date).slice(0, 10), String(v.start_time), String(v.end_time));
            const canJoin = confirmed && inWindow;
            return (
              <div key={v.id} className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-slate-900">Dr. {v.doctor_name}</b>
                    <span className="badge bg-brand-50 text-brand-700">{v.specialization}</span>
                    <StatusBadge status={v.status} />
                    {v.video_status === 'IN_PROGRESS' && <span className="badge-emergency">LIVE NOW</span>}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {String(v.date).slice(0, 10)} · {fmt12(String(v.start_time).slice(0, 5))} – {fmt12(String(v.end_time).slice(0, 5))}
                    {v.reason ? ` · ${v.reason}` : ''}
                  </p>
                </div>
                <div className="shrink-0">
                  {canJoin ? (
                    <button className="btn-success" onClick={() => join(v)}>Join Consultation</button>
                  ) : confirmed ? (
                    <button className="btn-outline" disabled>
                      Join opens near {fmt12(String(v.start_time).slice(0, 5))}
                    </button>
                  ) : (
                    <StatusBadge status={v.status} />
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
