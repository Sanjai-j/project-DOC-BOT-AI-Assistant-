/**
 * Import the India doctor directory dataset
 * (doc_bot_india_doctor_directory_synthetic.csv) into the doctors/users/
 * hospitals/doctor_availability tables, REPLACING the previous sample doctor
 * set (DOC1001–DOC1010 and any earlier directory import).
 *
 * What this script does:
 *  1. Deletes previously imported directory doctors (email domain marker) and
 *     the old 10-doctor sample set, including their appointments/availability.
 *  2. Creates one hospital row per (hospital, city) with city coordinates.
 *  3. Inserts every CSV doctor as an APPROVED doctor with:
 *       - deterministic Doctor ID  DOC200001..DOC2NNNNN
 *       - shared demo password     doctor123
 *       - specialty mapped onto the app's bookable specialty names
 *       - Mon–Sat availability (09:00–13:00 + 17:00–20:00, 30-min slots)
 *       - deterministic synthetic rating/review counts (the CSV has none)
 *
 * Idempotent: safe to re-run; it always rebuilds from the CSV.
 *
 * Run:  npm run doctors:import --workspace server -- [path/to/csv]
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createStandaloneDb, type DB } from '../db/index.js';
import { hashPassword } from '../utils/auth.js';
import { resolveDataset } from './dataset-path.js';

const DEFAULT_CSV = resolveDataset('doc_bot_india_doctor_directory_synthetic.csv');

const csvPath = process.argv[2] ?? DEFAULT_CSV;
const EMAIL_DOMAIN = '@docbot.dev';
const EMAIL_PREFIX = 'directory.doc.';
const CODE_BASE = 200000; // DOC200001 onwards — never collides with seed DOC1001-1010

// ---------------------------------------------------------------------------
// City coordinates (dataset has none; needed for /doctors/nearby + map view)
// ---------------------------------------------------------------------------
const CITY_COORDS: Record<string, [number, number]> = {
  Mumbai: [19.076, 72.8777], Pune: [18.5204, 73.8567], Nagpur: [21.1458, 79.0882],
  Nashik: [19.9975, 73.7898], Thane: [19.2183, 72.9781], Delhi: [28.7041, 77.1025],
  'New Delhi': [28.6139, 77.209], Gurugram: [28.4595, 77.0266], Faridabad: [28.4089, 77.3178],
  Noida: [28.5355, 77.391], Ghaziabad: [28.6692, 77.4538], Lucknow: [26.8467, 80.9462],
  Kanpur: [26.4499, 80.3319], Agra: [27.1767, 78.0081], Varanasi: [25.3176, 82.9739],
  Prayagraj: [25.4358, 81.8463], Jaipur: [26.9124, 75.7873], Jodhpur: [26.2389, 73.0243],
  Ahmedabad: [23.0225, 72.5714], Surat: [21.1702, 72.8311], Vadodara: [22.3072, 73.1812],
  Bengaluru: [12.9716, 77.5946], Mysuru: [12.2958, 76.6394], Mangaluru: [12.9148, 74.856],
  Chennai: [13.0827, 80.2707], Coimbatore: [11.0168, 76.9558], Madurai: [9.9252, 78.1198],
  Tiruchirappalli: [10.7905, 78.7047], Salem: [11.6643, 78.1462], Vellore: [12.9165, 79.1325],
  Hyderabad: [17.385, 78.4867], Warangal: [17.9689, 79.5941], Visakhapatnam: [17.6868, 83.2185],
  Vijayawada: [16.5062, 80.648], Tirupati: [13.6288, 79.4192], Kochi: [9.9312, 76.2673],
  Thiruvananthapuram: [8.5241, 76.9366], Kozhikode: [11.2588, 75.7804], Thrissur: [10.5276, 76.2144],
  Kolkata: [22.5726, 88.3639], Siliguri: [26.7271, 88.3953], Patna: [25.5941, 85.1376],
  Gaya: [24.7914, 85.0002], Ranchi: [23.3441, 85.3096], Jamshedpur: [22.8046, 86.2029],
  Bhopal: [23.2599, 77.4126], Indore: [22.7196, 75.8577], Jabalpur: [23.1815, 79.9864],
  Raipur: [21.2514, 81.6296], Bhubaneswar: [20.2961, 85.8245], Cuttack: [20.4625, 85.8828],
  Guwahati: [26.1445, 91.7362], Chandigarh: [30.7333, 76.7794], Amritsar: [31.634, 74.8723],
  Ludhiana: [30.901, 75.8573], Dehradun: [30.3165, 78.0322], Shimla: [31.1048, 77.1734],
  Srinagar: [34.0837, 74.7973], Jammu: [32.4265, 75.4412], Panaji: [15.4909, 73.8278],
  Puducherry: [11.9416, 79.8083], Gangtok: [27.533, 88.5122], Shillong: [25.5788, 91.8933],
  Imphal: [24.817, 93.9368], Aizawl: [23.7271, 92.7176], Agartala: [23.8315, 91.2868],
  Kohima: [25.6751, 94.111], Itanagar: [27.0844, 93.6053], 'Port Blair': [11.6234, 92.7265],
};

/**
 * CSV specialty category -> the app's specialty display name. Categories that
 * have no bookable counterpart keep a person-form of the category name so they
 * still appear under "All specialties" in Find Doctors.
 */
