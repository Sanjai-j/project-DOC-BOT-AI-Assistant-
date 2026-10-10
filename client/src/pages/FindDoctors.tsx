import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Icon, Stars, Spinner } from '../components/ui';

interface DoctorRow {
  id: string;
  specialization: string;
  experience_years: number;
  hospital_name: string;
  hospital_address: string;
  languages: string[];
  consultation_fee: string | null;
  fee_currency: string;
  avg_rating: number;
  reviews_count: number;
  photo_url: string | null;
  full_name: string;
  city: string | null;
  distance_km?: number | null;
  hospital_display_name?: string | null;
}

export const SPECIALTIES = [
  'General Physician', 'ENT', 'Cardiologist', 'Dermatologist', 'Neurologist', 'Orthopedic',
  'Pediatrician', 'Gynecologist', 'Ophthalmologist', 'Psychiatrist', 'Dentist', 'Pulmonologist',
  'Gastroenterologist', 'Urologist', 'Endocrinologist',
];

function DoctorCard({ d }: { d: DoctorRow }) {
  return (
    <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700">
        {d.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-slate-900">Dr. {d.full_name}</h3>
          <span className="badge bg-brand-50 text-brand-700">{d.specialization}</span>
        </div>
        <p className="mt-0.5 text-sm text-slate-500">
          {d.hospital_display_name || d.hospital_name}
          {d.city ? ` · ${d.city}` : ''} · {d.experience_years} yrs exp
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-1">
            <Stars value={d.avg_rating} size="text-sm" />
            <b>{Number(d.avg_rating).toFixed(1)}</b>
            <span className="text-slate-400">({d.reviews_count})</span>
          </span>
          {d.distance_km != null && <span className="text-slate-500">{Number(d.distance_km).toFixed(1)} km away</span>}
          {d.consultation_fee && (
            <span className="font-semibold text-slate-700">
              ₹{Number(d.consultation_fee).toFixed(0)} <span className="font-normal text-slate-400">consult</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link to={`/doctors/${d.id}`} className="btn-outline !py-2 !text-xs">View Profile</Link>
        <Link to={`/doctors/${d.id}?book=1`} className="btn-primary !py-2 !text-xs">Book Appointment</Link>
      </div>
    </div>
  );
}

export default function FindDoctors() {
  const query = useLocation().search;
  const navigate = useNavigate();
  const { user } = useAuth();
  const params = useMemo(() => new URLSearchParams(query), [query]);

  const [doctors, setDoctors] = useState<DoctorRow[] | null>(null);
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    specialty: params.get('specialty') ?? '',
    city: params.get('city') ?? '',
    hospital: '',
    minRating: '',
    availableThisWeek: params.get('availableThisWeek') === '1',
    date: '',
  });
  const [nearby, setNearby] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);

  const load = useCallback(async () => {
    setDoctors(null);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (filters.specialty) qs.set('specialty', filters.specialty);
      if (filters.city) qs.set('city', filters.city);
      if (filters.hospital) qs.set('hospital', filters.hospital);
      if (filters.minRating) qs.set('minRating', filters.minRating);
      if (filters.availableThisWeek) qs.set('availableThisWeek', 'true');
      if (filters.date) qs.set('date', filters.date);

      let rows: DoctorRow[];
      if (nearby) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
        );
        qs.set('lat', String(pos.coords.latitude));
        qs.set('lng', String(pos.coords.longitude));
        const res = await api<{ doctors: DoctorRow[] }>(`/api/doctors/nearby?${qs}`);
        rows = res.doctors;
      } else {
        const res = await api<{ doctors: DoctorRow[] }>(`/api/doctors?${qs}`);
        rows = res.doctors;
      }
      setDoctors(rows);
    } catch (err: any) {
      setError(
        err?.code === 1
          ? 'Location permission denied — enter a city manually or clear the “near me” filter.'
          : err.message
      );
      setDoctors([]);
    }
  }, [filters, nearby]);

  useEffect(() => {
    load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-slate-50">
      {!user && (
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
                <Icon name="cross" className="h-5 w-5" />
              </span>
              <span className="font-extrabold text-brand-700">DocBot TeleMed</span>
            </Link>
            <div className="flex items-center gap-2">
              <Link to="/hospitals" className="btn-outline !py-2 !text-xs">Hospitals</Link>
              <Link to="/login" className="btn-primary !py-2 !text-xs">Login</Link>
            </div>
          </div>
        </header>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Find doctors near me</h1>
            <p className="text-sm text-slate-500">Verified doctors only. Book in-person or video consultations.</p>
          </div>
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            {(['list', 'map'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  mode === m ? 'bg-brand-600 text-white' : 'text-slate-600'
                }`}
              >
                {m === 'list' ? '☰ List' : '🗺 Map'}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="card mt-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="label !text-xs">Specialty</label>
            <select className="input" value={filters.specialty} onChange={(e) => setFilters((f) => ({ ...f, specialty: e.target.value }))}>
              <option value="">All specialties</option>
              {SPECIALTIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label !text-xs">City / location</label>
            <input className="input" placeholder="e.g. Bengaluru" value={filters.city} onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))} />
          </div>
          <div>
            <label className="label !text-xs">Hospital</label>
            <input className="input" placeholder="Hospital name" value={filters.hospital} onChange={(e) => setFilters((f) => ({ ...f, hospital: e.target.value }))} />
          </div>
          <div>
            <label className="label !text-xs">Min rating</label>
            <select className="input" value={filters.minRating} onChange={(e) => setFilters((f) => ({ ...f, minRating: e.target.value }))}>
              <option value="">Any</option>
              <option value="4.5">4.5+</option>
              <option value="4">4.0+</option>
              <option value="3">3.0+</option>
            </select>
          </div>
          <div>
            <label className="label !text-xs">Available on date</label>
            <input className="input" type="date" min={today} value={filters.date} onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
                checked={filters.availableThisWeek}
                onChange={(e) => setFilters((f) => ({ ...f, availableThisWeek: e.target.checked }))}
              />
              Available this week
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
                checked={nearby}
                onChange={(e) => setNearby(e.target.checked)}
              />
              Near my location
            </label>
          </div>
        </div>

        {error && <div className="mt-4"><div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div></div>}

        {/* Results */}
        <div className="mt-6">
          {doctors === null ? (
            <Spinner label="Finding doctors…" />
          ) : mode === 'map' ? (
            <MapPanel doctors={doctors} />
          ) : doctors.length === 0 ? (
            <div className="card p-10 text-center text-slate-500">
              <div className="text-3xl">🔍</div>
              No doctors match these filters. Try widening your search.
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">{doctors.length} doctor(s) found</p>
              {doctors.map((d) => (
                <DoctorCard key={d.id} d={d} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/** Map panel: uses Google Maps only when an API key is present; otherwise a
 *  coordinate-based fallback list (works with zero external services). */
function MapPanel({ doctors }: { doctors: DoctorRow[] }) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  if (!apiKey) {
    return (
      <div className="card p-6">
        <div className="rounded-xl bg-slate-100 p-8 text-center">
          <p className="text-sm text-slate-600">
            Map preview uses stored locations (no Google Maps key configured).
            Doctor positions below are relative distances from search center.
          </p>
        </div>
        <div className="mt-4 space-y-2">
          {doctors.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5 text-sm">
              <span className="font-medium">Dr. {d.full_name} <span className="text-slate-400">· {d.hospital_display_name || d.hospital_name}</span></span>
              <span className="text-slate-500">{d.distance_km != null ? `${Number(d.distance_km).toFixed(1)} km` : d.city ?? ''}</span>
            </div>
          ))}
          {doctors.length === 0 && <p className="text-center text-sm text-slate-400">No locations to show.</p>}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Add <code className="rounded bg-slate-100 px-1">VITE_GOOGLE_MAPS_API_KEY</code> to enable the interactive map.
        </p>
      </div>
    );
  }
  return <GoogleMap doctors={doctors} apiKey={apiKey} />;
}

function GoogleMap({ doctors, apiKey }: { doctors: DoctorRow[]; apiKey: string }) {
  const ref = useMemo(() => ({ current: null as HTMLDivElement | null }), []);
  useEffect(() => {
    (window as any).initDocbotMap = () => {
      const el = ref.current;
      if (!el || !(window as any).google) return;
      const map = new (window as any).google.maps.Map(el, { zoom: 12, center: { lat: 12.97, lng: 77.64 } });
      const bounds = new (window as any).google.maps.LatLngBounds();
      doctors.forEach((d) => {
        if (d.distance_km == null) return;
        const marker = new (window as any).google.maps.Marker({
          map,
          title: `Dr. ${d.full_name} — ${d.specialization}`,
          position: map.getCenter(),
        });
        const iw = new (window as any).google.maps.InfoWindow({
          content: `<b>Dr. ${d.full_name}</b><br/>${d.specialization}<br/>${Number(d.distance_km).toFixed(1)} km`,
        });
        marker.addListener('click', () => iw.open(map, marker));
        bounds.extend(marker.getPosition());
      });
      map.fitBounds(bounds);
    };
    if (!(window as any).google) {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initDocbotMap`;
      s.async = true;
      document.head.appendChild(s);
    } else {
      (window as any).initDocbotMap();
    }
  }, [doctors, apiKey, ref]);
  return <div ref={(el) => (ref.current = el)} className="card h-96 w-full" />;
}
