import { createStandaloneDb } from '../db/index.js';

const db = await createStandaloneDb();
const t = await db.query(
  `SELECT 'users' t, COUNT(*)::int c FROM users
   UNION ALL SELECT 'doctors', COUNT(*)::int FROM doctors
   UNION ALL SELECT 'hospitals', COUNT(*)::int FROM hospitals
   UNION ALL SELECT 'availability', COUNT(*)::int FROM doctor_availability
   UNION ALL SELECT 'appointments', COUNT(*)::int FROM appointments
   UNION ALL SELECT 'reviews', COUNT(*)::int FROM reviews
   UNION ALL SELECT 'documents', COUNT(*)::int FROM doctor_documents
   UNION ALL SELECT 'video', COUNT(*)::int FROM video_consultations`
);
console.table(t.rows);
const docs = await db.query(`SELECT doctor_code, specialization, status FROM doctors ORDER BY doctor_code`);
console.table(docs.rows);
await db.close();
process.exit(0);
