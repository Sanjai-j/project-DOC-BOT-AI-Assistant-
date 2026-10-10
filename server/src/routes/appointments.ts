import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';
import { getDoctorSlotsForDate, toDateStr } from '../services/slots.js';

const router = Router();

function isSlotOpen(doctorId: string, date: string, time: string, slots: { start: string; status: string }[]): boolean {
  return slots.some((s) => s.start === time && s.status === 'available');
}

/**
 * POST /api/appointments — patient requests an appointment (status PENDING).
 * Prevents double booking by validating against generated slots and a DB unique index.
 */
router.post('/', requireAuth(['patient']), async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        doctorId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        consultationType: z.enum(['IN_PERSON', 'VIDEO']),
        reason: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid appointment request.' });
      return;
    }
    const { doctorId, date, time, consultationType, reason } = body.data;
    const db = await getDb();

    const docRes = await db.query(
      `SELECT d.id, u.full_name, d.status, d.doctor_code FROM doctors d JOIN users u ON u.id = d.id WHERE d.id = $1`,
      [doctorId]
    );
    if (docRes.rows.length === 0 || docRes.rows[0].status !== 'APPROVED') {
      res.status(404).json({ error: 'Doctor not available for booking.' });
      return;
    }

    const day = await getDoctorSlotsForDate(doctorId, date);
    if (!isSlotOpen(doctorId, date, time, day.slots)) {
      res.status(409).json({ error: 'That slot is no longer available. Please pick another time.' });
      return;
    }

    // compute end time from the matched slot
    const slot = day.slots.find((s) => s.start === time)!;

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, consultation_type, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING') RETURNING id`,
      [req.user!.id, doctorId, date, time, slot.end, consultationType, reason ?? null]
    );
    const appointmentId = rows[0].id;

    if (consultationType === 'VIDEO') {
      await db.query(`INSERT INTO video_consultations (appointment_id, status) VALUES ($1, 'REQUESTED')`, [
        appointmentId,
      ]);
    }

    const docName = docRes.rows[0].full_name;
    await notify({
      userId: doctorId,
      title: 'New appointment request',
      body: `A patient requested an appointment on ${date} at ${time} (${consultationType === 'VIDEO' ? 'Video' : 'In-person'}).`,
      type: 'info',
      link: '/doctor/requests',
    });
    await notify({
      userId: req.user!.id,
      title: 'Appointment request sent',
      body: `Your request was sent to ${docName}. You will be notified once it is ${'confirmed'}.`,
      type: 'info',
      link: '/patient/appointments',
    });

    res.status(201).json({ id: appointmentId, status: 'PENDING', message: 'Appointment requested. Waiting for doctor approval.' });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/appointments — role-aware list (patient: own; doctor: own; admin: all).
 * Filters: status, type, date range.
 */
