import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner, EmptyState } from '../components/ui';

interface Appt {
  id: string;
  date: string;
  status: string;
  patient_name: string;
  reason: string | null;
  consultation_type: string;
}

export default function DoctorPatients() {
  const [items, setItems] = useState<Appt[] | null>(null);

  useEffect(() => {
    api<{ appointments: Appt[] }>('/api/appointments')
      .then((r) => {
        // unique patients by name with visit count
        const map = new Map<string, { name: string; visits: number; last: string; reasons: Set<string> }>();
        r.appointments.forEach((a) => {
          const cur = map.get(a.patient_name) ?? { name: a.patient_name, visits: 0, last: a.date, reasons: new Set() };
          cur.visits += 1;
          if (a.date > cur.last) cur.last = a.date;
          if (a.reason) cur.reasons.add(a.reason);
          map.set(a.patient_name, cur);
        });
        setItems(Object.values(map).map((m: any) => ({ ...m, reasons: [...m.reasons] })) as any);
      })
      .catch(() => setItems([]));
  }, []);

  if (items === null) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Patients</h1>
        <p className="text-sm text-slate-500">People who have consulted or requested consultations with you.</p>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="users" title="No patients yet" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Patient</th>
                <th className="px-5 py-3">Visits</th>
                <th className="px-5 py-3">Last appointment</th>
                <th className="px-5 py-3">Reasons</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((p: any) => (
                <tr key={p.name}>
                  <td className="px-5 py-3 font-semibold text-slate-800">{p.name}</td>
                  <td className="px-5 py-3">{p.visits}</td>
                  <td className="px-5 py-3">{String(p.last).slice(0, 10)}</td>
                  <td className="px-5 py-3 text-slate-500">{(p.reasons ?? []).slice(0, 2).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
