import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';
import { setSetting, getSettings } from '../services/settings.js';

const router = Router();

router.use(requireAuth(['admin']));

/** GET /api/admin/stats — dashboard counters. */
router.get('/stats', async (_req, res, next) => {
  try {
    const db = await getDb();
    const one = async (sql: string): Promise<number> => {
      const r = await db.query(sql);
      return Number(r.rows[0]?.count ?? 0);
    };
    const stats = {
      pendingDoctors: await one(`SELECT COUNT(*)::int AS count FROM doctors WHERE status = 'PENDING'`),
      approvedDoctors: await one(`SELECT COUNT(*)::int AS count FROM doctors WHERE status = 'APPROVED'`),
      rejectedDoctors: await one(`SELECT COUNT(*)::int AS count FROM doctors WHERE status IN ('REJECTED','SUSPENDED')`),
      patients: await one(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'patient'`),
      appointments: await one(`SELECT COUNT(*)::int AS count FROM appointments`),
      pendingAppointments: await one(`SELECT COUNT(*)::int AS count FROM appointments WHERE status = 'PENDING'`),
      hospitals: await one(`SELECT COUNT(*)::int AS count FROM hospitals`),
      emergencyRequests: await one(`SELECT COUNT(*)::int AS count FROM emergency_requests WHERE status = 'OPEN'`),
    };
    res.json({ stats });
  } catch (e) {
    next(e);
  }
});

/** GET /api/admin/doctors?status=PENDING — verification queue and doctor management. */
router.get('/doctors', async (req, res, next) => {
  try {
    const db = await getDb();
    const status = (req.query.status as string) ?? '';
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE d.status = $1`;
    }
    const { rows } = await db.query(
      `SELECT d.*, u.full_name, u.email, u.phone, u.status AS user_status,
              (SELECT COUNT(*) FROM doctor_documents doc WHERE doc.doctor_id = d.id AND doc.doc_type = 'MEDICAL_ID') AS id_docs
       FROM doctors d JOIN users u ON u.id = d.id
       ${where}
       ORDER BY d.created_at DESC`,
      params
    );
    res.json({ doctors: rows });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/admin/doctors/:id/documents — secure document stream (admin only).
 * Doctor ID documents are NEVER publicly accessible.
 */
router.get('/doctors/:id/documents', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM doctor_documents WHERE doctor_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'No documents on file.' });
      return;
    }
    const docs = rows.map((r) => ({
      ...r,
      url: `/api/admin/documents/${r.stored_name}`,
    }));
    res.json({ documents: docs });
  } catch (e) {
    next(e);
  }
});

