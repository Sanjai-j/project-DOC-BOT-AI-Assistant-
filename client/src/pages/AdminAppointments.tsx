import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner, EmptyState, StatusBadge } from '../components/ui';

interface Appt {
  id: string;
  date: string;
  start_time: string;
  consultation_type: string;
  status: string;
  patient_name: string;
  doctor_name: string;
}

const FILTERS = ['', 'PENDING', 'CONFIRMED', 'COMPLETED', 'REJECTED', 'CANCELLED'];

export default function AdminAppointments() {
  const [rows, setRows] = useState<Appt[] | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    const qs = filter ? `?status=${filter}` : '';
    const r = await api<{ appointments: Appt[] }>(`/api/admin/appointments${qs}`).catch(() => ({ appointments: [] }));
    setRows(r.appointments);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Appointments</h1>
        <p className="text-sm text-slate-500">Monitor all appointments across the platform.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              filter === f ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="calendar" title="No appointments found" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Date & time</th>
                <th className="px-5 py-3">Patient</th>
                <th className="px-5 py-3">Doctor</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="px-5 py-3">
                    {String(a.date).slice(0, 10)}
                    <div className="text-xs text-slate-400">{String(a.start_time).slice(0, 5)}</div>
                  </td>
                  <td className="px-5 py-3 font-semibold">{a.patient_name}</td>
                  <td className="px-5 py-3">Dr. {a.doctor_name}</td>
                  <td className="px-5 py-3">{a.consultation_type === 'VIDEO' ? 'Video' : 'In-person'}</td>
                  <td className="px-5 py-3"><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
