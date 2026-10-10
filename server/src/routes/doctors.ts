import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { hashPassword, normalizePhone } from '../utils/auth.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import { getDoctorSlotsForDate, nextNDates, doctorHasOpenSlotOn } from '../services/slots.js';
import { notify } from '../services/notifications.js';

const router = Router();

// ── private upload storage (never served publicly) ────────────
const UPLOADS_DIR = config.uploadsDir;
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Lazy multer so missing deps fail loudly at first use, not import time
let multerMiddleware: any = null;
async function getUploader() {
  if (!multerMiddleware) {
    const multer = (await import('multer')).default;
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
      },
    });
    multerMiddleware = multer({
      storage,
      limits: { fileSize: MAX_FILE_SIZE, files: 3 },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
          cb(new Error('Only JPG, PNG, WEBP images or PDF documents are allowed'));
          return;
        }
        cb(null, true);
      },
    });
  }
  return multerMiddleware;
}

// ─────────────────────────── REGISTRATION ───────────────────────────

const registrationSchema = z.object({
  fullName: z.string().min(2).max(120),
  doctorIdNumber: z.string().min(3).max(60), // medical registration number on the document
  hospitalName: z.string().min(2).max(160),
  hospitalAddress: z.string().min(4).max(300),
  yearsExperience: z.coerce.number().int().min(0).max(70),
  specialization: z.string().min(2).max(80),
  qualifications: z.string().max(300).optional(),
  email: z.string().email().toLowerCase(),
  phone: z.string().min(6).max(20),
  password: z.string().min(8).max(128),
  availableDays: z.array(z.coerce.number().int().min(0).max(6)).min(1),
  availableHours: z.string().min(3).max(60).default('09:00-17:00'),
  languages: z.string().max(160).optional(),
  consultationFee: z.coerce.number().min(0).max(1000000).optional(),
  city: z.string().max(100).optional(),
});

/**
 * POST /api/doctors/register
 * Creates a pending doctor account with uploaded documents.
 * Status: PENDING — the doctor cannot log in until an admin approves.
 */
