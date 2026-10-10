/**
 * Seed demo data: hospitals, demo accounts, sample appointments and a pending
 * doctor for the admin verification queue.
 *
 * The doctor directory itself is imported separately from the India doctor
 * dataset via `npm run doctors:import --workspace server` (DOC200001+).
 * This seed no longer fabricates approved doctors; demo appointments attach
 * to the first imported directory doctors when present.
 * All data is fictional.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStandaloneDb } from '../db/index.js';
import { config } from '../config.js';
import { hashPassword } from '../utils/auth.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');

const HOSPITALS = [
  { name: 'Sunrise Multispeciality Hospital', address: '12 MG Road, Indiranagar', city: 'Bengaluru', lat: 12.9719, lng: 77.6412, specialties: ['Cardiologist', 'Orthopedic', 'General Physician', 'Dermatologist'], emergency: true, rating: 4.6, reviews: 512, source: 'APP' as const, phone: '+91 80 4000 1001' },
  { name: 'CarePoint City Clinic', address: '45 Brigade Road', city: 'Bengaluru', lat: 12.9738, lng: 77.6, specialties: ['ENT', 'Pediatrician', 'General Physician', 'Dentist'], emergency: false, rating: 4.3, reviews: 208, source: 'APP' as const, phone: '+91 80 4000 1002' },
  { name: 'GreenPark Medical Center', address: '9 Park Street', city: 'Kolkata', lat: 22.5726, lng: 88.3639, specialties: ['Neurologist', 'Psychiatrist', 'General Physician'], emergency: true, rating: 4.5, reviews: 341, source: 'GOOGLE' as const, phone: '+91 33 4000 1003' },
  { name: 'Lakeview Hospital', address: '2 Marine Drive', city: 'Mumbai', lat: 18.944, lng: 72.8235, specialties: ['Gynecologist', 'Pediatrician', 'Ophthalmologist', 'ENT'], emergency: true, rating: 4.4, reviews: 489, source: 'APP' as const, phone: '+91 22 4000 1004' },
  { name: 'NovaCare Specialty Clinic', address: '7 Hitech City Road', city: 'Hyderabad', lat: 17.9689, lng: 79.5941, specialties: ['Gastroenterologist', 'Urologist', 'Endocrinologist', 'Pulmonologist'], emergency: false, rating: 4.2, reviews: 154, source: 'APP' as const, phone: '+91 40 4000 1005' },
];

async function seed(): Promise<void> {
  const db = await createStandaloneDb();
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await db.query(sql);

  // Clear stale demo/test noise so a re-seed produces a clean, professional state.
  // NOTE: imported directory doctors (email directory.doc.*@docbot.dev) are NOT
  // touched here — they are managed exclusively by doctors:import.
  await db.query(`DELETE FROM emergency_requests`);
  await db.query(`DELETE FROM chat_messages`);
  await db.query(`DELETE FROM chat_sessions`);
  await db.query(`DELETE FROM notifications`);
  await db.query(`DELETE FROM otps`);
  await db.query(
    `DELETE FROM appointments WHERE doctor_id IN
       (SELECT d.id FROM doctors d JOIN users u ON u.id = d.id WHERE u.email LIKE 'e2e.doctor.%@docbot.dev')`
  );
  await db.query(
    `DELETE FROM doctors WHERE id IN (SELECT id FROM users WHERE email LIKE 'e2e.doctor.%@docbot.dev')`
  );
  await db.query(`DELETE FROM users WHERE email LIKE 'e2e.doctor.%@docbot.dev'`);

  console.log('[seed] creating demo data...');

  // ── admin ──
  const adminHash = await hashPassword(config.adminPassword);
  await db.query(
    `INSERT INTO users (role, full_name, email, password_hash)
     VALUES ('admin', 'TeleMed Admin', $1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [config.adminEmail, adminHash]
  );

  // ── demo patient ──
  const patientHash = await hashPassword('patient123');
  const patientRes = await db.query<{ id: string }>(
    `INSERT INTO users (role, full_name, email, phone, password_hash)
     VALUES ('patient', 'Ravi Demo', 'patient@docbot.dev', '+919900000001', $1)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [patientHash]
  );
  let patientId: string;
  if (patientRes.rows.length > 0) {
    patientId = patientRes.rows[0].id;
  } else {
    const existing = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'patient@docbot.dev'`);
    patientId = existing.rows[0].id;
  }
  await db.query(
    `INSERT INTO patients (id, date_of_birth, gender, location)
     VALUES ($1, '1992-04-12', 'male', 'Bengaluru')
     ON CONFLICT (id) DO NOTHING`,
    [patientId]
  );

  // ── second demo patient ──
  const p2Res = await db.query<{ id: string }>(
    `INSERT INTO users (role, full_name, email, phone, password_hash)
     VALUES ('patient', 'Sara Demo', 'sara@docbot.dev', '+919900000002', $1)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [patientHash]
  );
  let saraId: string;
  if (p2Res.rows.length > 0) {
    saraId = p2Res.rows[0].id;
    await db.query(`INSERT INTO patients (id, date_of_birth, gender, location) VALUES ($1, '1988-11-02', 'female', 'Mumbai') ON CONFLICT (id) DO NOTHING`, [saraId]);
  } else {
    const e2 = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'sara@docbot.dev'`);
    saraId = e2.rows[0].id;
  }

  // ── hospitals ──
  // The hospitals table has no unique name constraint, so drop duplicates from
  // previous seed runs first (keep the oldest row per name).
  await db.query(
    `DELETE FROM hospitals h USING hospitals keeper
     WHERE h.name = keeper.name AND h.created_at > keeper.created_at`
  );
  for (const h of HOSPITALS) {
    await db.query(
      `INSERT INTO hospitals (name, address, city, phone, lat, lng, specialties, emergency_24x7, rating, reviews_count, rating_source)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
       WHERE NOT EXISTS (SELECT 1 FROM hospitals WHERE name = $1)`,
      [h.name, h.address, h.city, h.phone, h.lat, h.lng, h.specialties, h.emergency, h.rating, h.reviews, h.source]
    );
  }

  // ── demo appointments (attach to imported directory doctors when present) ──
  const dirDocs = await db.query<{ id: string; doctor_code: string }>(
    `SELECT id, doctor_code FROM doctors WHERE doctor_code IN ('DOC200001','DOC200002') ORDER BY doctor_code`
  );
  const doc1 = dirDocs.rows.find((r) => r.doctor_code === 'DOC200001')?.id;
  const doc2 = dirDocs.rows.find((r) => r.doctor_code === 'DOC200002')?.id;

  if (doc1 && doc2) {
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // completed in-person yesterday with a review
    const done = await db.query<{ id: string }>(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, consultation_type, reason, status)
       SELECT $1, $2, $3, '10:00', '10:30', 'IN_PERSON', 'Persistent cough', 'COMPLETED'
       WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE patient_id = $1 AND doctor_id = $2 AND date = $3 AND start_time = '10:00')
       RETURNING id`,
      [patientId, doc1, fmt(yesterday)]
    );
    if (done.rows.length > 0) {
      await db.query(
        `INSERT INTO reviews (appointment_id, patient_id, doctor_id, rating, comment)
         VALUES ($1, $2, $3, 5, 'Excellent, patient and explained everything clearly.')
         ON CONFLICT DO NOTHING`,
        [done.rows[0].id, patientId, doc1]
      );
    }

    // pending request today for the second doctor
    await db.query(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, consultation_type, reason, status)
       SELECT $1, $2, $3, '09:30', '10:00', 'IN_PERSON', 'Chest discomfort while climbing stairs', 'PENDING'
       WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE patient_id = $1 AND doctor_id = $2 AND date = $3)
       RETURNING id`,
      [saraId, doc2, fmt(new Date())]
    );

    // confirmed video consultation tomorrow with the first doctor
    const vid = await db.query<{ id: string }>(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, consultation_type, reason, status)
       SELECT $1, $2, $3, '10:30', '11:00', 'VIDEO', 'Follow-up on treatment guidance', 'CONFIRMED'
       WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE patient_id = $1 AND doctor_id = $2 AND date = $3 AND consultation_type = 'VIDEO')
       RETURNING id`,
      [patientId, doc1, fmt(tomorrow)]
    );
    if (vid.rows.length > 0) {
      await db.query(
        `INSERT INTO video_consultations (appointment_id, status, room_id) VALUES ($1, 'CONFIRMED', $2)
         ON CONFLICT DO NOTHING`,
        [vid.rows[0].id, crypto.randomUUID()]
      );
    }
  } else {
    console.log('[seed] directory doctors not found — run `npm run doctors:import --workspace server` to add the doctor dataset (demo appointments skipped).');
  }

  // ── one PENDING doctor for the admin verification queue ──
  const pendHash = await hashPassword('doctor123');
  const pendRes = await db.query<{ id: string }>(
    `INSERT INTO users (role, full_name, email, phone, password_hash)
     VALUES ('doctor', 'Test Pending', 'pending.doctor@docbot.dev', '+919810000099', $1)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [pendHash]
  );
  let pendId: string;
  if (pendRes.rows.length > 0) pendId = pendRes.rows[0].id;
  else {
    const e = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'pending.doctor@docbot.dev'`);
    pendId = e.rows[0].id;
  }
  await db.query(
    `INSERT INTO doctors (id, doctor_code, specialization, qualifications, experience_years,
       hospital_name, hospital_address, languages, status)
     VALUES ($1, $2, 'Dentist', 'BDS, MDS', 6, 'CarePoint City Clinic', '45 Brigade Road, Bengaluru', $3, 'PENDING')
     ON CONFLICT (id) DO NOTHING`,
    [pendId, `PEND-DEMO-${crypto.randomBytes(2).toString('hex').toUpperCase()}`, ['English']]
  );
  // No placeholder document is fabricated. A real doctor registration upload
  // (through /doctor/register) provides the document for verification review.

  const docCount = await db.query<{ c: string }>(`SELECT count(*) AS c FROM doctors WHERE status = 'APPROVED'`);
  console.log(`[seed] done. Approved doctors in directory: ${docCount.rows[0].c}`);
  console.log('[seed] Demo accounts:');
  console.log('  Patient: patient@docbot.dev / OTP login (code shown in server console) or password patient123');
  console.log('  Doctor:  full name (e.g. "Demo Doctor 0001") + DOC200001 + password doctor123  [directory import]');
  console.log('  Admin:   ' + config.adminEmail + ' / ' + config.adminPassword);
  await db.close();
}

seed().catch((e) => {
  console.error('[seed] FAILED:', e);
  process.exit(1);
});
