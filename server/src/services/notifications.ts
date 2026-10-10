import { getDb } from '../db/index.js';

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'emergency';

export interface NotifyInput {
  userId: string;
  title: string;
  body?: string;
  type?: NotificationType;
  link?: string;
}

/** Fire-and-forget notification creation (errors are logged, never thrown to callers) */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const db = await getDb();
    await db.query(
      `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5)`,
      [input.userId, input.title, input.body ?? null, input.type ?? 'info', input.link ?? null]
    );
    broadcast(input.userId);
  } catch (e) {
    console.error('[notify] failed:', e);
  }
}

/** Ask all SSE clients to poll for new notifications for this user */
function broadcast(userId: string): void {
  const fn = (globalThis as any).__docbotNotifyHook as ((userId: string) => void) | undefined;
  if (fn) fn(userId);
}