const CATEGORY_TO_SPECIALTY: Record<string, string> = {
  'General Medicine': 'General Physician',
  'Family Medicine': 'General Physician',
  Pediatrics: 'Pediatrician',
  Gynecology: 'Gynecologist',
  'General Surgery': 'General Physician',
  Orthopedics: 'Orthopedic',
  Dermatology: 'Dermatologist',
  Psychiatry: 'Psychiatrist',
  Ophthalmology: 'Ophthalmologist',
  ENT: 'ENT',
  Cardiology: 'Cardiologist',
  Neurology: 'Neurologist',
  Nephrology: 'Nephrologist',
  Urology: 'Urologist',
  Endocrinology: 'Endocrinologist',
  Gastroenterology: 'Gastroenterologist',
  Pulmonology: 'Pulmonologist',
  Rheumatology: 'Orthopedic',
  Oncology: 'Oncologist',
  Hematology: 'Hematologist',
  Neonatology: 'Pediatrician',
  'Emergency Medicine': 'Emergency Physician',
  Anesthesiology: 'Anesthesiologist',
  Radiology: 'Radiologist',
  Pathology: 'Pathologist',
  Rehabilitation: 'Physiotherapist',
  'Plastic Surgery': 'Plastic Surgeon',
  Neurosurgery: 'Neurosurgeon',
  'Pediatric Surgery': 'Pediatric Surgeon',
  'Cardiothoracic Surgery': 'Cardiothoracic Surgeon',
};

/** Minimal RFC-4180 CSV line parser (handles quoted commas + escaped quotes). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else {
      if (c === '"') quoted = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Deterministic PRNG from a string seed (stable ratings across re-imports). */
function seededRand(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

async function bulkInsert(db: DB, table: string, cols: string[], rows: unknown[][]): Promise<void> {
  const CHUNK = 300;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk
      .map((_, ri) => `(${cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(',')})`)
      .join(',');
    await db.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      chunk.flat()
    );
  }
}

interface CsvDoctor {
  doctorId: string; name: string; category: string; city: string; state: string;
  languages: string[]; experience: number; fee: number; hospital: string;
}

