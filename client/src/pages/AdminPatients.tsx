import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner, EmptyState, ErrorBox, OkBox, ConfirmDialog } from '../components/ui';

interface PatRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  location: string | null;
  appointments_count: number;
  created_at: string;
}

export default function AdminPatients() {
  const [rows, setRows] = useState<PatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [target, setTarget] = useState<PatRow | null>(null);
  const [action, setAction] = useState<'suspend' | 'reactivate'>('suspend');

  const load = useCallback(async () => {
    const r = await api<{ patients: PatRow[] }>('/api/admin/patients').catch(() => ({ patients: [] }));
    setRows(r.patients);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function confirm() {
    if (!target) return;
    try {
      await api(`/api/admin/patients/${target.id}/${action}`, { method: 'POST' });
      setOk(action === 'suspend' ? 'Patient suspended.' : 'Patient reactivated.');
    } catch (e: any) {
      setError(e.message);
    }
    setTarget(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Patients</h1>
        <p className="text-sm text-slate-500">Registered patient accounts.</p>
      </div>

      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title="No patients registered yet" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Contact</th>
                <th className="px-5 py-3">Location</th>
                <th className="px-5 py-3">Appointments</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 font-semibold text-slate-800">{p.full_name}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {p.email}
                    <div className="text-xs text-slate-400">{p.phone}</div>
                  </td>
                  <td className="px-5 py-3">{p.location ?? '—'}</td>
                  <td className="px-5 py-3">{p.appointments_count}</td>
                  <td className="px-5 py-3">
                    <span className={p.status === 'ACTIVE' ? 'badge-confirmed' : 'badge-cancelled'}>{p.status}</span>
                  </td>
                  <td className="px-5 py-3">
                    {p.status === 'ACTIVE' ? (
                      <button
                        className="btn-danger !py-1.5 !text-xs"
                        onClick={() => {
                          setTarget(p);
                          setAction('suspend');
                        }}
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        className="btn-success !py-1.5 !text-xs"
                        onClick={() => {
                          setTarget(p);
                          setAction('reactivate');
                        }}
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(target)}
        title={action === 'suspend' ? `Suspend ${target?.full_name}?` : `Reactivate ${target?.full_name}?`}
        message={action === 'suspend' ? 'They will not be able to log in or book appointments.' : 'They regain full access.'}
        confirmLabel={action === 'suspend' ? 'Suspend' : 'Reactivate'}
        danger={action === 'suspend'}
        onConfirm={confirm}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
