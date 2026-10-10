import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import { notify } from '../services/notifications.js';

const router = Router();

/** GET /api/emergency/number — public-ish: the configured emergency number + safety text. */
router.get('/number', async (_req, res, next) => {
  try {
    const settings = await getSettings();
    res.json({
      number: settings.emergency_number,
      message: 'If this is a life-threatening emergency, contact your local emergency services immediately.',
      notice: 'DocBot TeleMed is not an emergency medical service.',
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/emergency — log an emergency action.
 * kind CALL_LOG: user tapped Call (tel: link opened).
 * kind HELP_REQUEST: user pressed Emergency Help, optionally with note + location.
 */
router.post('/', requireAuth(['patient', 'doctor', 'admin']), async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        kind: z.enum(['CALL_LOG', 'HELP_REQUEST']),
        message: z.string().max(1000).optional(),
        phoneUsed: z.string().max(30).optional(),
        lat: z.coerce.number().optional(),
        lng: z.coerce.number().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid emergency request.' });
      return;
    }
    const db = await getDb();
    const settings = await getSettings();
    const loc = body.data.lat !== undefined && body.data.lng !== undefined ? ` [${body.data.lat.toFixed(5)}, ${body.data.lng.toFixed(5)}]` : '';
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO emergency_requests (user_id, kind, phone_used, message, status)
       VALUES ($1, $2, $3, $4, 'OPEN') RETURNING id`,
      [req.user!.id, body.data.kind, body.data.phoneUsed ?? settings.emergency_number, `${body.data.message ?? ''}${loc}`.trim() || null]
    );
    // alert all admins
    const admins = await db.query(`SELECT id FROM users WHERE role = 'admin'`);
    for (const a of admins.rows) {
      await notify({
        userId: a.id,
        title: 'EMERGENCY request',
        body: `${req.user!.name} triggered an emergency ${body.data.kind === 'CALL_LOG' ? 'call' : 'help request'}${loc}.`,
        type: 'emergency',
        link: '/admin/emergency',
      });
    }
    res.status(201).json({ id: rows[0].id, number: settings.emergency_number });
  } catch (e) {
    next(e);
  }
});

/** GET /api/emergency/mine — the user's own emergency history. */
router.get('/mine', requireAuth(), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT id, kind, message, status, created_at FROM emergency_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.user!.id]
    );
    res.json({ requests: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
