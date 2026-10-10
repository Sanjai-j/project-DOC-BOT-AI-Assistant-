import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon, OkBox } from '../components/ui';

interface EmergencyRequest {
  id: string;
  kind: string;
  message: string | null;
  status: string;
  created_at: string;
}

export default function PatientEmergency() {
  const [number, setNumber] = useState('112');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [history, setHistory] = useState<EmergencyRequest[]>([]);

  const load = () =>
    api<{ requests: EmergencyRequest[] }>('/api/emergency/mine')
      .then((r) => setHistory(r.requests))
      .catch(() => {});

  useEffect(() => {
    api<{ number: string }>('/api/emergency/number').then((r) => setNumber(r.number)).catch(() => {});
    load();
  }, []);

  function call() {
    window.location.href = `tel:${number}`;
    api('/api/emergency', { method: 'POST', body: { kind: 'CALL_LOG' } }).then(load).catch(() => {});
  }

  async function sendHelp(e: React.FormEvent) {
    e.preventDefault();
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 })
      ).catch(() => null);
      await api('/api/emergency', {
        method: 'POST',
        body: {
          kind: 'HELP_REQUEST',
          message: note || 'Emergency help requested from patient dashboard',
          lat: pos?.coords.latitude,
          lng: pos?.coords.longitude,
        },
      });
      setSent('Emergency help request sent. Administrators have been alerted. If this is life-threatening, call now.');
      setNote('');
      load();
    } catch (err: any) {
      setSent(null);
      alert(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Emergency</h1>
        <p className="text-sm text-slate-500">Separate from normal appointments — immediate help comes first.</p>
      </div>

      <div className="rounded-3xl border-4 border-red-600 bg-white p-8 text-center">
        <span className="badge-emergency mx-auto !text-sm">EMERGENCY</span>
        <p className="mt-3 font-medium text-slate-700">
          If this is a life-threatening emergency, contact your local emergency services immediately.
        </p>
        <a href={`tel:${number}`} onClick={call} className="btn-danger mt-5 !px-10 !py-5 !text-xl">
          <Icon name="phone" className="h-6 w-6" /> Call {number}
        </a>
        <p className="mt-3 text-xs text-slate-400">DocBot TeleMed is not an emergency medical service.</p>
      </div>

      <form onSubmit={sendHelp} className="card space-y-3 p-5">
        <h2 className="font-bold text-slate-900">Need someone alerted?</h2>
        <p className="text-sm text-slate-500">Sends an emergency help request that administrators can see immediately.</p>
        <textarea
          className="input"
          rows={2}
          placeholder="What is happening? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn-danger w-full">Send emergency help request</button>
        {sent && <OkBox message={sent} />}
      </form>

      {history.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold text-slate-900">Your emergency history</h2>
          <div className="mt-3 space-y-2 text-sm">
            {history.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-2.5">
                <span>
                  {r.kind === 'CALL_LOG' ? 'Emergency call attempt' : 'Help request'}
                  {r.message ? ` — ${r.message}` : ''}
                </span>
                <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
