import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner, EmptyState, ErrorBox, OkBox, ConfirmDialog } from '../components/ui';

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
}

const EMPTY = { name: '', address: '', city: '', phone: '', lat: '', lng: '', specialties: '', emergency_24x7: false };

export default function AdminHospitals() {
  const [rows, setRows] = useState<Hospital[] | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<Hospital | null>(null);
  const [removing, setRemoving] = useState<Hospital | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ hospitals: Hospital[] }>('/api/admin/hospitals').catch(() => ({ hospitals: [] }));
    setRows(r.hospitals);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k: string) => (e: any) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  function startEdit(h: Hospital) {
    setEditing(h);
    setForm({
      name: h.name,
      address: h.address,
      city: h.city,
      phone: h.phone ?? '',
      lat: h.lat?.toString() ?? '',
      lng: h.lng?.toString() ?? '',
      specialties: h.specialties.join(', '),
      emergency_24x7: h.emergency_24x7,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    const body = {
      name: form.name,
      address: form.address,
      city: form.city,
      phone: form.phone || undefined,
      lat: form.lat ? Number(form.lat) : undefined,
      lng: form.lng ? Number(form.lng) : undefined,
      specialties: form.specialties ? form.specialties.split(',').map((s) => s.trim()).filter(Boolean) : [],
      emergency_24x7: form.emergency_24x7,
    };
    try {
      if (editing) {
        await api(`/api/admin/hospitals/${editing.id}`, { method: 'PUT', body });
        setOk('Hospital updated.');
      } else {
        await api('/api/admin/hospitals', { method: 'POST', body });
        setOk('Hospital added.');
      }
      setForm({ ...EMPTY });
      setEditing(null);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await api(`/api/admin/hospitals/${removing.id}`, { method: 'DELETE' });
      setOk('Hospital removed.');
    } catch (e: any) {
      setError(e.message);
    }
    setRemoving(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Hospitals</h1>
        <p className="text-sm text-slate-500">Add, edit or remove hospitals in the directory.</p>
      </div>

      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      <form onSubmit={submit} className="card grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-bold text-slate-900 sm:col-span-2">
          {editing ? `Edit: ${editing.name}` : 'Add a hospital'}
        </h2>
        <div>
          <label className="label">Name *</label>
          <input className="input" required value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label className="label">City *</label>
          <input className="input" required value={form.city} onChange={set('city')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Address *</label>
          <input className="input" required value={form.address} onChange={set('address')} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <label className="label">Specialties (comma separated)</label>
          <input className="input" value={form.specialties} onChange={set('specialties')} />
        </div>
        <div>
          <label className="label">Latitude</label>
          <input className="input" type="number" step="any" value={form.lat} onChange={set('lat')} />
        </div>
        <div>
          <label className="label">Longitude</label>
          <input className="input" type="number" step="any" value={form.lng} onChange={set('lng')} />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={form.emergency_24x7} onChange={set('emergency_24x7')} />
          24×7 emergency department
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <button className="btn-primary">{editing ? 'Save changes' : 'Add hospital'}</button>
          {editing && (
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                setEditing(null);
                setForm({ ...EMPTY });
              }}
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="building" title="No hospitals yet" />
      ) : (
        <div className="space-y-3">
          {rows.map((h) => (
            <div key={h.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <b className="text-slate-900">{h.name}</b>
                <p className="text-sm text-slate-500">{h.address}, {h.city}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {h.specialties.join(', ')} {h.emergency_24x7 ? '· 24×7 ER' : ''} · {Number(h.rating).toFixed(1)} ({h.reviews_count} reviews)
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-outline !py-2 !text-xs" onClick={() => startEdit(h)}>Edit</button>
                <button className="btn-danger !py-2 !text-xs" onClick={() => setRemoving(h)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name}?`}
        message="Doctors referencing this hospital will keep their textual address but lose the linked record."
        confirmLabel="Remove"
        danger
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
