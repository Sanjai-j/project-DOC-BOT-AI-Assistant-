import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { StatusBadge, Spinner, EmptyState, ConfirmDialog } from '../components/ui';

interface Appt {
  id: string;
  date: string;
  start_time: string;
  consultation_type: string;
  status: string;
  patient_name: string;
  reason: string | null;
}

export default function DoctorAppointments() {
  const [items, setItems] = useState<Appt[] | null>(null);
  const [completing, setCompleting] = useState<Appt | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ appointments: Appt[] }>('/api/appointments').catch(() => ({ appointments: [] }));
    setItems(r.appointments);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function complete() {
    if (!completing) return;
    try {
      await api(`/api/appointments/${completing.id}/complete`, { method: 'POST' });
      setOk('Marked completed. The patient can now leave a review.');
    } catch (err: any) {
      setError(err.message);
    }
    setCompleting(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Appointments</h1>
        <p className="text-sm text-slate-500">All your confirmed, completed and cancelled appointments.</p>
      </div>

      {ok && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{ok}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="calendar" title="No appointments yet" />
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-slate-900">{a.patient_name}</b>
                  <StatusBadge status={a.status} />
                  {a.consultation_type === 'VIDEO' && <span className="badge bg-rose-50 text-rose-700">Video</span>}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {String(a.date).slice(0, 10)} · {String(a.start_time).slice(0, 5)}
                  {a.reason ? ` · ${a.reason}` : ''}
                </p>
              </div>
              <div className="shrink-0">
                {a.status === 'CONFIRMED' && (
                  <button className="btn-outline !py-2 !text-xs" onClick={() => setCompleting(a)}>
                    Mark completed
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(completing)}
        title="Mark consultation completed?"
        message="The patient will be notified and can rate the consultation."
        confirmLabel="Mark completed"
        onConfirm={complete}
        onCancel={() => setCompleting(null)}
      />
    </div>
  );
}
