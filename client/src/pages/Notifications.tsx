import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon, Spinner, EmptyState } from '../components/ui';

interface Notif {
  id: string;
  title: string;
  body: string | null;
  type: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICON: Record<string, any> = {
  info: 'info',
  success: 'check',
  warning: 'clock',
  error: 'x',
  emergency: 'alert',
};

const TYPE_STYLE: Record<string, string> = {
  info: 'bg-slate-100 text-slate-500',
  success: 'bg-emerald-100 text-emerald-600',
  warning: 'bg-amber-100 text-amber-600',
  error: 'bg-red-100 text-red-600',
  emergency: 'bg-red-600 text-white',
};

export default function Notifications() {
  const [items, setItems] = useState<Notif[] | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ notifications: Notif[] }>('/api/notifications').catch(() => null);
    setItems(r?.notifications ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markAll() {
    await api('/api/notifications/read', { method: 'POST' });
    load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-900">Notifications</h1>
        <button className="btn-outline !py-2 !text-xs" onClick={markAll}>Mark all read</button>
      </div>

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title="No notifications" hint="Updates about your appointments will appear here." />
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const inner = (
              <div className={`card flex gap-3 p-4 ${!n.is_read ? 'border-brand-200 bg-brand-50/50' : ''}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TYPE_STYLE[n.type] ?? TYPE_STYLE.info}`}>
                  <Icon name={TYPE_ICON[n.type] ?? 'info'} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-sm text-slate-900">{n.title}</b>
                    {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  </div>
                  {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                  <p className="mt-1 text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</p>
                </div>
              </div>
            );
            return n.link ? (
              <Link to={n.link} key={n.id} onClick={() => api('/api/notifications/read', { method: 'POST', body: { id: n.id } }).catch(() => {})}>
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
