/**
 * Analyze the augmented disease-symptom CSV: stats + sample rows.
 * Usage: npx tsx src/scripts/analyze-dataset.ts [path-to-csv]
 */
import fs from 'node:fs';
import readline from 'node:readline';

const csvPath = process.argv[2] || 'C:/Users/sanja/AppData/Local/Temp/diseases.csv';

// Minimal CSV parser (RFC4180: quoted fields, escaped quotes)
function parseLine(line: string): string[] {
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
  const rl = readline.createInterface({ input: fs.createReadStream(csvPath, 'utf8'), crlfDelay: Infinity });
  let header: string[] | null = null;
  let rowCount = 0;
  const diseases = new Map<string, number>();
  let minSym = Number.MAX_SAFE_INTEGER;
  let maxSym = 0;
  let sumSym = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const fields = parseLine(line);
    if (!header) {
      header = fields;
      console.log(`columns: ${fields.length}`);
      console.log(`first column: "${fields[0]}"`);
      continue;
    }
    rowCount++;
    const disease = (fields[0] || '').trim().toLowerCase();
    diseases.set(disease, (diseases.get(disease) ?? 0) + 1);
    let ones = 0;
    for (let i = 1; i < fields.length; i++) if (fields[i] === '1') ones++;
    minSym = Math.min(minSym, ones);
    maxSym = Math.max(maxSym, ones);
    sumSym += ones;
  }

  console.log(`rows: ${rowCount}`);
  console.log(`unique diseases: ${diseases.size}`);
  console.log(`symptoms per row: min=${minSym} max=${maxSym} avg=${(sumSym / rowCount).toFixed(2)}`);
  console.log(`\ntop 15 diseases by row count:`);
  [...diseases.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([d, n]) => console.log(`  ${d}: ${n}`));
  console.log(`\nsample disease names (30 of ${diseases.size}):`);
  [...diseases.keys()].slice(0, 30).forEach((d) => console.log(`  ${d}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