router.get('/', requireAuth(), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { status, type } = req.query as Record<string, string | undefined>;
    const params: unknown[] = [];
    const where: string[] = [];

    if (req.user!.role === 'patient') {
      params.push(req.user!.id);
      where.push(`a.patient_id = $${params.length}`);
    } else if (req.user!.role === 'doctor') {
      params.push(req.user!.id);
      where.push(`a.doctor_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`a.consultation_type = $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT a.*, pu.full_name AS patient_name, du.full_name AS doctor_name,
              d.doctor_code, d.specialization, d.photo_url AS doctor_photo,
              v.status AS video_status, h.name AS hospital_name
       FROM appointments a
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users du ON du.id = d.id
       LEFT JOIN video_consultations v ON v.appointment_id = a.id
       LEFT JOIN hospitals h ON h.id = a.hospital_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.date DESC, a.start_time DESC
       LIMIT 200`,
      params
    );
    res.json({ appointments: rows });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/appointments/:id/accept — doctor only.
 * Confirms the appointment and notifies the patient.
 */
router.post('/:id/accept', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT a.*, pu.full_name AS patient_name FROM appointments a JOIN users pu ON pu.id = a.patient_id
       WHERE a.id = $1 AND a.doctor_id = $2`,
      [req.params.id, req.user!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }
    const appt = rows[0];
    if (appt.status !== 'PENDING') {
      res.status(409).json({ error: `This request is already ${String(appt.status).toLowerCase()}.` });
      return;
    }
    await db.query(`UPDATE appointments SET status = 'CONFIRMED', updated_at = now() WHERE id = $1`, [req.params.id]);
    if (appt.consultation_type === 'VIDEO') {
      await db.query(`UPDATE video_consultations SET status = 'CONFIRMED' WHERE appointment_id = $1`, [req.params.id]);
    }
    await notify({
      userId: appt.patient_id,
      title: 'Appointment confirmed',
      body: `Your appointment with Dr. ${req.user!.name} on ${toDateStr(new Date(appt.date))} at ${String(appt.start_time).slice(0, 5)} has been confirmed.`,
      type: 'success',
      link: '/patient/appointments',
    });
    res.json({ message: 'Appointment confirmed' });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/appointments/:id/reject — doctor only. Notifies the patient.
 */
router.post('/:id/reject', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const body = z.object({ reason: z.string().max(300).optional() }).safeParse(req.body);
    const rejectReason = body.success ? body.data.reason : undefined;
    const { rows } = await db.query(
      `SELECT a.*, pu.full_name AS patient_name FROM appointments a JOIN users pu ON pu.id = a.patient_id
       WHERE a.id = $1 AND a.doctor_id = $2`,
      [req.params.id, req.user!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }
    const appt = rows[0];
    if (appt.status !== 'PENDING') {
      res.status(409).json({ error: `This request is already ${String(appt.status).toLowerCase()}.` });
      return;
    }
    await db.query(
      `UPDATE appointments SET status = 'REJECTED', notes = COALESCE($2, notes), updated_at = now() WHERE id = $1`,
      [req.params.id, rejectReason ?? null]
    );
    if (appt.consultation_type === 'VIDEO') {
      await db.query(`UPDATE video_consultations SET status = 'REJECTED' WHERE appointment_id = $1`, [req.params.id]);
    }
    await notify({
      userId: appt.patient_id,
      title: 'Appointment declined',
      body: `Dr. ${req.user!.name} declined your appointment request${rejectReason ? `: ${rejectReason}` : '.'} Please try another slot.`,
      type: 'warning',
      link: '/patient/appointments',
    });
    res.json({ message: 'Appointment rejected' });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/appointments/:id/cancel — patient (own) or doctor (own).
 */
router.post('/:id/cancel', requireAuth(['patient', 'doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const column = req.user!.role === 'patient' ? 'patient_id' : 'doctor_id';
    const { rows } = await db.query(
      `SELECT a.* FROM appointments a WHERE a.id = $1 AND a.${column} = $2`,
      [req.params.id, req.user!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }
    const appt = rows[0];
    if (!['PENDING', 'CONFIRMED'].includes(appt.status)) {
      res.status(409).json({ error: 'Only pending or confirmed appointments can be cancelled.' });
      return;
    }
    await db.query(`UPDATE appointments SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [req.params.id]);
    if (appt.consultation_type === 'VIDEO') {
      await db.query(`UPDATE video_consultations SET status = 'CANCELLED' WHERE appointment_id = $1`, [req.params.id]);
    }
    const otherUser = req.user!.role === 'patient' ? appt.doctor_id : appt.patient_id;
    await notify({
      userId: otherUser,
      title: 'Appointment cancelled',
      body: `The appointment on ${toDateStr(new Date(appt.date))} at ${String(appt.start_time).slice(0, 5)} was cancelled by the ${req.user!.role}.`,
      type: 'warning',
      link: req.user!.role === 'patient' ? '/doctor/appointments' : '/patient/appointments',
    });
    res.json({ message: 'Appointment cancelled' });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/appointments/:id/complete — doctor marks a consultation done.
 * Unlocks the patient's ability to leave a review.
 */
router.post('/:id/complete', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT a.* FROM appointments a WHERE a.id = $1 AND a.doctor_id = $2`,
      [req.params.id, req.user!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }
    if (rows[0].status !== 'CONFIRMED') {
      res.status(409).json({ error: 'Only confirmed appointments can be marked completed.' });
      return;
    }
    await db.query(`UPDATE appointments SET status = 'COMPLETED', updated_at = now() WHERE id = $1`, [req.params.id]);
    if (rows[0].consultation_type === 'VIDEO') {
      await db.query(`UPDATE video_consultations SET status = 'ENDED' WHERE appointment_id = $1 AND status IN ('IN_PROGRESS','CONFIRMED')`, [req.params.id]);
    }
    await notify({
      userId: rows[0].patient_id,
      title: 'Consultation completed',
      body: `Your consultation with Dr. ${req.user!.name} is complete. You can now rate your experience.`,
      type: 'success',
      link: '/patient/appointments',
    });
    res.json({ message: 'Appointment completed' });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/reviews — patient rates a completed consultation (1–5 + optional comment).
 * One review per appointment; only after completion; recalculates the doctor average.
 */
router.post('/:id/review', requireAuth(['patient']), async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().max(1000).optional() })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Rating must be 1–5 stars.' });
      return;
    }
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM appointments WHERE id = $1 AND patient_id = $2 AND status = 'COMPLETED'`,
      [req.params.id, req.user!.id]
    );
    if (rows.length === 0) {
      res.status(403).json({ error: 'You can only review consultations you completed.' });
      return;
    }
    const existing = await db.query(`SELECT 1 FROM reviews WHERE appointment_id = $1`, [req.params.id]);
    if (existing.rowCount && existing.rowCount > 0) {
      res.status(409).json({ error: 'You already reviewed this consultation.' });
      return;
    }
    await db.query(
      `INSERT INTO reviews (appointment_id, patient_id, doctor_id, rating, comment) VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, req.user!.id, rows[0].doctor_id, body.data.rating, body.data.comment ?? null]
    );
    await db.query(
      `UPDATE doctors d SET
         avg_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE doctor_id = d.id), 0),
         reviews_count = (SELECT COUNT(*) FROM reviews WHERE doctor_id = d.id)
       WHERE d.id = $1`,
      [rows[0].doctor_id]
    );
    res.status(201).json({ message: 'Review submitted. Thank you!' });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/appointments/:id/review — fetch existing review (for prefill).
 */
router.get('/:id/review', requireAuth(['patient']), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(`SELECT rating, comment FROM reviews WHERE appointment_id = $1 AND patient_id = $2`, [
      req.params.id,
      req.user!.id,
    ]);
    res.json({ review: rows[0] ?? null });
  } catch (e) {
    next(e);
  }
});

export default router;
