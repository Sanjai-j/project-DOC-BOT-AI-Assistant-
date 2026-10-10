import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();

/** GET /api/notifications — latest notifications for the logged-in user. */
router.get('/', requireAuth(), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT id, title, body, type, link, is_read, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user!.id]
    );
    const unread = rows.filter((r) => !r.is_read).length;
    res.json({ notifications: rows, unread });
  } catch (e) {
    next(e);
  }
});

/** GET /api/notifications/stream — SSE poll bridge so the bell updates live. */
router.get('/stream', requireAuth(), async (req: AuthedRequest, res, next) => {
  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 5000\n\n');

    const sendPing = (): void => {
      try {
        res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
      } catch {
        /* client gone */
      }
    };
    const interval = setInterval(sendPing, 15000);

    const hook = (userId: string): void => {
      if (userId === req.user!.id) sendPing();
    };
    (globalThis as any).__docbotNotifyHook = hook;

    req.on('close', () => {
      clearInterval(interval);
      (globalThis as any).__docbotNotifyHook = undefined;
    });
  } catch (e) {
    next(e);
  }
});

/** POST /api/notifications/read — mark all (or one) as read. */
router.post('/read', requireAuth(), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const id = (req.body as { id?: string })?.id;
    if (id) {
      await db.query(`UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`, [id, req.user!.id]);
    } else {
      await db.query(`UPDATE notifications SET is_read = true WHERE user_id = $1`, [req.user!.id]);
    }
    res.json({ message: 'Marked as read' });
  } catch (e) {
    next(e);
  }
});

export default router;
