import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBox, OkBox } from '../components/ui';

export default function PatientProfile() {
  const [form, setForm] = useState({ fullName: '', location: '', gender: '', dateOfBirth: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: any }>('/api/auth/me').then((r) => {
      const u = r.user;
      setForm({
        fullName: u.full_name ?? '',
        location: u.location ?? '',
        gender: u.gender ?? '',
        dateOfBirth: u.date_of_birth ? String(u.date_of_birth).slice(0, 10) : '',
        email: u.email ?? '',
        phone: u.phone ?? '',
      });
    });
  }, []);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api('/api/auth/me', {
        method: 'PATCH',
        body: {
          fullName: form.fullName,
          location: form.location || undefined,
          gender: form.gender || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
        },
      });
      setOk('Profile updated.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-extrabold text-slate-900">Profile</h1>
      <form onSubmit={submit} className="card space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Full name</label>
            <input className="input" value={form.fullName} onChange={set('fullName')} required />
          </div>
          <div>
            <label className="label">Location</label>
            <input className="input" value={form.location} onChange={set('location')} />
          </div>
          <div>
            <label className="label">Gender</label>
            <select className="input" value={form.gender} onChange={set('gender')}>
              <option value="">Select…</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label">Date of birth</label>
            <input className="input" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
          {form.email || 'No email'} · {form.phone || 'No phone'}
          <p className="mt-1 text-xs text-slate-400">Contact details are managed at registration for security.</p>
        </div>
        {error && <ErrorBox message={error} />}
        {ok && <OkBox message={ok} />}
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </form>
    </div>
  );
}
