import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiForm } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ErrorBox, Icon, OkBox } from '../components/ui';

const SPECIALTIES = [
  'General Physician', 'ENT', 'Cardiologist', 'Dermatologist', 'Neurologist', 'Orthopedic',
  'Pediatrician', 'Gynecologist', 'Ophthalmologist', 'Psychiatrist', 'Dentist', 'Pulmonologist',
  'Gastroenterologist', 'Urologist', 'Endocrinologist',
];

const DAYS = [
  { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' },
  { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 0, l: 'Sun' },
];

type Tab = 'patient' | 'doctor';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [tab, setTab] = useState<Tab>('patient');

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-white p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Icon name="cross" className="h-5 w-5" />
          </span>
          <span className="text-xl font-extrabold text-brand-700">DocBot TeleMed</span>
        </Link>

        <div className="card overflow-hidden">
          {/* Role switcher */}
          <div className="grid grid-cols-2 border-b border-slate-200">
            {([
              ['patient', 'Patient'],
              ['doctor', 'Doctor'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition ${
                  tab === key
                    ? 'border-b-2 border-brand-600 bg-brand-50/50 text-brand-700'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Icon name={key === 'patient' ? 'user' : 'cross'} className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="p-6 sm:p-8">
            {tab === 'patient' ? <PatientPanel /> : <DoctorPanel />}
          </div>
        </div>

        {/* Discreet, non-prominent admin access (hidden login) */}
        <div className="mt-4 text-center">
          <Link to="/admin/login" className="text-xs text-slate-300 transition hover:text-slate-400" title="Staff access">
            Staff access
          </Link>
        </div>
      </div>
    </div>
  );

  /* ─────────────────────────── PATIENT: OTP flow ─────────────────────────── */

  function PatientPanel() {
    const [mode, setMode] = useState<'login' | 'register' | 'otp'>('login');
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [otpSentTo, setOtpSentTo] = useState('');
    const [code, setCode] = useState('');
    const [devOtp, setDevOtp] = useState('');
    const [reg, setReg] = useState({
      fullName: '', email: '', phone: '', dateOfBirth: '', gender: '', location: '', password: '',
    });

    const setRegField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setReg((f) => ({ ...f, [k]: e.target.value }));

    async function registerNow(e: React.FormEvent) {
      e.preventDefault();
      setBusy(true); setError(null);
      try {
        const res = await api<{ devOtp?: string; sentTo: string }>('/api/auth/patient/register', {
          method: 'POST', body: reg, token: false,
        });
        setDevOtp(res.devOtp ?? '');
        setOtpSentTo(res.sentTo);
        setInfo(`Account created. A verification code was sent to ${res.sentTo}.`);
        setMode('otp');
      } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    }

    async function sendOtp(e: React.FormEvent) {
      e.preventDefault();
      setBusy(true); setError(null);
      try {
        const res = await api<{ devOtp?: string; message?: string }>('/api/auth/patient/send-otp', {
          method: 'POST', body: { identifier }, token: false,
        });
        setDevOtp(res.devOtp ?? '');
        setOtpSentTo(identifier);
        setInfo(res.message ?? 'Code sent.');
        setMode('otp');
      } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    }

    async function verifyOtp(e: React.FormEvent) {
      e.preventDefault();
      setBusy(true); setError(null);
      try {
        const res = await api<{ token: string; user: any }>('/api/auth/patient/verify-otp', {
          method: 'POST', body: { identifier: otpSentTo, code }, token: false,
        });
        login(res.token, res.user);
        navigate('/patient');
      } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    }

    async function loginPassword(e: React.FormEvent) {
      e.preventDefault();
      setBusy(true); setError(null);
      try {
        const res = await api<{ token: string; user: any }>('/api/auth/patient/login', {
          method: 'POST', body: { identifier, password }, token: false,
        });
        login(res.token, res.user);
        navigate('/patient');
      } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    }

    if (mode === 'otp') {
      return (
        <>
          <h1 className="text-xl font-bold text-slate-900">Verify your code</h1>
          <p className="mt-1 text-sm text-slate-500">
            A 6-digit code was sent to <b>{otpSentTo}</b>.
          </p>
          {devOtp && (
            <div className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              Development mode — your OTP is <b className="tracking-widest">{devOtp}</b>
            </div>
          )}
          <form onSubmit={verifyOtp} className="mt-5 space-y-3">
            <input
              className="input text-center text-2xl tracking-[0.5em]"
              placeholder="······"
              maxLength={6}
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            {error && <ErrorBox message={error} />}
            <button className="btn-primary w-full" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <button type="button" className="btn-outline w-full" onClick={() => setMode('login')}>
              Back to login
            </button>
          </form>
        </>
      );
    }

    if (mode === 'register') {
      return (
        <>
          <h1 className="text-xl font-bold text-slate-900">Create your patient account</h1>
          <p className="mt-1 text-sm text-slate-500">Your email or phone will be verified with a one-time code.</p>
          <form onSubmit={registerNow} className="mt-5 space-y-3">
            <div>
              <label className="label">Full name *</label>
              <input className="input" required value={reg.fullName} onChange={setRegField('fullName')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Email *</label>
                <input className="input" type="email" required value={reg.email} onChange={setRegField('email')} />
              </div>
              <div>
                <label className="label">Phone *</label>
                <input className="input" required value={reg.phone} onChange={setRegField('phone')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Date of birth</label>
                <input className="input" type="date" value={reg.dateOfBirth} onChange={setRegField('dateOfBirth')} />
              </div>
              <div>
                <label className="label">Gender</label>
                <select className="input" value={reg.gender} onChange={setRegField('gender')}>
                  <option value="">Select…</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Location (city / area)</label>
              <input className="input" value={reg.location} onChange={setRegField('location')} />
            </div>
            <div>
              <label className="label">Password (min 8 characters)</label>
              <input className="input" type="password" minLength={8} value={reg.password} onChange={setRegField('password')} />
            </div>
            {error && <ErrorBox message={error} />}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? 'Creating…' : 'Register & send OTP'}
            </button>
            <p className="text-center text-sm text-slate-500">
              Already registered?{' '}
              <button type="button" className="font-semibold text-brand-700" onClick={() => setMode('login')}>Log in</button>
            </p>
          </form>
        </>
      );
    }

    return (
      <>
        <h1 className="text-xl font-bold text-slate-900">Patient login</h1>
        <p className="mt-1 text-sm text-slate-500">Log in with your email or phone number.</p>
        <form onSubmit={loginPassword} className="mt-5 space-y-3">
          <div>
            <label className="label">Email or phone</label>
            <input className="input" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <ErrorBox message={error} />}
          {info && <OkBox message={info} />}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Login with password'}
          </button>
        </form>
        <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
          <div className="h-px flex-1 bg-slate-200" /> or receive a one-time code <div className="h-px flex-1 bg-slate-200" />
        </div>
        <form onSubmit={sendOtp} className="space-y-3">
          <input
            className="input"
            placeholder="Email or phone for OTP"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
          <button className="btn-outline w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Send OTP code'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          New here?{' '}
          <button className="font-semibold text-brand-700" onClick={() => { setMode('register'); setError(null); setInfo(null); }}>
            Create an account
          </button>
        </p>
      </>
    );
  }

  /* ─────────────── DOCTOR: register (approval-gated) / login ─────────────── */

  function DoctorPanel() {
    const [mode, setMode] = useState<'login' | 'register' | 'submitted'>('login');
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // login (name + unique ID + password)
    const [fullName, setFullName] = useState('');
    const [doctorCode, setDoctorCode] = useState('');
    const [docPassword, setDocPassword] = useState('');

    // first-time status check (email + password → admin decision)
    const [showStatus, setShowStatus] = useState(false);
    const [statusEmail, setStatusEmail] = useState('');
    const [statusPassword, setStatusPassword] = useState('');
    const [statusResult, setStatusResult] = useState<{
      status: string; message: string; doctorCode?: string; fullName?: string;
    } | null>(null);

    // registration
    const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [reg, setReg] = useState({
      fullName: '', doctorIdNumber: '', hospitalName: '', hospitalAddress: '', yearsExperience: '',
      specialization: '', qualifications: '', email: '', phone: '', password: '',
      availableHours: '09:00-17:00', languages: 'English', consultationFee: '', city: '',
    });

    const setRegField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setReg((f) => ({ ...f, [k]: e.target.value }));

    const toggleDay = (v: number) =>
      setDays((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));

    async function doctorLogin(e: React.FormEvent) {
      e.preventDefault();
      setBusy(true); setError(null);
      try {
        const res = await api<{ token: string; user: any }>('/api/auth/doctor/login', {
          method: 'POST',
          body: { fullName, doctorCode, password: docPassword },
          token: false,
        });
        login(res.token, res.user);
        navigate('/doctor');
      } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    }

    async function checkStatus(e: React.FormEvent) {
      e.preventDefault();
      setBusy(true); setError(null); setOk(null);
      try {
        const res = await api<{
          status: string; message: string; doctorCode?: string; fullName?: string;
        }>('/api/auth/doctor/status', {
          method: 'POST',
          body: { email: statusEmail, password: statusPassword },
          token: false,
        });
        setStatusResult(res);
        if (res.status === 'APPROVED') {
          setFullName(res.fullName ?? fullName);
          setDoctorCode(res.doctorCode ?? doctorCode);
          setOk(`${res.message} You can log in below with this ID.`);
        }
      } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    }

    async function registerDoctor(e: React.FormEvent) {
      e.preventDefault();
      if (days.length === 0) { setError('Select at least one available day.'); return; }
      const idInput = document.getElementById('docIdImage') as HTMLInputElement | null;
      if (!idInput?.files?.[0]) { setError('Upload an image of your medical ID document.'); return; }
      setBusy(true); setError(null);
      try {
        const fd = new FormData();
        Object.entries(reg).forEach(([k, v]) => v && fd.append(k, String(v)));
        fd.append('availableDays', days.join(','));
        fd.append('idDocument', idInput.files[0]);
        const photoInput = document.getElementById('docPhoto') as HTMLInputElement | null;
        if (photoInput?.files?.[0]) fd.append('photo', photoInput.files[0]);
        await apiForm('/api/doctors/register', fd);
        setMode('submitted');
      } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    }

    if (mode === 'submitted') {
      return (
        <div className="py-4 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <Icon name="clock" className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Registration received</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your credentials are <b>Pending Verification</b>. An administrator will review your ID document,
            hospital and experience. Once approved you will receive a unique Doctor ID and can log in here with
            your name, that ID and your password.
          </p>
          <button className="btn-primary mt-6 w-full" onClick={() => setMode('login')}>Back to doctor login</button>
        </div>
      );
    }

    if (mode === 'register') {
      return (
        <>
          <h1 className="text-xl font-bold text-slate-900">Doctor registration</h1>
          <p className="mt-1 text-sm text-slate-500">
            Submit your credentials. Login is enabled only after an administrator approves your account.
          </p>
          <form onSubmit={registerDoctor} className="mt-4 space-y-3">
            <div>
              <label className="label">Full name *</label>
              <input className="input" required value={reg.fullName} onChange={setRegField('fullName')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Medical reg. no. *</label>
                <input className="input" required value={reg.doctorIdNumber} onChange={setRegField('doctorIdNumber')} />
              </div>
              <div>
                <label className="label">Years of experience *</label>
                <input className="input" type="number" min={0} max={70} required value={reg.yearsExperience} onChange={setRegField('yearsExperience')} />
              </div>
            </div>
            <div>
              <label className="label">Specialization *</label>
              <select className="input" required value={reg.specialization} onChange={setRegField('specialization')}>
                <option value="">Select specialty…</option>
                {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Hospital name *</label>
              <input className="input" required value={reg.hospitalName} onChange={setRegField('hospitalName')} />
            </div>
            <div>
              <label className="label">Hospital address *</label>
              <input className="input" required value={reg.hospitalAddress} onChange={setRegField('hospitalAddress')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Email *</label>
                <input className="input" type="email" required value={reg.email} onChange={setRegField('email')} />
              </div>
              <div>
                <label className="label">Phone *</label>
                <input className="input" required value={reg.phone} onChange={setRegField('phone')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Password (min 8) *</label>
                <input className="input" type="password" required minLength={8} value={reg.password} onChange={setRegField('password')} />
              </div>
              <div>
                <label className="label">Qualifications</label>
                <input className="input" placeholder="MBBS, MD…" value={reg.qualifications} onChange={setRegField('qualifications')} />
              </div>
            </div>
            <div>
              <label className="label">Image of your medical ID document * (JPG, PNG or PDF, max 5 MB)</label>
              <input
                id="docIdImage"
                className="input"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
              />
            </div>
            <div>
              <label className="label">Profile photo (optional)</label>
              <input id="docPhoto" className="input" type="file" accept="image/jpeg,image/png,image/webp" />
            </div>
            <div>
              <label className="label">Available days *</label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => (
                  <button
                    type="button"
                    key={d.v}
                    onClick={() => toggleDay(d.v)}
                    className={`rounded-xl border px-3.5 py-1.5 text-sm font-semibold transition ${
                      days.includes(d.v)
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {d.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-w-xs">
              <label className="label">Consultation hours *</label>
              <input
                className="input"
                placeholder="09:00-17:00"
                pattern="\d{2}:\d{2}-\d{2}:\d{2}"
                required
                value={reg.availableHours}
                onChange={setRegField('availableHours')}
              />
            </div>
            {error && <ErrorBox message={error} />}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit for verification'}
            </button>
            <p className="text-center text-sm text-slate-500">
              Already approved?{' '}
              <button type="button" className="font-semibold text-brand-700" onClick={() => { setMode('login'); setError(null); }}>
                Log in
              </button>
            </p>
          </form>
        </>
      );
    }

    return (
      <>
        <h1 className="text-xl font-bold text-slate-900">Doctor login</h1>
        <p className="mt-1 text-sm text-slate-500">
          Use your full name, the unique Doctor ID assigned at approval (e.g. DOC1001) and your password.
        </p>
        <form onSubmit={doctorLogin} className="mt-5 space-y-3">
          <div>
            <label className="label">Full name</label>
            <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="label">Doctor ID</label>
            <input
              className="input uppercase"
              placeholder="DOC1001"
              required
              value={doctorCode}
              onChange={(e) => setDoctorCode(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required value={docPassword} onChange={(e) => setDocPassword(e.target.value)} />
          </div>
          {error && <ErrorBox message={error} />}
          {ok && <OkBox message={ok} />}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Login'}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
          <div className="h-px flex-1 bg-slate-200" /> logging in for the first time? <div className="h-px flex-1 bg-slate-200" />
        </div>
        {showStatus ? (
          <form onSubmit={checkStatus} className="space-y-3 rounded-xl bg-slate-50 p-4">
            <p className="text-xs leading-relaxed text-slate-500">
              Your registration was sent to the administrator for verification. First-time login is enabled
              only after approval. Enter the email and password you registered with to see the current status
              and your assigned Doctor ID.
            </p>
            <input
              className="input"
              type="email"
              placeholder="Email you registered with"
              required
              value={statusEmail}
              onChange={(e) => setStatusEmail(e.target.value)}
            />
            <input
              className="input"
              type="password"
              placeholder="Your registration password"
              required
              value={statusPassword}
              onChange={(e) => setStatusPassword(e.target.value)}
            />
            {statusResult && (
              <div
                className={`rounded-xl px-4 py-3 text-sm ${
                  statusResult.status === 'APPROVED'
                    ? 'bg-emerald-50 text-emerald-800'
                    : statusResult.status === 'REJECTED'
                      ? 'bg-red-50 text-red-700'
                      : statusResult.status === 'INFO_REQUESTED'
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-slate-100 text-slate-700'
                }`}
              >
                <b className="block">{statusResult.status === 'APPROVED' ? 'Approved' : statusResult.status.replace('_', ' ')}</b>
                {statusResult.message}
              </div>
            )}
            {error && <ErrorBox message={error} />}
            <button className="btn-outline w-full" disabled={busy}>
              {busy ? 'Checking…' : 'Check verification status'}
            </button>
            <button
              type="button"
              className="text-xs font-semibold text-slate-500"
              onClick={() => { setShowStatus(false); setStatusResult(null); }}
            >
              Hide
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="w-full text-sm font-semibold text-brand-700"
            onClick={() => setShowStatus(true)}
          >
            Check verification status
          </button>
        )}

        <p className="mt-4 text-center text-sm text-slate-500">
          Not verified yet?{' '}
          <button className="font-semibold text-brand-700" onClick={() => { setMode('register'); setError(null); setOk(null); }}>
            Register for verification
          </button>
        </p>
      </>
    );
  }
}
