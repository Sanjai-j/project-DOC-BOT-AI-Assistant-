import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';

export default function HowItWorks() {
  const steps = [
    { icon: 'user', t: 'Create your patient account', d: 'Register with email or phone and verify with a one-time code (OTP).' },
    { icon: 'chat', t: 'Chat with DocBot', d: 'Describe symptoms in your own words. DocBot suggests a medical specialty — never a diagnosis.' },
    { icon: 'search', t: 'Find the right doctor', d: 'Filter by specialty, location, availability, rating and hospital. See who is free this week.' },
    { icon: 'calendar', t: 'Request an appointment', d: 'Pick a slot. The request stays pending until the doctor accepts it.' },
    { icon: 'video', t: 'Consult via video', d: 'For video consultations, the doctor starts the call at the appointment time and you join — no downloads.' },
    { icon: 'check', t: 'Rate your experience', d: 'After a completed consultation, leave a rating and review to help other patients.' },
  ] as const;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-100">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Icon name="cross" className="h-5 w-5" />
            </span>
            <span className="font-extrabold text-brand-700">DocBot TeleMed</span>
          </Link>
          <Link to="/login" className="btn-primary !py-2 !text-xs">Login</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-extrabold text-slate-900">How DocBot TeleMed works</h1>
        <p className="mt-2 text-slate-600">
          From first symptom to verified doctor — a guided, safe and transparent journey.
        </p>
        <div className="mt-10 space-y-5">
          {steps.map((s, i) => (
            <div key={s.t} className="card flex gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={s.icon} className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-bold text-slate-900">{i + 1}. {s.t}</h3>
                <p className="mt-1 text-sm text-slate-600">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          DocBot provides general guidance only and is not a medical diagnosis. DocBot TeleMed is not an emergency
          medical service. If this is a life-threatening emergency, contact your local emergency services immediately.
        </div>
        <div className="mt-8 flex gap-3">
          <Link to="/login" className="btn-primary">Create free account</Link>
          <Link to="/patient/docbot" className="btn-outline">Chat with DocBot</Link>
        </div>
      </main>
    </div>
  );
}
