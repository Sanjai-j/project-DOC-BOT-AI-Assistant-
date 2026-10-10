import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner, EmptyState, ErrorBox, OkBox, StatusBadge, ConfirmDialog } from '../components/ui';

interface DocRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  specialization: string;
  experience_years: number;
  hospital_name: string;
  doctor_code: string;
  status: string;
  avg_rating: number;
  reviews_count: number;
}

const FILTERS = [
  { v: '', l: 'All' },
  { v: 'APPROVED', l: 'Approved' },
  { v: 'PENDING', l: 'Pending' },
  { v: 'INFO_REQUESTED', l: 'Info requested' },
  { v: 'REJECTED', l: 'Rejected' },
  { v: 'SUSPENDED', l: 'Suspended' },
];

export default function AdminDoctors() {
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [filter, setFilter] = useState('APPROVED');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [suspending, setSuspending] = useState<DocRow | null>(null);
  const [reactivating, setReactivating] = useState<DocRow | null>(null);

  const load = useCallback(async () => {
    const qs = filter ? `?status=${filter}` : '';
    const r = await api<{ doctors: DocRow[] }>(`/api/admin/doctors${qs}`).catch(() => ({ doctors: [] }));
    setRows(r.doctors);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function doSuspend() {
    if (!suspending) return;
    try {
      await api(`/api/admin/doctors/${suspending.id}/suspend`, { method: 'POST' });
      setOk(`Dr. ${suspending.full_name} suspended — they can no longer log in.`);
    } catch (e: any) {
      setError(e.message);
    }
    setSuspending(null);
    load();
  }

  async function doReactivate() {
    if (!reactivating) return;
    try {
      await api(`/api/admin/doctors/${reactivating.id}/reactivate`, { method: 'POST' });
      setOk(`Dr. ${reactivating.full_name} reactivated.`);
    } catch (e: any) {
      setError(e.message);
    }
    setReactivating(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Doctors</h1>
        <p className="text-sm text-slate-500">All registered doctors and their verification status.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              filter === f.v ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="cross" title="No doctors in this category" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Doctor ID</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Specialty</th>
                <th className="px-5 py-3">Hospital</th>
                <th className="px-5 py-3">Rating</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-3 font-mono text-xs font-bold text-brand-700">{d.doctor_code}</td>
                  <td className="px-5 py-3">
                    <b>Dr. {d.full_name}</b>
                    <div className="text-xs text-slate-400">{d.email}</div>
                  </td>
                  <td className="px-5 py-3">{d.specialization}</td>
                  <td className="px-5 py-3 text-slate-500">{d.hospital_name}</td>
                  <td className="px-5 py-3">
                    {Number(d.avg_rating).toFixed(1)} <span className="text-xs text-slate-400">({d.reviews_count})</span>
                  </td>
                  <td className="px-5 py-3"><StatusBadge status={d.status} /></td>
                  <td className="px-5 py-3">
                    {d.status === 'APPROVED' && (
                      <button className="btn-danger !py-1.5 !text-xs" onClick={() => setSuspending(d)}>Suspend</button>
                    )}
                    {d.status === 'SUSPENDED' && (
                      <button className="btn-success !py-1.5 !text-xs" onClick={() => setReactivating(d)}>Reactivate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(suspending)}
        title={`Suspend Dr. ${suspending?.full_name}?`}
        message="Their login will be blocked immediately and patients cannot book them."
        confirmLabel="Suspend"
        danger
        onConfirm={doSuspend}
        onCancel={() => setSuspending(null)}
      />
      <ConfirmDialog
        open={Boolean(reactivating)}
        title={`Reactivate Dr. ${reactivating?.full_name}?`}
        message="They will be able to log in and accept appointments again."
        confirmLabel="Reactivate"
        onConfirm={doReactivate}
        onCancel={() => setReactivating(null)}
      />
    </div>
  );
}
