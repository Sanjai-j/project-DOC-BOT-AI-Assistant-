import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  generateOtp,
  hashPassword,
  isValidEmail,
  isStrongEnoughPassword,
  normalizePhone,
  otpExpiryDate,
  signToken,
  verifyPassword,
  verifyToken,
} from '../utils/auth.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { authLimiter } from '../middleware/common.js';
import { notify } from '../services/notifications.js';
import { config } from '../config.js';

const router = Router();

/**
 * OTP delivery: in production plug an email/SMS provider here.
 * In development the OTP is printed to the server console AND returned
 * in the API response (devOtp) so the demo flow works with zero external services.
 */
function deliverOtp(identifier: string, code: string): void {
  console.log(`[otp] ${identifier} -> ${code} (valid ${config.otpExpiryMinutes} min)`);
}

function isProduction(): boolean {
  return config.env === 'production';
}

async function createAndStoreOtp(identifier: string, purpose: 'LOGIN' | 'REGISTER'): Promise<string> {
  const db = await getDb();
  const code = generateOtp();
  await db.query(`UPDATE otps SET consumed = true WHERE identifier = $1 AND consumed = false`, [identifier]);
  await db.query(`INSERT INTO otps (identifier, code, purpose, expires_at) VALUES ($1, $2, $3, $4)`, [
    identifier,
    code,
    purpose,
    otpExpiryDate(),
  ]);
  deliverOtp(identifier, code);
  return code;
}

async function consumeOtp(identifier: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT id, expires_at, consumed FROM otps
     WHERE identifier = $1 AND code = $2 AND consumed = false
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, code.trim()]
  );
  if (rows.length === 0) return { ok: false, error: 'Invalid OTP code. Please check and try again.' };
  const otp = rows[0];
  if (new Date(String(otp.expires_at)).getTime() < Date.now()) {
    return { ok: false, error: 'This OTP has expired. Please request a new one.' };
  }
  await db.query(`UPDATE otps SET consumed = true WHERE id = $1`, [otp.id]);
  return { ok: true };
}

// ─────────────────────────── PATIENT ───────────────────────────

const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  phone: z.string().min(6).max(20),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  location: z.string().max(200).optional(),
  password: z.string().min(8).max(128).optional(),
});

/**
 * POST /api/auth/patient/register
 * Creates the patient account (unverified) and sends an OTP to email/phone.
 */
router.post('/patient/register', authLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please fill all required fields correctly.' });
      return;
    }
    const { fullName, email, phone, dateOfBirth, gender, location, password } = parsed.data;
    if (password && !isStrongEnoughPassword(password)) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    const normPhone = normalizePhone(phone);
    const db = await getDb();

    const existing = await db.query(`SELECT id FROM users WHERE email = $1 OR phone = $2`, [email, normPhone]);
    if (existing.rowCount && existing.rowCount > 0) {
      res.status(409).json({ error: 'An account with this email or phone already exists. Please log in.' });
      return;
    }

    const passwordHash = password ? await hashPassword(password) : null;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (role, full_name, email, phone, password_hash) VALUES ('patient', $1, $2, $3, $4) RETURNING id`,
      [fullName, email, normPhone, passwordHash]
    );
    await db.query(`INSERT INTO patients (id, date_of_birth, gender, location) VALUES ($1, $2, $3, $4)`, [
      rows[0].id,
      dateOfBirth ?? null,
      gender ?? null,
      location ?? null,
    ]);
    const code = await createAndStoreOtp(email, 'REGISTER');
    await notify({ userId: rows[0].id, title: 'Welcome to DocBot TeleMed', body: 'Your account was created. Verify your contact to get started.', type: 'success' });
    res.status(201).json({
      message: 'Account created. We sent a verification code.',
      sentTo: email,
      ...(isProduction() ? {} : { devOtp: code }),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/auth/patient/send-otp
 * Login via OTP: identifier may be email OR phone.
 */
router.post('/patient/send-otp', authLimiter, async (req, res, next) => {
  try {
    const body = z.object({ identifier: z.string().min(5).max(120) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Enter your email or phone number.' });
      return;
    }
    const raw = body.data.identifier.trim();
    const isEmail = isValidEmail(raw);
    const identifier = isEmail ? raw.toLowerCase() : normalizePhone(raw);
    const db = await getDb();

    const { rows } = await db.query(
      `SELECT u.id FROM users u JOIN patients p ON p.id = u.id
       WHERE u.role = 'patient' AND (${isEmail ? 'u.email = $1' : 'u.phone = $1'})`,
      [identifier]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'No account found for that email/phone. Please register first.' });
      return;
    }
    const code = await createAndStoreOtp(identifier, 'LOGIN');
    res.json({
      message: `We sent a code to ${identifier}`,
      ...(isProduction() ? {} : { devOtp: code }),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/auth/patient/verify-otp
 * Verifies OTP for register or login and returns a JWT.
 */
router.post('/patient/verify-otp', authLimiter, async (req, res, next) => {
  try {
    const body = z
      .object({ identifier: z.string().min(5), code: z.string().min(4).max(8) })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Enter the code we sent you.' });
      return;
    }
    const raw = body.data.identifier.trim();
    const isEmail = isValidEmail(raw);
    const identifier = isEmail ? raw.toLowerCase() : normalizePhone(raw);
    const check = await consumeOtp(identifier, body.data.code);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.status FROM users u JOIN patients p ON p.id = u.id
       WHERE u.role = 'patient' AND (${isEmail ? 'u.email = $1' : 'u.phone = $1'})`,
      [identifier]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    const user = rows[0];
    if (user.status === 'SUSPENDED') {
      res.status(403).json({ error: 'This account has been suspended. Contact support.' });
      return;
    }
    const token = signToken({ sub: user.id, role: 'patient', name: user.full_name });
    res.json({ token, user: { id: user.id, role: 'patient', name: user.full_name } });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/auth/patient/login (optional password path)
 */
