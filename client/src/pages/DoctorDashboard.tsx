import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, StatusBadge } from '../components/ui';

interface Appt {
  id: string;
  date: string;
  start_time: string;
  consultation_type: string;
  status: string;
  patient_name: string;
  reason: string | null;
}

export default function DoctorDashboard() {
  const [appts, setAppts] = useState<Appt[] | null>(null);

  useEffect(() => {
    api<{ appointments: Appt[] }>('/api/appointments')
      .then((r) => setAppts(r.appointments))
      .catch(() => setAppts([]));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const all = appts ?? [];
  const pending = all.filter((a) => a.status === 'PENDING');
  const todayAppts = all.filter((a) => String(a.date).slice(0, 10) === today && a.status === 'CONFIRMED');
  const upcomingVideo = all.filter((a) => a.consultation_type === 'VIDEO' && a.status === 'CONFIRMED' && String(a.date).slice(0, 10) >= today);
  const completed = all.filter((a) => a.status === 'COMPLETED');

  const cards = [
    { label: "Today's appointments", value: todayAppts.length, icon: 'calendar', to: '/doctor/appointments' },
    { label: 'Pending requests', value: pending.length, icon: 'inbox', to: '/doctor/requests' },
    { label: 'Upcoming video calls', value: upcomingVideo.length, icon: 'video', to: '/doctor/video' },
    { label: 'Completed consultations', value: completed.length, icon: 'check', to: '/doctor/appointments' },
  ] as const;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Doctor dashboard</h1>
        <p className="text-sm text-slate-500">Requests, schedule and video consultations at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="card p-5 transition hover:shadow-md">
            <div className="flex items-center justify-between">
              <Icon name={c.icon} className="h-6 w-6 text-brand-600" />
              <span className="text-3xl font-extrabold text-slate-900">{c.value}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-slate-500">{c.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900">Today's schedule</h2>
            <Link to="/doctor/appointments" className="text-sm font-semibold text-brand-700">All →</Link>
          </div>
          <div className="mt-3 space-y-3">
            {todayAppts.length === 0 && <p className="text-sm text-slate-400">No confirmed appointments today.</p>}
            {todayAppts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                <div>
                  <b className="text-sm">{String(a.start_time).slice(0, 5)}</b> <span className="text-sm text-slate-600">· {a.patient_name}</span>
                  <div className="text-xs text-slate-400">{a.consultation_type === 'VIDEO' ? 'Video' : 'In-person'}{a.reason ? ` · ${a.reason}` : ''}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900">New requests need your action</h2>
            <Link to="/doctor/requests" className="text-sm font-semibold text-brand-700">Review →</Link>
          </div>
          <div className="mt-3 space-y-3">
            {pending.length === 0 && <p className="text-sm text-slate-400">No pending requests. 🎉</p>}
            {pending.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                <div>
                  <b className="text-sm">{a.patient_name}</b>
                  <div className="text-xs text-slate-500">{String(a.date).slice(0, 10)} at {String(a.start_time).slice(0, 5)}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