/** GET /api/admin/documents/:storedName — authenticated file stream from private storage. */
router.get('/documents/:storedName', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const name = path.basename(String(req.params.storedName));
    const { rows } = await db.query(`SELECT * FROM doctor_documents WHERE stored_name = $1`, [name]);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    const filePath = path.join(config.uploadsDir, name);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File missing from storage.' });
      return;
    }
    res.setHeader('Content-Type', rows[0].mime_type);
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/doctors/:id/approve — assign unique DOC code and activate login. */
router.post('/doctors/:id/approve', async (req, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(`SELECT d.*, u.full_name FROM doctors d JOIN users u ON u.id = d.id WHERE d.id = $1`, [
      req.params.id,
    ]);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Doctor not found.' });
      return;
    }
    const doc = rows[0];
    if (doc.status === 'APPROVED') {
      res.status(409).json({ error: 'Doctor is already approved.' });
      return;
    }

    // Assign a unique sequential code (or keep the admin-supplied override).
    let code = (req.body as { doctorCode?: string })?.doctorCode?.trim();
    if (code) {
      const clash = await db.query(`SELECT 1 FROM doctors WHERE doctor_code = $1 AND id <> $2`, [code, doc.id]);
      if (clash.rowCount && clash.rowCount > 0) {
        res.status(409).json({ error: `Doctor ID ${code} is already taken. Choose another.` });
        return;
      }
    } else {
      const maxRow = await db.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(doctor_code, '\\D', '', 'g'), '')::bigint), 1000) AS max
         FROM doctors WHERE doctor_code ~ '^DOC\\d+$'`
      );
      const next = Number(maxRow.rows[0].max) + 1;
      code = `DOC${next}`;
    }

    await db.query(`UPDATE doctors SET status = 'APPROVED', doctor_code = $1, info_note = NULL WHERE id = $2`, [code, doc.id]);
    await db.query(`UPDATE doctor_documents SET status = 'VERIFIED' WHERE doctor_id = $1`, [doc.id]);
    await notify({
      userId: doc.id,
      title: 'Registration approved',
      body: `Your registration was verified. Your unique Doctor ID is ${code}. Log in with your full name, this ID and your password.`,
      type: 'success',
      link: '/doctor/login',
    });
    res.json({ message: `Approved. Doctor ID: ${code}`, doctorCode: code });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/doctors/:id/reject */
router.post('/doctors/:id/reject', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const reason = (req.body as { reason?: string })?.reason ?? 'Documents could not be verified.';
    const { rows } = await db.query(`SELECT id FROM doctors WHERE id = $1`, [req.params.id]);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Doctor not found.' });
      return;
    }
    await db.query(`UPDATE doctors SET status = 'REJECTED', info_note = $2 WHERE id = $1`, [req.params.id, reason]);
    await notify({
      userId: req.params.id,
      title: 'Registration not approved',
      body: reason,
      type: 'error',
      link: '/doctor/register',
    });
    res.json({ message: 'Doctor rejected' });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/doctors/:id/request-info */
router.post('/doctors/:id/request-info', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const note = (req.body as { note?: string })?.note ?? 'Please provide additional verification documents.';
    const { rows } = await db.query(`SELECT id FROM doctors WHERE id = $1`, [req.params.id]);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Doctor not found.' });
      return;
    }
    await db.query(`UPDATE doctors SET status = 'INFO_REQUESTED', info_note = $2 WHERE id = $1`, [req.params.id, note]);
    await notify({
      userId: req.params.id,
      title: 'Additional information requested',
      body: note,
      type: 'warning',
      link: '/doctor/login',
    });
    res.json({ message: 'Information requested from doctor' });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/doctors/:id/suspend | reactivate */
router.post('/doctors/:id/suspend', async (req, res, next) => {
  try {
    const db = await getDb();
    await db.query(`UPDATE doctors SET status = 'SUSPENDED' WHERE id = $1`, [req.params.id]);
    await db.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Doctor suspended' });
  } catch (e) {
    next(e);
  }
});
router.post('/doctors/:id/reactivate', async (req, res, next) => {
  try {
    const db = await getDb();
    await db.query(`UPDATE doctors SET status = 'APPROVED' WHERE id = $1 AND status = 'SUSPENDED'`, [req.params.id]);
    await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Doctor reactivated' });
  } catch (e) {
    next(e);
  }
});

/** GET /api/admin/patients */
router.get('/patients', async (req, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
              p.date_of_birth, p.gender, p.location,
              (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = u.id) AS appointments_count
       FROM users u LEFT JOIN patients p ON p.id = u.id
       WHERE u.role = 'patient'
       ORDER BY u.created_at DESC LIMIT 200`
    );
    res.json({ patients: rows });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/patients/:id/suspend | reactivate */
router.post('/patients/:id/suspend', async (req, res, next) => {
  try {
    const db = await getDb();
    await db.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1 AND role = 'patient'`, [req.params.id]);
    res.json({ message: 'Patient suspended' });
  } catch (e) {
    next(e);
  }
});
router.post('/patients/:id/reactivate', async (req, res, next) => {
  try {
    const db = await getDb();
    await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1 AND role = 'patient'`, [req.params.id]);
    res.json({ message: 'Patient reactivated' });
  } catch (e) {
    next(e);
  }
});