router.post('/patient/login', authLimiter, async (req, res, next) => {
  try {
    const body = z.object({ identifier: z.string().min(5), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Enter your email/phone and password.' });
      return;
    }
    const raw = body.data.identifier.trim();
    const isEmail = isValidEmail(raw);
    const identifier = isEmail ? raw.toLowerCase() : normalizePhone(raw);
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.password_hash, u.status FROM users u JOIN patients p ON p.id = u.id
       WHERE u.role = 'patient' AND (${isEmail ? 'u.email = $1' : 'u.phone = $1'})`,
      [identifier]
    );
    if (rows.length === 0 || !(await verifyPassword(body.data.password, rows[0].password_hash))) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    if (rows[0].status === 'SUSPENDED') {
      res.status(403).json({ error: 'This account has been suspended. Contact support.' });
      return;
    }
    const token = signToken({ sub: rows[0].id, role: 'patient', name: rows[0].full_name });
    res.json({ token, user: { id: rows[0].id, role: 'patient', name: rows[0].full_name } });
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────── DOCTOR ───────────────────────────

/**
 * POST /api/auth/doctor/login
 * Requires the doctor's full name + unique Doctor ID (e.g. DOC1001) + password.
 * Only APPROVED doctors may log in. The Doctor ID is assigned by the admin at
 * approval time, is unique, and is never displayed publicly as a shortcut.
 */
router.post('/doctor/login', authLimiter, async (req, res, next) => {
  try {
    const body = z
      .object({ fullName: z.string().min(2).max(120), doctorCode: z.string().min(3), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Enter your full name, Doctor ID and password.' });
      return;
    }
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.password_hash, u.status AS user_status, d.status AS doctor_status, d.doctor_code
       FROM doctors d JOIN users u ON u.id = d.id
       WHERE UPPER(d.doctor_code) = UPPER($1)`,
      [body.data.doctorCode.trim()]
    );
    if (
      rows.length === 0 ||
      rows[0].full_name.trim().toLowerCase() !== body.data.fullName.trim().toLowerCase() ||
      !(await verifyPassword(body.data.password, rows[0].password_hash))
    ) {
      res.status(401).json({ error: 'Invalid name, Doctor ID or password.' });
      return;
    }
    const doc = rows[0];
    if (doc.user_status === 'SUSPENDED') {
      res.status(403).json({ error: 'This account has been suspended. Contact support.' });
      return;
    }
    if (doc.doctor_status === 'PENDING') {
      res.status(403).json({
        error: 'First-time login is enabled only after an administrator approves your registration. Use "Check verification status" below to track it.',
      });
      return;
    }
    if (doc.doctor_status === 'INFO_REQUESTED') {
      res.status(403).json({ error: 'The admin requested additional information for your verification. Please update your registration.' });
      return;
    }
    if (doc.doctor_status === 'REJECTED') {
      res.status(403).json({ error: 'Your registration was not approved. Contact support for details.' });
      return;
    }
    if (doc.doctor_status !== 'APPROVED') {
      res.status(403).json({ error: 'Your account is not active. Contact support.' });
      return;
    }
    const token = signToken({
      sub: doc.id,
      role: 'doctor',
      name: doc.full_name,
      doctorCode: doc.doctor_code,
    });
    res.json({ token, user: { id: doc.id, role: 'doctor', name: doc.full_name, doctorCode: doc.doctor_code } });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/auth/doctor/status
 * For a doctor who has not logged in before: given the email they registered
 * with and their password, reports the verification decision made by the admin.
 * Once approved, the assigned unique Doctor ID is returned so the doctor can
 * log in with name + ID + password. Password-checked so nothing leaks publicly.
 */
router.post('/doctor/status', authLimiter, async (req, res, next) => {
  try {
    const body = z
      .object({ email: z.string().min(5), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Enter the email you registered with and your password.' });
      return;
    }
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.password_hash, u.status AS user_status,
              d.status AS doctor_status, d.doctor_code, d.specialization, d.requested_at, d.info_note
       FROM doctors d JOIN users u ON u.id = d.id
       WHERE u.role = 'doctor' AND u.email = $1`,
      [body.data.email.trim().toLowerCase()]
    );
    if (rows.length === 0 || !(await verifyPassword(body.data.password, rows[0].password_hash))) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const doc = rows[0];
    if (doc.user_status === 'SUSPENDED' || doc.doctor_status === 'SUSPENDED') {
      res.json({ status: 'SUSPENDED', message: 'This account has been suspended. Contact support.' });
      return;
    }
    if (doc.doctor_status === 'APPROVED') {
      res.json({
        status: 'APPROVED',
        doctorCode: doc.doctor_code,
        fullName: doc.full_name,
        specialization: doc.specialization,
        message: `Your registration was approved. Your unique Doctor ID is ${doc.doctor_code}.`,
      });
      return;
    }
    if (doc.doctor_status === 'INFO_REQUESTED') {
      res.json({
        status: 'INFO_REQUESTED',
        message: doc.info_note || 'The administrator requested additional information for your verification.',
      });
      return;
    }
    if (doc.doctor_status === 'REJECTED') {
      res.json({ status: 'REJECTED', message: doc.info_note || 'Your registration was not approved.' });
      return;
    }
    res.json({
      status: 'PENDING',
      requestedAt: doc.requested_at,
      message: 'Your registration documents are with the administrator for verification. First-time login is enabled only after approval — check back here, or watch for the notification.',
    });
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────── ADMIN ───────────────────────────

/**
 * POST /api/auth/admin/login — separate, secure route (/admin/login in the UI).
 */
router.post('/admin/login', authLimiter, async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().min(3), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Enter admin email and password.' });
      return;
    }
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT id, full_name, email, password_hash, status FROM users WHERE role = 'admin' AND email = $1`,
      [body.data.email.trim().toLowerCase()]
    );
    if (rows.length === 0 || !(await verifyPassword(body.data.password, rows[0].password_hash))) {
      res.status(401).json({ error: 'Invalid admin credentials.' });
      return;
    }
    if (rows[0].status === 'SUSPENDED') {
      res.status(403).json({ error: 'This admin account is suspended.' });
      return;
    }
    const token = signToken({ sub: rows[0].id, role: 'admin', name: rows[0].full_name });
    res.json({ token, user: { id: rows[0].id, role: 'admin', name: rows[0].full_name } });
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────── ME ───────────────────────────

/**
 * GET /api/auth/me — current profile for the logged-in user.
 */
router.get('/me', requireAuth(), async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT u.id, u.role, u.full_name, u.email, u.phone, u.status,
              p.date_of_birth, p.gender, p.location,
              d.doctor_code, d.specialization, d.status AS doctor_status, d.photo_url,
              d.experience_years, d.hospital_name, d.qualifications, d.languages,
              d.consultation_fee, d.fee_currency, d.bio
       FROM users u
       LEFT JOIN patients p ON p.id = u.id
       LEFT JOIN doctors d ON d.id = u.id
       WHERE u.id = $1`,
      [req.user!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    res.json({ user: rows[0] });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/auth/me — patients update their profile.
 */
router.patch('/me', requireAuth(['patient']), async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        fullName: z.string().min(2).max(120).optional(),
        location: z.string().max(200).optional(),
        gender: z.enum(['male', 'female', 'other']).optional(),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid profile data.' });
      return;
    }
    const db = await getDb();
    const { fullName, location, gender, dateOfBirth } = body.data;
    if (fullName) await db.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName, req.user!.id]);
    await db.query(
      `UPDATE patients SET
         location = COALESCE($1, location),
         gender = COALESCE($2, gender),
         date_of_birth = COALESCE($3, date_of_birth)
       WHERE id = $4`,
      [location ?? null, gender ?? null, dateOfBirth ?? null, req.user!.id]
    );
    res.json({ message: 'Profile updated' });
  } catch (e) {
    next(e);
  }
});

export default router;
