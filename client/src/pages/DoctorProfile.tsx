import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, getToken, getStoredUser } from '../lib/api';
import { Stars, Spinner, ErrorBox, ConfirmDialog } from '../components/ui';

interface DaySlots {
  date: string;
  weekday: string;
  slots: { start: string; end: string; status: string }[];
}

interface DoctorDetail {
  id: string;
  specialization: string;
  qualifications: string | null;
  experience_years: number;
  hospital_name: string;
  hospital_address: string;
  languages: string[];
  consultation_fee: string | null;
  fee_currency: string;
  bio: string | null;
  avg_rating: number;
  reviews_count: number;
  full_name: string;
  hospital_display_name: string | null;
  hospital_full_address: string | null;
  city: string | null;
}

interface Review {
  rating: number;
  comment: string | null;
  created_at: string;
  patient_name: string;
}

function fmt12(t: string): string {
  let [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function DoctorProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const user = getStoredUser();
  const isPatient = user?.role === 'patient';

  const [doctor, setDoctor] = useState<DoctorDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [days, setDays] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [consultType, setConsultType] = useState<'IN_PERSON' | 'VIDEO'>('IN_PERSON');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ doctor: DoctorDetail; reviews: Review[] }>(`/api/doctors/${id}`);
      setDoctor(d.doctor);
      setReviews(d.reviews);
      const s = await api<{ days: DaySlots[] }>(`/api/doctors/${id}/slots`);
      setDays(s.days);
      const firstOpen = s.days.find((d2) => d2.slots.some((sl) => sl.status === 'available'));
      if (firstOpen) setSelectedDate(firstOpen.date);
    } catch (err: any) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function book() {
    setBusy(true);
    setError(null);
    try {
      if (consultType === 'VIDEO') {
        await api('/api/video/request', {
          method: 'POST',
          body: { doctorId: id, date: selectedDate, time: selectedTime, reason },
        });
        setOk('Video consultation requested! You will be able to join once the doctor confirms.');
      } else {
        await api('/api/appointments', {
          method: 'POST',
          body: { doctorId: id, date: selectedDate, time: selectedTime, consultationType: consultType, reason },
        });
        setOk('Appointment requested! You will be notified once the doctor confirms.');
      }
      setConfirmOpen(false);
    } catch (err: any) {
      setError(err.message);
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!doctor) {
    return error ? (
      <div className="mx-auto max-w-xl p-8"><ErrorBox message={error} /><Link to="/find-doctors" className="btn-outline mt-4">← Back to search</Link></div>
    ) : (
      <Spinner label="Loading doctor profile…" />
    );
  }

  const selectedDay = days.find((d) => d.date === selectedDate);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link to="/find-doctors" className="text-sm font-semibold text-brand-700">← Back to doctors</Link>
          {!user && <Link to="/login" className="btn-primary !py-2 !text-xs">Login to book</Link>}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Header card */}
        <div className="card p-6">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-brand-100 text-3xl font-bold text-brand-700">
              {doctor.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900">Dr. {doctor.full_name}</h1>
                <span className="badge bg-brand-50 text-brand-700">{doctor.specialization}</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {doctor.hospital_display_name || doctor.hospital_name}
                {doctor.city ? ` · ${doctor.city}` : ''} · {doctor.experience_years} years experience
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <Stars value={doctor.avg_rating} />
                <b>{Number(doctor.avg_rating).toFixed(1)}</b>
                <span className="text-slate-400">{doctor.reviews_count} reviews</span>
                {doctor.consultation_fee && (
                  <span className="font-semibold">₹{Number(doctor.consultation_fee).toFixed(0)} consult</span>
                )}
              </div>
              {doctor.qualifications && <p className="mt-2 text-sm text-slate-600">Qualifications: {doctor.qualifications}</p>}
              <p className="mt-1 text-sm text-slate-600">Languages: {doctor.languages.join(', ')}</p>
              {doctor.bio && <p className="mt-3 text-sm text-slate-600">{doctor.bio}</p>}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          {/* Slots + booking */}
          <div className="space-y-6 lg:col-span-3">
            <div className="card p-6">
              <h2 className="font-bold text-slate-900">Available slots</h2>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {days.map((d) => {
                  const open = d.slots.some((s) => s.status === 'available');
                  return (
                    <button
                      key={d.date}
                      onClick={() => {
                        setSelectedDate(d.date);
                        setSelectedTime('');
                      }}
                      className={`shrink-0 rounded-xl border px-3.5 py-2 text-center text-sm transition ${
                        selectedDate === d.date
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : open
                            ? 'border-slate-200 bg-white hover:border-brand-400'
                            : 'border-slate-100 bg-slate-50 text-slate-300'
                      }`}
                    >
                      <div className="font-semibold">{d.weekday.slice(0, 3)}</div>
                      <div className="text-xs opacity-80">{d.date.slice(5)}</div>
                    </button>
                  );
                })}
              </div>

              {selectedDay && (
                <div className="mt-4">
                  {selectedDay.slots.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      Unavailable on {selectedDay.weekday}s.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {selectedDay.slots.map((s) => (
                        <button
                          key={s.start}
                          disabled={s.status !== 'available'}
                          onClick={() => setSelectedTime(s.start)}
                          className={`rounded-xl border px-2 py-2 text-sm font-semibold transition ${
                            selectedTime === s.start
                              ? 'border-brand-600 bg-brand-600 text-white'
                              : s.status === 'available'
                                ? 'border-slate-200 bg-white hover:border-brand-400'
                                : 'border-slate-100 bg-slate-50 text-slate-300 line-through'
                          }`}
                          title={s.status !== 'available' ? s.status : 'Available'}
                        >
                          {fmt12(s.start)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Reviews */}
            <div className="card p-6">
              <h2 className="font-bold text-slate-900">Patient reviews</h2>
              {reviews.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">No reviews yet.</p>
              ) : (
                <div className="mt-3 space-y-4">
                  {reviews.map((r, i) => (
                    <div key={i} className="border-b border-slate-100 pb-3 last:border-0">
                      <div className="flex items-center gap-2">
                        <Stars value={r.rating} size="text-sm" />
                        <b className="text-sm">{r.patient_name}</b>
                        <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString()}</span>
                      </div>
                      {r.comment && <p className="mt-1 text-sm text-slate-600">{r.comment}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Booking panel */}
          <div className="lg:col-span-2">
            <div className="card sticky top-4 p-6">
              <h2 className="font-bold text-slate-900">Book appointment</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(['IN_PERSON', 'VIDEO'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setConsultType(t)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                      consultType === t ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {t === 'IN_PERSON' ? 'In-person' : 'Video'}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <label className="label">Reason for consultation (optional)</label>
                <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Briefly describe your concern…" />
              </div>
              <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {selectedTime ? (
                  <>
                    <b>{fmt12(selectedTime)}</b> on <b>{selectedDate}</b>
                    <br />
                    <span className="text-xs">{consultType === 'VIDEO' ? 'Video consultation — the doctor must accept, then you can join at the scheduled time.' : 'In-person visit — the doctor must accept your request.'}</span>
                  </>
                ) : (
                  'Select a date and a time slot above.'
                )}
              </div>
              {ok && <div className="mt-3"><div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{ok}</div></div>}
              {error && <div className="mt-3"><ErrorBox message={error} /></div>}
              <button
                className="btn-primary mt-4 w-full"
                disabled={!selectedTime || !isPatient || busy || Boolean(ok)}
                onClick={() => setConfirmOpen(true)}
              >
                {consultType === 'VIDEO' ? 'Request Video Consultation' : 'Request Appointment'}
              </button>
              {!user && <p className="mt-2 text-center text-xs text-slate-400">Log in as a patient to book.</p>}
              {user && !isPatient && (
                <p className="mt-2 text-center text-xs text-slate-400">Only patients can book appointments.</p>
              )}
            </div>
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={confirmOpen}
        title={consultType === 'VIDEO' ? 'Request video consultation?' : 'Request appointment?'}
        message={`Send a ${consultType === 'VIDEO' ? 'video consultation' : 'in-person appointment'} request to Dr. ${doctor.full_name} for ${selectedDate} at ${selectedTime ? fmt12(selectedTime) : ''}? The appointment stays PENDING until the doctor accepts.`}
        confirmLabel="Send request"
        onConfirm={book}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
