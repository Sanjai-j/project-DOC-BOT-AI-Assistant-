import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';
import { getDoctorSlotsForDate, toDateStr } from '../services/slots.js';

const router = Router();

/** Short-lived signed room token so room links can't be forged. */
export function signRoomToken(roomId: string, appointmentId: string): string {
  const payload = `${roomId}.${appointmentId}.${Date.now()}`;
  const sig = crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'docbot-dev-secret')
    .update(payload)
    .digest('hex')
    .slice(0, 32);
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyRoomToken(token: string): { roomId: string; appointmentId: string; issuedAt: number } | null {
  try {
    const [b64, sig] = token.split('.');
    const payload = Buffer.from(b64, 'base64url').toString('utf8');
    const expected = crypto
      .createHmac('sha256', process.env.JWT_SECRET || 'docbot-dev-secret')
      .update(payload)
      .digest('hex')
      .slice(0, 32);
    if (sig !== expected) return null;
    const [roomId, appointmentId, ts] = payload.split('.');
    return { roomId, appointmentId: appointmentId || '', issuedAt: Number(ts) };
  } catch {
    return null;
  }
}

/** Patient join window: from 10 min before start until 15 min after end. */
export function patientWindowOpen(date: string, startTime: string, endTime: string): boolean {
  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  const now = Date.now();
  return now >= start.getTime() - 10 * 60_000 && now <= end.getTime() + 15 * 60_000;
}

/** Doctor can open the room a bit wider: 15 min before until 30 min after. */
export function doctorWindowOpen(date: string, startTime: string, endTime: string): boolean {
  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  const now = Date.now();
  return now >= start.getTime() - 15 * 60_000 && now <= end.getTime() + 30 * 60_000;
}

/**
 * POST /api/video/request — patient requests a video consultation slot.
 * The patient can NEVER start the call; this only creates a PENDING request.
 */
router.post('/request', requireAuth(['patient']), async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        doctorId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        reason: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid video consultation request.' });
      return;
    }
    const { doctorId, date, time, reason } = body.data;
    const db = await getDb();

    const docRes = await db.query(
      `SELECT d.id, u.full_name, d.status FROM doctors d JOIN users u ON u.id = d.id WHERE d.id = $1`,
      [doctorId]
    );
    if (docRes.rows.length === 0 || docRes.rows[0].status !== 'APPROVED') {
      res.status(404).json({ error: 'Doctor not available for booking.' });
      return;
    }

    const day = await getDoctorSlotsForDate(doctorId, date);
    const slot = day.slots.find((s) => s.start === time && s.status === 'available');
    if (!slot) {
      res.status(409).json({ error: 'That slot is no longer available. Please pick another time.' });
      return;
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, consultation_type, reason, status)
       VALUES ($1, $2, $3, $4, $5, 'VIDEO', $6, 'PENDING') RETURNING id`,
      [req.user!.id, doctorId, date, time, slot.end, reason ?? null]
    );
    await db.query(`INSERT INTO video_consultations (appointment_id, status) VALUES ($1, 'REQUESTED')`, [rows[0].id]);

    await notify({
      userId: doctorId,
      title: 'New video consultation request',
      body: `A patient requested a video consultation on ${date} at ${time}.`,
      type: 'info',
      link: '/doctor/video',
    });
    await notify({
      userId: req.user!.id,
      title: 'Video consultation requested',
      body: `Your request was sent to Dr. ${docRes.rows[0].full_name}. You can join only after it is confirmed.`,
      type: 'info',
      link: '/patient/video',
    });

    res.status(201).json({
      id: rows[0].id,
      status: 'PENDING',
      message: 'Video consultation requested. You will be able to join once the doctor confirms.',
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/video/accept — doctor confirms a pending video request and a private room is created.
 */
router.post('/accept', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ appointmentId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Missing appointmentId.' });
      return;
    }
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT a.*, pu.full_name AS patient_name FROM appointments a JOIN users pu ON pu.id = a.patient_id
       WHERE a.id = $1 AND a.doctor_id = $2 AND a.consultation_type = 'VIDEO'`,
      [body.data.appointmentId, req.user!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Video consultation not found.' });
      return;
    }
    if (rows[0].status !== 'PENDING') {
      res.status(409).json({ error: `This request is already ${String(rows[0].status).toLowerCase()}.` });
      return;
    }
    const roomId = crypto.randomUUID();
    await db.query(`UPDATE appointments SET status = 'CONFIRMED', updated_at = now() WHERE id = $1`, [rows[0].id]);
    await db.query(`UPDATE video_consultations SET status = 'CONFIRMED', room_id = $1 WHERE appointment_id = $2`, [
      roomId,
      rows[0].id,
    ]);
    await notify({
      userId: rows[0].patient_id,
      title: 'Video consultation confirmed',
      body: `Dr. ${req.user!.name} confirmed your video consultation on ${toDateStr(new Date(rows[0].date))} at ${String(rows[0].start_time).slice(0, 5)}.`,
      type: 'success',
      link: '/patient/video',
    });
    res.json({ message: 'Video consultation confirmed', roomId });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/video/reject — doctor declines a pending video request.
 */
