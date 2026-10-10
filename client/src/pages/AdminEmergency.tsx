import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner, EmptyState, ErrorBox, OkBox, StatusBadge } from '../components/ui';

interface EmReq {
  id: string;
  kind: string;
  full_name: string | null;
  phone: string | null;
  phone_used: string | null;
  message: string | null;
  status: string;
  created_at: string;
}

export default function AdminEmergency() {
  const [rows, setRows] = useState<EmReq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ requests: EmReq[] }>('/api/admin/emergency').catch(() => ({ requests: [] }));
    setRows(r.requests);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: 'RESOLVED' | 'FALSE_ALARM') {
    try {
      await api(`/api/admin/emergency/${id}/resolve`, { method: 'POST', body: { status } });
      setOk(`Marked ${status === 'RESOLVED' ? 'resolved' : 'false alarm'}.`);
    } catch (e: any) {
      setError(e.message);
    }
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Emergency requests</h1>
        <p className="text-sm text-slate-500">Emergency calls and help requests triggered across the app.</p>
      </div>

      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="alert" title="No emergency events" hint="This is good news." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.id}
              className={`card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${
                r.status === 'OPEN' ? 'ring-2 ring-red-200' : ''
              }`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-slate-900">{r.kind === 'CALL_LOG' ? 'Emergency call' : 'Help request'}</b>
                  <StatusBadge status={r.status} />
                  <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {r.full_name ?? 'Anonymous'} {r.phone_used ? `· dialed ${r.phone_used}` : ''}
                  {r.message ? ` — ${r.message}` : ''}
                </p>
              </div>
              {r.status === 'OPEN' && (
                <div className="flex shrink-0 gap-2">
                  <button className="btn-success !py-2 !text-xs" onClick={() => setStatus(r.id, 'RESOLVED')}>
                    Mark resolved
                  </button>
                  <button className="btn-outline !py-2 !text-xs" onClick={() => setStatus(r.id, 'FALSE_ALARM')}>
                    False alarm
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
