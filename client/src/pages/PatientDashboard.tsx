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
  doctor_name: string;
  specialization: string;
}

const CARDS = [
  { to: '/patient/docbot', icon: 'chat', title: 'Chat with DocBot', desc: 'Describe symptoms, get specialty guidance', cls: 'bg-brand-600' },
  { to: '/patient/find', icon: 'search', title: 'Find a Doctor', desc: 'Filter by specialty, rating, distance', cls: 'bg-sky-600' },
  { to: '/patient/find?near=1', icon: 'pin', title: 'Nearby Doctors', desc: 'Doctors closest to your location', cls: 'bg-emerald-600' },
  { to: '/patient/hospitals', icon: 'building', title: 'Hospitals', desc: 'Top-rated hospitals near you', cls: 'bg-violet-600' },
  { to: '/patient/appointments', icon: 'calendar', title: 'My Appointments', desc: 'Requests, confirmed and past visits', cls: 'bg-amber-600' },
  { to: '/patient/video', icon: 'video', title: 'Video Consultations', desc: 'Join confirmed video calls', cls: 'bg-rose-600' },
  { to: '/patient/emergency', icon: 'alert', title: 'Emergency', desc: 'Immediate help, one tap', cls: 'bg-red-600' },
] as const;

export default function PatientDashboard() {
  const [appts, setAppts] = useState<Appt[] | null>(null);

  useEffect(() => {
    api<{ appointments: Appt[] }>('/api/appointments')
      .then((r) => setAppts(r.appointments))
      .catch(() => setAppts([]));
  }, []);

  const upcoming = (appts ?? []).filter((a) => ['PENDING', 'CONFIRMED'].includes(a.status));
  const completed = (appts ?? []).filter((a) => a.status === 'COMPLETED');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Patient dashboard</h1>
        <p className="text-sm text-slate-500">Your care, one place — guidance, doctors and consultations.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <Link key={c.title} to={c.to} className={`group rounded-2xl ${c.cls} p-5 text-white shadow-sm transition hover:shadow-md`}>
            <Icon name={c.icon} className="h-7 w-7" />
            <h3 className="mt-3 font-bold">{c.title}</h3>
            <p className="mt-0.5 text-xs opacity-80">{c.desc}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900">Upcoming & pending</h2>
            <Link to="/patient/appointments" className="text-sm font-semibold text-brand-700">View all →</Link>
          </div>
          <div className="mt-3 space-y-3">
            {upcoming === null && <p className="text-sm text-slate-400">Loading…</p>}
            {upcoming?.length === 0 && <p className="text-sm text-slate-400">No upcoming appointments.</p>}
            {upcoming?.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">
                    Dr. {a.doctor_name} <span className="font-normal text-slate-400">· {a.specialization}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {String(a.date).slice(0, 10)} at {String(a.start_time).slice(0, 5)} · {a.consultation_type === 'VIDEO' ? 'Video' : 'In-person'}
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-bold text-slate-900">Completed consultations</h2>
          <div className="mt-3 space-y-3">
            {completed.length === 0 && <p className="text-sm text-slate-400">Nothing here yet.</p>}
            {completed.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">Dr. {a.doctor_name}</div>
                  <div className="text-xs text-slate-500">{String(a.date).slice(0, 10)} · {a.specialization}</div>
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
