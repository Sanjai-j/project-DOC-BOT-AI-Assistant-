import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { StatusBadge, Spinner, EmptyState } from '../components/ui';

interface Appt {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  consultation_type: string;
  status: string;
  reason: string | null;
  patient_name: string;
}

function fmt12(t: string): string {
  let [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function DoctorRequests() {
  const [items, setItems] = useState<Appt[] | null>(null);
  const [rejecting, setRejecting] = useState<Appt | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ appointments: Appt[] }>('/api/appointments?status=PENDING').catch(() => ({ appointments: [] }));
    setItems(r.appointments);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function accept(a: Appt) {
    try {
      await api(`/api/appointments/${a.id}/accept`, { method: 'POST' });
      setOk(`Accepted ${a.patient_name}'s ${String(a.date).slice(0, 10)} appointment. The patient has been notified.`);
    } catch (err: any) {
      setError(err.message);
    }
    load();
  }

  async function reject() {
    if (!rejecting) return;
    try {
      await api(`/api/appointments/${rejecting.id}/reject`, { method: 'POST', body: { reason: rejectReason || undefined } });
      setOk('Request rejected. The patient has been notified.');
    } catch (err: any) {
      setError(err.message);
    }
    setRejecting(null);
    setRejectReason('');
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Appointment requests</h1>
        <p className="text-sm text-slate-500">Patients' requests stay pending until you accept or reject them.</p>
      </div>

      {ok && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{ok}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="inbox" title="No pending requests" hint="New appointment requests will appear here." />
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className="card flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-slate-900">{a.patient_name}</b>
                  <StatusBadge status={a.status} />
                  {a.consultation_type === 'VIDEO' && <span className="badge bg-rose-50 text-rose-700">Video</span>}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {String(a.date).slice(0, 10)} · {fmt12(String(a.start_time).slice(0, 5))} – {fmt12(String(a.end_time).slice(0, 5))}
                </p>
                {a.reason && <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">“{a.reason}”</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-success" onClick={() => accept(a)}>Accept</button>
                <button className="btn-danger" onClick={() => setRejecting(a)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Reject request from {rejecting.patient_name}?</h3>
            <textarea
              className="input mt-3"
              rows={2}
              placeholder="Reason (optional, shared with the patient)…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn-danger" onClick={reject}>Reject request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
