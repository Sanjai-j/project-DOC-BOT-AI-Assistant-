import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Icon, Stars, Spinner } from '../components/ui';

interface Hospital {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  specialties: string[];
  emergency_24x7: boolean;
  rating: number;
  reviews_count: number;
  rating_source: string;
  doctors_count?: number;
  distance_km?: number | null;
}

export default function Hospitals() {
  const { user } = useAuth();
  const [hospitals, setHospitals] = useState<Hospital[] | null>(null);
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [emergencyOnly, setEmergencyOnly] = useState(false);
  const [nearby, setNearby] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setHospitals(null);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (city) qs.set('city', city);
      if (emergencyOnly) qs.set('emergency', 'true');
      let url = `/api/hospitals?${qs}`;
      if (nearby) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
        );
        url = `/api/hospitals/nearby?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`;
      }
      const res = await api<{ hospitals: Hospital[] }>(url);
      setHospitals(res.hospitals);
    } catch (err: any) {
      setError(err?.code === 1 ? 'Location permission denied — showing all hospitals instead.' : err.message);
      const res = await api<{ hospitals: Hospital[] }>('/api/hospitals').catch(() => ({ hospitals: [] }));
      setHospitals(res.hospitals);
    }
  }, [q, city, emergencyOnly, nearby]);

  useEffect(() => {
    load();
  }, [load]);

  function directions(h: Hospital) {
    if (h.lat && h.lng) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`, '_blank');
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.name + ' ' + h.address)}`, '_blank');
    }
  }

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
            <Link to="/find-doctors" className="btn-outline !py-2 !text-xs">Find doctors</Link>
          </div>
        </header>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-extrabold text-slate-900">Find hospitals</h1>
        <p className="text-sm text-slate-500">Application-verified hospital directory with ratings and specialties.</p>

        <div className="card mt-5 grid gap-3 p-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label !text-xs">Search</label>
            <input className="input" placeholder="Name or address…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label className="label !text-xs">City</label>
            <input className="input" placeholder="e.g. Bengaluru" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={emergencyOnly} onChange={(e) => setEmergencyOnly(e.target.checked)} />
              24×7 emergency
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={nearby} onChange={(e) => setNearby(e.target.checked)} />
              Near my location
            </label>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>
        )}

        {hospitals === null ? (
          <Spinner label="Loading hospitals…" />
        ) : (
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {hospitals.map((h) => (
              <div key={h.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{h.name}</h3>
                    <p className="text-sm text-slate-500">{h.address}, {h.city}</p>
                  </div>
                  {h.emergency_24x7 && <span className="badge bg-red-100 text-red-700">24×7 ER</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <Stars value={h.rating} size="text-sm" />
                  <b>{Number(h.rating).toFixed(1)}</b>
                  <span className="text-slate-400">({h.reviews_count} reviews)</span>
                  <span className="badge bg-slate-100 text-slate-500">
                    {h.rating_source === 'GOOGLE' ? 'Google Rating' : 'Application Rating'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {h.specialties.slice(0, 6).map((s) => (
                    <span key={s} className="badge bg-brand-50 text-brand-700">{s}</span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  {h.doctors_count !== undefined && <span>{h.doctors_count} doctors</span>}
                  {h.distance_km != null && <span>{Number(h.distance_km).toFixed(1)} km away</span>}
                  {h.phone && <span>{h.phone}</span>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to={`/find-doctors?specialty=&city=${encodeURIComponent(h.city)}`} className="btn-outline !py-2 !text-xs">
                    View Doctors
                  </Link>
                  <button onClick={() => directions(h)} className="btn-primary !py-2 !text-xs">
                    Get Directions
                  </button>
                </div>
              </div>
            ))}
            {hospitals.length === 0 && (
              <div className="card p-10 text-center text-slate-500 md:col-span-2">
                No hospitals match your filters.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
