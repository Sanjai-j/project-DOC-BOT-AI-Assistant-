import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getStoredUser } from '../lib/api';
import { Icon, Stars } from '../components/ui';

interface Hospital {
  id: string;
  name: string;
  city: string;
  rating: number;
  reviews_count: number;
  specialties: string[];
  emergency_24x7: boolean;
  rating_source: string;
}

export default function Landing() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const user = getStoredUser();

  useEffect(() => {
    api<{ hospitals: Hospital[] }>('/api/hospitals/top-rated')
      .then((r) => setHospitals(r.hospitals.slice(0, 3)))
      .catch(() => {});
  }, []);

  const dash =
    user?.role === 'patient' ? '/patient' : user?.role === 'doctor' ? '/doctor' : user?.role === 'admin' ? '/admin' : null;

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Icon name="cross" className="h-5 w-5" />
            </span>
            <span className="text-lg font-extrabold text-brand-700">DocBot TeleMed</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a href="#how-docbot-works" className="hover:text-brand-700">How It Works</a>
            <Link to="/find-doctors" className="hover:text-brand-700">Find a Doctor</Link>
            <Link to="/hospitals" className="hover:text-brand-700">Hospitals</Link>
            <Link to="/emergency" className="text-red-600 hover:text-red-700">Emergency</Link>
          </nav>
          <div className="flex items-center gap-2">
            {dash ? (
              <Link to={dash} className="btn-primary !py-2">My Dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn-outline !py-2">Login</Link>
                <Link to="/register" className="btn-primary !py-2">Register</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <span className="badge bg-brand-100 text-brand-800">AI-guided · Verified doctors · Secure video calls</span>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight text-slate-900 md:text-5xl">
              Healthcare Guidance.<br />
              <span className="text-brand-600">Doctors You Can Trust.</span>
            </h1>
            <p className="mt-4 max-w-lg text-lg text-slate-600">
              Describe your symptoms to DocBot, get pointed to the right specialty, then find verified doctors,
              top-rated hospitals and book in-person or video consultations — all online.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/patient/docbot" className="btn-primary !px-5 !py-3">Chat with DocBot</Link>
              <Link to="/find-doctors" className="btn-outline !px-5 !py-3">Find a Doctor</Link>
              <Link to="/emergency" className="btn-danger !px-5 !py-3">Emergency Help</Link>
            </div>
            <p className="mt-4 text-xs text-slate-400">
              DocBot provides general guidance and is not a medical diagnosis.
            </p>
          </div>
          <div className="relative hidden md:block">
            <div className="card space-y-4 p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                  <Icon name="chat" className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-sm font-bold">DocBot</div>
                  <div className="text-xs text-emerald-600">Online — medical guidance assistant</div>
                </div>
              </div>
              <div className="ml-8 rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5 text-sm">
                I have a sore throat, blocked nose and ear pain.
              </div>
              <div className="mr-8 rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white">
                Based on your symptoms, an <b>ENT specialist</b> may be appropriate. Would you like to see available
                ENT doctors near you?
              </div>
              <div className="flex gap-2">
                <Link to="/patient/docbot" className="btn-primary !py-1.5 !text-xs">Show ENT Doctors</Link>
                <Link to="/find-doctors" className="btn-outline !py-1.5 !text-xs">Find Nearby Doctors</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How DocBot works */}
      <section id="how-docbot-works" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="section-title text-center">How DocBot works</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-slate-600">
          DocBot is your guide to the right care — it never diagnoses, it points you to the right specialist.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {[
            { icon: 'chat', t: '1. Describe symptoms', d: 'Tell DocBot what you feel in your own words.' },
            { icon: 'search', t: '2. Get a specialty', d: 'DocBot suggests the medical specialty that fits — e.g. ENT, Cardiology.' },
            { icon: 'user', t: '3. Meet the doctors', d: 'Compare verified doctors by rating, distance, hospital and availability.' },
            { icon: 'calendar', t: '4. Book & consult', d: 'Request a slot; once the doctor accepts, meet in-person or on video.' },
          ].map((s) => (
            <div key={s.t} className="card p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={s.icon as any} className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-bold text-slate-900">{s.t}</h3>
              <p className="mt-1 text-sm text-slate-600">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature sections */}
      <section className="bg-slate-50 py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-3">
          <div className="card p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Icon name="pin" className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-lg font-bold">Find nearby doctors</h3>
            <p className="mt-1 text-sm text-slate-600">
              Search by specialty, location, availability, rating and hospital. See who is free this week and book
              instantly.
            </p>
            <Link to="/find-doctors" className="mt-4 inline-block text-sm font-semibold text-brand-700">
              Find doctors →
            </Link>
          </div>
          <div className="card p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Icon name="video" className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-lg font-bold">Video consultations</h3>
            <p className="mt-1 text-sm text-slate-600">
              Request a video slot. When the doctor accepts and starts the call, join securely from your browser —
              no installs.
            </p>
            <Link to="/register" className="mt-4 inline-block text-sm font-semibold text-brand-700">
              Get started →
            </Link>
          </div>
          <div className="card p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <Icon name="alert" className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-lg font-bold">Emergency assistance</h3>
            <p className="mt-1 text-sm text-slate-600">
              One-tap emergency calling with the configured local emergency number. DocBot escalates urgent symptoms
              immediately.
            </p>
            <Link to="/emergency" className="mt-4 inline-block text-sm font-semibold text-red-600">
              Emergency help →
            </Link>
          </div>
        </div>
      </section>

      {/* Top hospitals preview */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="section-title">Top-rated hospitals</h2>
            <p className="mt-1 text-sm text-slate-500">Ranked by application ratings and review counts.</p>
          </div>
          <Link to="/hospitals" className="text-sm font-semibold text-brand-700">View all →</Link>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {hospitals.map((h) => (
            <div key={h.id} className="card p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">{h.name}</h3>
                  <p className="text-sm text-slate-500">{h.city}</p>
                </div>
                {h.emergency_24x7 && <span className="badge bg-red-100 text-red-700">24×7 ER</span>}
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Stars value={h.rating} />
                <span className="font-semibold">{h.rating.toFixed(1)}</span>
                <span className="text-slate-400">({h.reviews_count} reviews)</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {h.rating_source === 'GOOGLE' ? 'Google Rating' : 'Application Rating'}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {h.specialties.slice(0, 3).map((s) => (
                  <span key={s} className="badge bg-brand-50 text-brand-700">{s}</span>
                ))}
              </div>
            </div>
          ))}
          {hospitals.length === 0 && (
            <p className="text-sm text-slate-400">Hospital data loads once the server is running.</p>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-slate-500">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
                <Icon name="cross" className="h-5 w-5" />
              </span>
              <b className="text-slate-700">DocBot TeleMed</b>
            </div>
            <div className="flex gap-5">
              <Link to="/login" className="hover:text-brand-700">Login / Register</Link>
              <Link to="/how-it-works" className="hover:text-brand-700">How It Works</Link>
            </div>
          </div>
          <p className="mt-6 text-xs text-slate-400">
            DocBot TeleMed is not an emergency medical service and is not a replacement for professional medical
            diagnosis or treatment. AI-generated information is for general guidance only. If this is a
            life-threatening emergency, contact your local emergency services immediately.
          </p>
        </div>
      </footer>
    </div>
  );
}
