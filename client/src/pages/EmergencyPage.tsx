import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon } from '../components/ui';

export default function EmergencyPage() {
  const [number, setNumber] = useState('112');
  const [logged, setLogged] = useState(false);

  useEffect(() => {
    api<{ number: string }>('/api/emergency/number', { token: false })
      .then((r) => setNumber(r.number))
      .catch(() => {});
  }, []);

  function callNow() {
    window.location.href = `tel:${number}`;
    setLogged(true);
  }

  return (
    <div className="min-h-screen bg-red-50">
      <header className="border-b border-red-100 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Icon name="cross" className="h-5 w-5" />
            </span>
            <span className="font-extrabold text-brand-700">DocBot TeleMed</span>
          </Link>
          <Link to="/login" className="btn-outline !py-2 !text-xs">Login</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-3xl border-4 border-red-600 bg-white p-8 text-center shadow-lg">
          <span className="badge-emergency mx-auto !text-sm">EMERGENCY</span>
          <h1 className="mt-4 text-3xl font-extrabold text-slate-900">
            Your symptoms may require immediate medical attention.
          </h1>
          <p className="mt-3 text-slate-600">
            If this is a life-threatening emergency, contact your local emergency services immediately. Do not wait
            for an online appointment.
          </p>
          <a href={`tel:${number}`} onClick={callNow} className="btn-danger mt-8 !px-10 !py-5 !text-xl">
            <Icon name="phone" className="h-6 w-6" /> Call Emergency Services ({number})
          </a>
          {logged && <p className="mt-3 text-xs text-slate-400">Your call attempt has been logged for safety follow-up.</p>}
          <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              <b>While waiting for help:</b>
              <ul className="mt-1 list-disc pl-5">
                <li>Stay calm and sit or lie down safely</li>
                <li>Unlock your door if you can</li>
                <li>Keep your phone with you</li>
              </ul>
            </div>
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
              <b>Call immediately for:</b>
              <ul className="mt-1 list-disc pl-5">
                <li>Chest pain or difficulty breathing</li>
                <li>Unconsciousness or seizure</li>
                <li>Severe bleeding or stroke signs</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="card mt-8 p-6">
          <h2 className="font-bold text-slate-900">Need non-urgent help?</h2>
          <p className="mt-1 text-sm text-slate-600">
            For non-emergency concerns, DocBot can suggest the right specialty and help you book a doctor.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/patient/docbot" className="btn-primary">Chat with DocBot</Link>
            <Link to="/find-doctors" className="btn-outline">Find a doctor</Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          DocBot TeleMed is a software platform and is NOT an emergency medical service. The emergency number shown
          is configured by the application administrator.
        </p>
      </main>
    </div>
  );
}