router.post('/register', async (req, res, next) => {
  try {
    const upload = await getUploader();
    upload.fields([
      { name: 'idDocument', maxCount: 1 },
      { name: 'photo', maxCount: 1 },
    ])(req, res, async (err: unknown) => {
      if (err) {
        res.status(400).json({ error: (err as Error).message || 'File upload failed' });
        return;
      }
      try {
        // multipart forms send plain strings — normalize before validation
        const raw = { ...(req.body as Record<string, unknown>) };
        if (typeof raw.availableDays === 'string') {
          raw.availableDays = (raw.availableDays as string)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
        for (const k of Object.keys(raw)) {
          if (raw[k] === '') delete raw[k];
        }
        const parsed = registrationSchema.safeParse(raw);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Please complete all required fields (password min 8 chars, at least one available day).',
          });
          return;
        }
        const data = parsed.data;
        const files = (req as any).files as Record<string, Express.Multer.File[]> | undefined;
        const idDoc = files?.idDocument?.[0];
        const photo = files?.photo?.[0];
        if (!idDoc) {
          res.status(400).json({ error: 'Please upload your medical ID document.' });
          return;
        }

        const db = await getDb();
        const dupe = await db.query(`SELECT id FROM users WHERE email = $1 OR phone = $2`, [
          data.email,
          normalizePhone(data.phone),
        ]);
        if (dupe.rowCount && dupe.rowCount > 0) {
          res.status(409).json({ error: 'An account with this email or phone already exists.' });
          return;
        }

        const passwordHash = await hashPassword(data.password);
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO users (role, full_name, email, phone, password_hash)
           VALUES ('doctor', $1, $2, $3, $4) RETURNING id`,
          [data.fullName, data.email, normalizePhone(data.phone), passwordHash]
        );
        const doctorUserId = rows[0].id;

        // doctor_code is assigned by the admin at approval time; store the medical
        // registration number now and reserve a temporary unique code.
        const tempCode = `PEND-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

        await db.query(
          `INSERT INTO doctors (id, doctor_code, specialization, qualifications, experience_years,
             hospital_name, hospital_address, languages, consultation_fee, fee_currency, status, requested_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'INR', 'PENDING', now())`,
          [
            doctorUserId,
            tempCode,
            data.specialization,
            data.qualifications ?? null,
            data.yearsExperience,
            data.hospitalName,
            data.hospitalAddress,
            data.languages ? data.languages.split(',').map((s) => s.trim()).filter(Boolean) : ['English'],
            data.consultationFee ?? null,
          ]
        );

        // store documents (private directory, never publicly served)
        await db.query(
          `INSERT INTO doctor_documents (doctor_id, doc_type, file_name, stored_name, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            doctorUserId,
            'MEDICAL_ID',
            idDoc.originalname,
            idDoc.filename,
            idDoc.mimetype,
            idDoc.size,
          ]
        );
        if (photo) {
          await db.query(
            `INSERT INTO doctor_documents (doctor_id, doc_type, file_name, stored_name, mime_type, size_bytes)
             VALUES ($1, 'PROFILE_PHOTO', $2, $3, $4, $5)`,
            [doctorUserId, photo.originalname, photo.filename, photo.mimetype, photo.size]
          );
        }

        // default availability from registration
        for (const day of data.availableDays) {
          const [sh, eh] = data.availableHours.split('-');
          await db.query(
            `INSERT INTO doctor_availability (doctor_id, weekday, start_time, end_time, slot_minutes)
             VALUES ($1, $2, $3, $4, 30)`,
            [doctorUserId, day, `${sh.padStart(2, '0')}:00`, `${(eh ?? '17').padStart(2, '0')}:00`]
          );
        }

        // notify admins
        const admins = await db.query(`SELECT id FROM users WHERE role = 'admin'`);
        for (const a of admins.rows) {
          await notify({
            userId: a.id,
            title: 'New doctor awaiting verification',
            body: `${data.fullName} (${data.specialization}) submitted registration documents.`,
            type: 'info',
            link: '/admin/verification',
          });
        }

        res.status(201).json({
          message:
            'Registration received. Your account is pending verification — you will be able to log in after an admin approves it.',
        });
      } catch (e) {
        next(e);
      }
    });
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────── DISCOVERY ───────────────────────────

const SPECIALTY_ALIASES: Record<string, string> = {
  ent: 'ENT',
  'general physician': 'General Physician',
  gp: 'General Physician',
  cardiologist: 'Cardiologist',
  dermatologist: 'Dermatologist',
  neurologist: 'Neurologist',
  orthopedic: 'Orthopedic',
  pediatrician: 'Pediatrician',
  gynecologist: 'Gynecologist',
  ophthalmologist: 'Ophthalmologist',
  psychiatrist: 'Psychiatrist',
  dentist: 'Dentist',
  pulmonologist: 'Pulmonologist',
  gastroenterologist: 'Gastroenterologist',
  urologist: 'Urologist',
  endocrinologist: 'Endocrinologist',
};

/**
 * GET /api/doctors
 * Public search of APPROVED doctors. Filters: specialty, city, hospital, rating,
 * availableThisWeek, date. Sorted by rating desc.
 */
router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const { specialty, city, hospital, minRating, availableThisWeek, date } = req.query as Record<string, string | undefined>;

    const params: unknown[] = [];
    const where = [`d.status = 'APPROVED'`];
    if (specialty) {
      params.push(specialty);
      where.push(`d.specialization ILIKE $${params.length}`);
    }
    if (city) {
      params.push(`%${city}%`);
      where.push(`(COALESCE(h.city, '') ILIKE $${params.length} OR COALESCE(d.hospital_address, '') ILIKE $${params.length})`);
    }
    if (hospital) {
      params.push(`%${hospital}%`);
      where.push(`(COALESCE(h.name, '') ILIKE $${params.length} OR COALESCE(d.hospital_name, '') ILIKE $${params.length})`);
    }
    if (minRating) {
      params.push(Number(minRating));
      where.push(`d.avg_rating >= $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT d.id, d.doctor_code, d.specialization, d.experience_years, d.hospital_name,
              d.hospital_address, d.languages, d.consultation_fee, d.fee_currency,
              d.avg_rating, d.reviews_count, d.photo_url, d.bio,
              u.full_name, h.city, h.name AS hospital_display_name, h.lat, h.lng
       FROM doctors d
       JOIN users u ON u.id = d.id
       LEFT JOIN hospitals h ON h.id = d.hospital_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.avg_rating DESC, d.reviews_count DESC, u.full_name ASC
       LIMIT 100`,
      params
    );

    let doctors = rows;
    if (availableThisWeek === 'true' || date) {
      const dates = date ? [date] : nextNDates(7);
      const filtered = [];
      for (const doc of doctors) {
        for (const ds of dates) {
          if (await doctorHasOpenSlotOn(doc.id, ds)) {
            filtered.push(doc);
            break;
          }
        }
      }
      doctors = filtered;
    }

    res.json({ doctors });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/doctors/nearby?lat=&lng=&city=
 * Distance-based ranking using stored coordinates (haversine).
 * Works without any maps API; the client can layer Google Maps on top if a key exists.
 */
router.get('/nearby', async (req, res, next) => {
  try {
    const db = await getDb();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const city = (req.query.city as string) ?? '';

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      // fall back to plain list ordered by rating
      const { rows } = await db.query(
        `SELECT d.id, d.doctor_code, d.specialization, d.experience_years, d.hospital_name,
                d.hospital_address, d.languages, d.consultation_fee, d.fee_currency,
                d.avg_rating, d.reviews_count, d.photo_url, u.full_name, h.city,
                h.lat, h.lng, NULL::float AS distance_km
         FROM doctors d JOIN users u ON u.id = d.id LEFT JOIN hospitals h ON h.id = d.hospital_id
         WHERE d.status = 'APPROVED'
         ORDER BY d.avg_rating DESC LIMIT 50`
      );
      res.json({ doctors: rows, mode: 'no-location' });
      return;
    }

    const { rows } = await db.query(
      `SELECT d.id, d.doctor_code, d.specialization, d.experience_years, d.hospital_name,
              d.hospital_address, d.languages, d.consultation_fee, d.fee_currency,
              d.avg_rating, d.reviews_count, d.photo_url, u.full_name, h.city,
              h.lat, h.lng, h.name AS hospital_display_name,
              (6371 * acos(
                 LEAST(1.0, cos(radians($1)) * cos(radians(COALESCE(h.lat, d.lat))) *
                 cos(radians(COALESCE(h.lng, d.lng)) - radians($2)) +
                 sin(radians($1)) * sin(radians(COALESCE(h.lat, d.lat))))
              )) AS distance_km
       FROM doctors d
       JOIN users u ON u.id = d.id
       LEFT JOIN hospitals h ON h.id = d.hospital_id
       WHERE d.status = 'APPROVED'
         AND (h.lat IS NOT NULL OR d.lat IS NOT NULL)
       ORDER BY distance_km ASC NULLS LAST
       LIMIT 50`,
      [lat, lng]
    );

    let doctors = rows;
    if (city) {
      const c = city.toLowerCase();
      doctors = doctors.filter(
        (r) => (r.city ?? '').toLowerCase().includes(c) || (r.hospital_address ?? '').toLowerCase().includes(c)
      );
    }
    res.json({ doctors, mode: 'coordinates' });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/doctors/:id/slots?date=YYYY-MM-DD
 * Weekly availability + generated slots for the next 7 days (or a given date).
 */
router.get('/:id/slots', async (req, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT d.id FROM doctors d WHERE d.id = $1 AND d.status = 'APPROVED'`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Doctor not found or not available for booking.' });
      return;
    }
    const weekly = await db.query(
      `SELECT weekday, start_time, end_time, slot_minutes, break_start, break_end, is_active
       FROM doctor_availability WHERE doctor_id = $1 ORDER BY weekday, start_time`,
      [req.params.id]
    );
    const dates = req.query.date ? [String(req.query.date)] : nextNDates(7);
    const days = [];
    for (const ds of dates) {
      days.push(await getDoctorSlotsForDate(req.params.id, ds));
    }
    res.json({ weekly: weekly.rows, days });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/doctors/:id — public profile (NO verification documents here).
 */
router.get('/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT d.id, d.doctor_code, d.specialization, d.qualifications, d.experience_years,
              d.hospital_name, d.hospital_address, d.languages, d.consultation_fee, d.fee_currency,
              d.bio, d.photo_url, d.avg_rating, d.reviews_count, u.full_name,
              h.name AS hospital_display_name, h.address AS hospital_full_address,
              h.city, h.lat, h.lng
       FROM doctors d JOIN users u ON u.id = d.id LEFT JOIN hospitals h ON h.id = d.hospital_id
       WHERE d.id = $1 AND d.status = 'APPROVED'`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Doctor not found.' });
      return;
    }
    const reviews = await db.query(
      `SELECT r.rating, r.comment, r.created_at, u.full_name AS patient_name
       FROM reviews r JOIN users u ON u.id = r.patient_id
       WHERE r.doctor_id = $1
       ORDER BY r.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ doctor: rows[0], reviews: reviews.rows });
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────── DOCTOR'S OWN SCHEDULE ───────────────────────────

/** Ensure the requesting doctor owns the :id resource. */
async function assertOwnDoctor(req: AuthedRequest, id: string): Promise<boolean> {
  return req.user?.role === 'doctor' && req.user.id === id;
}

/**
 * PUT /api/doctors/:id/availability — doctor replaces their weekly schedule.
 */
router.put('/:id/availability', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    if (!(await assertOwnDoctor(req, req.params.id))) {
      res.status(403).json({ error: 'You can only edit your own schedule.' });
      return;
    }
    const body = z
      .object({
        rows: z.array(
          z.object({
            weekday: z.number().int().min(0).max(6),
            enabled: z.boolean(),
            start: z.string().regex(/^\d{2}:\d{2}$/),
            end: z.string().regex(/^\d{2}:\d{2}$/),
            slotMinutes: z.coerce.number().int().min(5).max(240),
            breakStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
            breakEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          })
        ),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid schedule data.' });
      return;
    }
    const db = await getDb();
    await db.query(`DELETE FROM doctor_availability WHERE doctor_id = $1`, [req.params.id]);
    for (const r of body.data.rows) {
      if (!r.enabled) continue;
      if (r.start >= r.end) continue; // skip invalid ranges
      await db.query(
        `INSERT INTO doctor_availability (doctor_id, weekday, start_time, end_time, slot_minutes, break_start, break_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.params.id, r.weekday, r.start, r.end, r.slotMinutes, r.breakStart ?? null, r.breakEnd ?? null]
      );
    }
    res.json({ message: 'Schedule updated' });
  } catch (e) {
    next(e);
  }
});

/** GET /api/doctors/:id/unavailable — doctor's own leave dates. */
router.get('/:id/unavailable', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    if (!(await assertOwnDoctor(req, req.params.id))) {
      res.status(403).json({ error: 'Not your schedule.' });
      return;
    }
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT date, reason FROM doctor_unavailable_dates WHERE doctor_id = $1 ORDER BY date`,
      [req.params.id]
    );
    res.json({ unavailable: rows });
  } catch (e) {
    next(e);
  }
});

/** POST /api/doctors/:id/unavailable — add a leave date. */
router.post('/:id/unavailable', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    if (!(await assertOwnDoctor(req, req.params.id))) {
      res.status(403).json({ error: 'Not your schedule.' });
      return;
    }
    const body = z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().max(200).optional() })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid date.' });
      return;
    }
    const db = await getDb();
    await db.query(
      `INSERT INTO doctor_unavailable_dates (doctor_id, date, reason) VALUES ($1, $2, $3)
       ON CONFLICT (doctor_id, date) DO UPDATE SET reason = EXCLUDED.reason`,
      [req.params.id, body.data.date, body.data.reason ?? null]
    );
    res.json({ message: 'Leave date saved' });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/doctors/:id/unavailable/:date — remove a leave date. */
router.delete('/:id/unavailable/:date', requireAuth(['doctor']), async (req: AuthedRequest, res, next) => {
  try {
    if (!(await assertOwnDoctor(req, req.params.id))) {
      res.status(403).json({ error: 'Not your schedule.' });
      return;
    }
    const db = await getDb();
    await db.query(`DELETE FROM doctor_unavailable_dates WHERE doctor_id = $1 AND date = $2`, [
      req.params.id,
      req.params.date,
    ]);
    res.json({ message: 'Leave date removed' });
  } catch (e) {
    next(e);
  }
});

export default router;
