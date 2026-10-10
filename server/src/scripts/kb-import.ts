/**
 * Import the augmented disease-symptom dataset into the DocBot knowledge base.
 *
 *   npm run kb:import --workspace server
 *   npm run kb:import --workspace server -- C:/path/to/Final_Augmented_dataset_....csv
 *
 * Default CSV path: C:/Users/sanja/Downloads/datasetfordis/Final_Augmented_dataset_Diseases_and_Symptoms.csv
 * (If that file is locked by Windows, copy it first — e.g. %TEMP%/diseases.csv — and pass it as the argument.)
 *
 * Streams the CSV row by row, aggregates disease -> symptom co-occurrence in
 * memory (773 diseases x 377 symptoms = ~291k cells), then writes to Postgres
 * in batches. Safe to re-run: TRUNCATEs the kb_* tables first.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { createStandaloneDb } from '../db/index.js';
import { assignSpecialty } from '../docbot/specialty-map.js';

const DEFAULT_CSV =
  process.env.KB_CSV_PATH ||
  'C:/Users/sanja/AppData/Local/Temp/diseases.csv';

// ---------------------------------------------------------------------------
// Minimal RFC4180 CSV line parser (quoted fields, escaped quotes).
// ---------------------------------------------------------------------------
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

interface DiseaseAgg {
  rows: number;
  symp: Map<number, number>; // symptom index -> count of rows with flag=1
}

async function main(): Promise<void> {
  const csvPath = process.argv[2] || DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) {
    console.error(`[kb:import] CSV not found: ${csvPath}`);
    console.error('Pass a readable copy as an argument, e.g.:');
    console.error('  npm run kb:import --workspace server -- C:/Users/sanja/AppData/Local/Temp/diseases.csv');
    process.exit(1);
  }

  const t0 = Date.now();
  console.log(`[kb:import] reading ${csvPath}`);

  const headerToIndex = new Map<string, number>(); // symptom name -> column index
  const symptoms: string[] = []; // ordered unique symptom names
  const diseases = new Map<string, DiseaseAgg>();

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, 'utf8'),
    crlfDelay: Infinity,
  });

  let headerCols: string[] | null = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (!headerCols) {
      headerCols = fields;
      for (let i = 1; i < fields.length; i++) {
        const name = fields[i].trim().toLowerCase();
        if (!name || headerToIndex.has(name)) continue;
        headerToIndex.set(name, symptoms.length);
        symptoms.push(name);
      }
      continue;
    }
    const disease = (fields[0] || '').trim().toLowerCase();
    if (!disease) continue;
    let agg = diseases.get(disease);
    if (!agg) {
      agg = { rows: 0, symp: new Map() };
      diseases.set(disease, agg);
    }
    agg.rows++;
    for (let c = 1; c < fields.length; c++) {
      if (fields[c] !== '1') continue;
      const name = headerCols[c]?.trim().toLowerCase();
      if (!name) continue;
      const si = headerToIndex.get(name);
      if (si === undefined) continue;
      agg.symp.set(si, (agg.symp.get(si) ?? 0) + 1);
    }
  }

  const totalRows = [...diseases.values()].reduce((s, d) => s + d.rows, 0);
  console.log(`[kb:import] parsed ${totalRows} rows, ${diseases.size} diseases, ${symptoms.length} symptoms`);

  // ------------------------------------------------------------------
  // Write to Postgres
  // ------------------------------------------------------------------
  const db = await createStandaloneDb();
  await db.withTransaction(async (client) => {
    await client.query('TRUNCATE kb_disease_symptom, kb_symptoms, kb_diseases RESTART IDENTITY CASCADE');

    // Symptoms + document frequency
    const sympIds: number[] = [];
    for (let i = 0; i < symptoms.length; i++) {
      const { rows } = await client.query('INSERT INTO kb_symptoms (name, df) VALUES ($1, $2) RETURNING id', [
        symptoms[i],
        0,
      ]);
      sympIds[i] = rows[0].id;
    }

    // Diseases
    const diseaseIds = new Map<string, number>();
    for (const [name, agg] of diseases) {
      const specialty = assignSpecialty(name);
      const { rows } = await client.query(
        'INSERT INTO kb_diseases (name, row_count, specialty) VALUES ($1, $2, $3) RETURNING id',
        [name, agg.rows, specialty]
      );
      diseaseIds.set(name, rows[0].id);
    }

    // Disease-symptom edges in batches of 400 (parameter limit 65535 / 3)
    const edgeBatch: any[] = [];
    const flush = async () => {
      if (edgeBatch.length === 0) return;
      const values: string[] = [];
      const params: any[] = [];
      for (const [did, sid, w] of edgeBatch) {
        const b = params.length;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3})`);
        params.push(did, sid, w);
      }
      await client.query(
        `INSERT INTO kb_disease_symptom (disease_id, symptom_id, weight) VALUES ${values.join(',')}
         ON CONFLICT (disease_id, symptom_id) DO UPDATE SET weight = EXCLUDED.weight`,
        params
      );
      edgeBatch.length = 0;
    };

    for (const [diseaseName, agg] of diseases) {
      const did = diseaseIds.get(diseaseName)!;
      for (const [si, count] of agg.symp) {
        edgeBatch.push([did, sympIds[si], count / agg.rows]);
        if (edgeBatch.length >= 400) await flush();
      }
    }
    await flush();

    // Document frequencies: number of diseases each symptom is linked to.
    // (Used as IDF: symptoms appearing in every disease carry no signal.)
    await client.query(
      `UPDATE kb_symptoms s SET df = COALESCE(c.cnt, 0)
       FROM (SELECT symptom_id, count(*) AS cnt FROM kb_disease_symptom GROUP BY symptom_id) c
       WHERE c.symptom_id = s.id`
    );
  });

  const { rows: stats } = await db.query<{ diseases: string; symptoms: string; edges: string }>(
    `SELECT (SELECT count(*) FROM kb_diseases)::text AS diseases,
            (SELECT count(*) FROM kb_symptoms)::text AS symptoms,
            (SELECT count(*) FROM kb_disease_symptom)::text AS edges`
  );
  console.log(
    `[kb:import] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
      `diseases=${stats[0].diseases} symptoms=${stats[0].symptoms} links=${stats[0].edges}`
  );
  await db.close();
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('kb-import.ts');
if (isDirectRun) {
  main().catch((e) => {
    console.error('[kb:import] FAILED:', e);
    process.exit(1);
  });
}
