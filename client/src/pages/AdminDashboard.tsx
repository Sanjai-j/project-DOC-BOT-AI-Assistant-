import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner } from '../components/ui';

interface Stats {
  pendingDoctors: number;
  approvedDoctors: number;
  rejectedDoctors: number;
  patients: number;
  appointments: number;
  pendingAppointments: number;
  hospitals: number;
  emergencyRequests: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<any>(null);

  useEffect(() => {
    api<{ stats: Stats }>('/api/admin/stats').then((r) => setStats(r.stats)).catch(() => setStats(null));
    api<any>('/api/admin/reports').then(setReports).catch(() => {});
  }, []);

  if (!stats) return <Spinner />;

  const cards = [
    { label: 'Pending doctors', value: stats.pendingDoctors, icon: 'clock', to: '/admin/verification', alert: stats.pendingDoctors > 0 },
    { label: 'Approved doctors', value: stats.approvedDoctors, icon: 'cross', to: '/admin/doctors', alert: false },
    { label: 'Rejected / suspended', value: stats.rejectedDoctors, icon: 'x', to: '/admin/doctors', alert: false },
    { label: 'Patients', value: stats.patients, icon: 'users', to: '/admin/patients', alert: false },
    { label: 'Appointments', value: stats.appointments, icon: 'calendar', to: '/admin/appointments', alert: false },
    { label: 'Pending appointments', value: stats.pendingAppointments, icon: 'clock', to: '/admin/appointments', alert: false },
    { label: 'Hospitals', value: stats.hospitals, icon: 'building', to: '/admin/hospitals', alert: false },
    { label: 'Open emergency requests', value: stats.emergencyRequests, icon: 'alert', to: '/admin/emergency', alert: stats.emergencyRequests > 0 },
  ] as const;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Admin dashboard</h1>
        <p className="text-sm text-slate-500">Doctor verification, platform health and operations.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className={`card p-5 transition hover:shadow-md ${c.alert ? 'ring-2 ring-amber-300' : ''}`}>
            <div className="flex items-center justify-between">
              <Icon name={c.icon} className="h-6 w-6 text-brand-600" />
              <span className="text-3xl font-extrabold text-slate-900">{c.value}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-slate-500">{c.label}</p>
          </Link>
        ))}
      </div>

      {reports && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="card p-5">
            <h2 className="font-bold text-slate-900">Appointments by status</h2>
            <div className="mt-3 space-y-1.5 text-sm">
              {reports.byStatus?.map((r: any) => (
                <div key={r.status} className="flex justify-between">
                  <StatusInline status={r.status} />
                  <b>{r.count}</b>
                </div>
              ))}
            </div>
          </section>
          <section className="card p-5">
            <h2 className="font-bold text-slate-900">Demand by specialty</h2>
            <div className="mt-3 space-y-1.5 text-sm">
              {reports.bySpecialty?.slice(0, 6).map((r: any) => (
                <div key={r.specialization} className="flex justify-between">
                  <span>{r.specialization}</span>
                  <b>{r.count}</b>
                </div>
              ))}
            </div>
          </section>
          <section className="card p-5">
            <h2 className="font-bold text-slate-900">Top-rated doctors</h2>
            <div className="mt-3 space-y-1.5 text-sm">
              {reports.topDoctors?.slice(0, 6).map((r: any) => (
                <div key={r.full_name} className="flex justify-between">
                  <span>Dr. {r.full_name} <span className="text-slate-400">· {r.specialization}</span></span>
                  <b>{Number(r.avg_rating).toFixed(1)}</b>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function StatusInline({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'badge-pending',
    CONFIRMED: 'badge-confirmed',
    COMPLETED: 'badge-completed',
    CANCELLED: 'badge-cancelled',
    REJECTED: 'badge-rejected',
  };
  return <span className={map[status] ?? 'badge bg-slate-100 text-slate-600'}>{status}</span>;
}
