/**
 * Import Symptom2Disease.csv (labeled patient symptom descriptions) into the
 * kb_text_classes table for DocBot's Naive Bayes text classifier.
 *
 *   npm run kb:text-import --workspace server
 *   npm run kb:text-import --workspace server -- C:/path/to/Symptom2Disease.csv
 *
 * Default CSV: C:/Users/sanja/AppData/Local/Temp/symptom2disease.csv
 * Safe to re-run: replaces all rows in kb_text_classes.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { createStandaloneDb } from '../db/index.js';
import { tokenize } from '../docbot/text-kb.js';
import { labelToSpecialty } from '../docbot/text-kb.js';

const DEFAULT_CSV = process.env.KB_TEXT_CSV_PATH || 'C:/Users/sanja/AppData/Local/Temp/symptom2disease.csv';

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

async function main(): Promise<void> {
  const csvPath = process.argv[2] || DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) {
    console.error(`[kb:text-import] CSV not found: ${csvPath}`);
    console.error('Pass a readable copy as an argument, e.g.:');
    console.error('  npm run kb:text-import --workspace server -- C:/Users/sanja/Downloads/Symptom2Disease.csv');
    process.exit(1);
  }

  const t0 = Date.now();
  console.log(`[kb:text-import] reading ${csvPath}`);

  // aggregate token counts per label
  const classes = new Map<string, { docCount: number; vocab: Map<string, number> }>();
  const rl = readline.createInterface({ input: fs.createReadStream(csvPath, 'utf8'), crlfDelay: Infinity });
  let first = true;
  let rows = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (first) {
      first = false; // header: ,label,text
      continue;
    }
    const fields = parseCsvLine(line);
    const label = (fields[1] || '').trim();
    const text = (fields[2] || '').trim();
    if (!label || !text) continue;
    rows++;
    let cls = classes.get(label);
    if (!cls) {
      cls = { docCount: 0, vocab: new Map() };
      classes.set(label, cls);
    }
    cls.docCount++;
    for (const tok of tokenize(text)) cls.vocab.set(tok, (cls.vocab.get(tok) ?? 0) + 1);
  }

  console.log(`[kb:text-import] parsed ${rows} rows across ${classes.size} labels`);

  const db = await createStandaloneDb();
  await db.withTransaction(async (client) => {
    await client.query('TRUNCATE kb_text_classes RESTART IDENTITY');
    for (const [label, cls] of classes) {
      const totalTokens = [...cls.vocab.values()].reduce((s, n) => s + n, 0);
      const specialty = labelToSpecialty(label);
      await client.query(
        'INSERT INTO kb_text_classes (label, specialty, doc_count, total_tokens, vocab) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [label, specialty, cls.docCount, totalTokens, JSON.stringify(Object.fromEntries(cls.vocab))]
      );
    }
  });

  console.log(`[kb:text-import] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${classes.size} classes stored`);
  await db.close();
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('kb-text-import.ts');
if (isDirectRun) {
  main().catch((e) => {
    console.error('[kb:text-import] FAILED:', e);
    process.exit(1);
  });
}
