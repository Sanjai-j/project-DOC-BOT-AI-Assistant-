/**
 * Interactive SQL prompt over the embedded Postgres (PGlite) database.
 * Lets you run any SQL against DocBot TeleMed data without a separate
 * database install:
 *
 *   cd server
 *   npm run db:sql            -- tables overview, then a SQL> prompt
 *   npm run db:sql "SELECT full_name, email FROM users LIMIT 5"
 *
 * Type "exit" (or press Ctrl+C) to quit.
 */
import { createStandaloneDb } from '../db/index.js';
import type { DB } from '../db/index.js';

const inlineQuery = process.argv.slice(2).join(' ').trim();

const TABLES: Array<[string, string]> = [
  ['users', 'all accounts: patients, doctors, admins'],
  ['doctors', 'doctor profiles: DOC id, verification status, hospital, specialty'],
  ['hospitals', 'hospital directory'],
  ['appointments', 'bookings and their status'],
  ['video_requests', 'video consultation requests and call windows'],
  ['doctor_verification_docs', 'uploaded ID documents (private)'],
  ['notifications', 'in-app notifications'],
  ['emergency_logs', 'emergency call / help attempts'],
  ['chat_messages', 'DocBot conversation history'],
  ['reviews', 'appointment ratings'],
];

async function showOverview(db: DB): Promise<void> {
  console.log('\nDocBot TeleMed — embedded Postgres (PGlite)');
  console.log('Data dir: ' + (process.env.DATA_DIR || '%TEMP%/docbot-telemed-data') + '\n');
  console.log('TABLES');
  for (const [name, desc] of TABLES) {
    try {
      const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${name}`);
      console.log(`  ${name.padEnd(28)} ${String(r.rows[0]?.n ?? 0).padStart(4)} rows   ${desc}`);
    } catch {
      console.log(`  ${name.padEnd(28)}    --   ${desc}`);
    }
  }
  console.log('\nExamples:');
  console.log("  SELECT full_name, email FROM users WHERE role = 'doctor';");
  console.log('  SELECT id, full_name, specialty, status FROM doctors;');
  console.log("  SELECT status, count(*) FROM appointments GROUP BY status;");
  console.log('');
}

async function runOne(db: DB, sql: string): Promise<void> {
  const t0 = Date.now();
  const res = await db.query(sql);
  const rows = res.rows ?? [];
  if (rows.length === 0) {
    console.log('(no rows)');
  } else {
    console.table(rows.slice(0, 50));
    if (rows.length > 50) console.log(`(${rows.length - 50} more rows not shown)`);
  }
  console.log(`${rows.length} row(s) in ${Date.now() - t0} ms\n`);
}

async function main(): Promise<void> {
  if (inlineQuery) {
    const db = await createStandaloneDb();
    try {
      await runOne(db, inlineQuery);
    } finally {
      await db.close();
    }
    process.exit(0);
  }

  const db = await createStandaloneDb();
  await showOverview(db);

  // readline prompt (no extra dependency needed)
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write('SQL> ');
  for (;;) {
    let line: string;
    try {
      line = (await rl.question('')) .trim();
    } catch {
      break; // stdin closed
    }
    if (!line) {
      process.stdout.write('SQL> ');
      continue;
    }
    if (/^(exit|quit|q)\s*;?$/i.test(line)) break;
    try {
      await runOne(db, line.replace(/;\s*$/, ''));
    } catch (e) {
      console.log('ERROR:', (e as Error).message);
    }
    process.stdout.write('SQL> ');
  }
  rl.close();
  await db.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
