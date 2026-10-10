import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from './api';

export interface ReminderToast {
  id: number;
  title: string;
  body: string;
}

/**
 * Polls notifications and raises browser notifications + in-app toasts for
 * reminder/emergency types. The reminder scheduler on the server creates
 * "Video consultation at …" notifications 30 and 10 minutes before calls.
 */
/** Session-level dedupe so toasts never repeat across page navigations. */
const seen = new Set<string>();

export function useReminders(): ReminderToast[] {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<ReminderToast[]>([]);

  useEffect(() => {
    if (!user) return;

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    let active = true;
    const poll = async () => {
      try {
        const r = await api<{ notifications: any[] }>('/api/notifications');
        for (const n of r.notifications ?? []) {
          const isAlert =
            /reminder|starts in|scheduled at|starting/i.test(n.title) || n.type === 'emergency';
          const isFresh = Date.now() - new Date(n.created_at).getTime() < 120_000;
          if (!isAlert || !isFresh || seen.has(n.id)) continue;
          seen.add(n.id);
          const toast = { id: Date.now() + Math.random(), title: n.title, body: n.body ?? '' };
          setToasts((t) => [...t, toast]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), 30000);
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(`DocBot TeleMed — ${n.title}`, { body: n.body ?? '', tag: n.id });
            } catch {
              /* some browsers require SW */
            }
          }
        }
      } catch {
        /* offline */
      }
    };

    poll();
    const t = setInterval(poll, 25000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [user]);

  return toasts;
}

export function ReminderToaster() {
  const toasts = useReminders();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div key={t.id} className="w-80 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-lg">
          <div className="flex items-start gap-2">
            <span className="text-xl">⏰</span>
            <div>
              <b className="text-sm text-amber-900">{t.title}</b>
              <p className="text-xs text-amber-800">{t.body}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