router.post('/reject', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ appointmentId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Missing appointmentId.' });
      return;
    }
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT a.* FROM appointments a WHERE a.id = $1 AND a.doctor_id = $2 AND a.consultation_type = 'VIDEO'`,
      [body.data.appointmentId, req.user!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Video consultation not found.' });
      return;
    }
    if (rows[0].status !== 'PENDING') {
      res.status(409).json({ error: `This request is already ${String(rows[0].status).toLowerCase()}.` });
      return;
    }
    await db.query(`UPDATE appointments SET status = 'REJECTED', updated_at = now() WHERE id = $1`, [rows[0].id]);
    await db.query(`UPDATE video_consultations SET status = 'REJECTED' WHERE appointment_id = $1`, [rows[0].id]);
    await notify({
      userId: rows[0].patient_id,
      title: 'Video consultation declined',
      body: `Dr. ${req.user!.name} declined the video consultation request. Please try another slot.`,
      type: 'warning',
      link: '/patient/video',
    });
    res.json({ message: 'Video consultation rejected' });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/video/mine — list the current user's video consultations.
 */
router.get('/mine', requireAuth(['patient', 'doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const col = req.user!.role === 'patient' ? 'a.patient_id' : 'a.doctor_id';
    const { rows } = await db.query(
      `SELECT a.id, a.date, a.start_time, a.end_time, a.status, a.reason, a.consultation_type,
              v.status AS video_status, v.room_id,
              pu.full_name AS patient_name, du.full_name AS doctor_name,
              d.specialization, d.doctor_code
       FROM appointments a
       JOIN video_consultations v ON v.appointment_id = a.id
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users du ON du.id = d.id
       WHERE ${col} = $1
       ORDER BY a.date DESC, a.start_time DESC`,
      [req.user!.id]
    );
    res.json({ consultations: rows });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/video/room/:appointmentId — access to a room.
 * Doctor: confirmed window. Patient: only once confirmed AND inside the join window.
 */
router.get('/room/:appointmentId', requireAuth(['patient', 'doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT a.*, v.status AS video_status, v.room_id,
              pu.full_name AS patient_name, du.full_name AS doctor_name
       FROM appointments a
       JOIN video_consultations v ON v.appointment_id = a.id
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users du ON du.id = d.id
       WHERE a.id = $1`,
      [req.params.appointmentId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Consultation not found.' });
      return;
    }
    const a = rows[0];
    const isDoctor = a.doctor_id === req.user!.id;
    const isPatient = a.patient_id === req.user!.id;
    if (!isDoctor && !isPatient) {
      res.status(403).json({ error: 'Not your consultation.' });
      return;
    }
    const dateStr = toDateStr(new Date(a.date));
    const startT = String(a.start_time).slice(0, 5);
    const endT = String(a.end_time).slice(0, 5);

    if (isDoctor) {
      if (!doctorWindowOpen(dateStr, startT, endT)) {
        res.status(423).json({
          error: `You can open the call from 15 minutes before the scheduled time (${startT}).`,
        });
        return;
      }
    } else {
      if (a.status !== 'CONFIRMED' && a.status !== 'IN_PROGRESS') {
        res.status(403).json({ error: 'The doctor has not confirmed this consultation yet.' });
        return;
      }
      if (!patientWindowOpen(dateStr, startT, endT)) {
        res.status(423).json({
          error: `The join button becomes active around ${startT} on ${dateStr}.`,
        });
        return;
      }
    }

    const token = signRoomToken(a.room_id ?? a.id, a.id);
    res.json({
      roomId: a.room_id ?? a.id,
      token,
      role: isDoctor ? 'doctor' : 'patient',
      appointment: { id: a.id, date: dateStr, start: startT, end: endT, status: a.status },
      otherParty: isDoctor ? a.patient_name : `Dr. ${a.doctor_name}`,
      videoStatus: a.video_status,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/video/:appointmentId/start — DOCTOR ONLY. Marks the call in progress.
 */
router.post('/:appointmentId/start', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT a.*, v.room_id FROM appointments a JOIN video_consultations v ON v.appointment_id = a.id
       WHERE a.id = $1 AND a.doctor_id = $2`,
      [req.params.appointmentId, req.user!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Consultation not found.' });
      return;
    }
    const a = rows[0];
    if (a.status !== 'CONFIRMED') {
      res.status(409).json({ error: `Cannot start a ${String(a.status).toLowerCase()} consultation.` });
      return;
    }
    const dateStr = toDateStr(new Date(a.date));
    if (!doctorWindowOpen(dateStr, String(a.start_time).slice(0, 5), String(a.end_time).slice(0, 5))) {
      res.status(423).json({ error: 'Too early — the call window opens 15 minutes before the scheduled time.' });
      return;
    }
    await db.query(`UPDATE video_consultations SET status = 'IN_PROGRESS', started_at = now() WHERE appointment_id = $1`, [
      a.id,
    ]);
    await db.query(`UPDATE appointments SET status = 'CONFIRMED', updated_at = now() WHERE id = $1`, [a.id]);
    await notify({
      userId: a.patient_id,
      title: 'Your consultation is starting',
      body: `Dr. ${req.user!.name} has started the call. Join now.`,
      type: 'info',
      link: '/patient/video',
    });
    res.json({ message: 'Call started', roomId: a.room_id });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/video/:appointmentId/end — DOCTOR ONLY. Ends the call and completes the appointment.
 */
router.post('/:appointmentId/end', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT a.* FROM appointments a WHERE a.id = $1 AND a.doctor_id = $2`,
      [req.params.appointmentId, req.user!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Consultation not found.' });
      return;
    }
    await db.query(`UPDATE video_consultations SET status = 'ENDED', ended_at = now() WHERE appointment_id = $1`, [
      rows[0].id,
    ]);
    await db.query(`UPDATE appointments SET status = 'COMPLETED', updated_at = now() WHERE id = $1`, [rows[0].id]);
    await notify({
      userId: rows[0].patient_id,
      title: 'Consultation completed',
      body: `Your video consultation with Dr. ${req.user!.name} has ended. You can now rate your experience.`,
      type: 'success',
      link: '/patient/appointments',
    });
    res.json({ message: 'Call ended. Appointment marked completed.' });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/video/monitor — admin overview of all video consultations.
 */
router.get('/monitor', requireAuth(['admin']), async (_req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT v.status AS video_status, v.started_at, v.ended_at,
              a.id AS appointment_id, a.date, a.start_time, a.status AS appointment_status,
              pu.full_name AS patient_name, du.full_name AS doctor_name
       FROM video_consultations v
       JOIN appointments a ON a.id = v.appointment_id
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users du ON du.id = d.id
       ORDER BY a.date DESC LIMIT 100`
    );
    res.json({ consultations: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