async function main(): Promise<void> {
  const raw = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(raw[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const doctors: CsvDoctor[] = raw.slice(1).map((line) => {
    const r = parseCsvLine(line);
    return {
      doctorId: r[idx.doctor_id],
      name: r[idx.doctor_name].trim(),
      category: (r[idx.doc_bot_specialty_category] || r[idx.specialty]).trim(),
      city: r[idx.city].trim(),
      state: r[idx.state_ut].trim(),
      languages: r[idx.languages].split(',').map((s) => s.trim()).filter(Boolean),
      experience: Number(r[idx.experience_years]) || 0,
      fee: Number(r[idx.consultation_fee_inr_demo]) || 0,
      hospital: r[idx.hospital_or_clinic].trim(),
    };
  });
  console.log(`[doctors-import] parsed ${doctors.length} doctors from ${csvPath}`);

  const db = await createStandaloneDb();

  // ---- 1. wipe previous directory import + old sample doctor set ----------
  console.log('[doctors-import] removing previous sample/directory doctors...');
  const patterns = [`${EMAIL_PREFIX}%${EMAIL_DOMAIN}`]; // directory doctors
  for (const pattern of patterns) {
    await db.query(
      `DELETE FROM appointments WHERE doctor_id IN
         (SELECT d.id FROM doctors d JOIN users u ON u.id = d.id WHERE u.email LIKE $1)`,
      [pattern]
    );
    await db.query(
      `DELETE FROM reviews WHERE doctor_id IN
         (SELECT d.id FROM doctors d JOIN users u ON u.id = d.id WHERE u.email LIKE $1)`,
      [pattern]
    );
    await db.query(
      `DELETE FROM doctor_documents WHERE doctor_id IN
         (SELECT d.id FROM doctors d JOIN users u ON u.id = d.id WHERE u.email LIKE $1)`,
      [pattern]
    );
    await db.query(
      `DELETE FROM doctor_availability WHERE doctor_id IN
         (SELECT d.id FROM doctors d JOIN users u ON u.id = d.id WHERE u.email LIKE $1)`,
      [pattern]
    );
    await db.query(
      `DELETE FROM doctor_unavailable_dates WHERE doctor_id IN
         (SELECT d.id FROM doctors d JOIN users u ON u.id = d.id WHERE u.email LIKE $1)`,
      [pattern]
    );
    await db.query(
      `DELETE FROM doctors WHERE id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [pattern]
    );
    await db.query(`DELETE FROM users WHERE email LIKE $1`, [pattern]);
  }
  // legacy sample doctors DOC1001–DOC1010
  await db.query(
    `DELETE FROM appointments WHERE doctor_id IN (SELECT id FROM doctors WHERE doctor_code ~ '^DOC10(0[1-9]|10)$')`
  );
  await db.query(
    `DELETE FROM reviews WHERE doctor_id IN (SELECT id FROM doctors WHERE doctor_code ~ '^DOC10(0[1-9]|10)$')`
  );
  await db.query(
    `DELETE FROM doctor_documents WHERE doctor_id IN (SELECT id FROM doctors WHERE doctor_code ~ '^DOC10(0[1-9]|10)$')`
  );
  await db.query(
    `DELETE FROM doctor_availability WHERE doctor_id IN (SELECT id FROM doctors WHERE doctor_code ~ '^DOC10(0[1-9]|10)$')`
  );
  await db.query(
    `DELETE FROM doctor_unavailable_dates WHERE doctor_id IN (SELECT id FROM doctors WHERE doctor_code ~ '^DOC10(0[1-9]|10)$')`
  );
  await db.query(`DELETE FROM doctors WHERE doctor_code ~ '^DOC10(0[1-9]|10)$'`);
  await db.query(
    `DELETE FROM users WHERE id IN (SELECT id FROM doctors WHERE doctor_code ~ '^DOC10(0[1-9]|10)$')`
  );
  await db.query(`DELETE FROM users WHERE role = 'doctor' AND email LIKE 'sample.doctor.%${EMAIL_DOMAIN}'`);
  // hospitals created by a previous directory import
  await db.query(`DELETE FROM hospitals WHERE name LIKE 'Demo Medical Centre — %'`);

  // ---- 2. hospitals: one per (hospital, city) ------------------------------
  console.log('[doctors-import] creating city hospitals...');
  const citySpecialties = new Map<string, Set<string>>();
  for (const d of doctors) {
    const spec = CATEGORY_TO_SPECIALTY[d.category] ?? d.category;
    if (!citySpecialties.has(d.city)) citySpecialties.set(d.city, new Set());
    citySpecialties.get(d.city)!.add(spec);
  }
  const hospitalIdByCity = new Map<string, string>();
  const hospitalRows: unknown[][] = [];
  for (const [city, specs] of citySpecialties) {
    const state = doctors.find((d) => d.city === city)!.state;
    const id = crypto.randomUUID();
    hospitalIdByCity.set(city, id);
    const rand = seededRand(`hospital:${city}`);
    const [lat, lng] = CITY_COORDS[city] ?? [0, 0];
    hospitalRows.push([
      id,
      `Demo Medical Centre — ${city}`,
      `Demo Medical Centre, ${city}, ${state}, India`,
      city,
      `+91${String(2000000000 + Math.floor(rand() * 999999999))}`,
      lat,
      lng,
      [...specs].slice(0, 8),
      false,
      Math.round((4.0 + rand() * 0.5) * 10) / 10,
      50 + Math.floor(rand() * 300),
      'APP',
    ]);
  }
  await bulkInsert(
    db,
    'hospitals',
    ['id', 'name', 'address', 'city', 'phone', 'lat', 'lng', 'specialties', 'emergency_24x7', 'rating', 'reviews_count', 'rating_source'],
    hospitalRows
  );

  // ---- 3. doctors + users + availability ----------------------------------
  console.log('[doctors-import] inserting doctors, users and availability...');
  const passwordHash = await hashPassword('doctor123'); // one hash, shared demo password
  const userRows: unknown[][] = [];
  const doctorRows: unknown[][] = [];
  const availRows: unknown[][] = [];
  const DAYS = [1, 2, 3, 4, 5, 6]; // Mon–Sat per dataset days_demo
  const HOURS: Array<[string, string]> = [['09:00', '13:00'], ['17:00', '20:00']];

  doctors.forEach((d, i) => {
    const n = CODE_BASE + 1 + i;
    const id = crypto.randomUUID();
    const spec = CATEGORY_TO_SPECIALTY[d.category] ?? d.category;
    const email = `${EMAIL_PREFIX}${n}${EMAIL_DOMAIN}`;
    const phone = `+9192${String(100000000 + i)}`;
    const rand = seededRand(d.doctorId);
    const rating = Math.round((3.9 + rand()) * 10) / 10;
    const reviews = 12 + Math.floor(rand() * 300);
    const hospitalId = hospitalIdByCity.get(d.city)!;
    const bio =
      `${d.name} — ${d.category} specialist at ${d.hospital}, ${d.city}. ` +
      `${d.experience} years of experience. Consults in ${d.languages.join(', ')}. ` +
      `(Synthetic demo record from the DocBot India doctor directory.)`;

    userRows.push([id, 'doctor', d.name, email, phone, passwordHash]);
    doctorRows.push([
      id, `DOC${n}`, spec, null, d.experience, hospitalId,
      `Demo Medical Centre — ${d.city}`, `${d.hospital}, ${d.city}, ${d.state}, India`,
      d.languages, d.fee, 'INR', bio, null, rating, reviews, 'APPROVED',
      CITY_COORDS[d.city]?.[0] ?? null, CITY_COORDS[d.city]?.[1] ?? null,
    ]);
    for (const day of DAYS) {
      for (const [s, e] of HOURS) availRows.push([id, day, s, e, 30, null, null]);
    }
  });

  await bulkInsert(
    db,
    'users',
    ['id', 'role', 'full_name', 'email', 'phone', 'password_hash'],
    userRows
  );
  await bulkInsert(
    db,
    'doctors',
    ['id', 'doctor_code', 'specialization', 'qualifications', 'experience_years',
     'hospital_id', 'hospital_name', 'hospital_address', 'languages', 'consultation_fee',
     'fee_currency', 'bio', 'photo_url', 'avg_rating', 'reviews_count', 'status', 'lat', 'lng'],
    doctorRows
  );
  await bulkInsert(
    db,
    'doctor_availability',
    ['doctor_id', 'weekday', 'start_time', 'end_time', 'slot_minutes', 'break_start', 'break_end'],
    availRows
  );

  const counts = await db.query<{ doctors: string; hospitals: string; avail: string }>(
    `SELECT (SELECT count(*) FROM doctors WHERE doctor_code LIKE 'DOC2%') AS doctors,
            (SELECT count(*) FROM hospitals WHERE name LIKE 'Demo Medical Centre — %') AS hospitals,
            (SELECT count(*) FROM doctor_availability a JOIN doctors d ON d.id = a.doctor_id
              WHERE d.doctor_code LIKE 'DOC2%') AS avail`
  );
  console.log('[doctors-import] done:', counts.rows[0]);
  console.log('[doctors-import] Doctor login: full name (e.g. "Demo Doctor 0001") + DOC200001 + password doctor123');
  await db.close();
}

main().catch((e) => {
  console.error('[doctors-import] FAILED:', e);
  process.exit(1);
});
