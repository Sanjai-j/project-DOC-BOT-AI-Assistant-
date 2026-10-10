import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ErrorBox, Icon } from '../components/ui';

export default function AdminLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: any }>('/api/auth/admin/login', {
        method: 'POST',
        body: { email, password },
        token: false,
      });
      login(res.token, res.user);
      navigate('/admin');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="card p-6 sm:p-8">
          <div className="mb-4 flex items-center gap-2 text-slate-500">
            <Icon name="lock" className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-widest">Restricted area</span>
          </div>
          <h1 className="text-lg font-bold text-slate-900">Administration login</h1>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div>
              <label className="label">Admin email</label>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <ErrorBox message={error} />}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
        <Link to="/" className="mt-4 block text-center text-xs text-slate-400">← Back to DocBot TeleMed</Link>
      </div>
    </div>
  );
}
