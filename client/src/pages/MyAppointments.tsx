import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { StatusBadge, Spinner, EmptyState, ConfirmDialog } from '../components/ui';

interface Appt {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  consultation_type: string;
  status: string;
  reason: string | null;
  notes: string | null;
  doctor_name: string;
  specialization: string;
}

const TABS = ['UPCOMING', 'PENDING', 'COMPLETED', 'CANCELLED'] as const;

function fmt12(t: string): string {
  let [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function MyAppointments() {
  const [appts, setAppts] = useState<Appt[] | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('UPCOMING');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reviewFor, setReviewFor] = useState<Appt | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ appointments: Appt[] }>('/api/appointments');
      setAppts(r.appointments);
    } catch (err: any) {
      setError(err.message);
      setAppts([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel() {
    if (!cancelId) return;
    try {
      await api(`/api/appointments/${cancelId}/cancel`, { method: 'POST' });
      setOk('Appointment cancelled.');
    } catch (err: any) {
      setError(err.message);
    }
    setCancelId(null);
    load();
  }

  async function submitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewFor) return;
    try {
      await api(`/api/appointments/${reviewFor.id}/review`, { method: 'POST', body: { rating, comment } });
      setOk('Thank you — your review was submitted!');
      setReviewFor(null);
      setComment('');
    } catch (err: any) {
      setError(err.message);
    }
    load();
  }

  const upcomingList = (appts ?? []).filter((a) => {
    if (tab === 'UPCOMING') return ['PENDING', 'CONFIRMED'].includes(a.status);
    if (tab === 'PENDING') return a.status === 'PENDING';
    if (tab === 'COMPLETED') return a.status === 'COMPLETED';
    return a.status === 'CANCELLED' || a.status === 'REJECTED';
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">My appointments</h1>
          <p className="text-sm text-slate-500">Requests, confirmed visits and consultation history.</p>
        </div>
        <Link to="/patient/find" className="btn-primary !py-2 !text-xs">+ Book new appointment</Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              tab === t ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {t === 'UPCOMING' ? 'Upcoming' : t === 'PENDING' ? 'Pending requests' : t === 'COMPLETED' ? 'Completed' : 'Cancelled / Rejected'}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {ok && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{ok}</div>}

      {appts === null ? (
        <Spinner />
      ) : upcomingList.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing here yet" hint="Book a consultation to get started." />
      ) : (
        <div className="space-y-3">
          {upcomingList.map((a) => (
            <div key={a.id} className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-slate-900">Dr. {a.doctor_name}</b>
                  <span className="badge bg-brand-50 text-brand-700">{a.specialization}</span>
                  <StatusBadge status={a.status} />
                  {a.consultation_type === 'VIDEO' && <span className="badge bg-rose-50 text-rose-700">Video</span>}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {String(a.date).slice(0, 10)} · {fmt12(String(a.start_time).slice(0, 5))}
                  {a.reason ? ` · ${a.reason}` : ''}
                </p>
                {a.notes && <p className="mt-0.5 text-xs text-slate-400">Doctor's note: {a.notes}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {a.status === 'COMPLETED' && (
                  <button className="btn-outline !py-2 !text-xs" onClick={() => setReviewFor(a)}>
                    Rate
                  </button>
                )}
                {['PENDING', 'CONFIRMED'].includes(a.status) && (
                  <button className="btn-danger !py-2 !text-xs" onClick={() => setCancelId(a.id)}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelId)}
        title="Cancel this appointment?"
        message="The doctor will be notified. This cannot be undone."
        confirmLabel="Yes, cancel it"
        danger
        onConfirm={cancel}
        onCancel={() => setCancelId(null)}
      />

      {reviewFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <form onSubmit={submitReview} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Rate Dr. {reviewFor.doctor_name}</h3>
            <div className="mt-3 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button type="button" key={n} onClick={() => setRating(n)} className="text-3xl leading-none">
                  <span className={n <= rating ? 'text-amber-400' : 'text-slate-300'}>★</span>
                </button>
              ))}
            </div>
            <textarea
              className="input mt-3"
              rows={3}
              placeholder="Optional review…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={() => setReviewFor(null)}>Cancel</button>
              <button className="btn-primary">Submit review</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
