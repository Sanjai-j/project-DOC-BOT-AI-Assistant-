import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { runRuleEngine } from '../docbot/rules.js';
import { buildKbReply } from '../docbot/kb.js';
import { askLLM, llmAvailable } from '../docbot/llm.js';
import { notify } from '../services/notifications.js';

const router = Router();

/**
 * POST /api/chat — send a message to DocBot.
 * Pipeline: save user msg → emergency check → rule engine (always) → KB
 * enrichment (dataset-trained, when symptoms are recognized) → optional LLM
 * (constrained, emergency-checked locally) → save assistant msg.
 */
router.post('/', requireAuth(['patient', 'doctor', 'admin']), async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ message: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Type a message for DocBot.' });
      return;
    }
    const message = body.data.message.trim();
    const db = await getDb();

    // ensure session
    let { rows: sess } = await db.query(`SELECT id FROM chat_sessions WHERE user_id = $1`, [req.user!.id]);
    if (sess.length === 0) {
      await db.query(`INSERT INTO chat_sessions (user_id) VALUES ($1)`, [req.user!.id]);
      ({ rows: sess } = await db.query(`SELECT id FROM chat_sessions WHERE user_id = $1`, [req.user!.id]));
    }
    const sessionId = sess[0].id;

    await db.query(`INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`, [sessionId, message]);

    const fallback = runRuleEngine(message);
    const result = await buildKbReply(message, fallback);

    // Load short history for LLM context
    const { rows: histRows } = await db.query<{ role: 'user' | 'assistant'; content: string }>(
      `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );
    const history = histRows.slice(-12).map((r) => ({ role: r.role, content: r.content }));

    const finalResult = await askLLM(history, result);

    const meta: Record<string, unknown> = {
      emergency: finalResult.emergency,
      suggestedSpecialty: finalResult.suggestedSpecialty,
      buttons: finalResult.actionButtons,
      engine: llmAvailable() ? 'llm+kb+rules' : 'kb+rules',
    };
    await db.query(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES ($1, 'assistant', $2, $3)`, [
      sessionId,
      finalResult.reply,
      JSON.stringify(meta),
    ]);

    if (finalResult.emergency) {
      await db.query(
        `INSERT INTO emergency_requests (user_id, kind, message, status) VALUES ($1, 'HELP_REQUEST', $2, 'OPEN')`,
        [req.user!.id, message]
      );
      await notify({
        userId: req.user!.id,
        title: 'EMERGENCY — seek immediate help',
        body: 'DocBot detected possibly urgent symptoms. Please call your local emergency number now.',
        type: 'emergency',
        link: '/patient/emergency',
      });
    }

    res.json({
      reply: finalResult.reply,
      suggestedSpecialty: finalResult.suggestedSpecialty,
      emergency: finalResult.emergency,
      quickReplies: finalResult.quickReplies,
      actionButtons: finalResult.actionButtons,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /api/chat — conversation history for the logged-in user. */
router.get('/', requireAuth(['patient', 'doctor', 'admin']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows: sess } = await db.query(`SELECT id FROM chat_sessions WHERE user_id = $1`, [req.user!.id]);
    if (sess.length === 0) {
      res.json({ messages: [] });
      return;
    }
    const { rows } = await db.query(
      `SELECT role, content, meta, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 200`,
      [sess[0].id]
    );
    res.json({ messages: rows });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/chat — start a fresh conversation. */
router.delete('/', requireAuth(['patient', 'doctor', 'admin']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    await db.query(`DELETE FROM chat_sessions WHERE user_id = $1`, [req.user!.id]);
    res.json({ message: 'Conversation cleared' });
  } catch (e) {
    next(e);
  }
});

export default router;
