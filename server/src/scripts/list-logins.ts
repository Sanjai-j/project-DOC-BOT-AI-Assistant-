/**
 * Lists every account that can log in: patients, doctors (with their unique
 * Doctor ID), and admins.
 *
 * Passwords are stored as bcrypt hashes, so plaintext passwords can never be
 * read from the database. For accounts created by the demo seed, this script
 * checks the known demo passwords against the stored hash and shows them.
 * Real users' passwords are never shown.
 *
 * Run:  npx tsx src/scripts/list-logins.ts   (from the server directory)
 */
import { createStandaloneDb } from '../db/index.js';
import { verifyPassword } from '../utils/auth.js';

/** Demo passwords that the seed/E2E scripts use — checked against hashes. */
const KNOWN_DEMO_PASSWORDS = ['patient123', 'doctor123', 'ChangeMe!123', 'cardio123'];

interface Row {
  role: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  status: string;
  doctor_code?: string | null;
  doctor_status?: string | null;
  created_at: string;
}

async function main(): Promise<void> {
  const db = await createStandaloneDb();
  const { rows } = await db.query<Row>(
    `SELECT u.role, u.full_name, u.email, u.phone, u.password_hash, u.status, u.created_at,
            d.doctor_code, d.status AS doctor_status
     FROM users u
     LEFT JOIN doctors d ON d.id = u.id
     ORDER BY u.role, u.created_at`
  );

  const groups: Record<string, Row[]> = { admin: [], doctor: [], patient: [] };
  for (const r of rows) (groups[r.role] ??= []).push(r);

  for (const role of ['admin', 'doctor', 'patient'] as const) {
    const list = groups[role] ?? [];
    console.log(`\n=== ${role.toUpperCase()}S (${list.length}) ===`);
    for (const r of list) {
      let pw = '(none / OTP-only account)';
      if (r.password_hash) {
        // verifyPassword is async — await each candidate (a Promise is always
        // truthy, so Array.find would wrongly match the first entry).
        let match: string | undefined;
        for (const p of KNOWN_DEMO_PASSWORDS) {
          if (await verifyPassword(p, r.password_hash)) {
            match = p;
            break;
          }
        }
        pw = match ? `${match} (demo)` : '(private — hashed, not recoverable)';
      }
      const idLabel =
        role === 'doctor'
          ? ` | ID: ${r.doctor_code ?? '—'} | verification: ${r.doctor_status ?? '—'}`
          : '';
      console.log(
        `  ${r.full_name} | ${r.email ?? r.phone ?? '(no identifier)'}${idLabel} | password: ${pw} | ${r.status}`
      );
    }
  }

  console.log('\nNotes:');
  console.log('  - Doctor login needs: full name + Doctor ID + password.');
  console.log('  - Patient login needs: email or phone + password, or an OTP code.');
  console.log('  - "private" means a real registered user — the hash cannot be reversed.');
  await db.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