/** GET /api/admin/hospitals + POST (add) + PUT (edit) + DELETE (remove) */
router.get('/hospitals', async (_req, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM hospitals ORDER BY name`);
    res.json({ hospitals: rows });
  } catch (e) {
    next(e);
  }
});

const hospitalSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(4),
  city: z.string().min(2),
  country: z.string().min(2).default('India'),
  phone: z.string().max(30).optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  specialties: z.array(z.string()).default([]),
  emergency_24x7: z.coerce.boolean().default(false),
});

router.post('/hospitals', async (req, res, next) => {
  try {
    const body = hospitalSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid hospital data.' });
      return;
    }
    const h = body.data;
    const db = await getDb();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO hospitals (name, address, city, country, phone, lat, lng, specialties, emergency_24x7)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [h.name, h.address, h.city, h.country, h.phone ?? null, h.lat ?? null, h.lng ?? null, h.specialties, h.emergency_24x7]
    );
    res.status(201).json({ id: rows[0].id, message: 'Hospital added' });
  } catch (e) {
    next(e);
  }
});

router.put('/hospitals/:id', async (req, res, next) => {
  try {
    const body = hospitalSchema.partial().safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid hospital data.' });
      return;
    }
    const h = body.data;
    const db = await getDb();
    await db.query(
      `UPDATE hospitals SET
         name = COALESCE($1, name), address = COALESCE($2, address), city = COALESCE($3, city),
         country = COALESCE($4, country), phone = COALESCE($5, phone), lat = COALESCE($6, lat),
         lng = COALESCE($7, lng), specialties = COALESCE($8, specialties), emergency_24x7 = COALESCE($9, emergency_24x7)
       WHERE id = $10`,
      [h.name ?? null, h.address ?? null, h.city ?? null, h.country ?? null, h.phone ?? null,
       h.lat ?? null, h.lng ?? null, h.specialties ?? null, h.emergency_24x7 ?? null, req.params.id]
    );
    res.json({ message: 'Hospital updated' });
  } catch (e) {
    next(e);
  }
});

router.delete('/hospitals/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    await db.query(`DELETE FROM hospitals WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Hospital removed' });
  } catch (e) {
    next(e);
  }
});

/** GET /api/admin/appointments — all appointments with filters. */
router.get('/appointments', async (req, res, next) => {
  try {
    const db = await getDb();
    const { status } = req.query as Record<string, string | undefined>;
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE a.status = $1`;
    }
    const { rows } = await db.query(
      `SELECT a.*, pu.full_name AS patient_name, du.full_name AS doctor_name
       FROM appointments a
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users du ON du.id = d.id
       ${where}
       ORDER BY a.created_at DESC LIMIT 300`,
      params
    );
    res.json({ appointments: rows });
  } catch (e) {
    next(e);
  }
});

/** GET /api/admin/emergency — emergency request log. */
router.get('/emergency', async (_req, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT e.*, u.full_name, u.phone FROM emergency_requests e LEFT JOIN users u ON u.id = e.user_id
       ORDER BY e.created_at DESC LIMIT 200`
    );
    res.json({ requests: rows });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/emergency/:id/resolve | false-alarm */
router.post('/emergency/:id/resolve', async (req, res, next) => {
  try {
    const db = await getDb();
    const status = (req.body as { status?: string })?.status === 'FALSE_ALARM' ? 'FALSE_ALARM' : 'RESOLVED';
    await db.query(`UPDATE emergency_requests SET status = $1 WHERE id = $2`, [status, req.params.id]);
    res.json({ message: `Marked ${status}` });
  } catch (e) {
    next(e);
  }
});

/** GET /api/admin/settings */
router.get('/settings', async (_req, res, next) => {
  try {
    const settings = await getSettings(true);
    res.json({ settings });
  } catch (e) {
    next(e);
  }
});

/** PUT /api/admin/settings — emergency number, slot duration, reminders. */
router.put('/settings', async (req, res, next) => {
  try {
    const body = z
      .object({
        emergency_number: z.string().min(3).max(20),
        default_slot_minutes: z.coerce.number().int().min(5).max(120),
        video_reminder_30: z.coerce.boolean(),
        video_reminder_10: z.coerce.boolean(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid settings.' });
      return;
    }
    for (const [k, v] of Object.entries(body.data)) {
      await setSetting(k as any, String(v));
    }
    res.json({ message: 'Settings saved' });
  } catch (e) {
    next(e);
  }
});

/** GET /api/admin/reports — simple operational report. */
router.get('/reports', async (_req, res, next) => {
  try {
    const db = await getDb();
    const byStatus = await db.query(`SELECT status, COUNT(*)::int AS count FROM appointments GROUP BY status`);
    const bySpecialty = await db.query(
      `SELECT d.specialization, COUNT(a.id)::int AS count FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id GROUP BY d.specialization ORDER BY count DESC`
    );
    const topDoctors = await db.query(
      `SELECT u.full_name, d.specialization, d.avg_rating, d.reviews_count FROM doctors d JOIN users u ON u.id = d.id
       WHERE d.status = 'APPROVED' ORDER BY d.avg_rating DESC LIMIT 10`
    );
    res.json({ byStatus: byStatus.rows, bySpecialty: bySpecialty.rows, topDoctors: topDoctors.rows });
  } catch (e) {
    next(e);
  }
});

export default router;
