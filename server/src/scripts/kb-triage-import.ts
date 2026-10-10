/**
 * Import doc_bot_medical_symptom_training_dataset.csv (144 curated conditions)
 * into kb_triage_conditions.
 *
 *   npm run kb:triage-import --workspace server
 *   npm run kb:triage-import --workspace server -- C:/path/to/..._training_dataset.csv
 *
 * Default CSV: datasets/doc_bot_medical_symptom_training_dataset.csv (ships with the repo)
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { createStandaloneDb } from '../db/index.js';
import { resolveDataset } from './dataset-path.js';

const DEFAULT_CSV = resolveDataset(
  'doc_bot_medical_symptom_training_dataset.csv',
  process.env.KB_TRIAGE_CSV_PATH
);

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function splitList(s: string): string[] {
  return s
    .split(/[;,]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const csvPath = process.argv[2] || DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) {
    console.error(`[kb:triage-import] CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const rl = readline.createInterface({ input: fs.createReadStream(csvPath, 'utf8'), crlfDelay: Infinity });
  const rows: any[] = [];
  let first = true;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (first) {
      first = false;
      continue;
    }
    const f = parseCsvLine(line);
    if (f.length < 8) continue;
    rows.push({
      code: f[0].trim(),
      condition: f[1].trim(),
      symptoms: splitList(f[2]),
      specialty: f[3].trim(),
      triage: f[4].trim(),
      redFlags: splitList(f[5]),
      instruction: f[6].trim(),
    });
  }
  console.log(`[kb:triage-import] parsed ${rows.length} conditions`);

  const db = await createStandaloneDb();
  await db.withTransaction(async (client) => {
    await client.query('TRUNCATE kb_triage_conditions RESTART IDENTITY');
    for (const r of rows) {
      await client.query(
        `INSERT INTO kb_triage_conditions (code, condition, symptoms, specialty, triage_level, red_flags, bot_instruction)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [r.code, r.condition, r.symptoms, r.specialty, r.triage, r.redFlags, r.instruction]
      );
    }
  });
  console.log(`[kb:triage-import] done — ${rows.length} conditions stored`);
  await db.close();
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('kb-triage-import.ts');
if (isDirectRun) {
  main().catch((e) => {
    console.error('[kb:triage-import] FAILED:', e);
    process.exit(1);
  });
}
