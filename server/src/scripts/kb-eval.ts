/**
 * Evaluate the text classifier with a hold-out split: train on 80% of the
 * Symptom2Disease rows (in-memory), test on the remaining 20%, report
 * accuracy + per-label results. This measures what the deployed classifier
 * would get on unseen patient wording.
 *
 *   npm run kb:eval --workspace server
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { tokenize, labelToSpecialty } from '../docbot/text-kb.js';
import { resolveDataset } from './dataset-path.js';

const DEFAULT_CSV = resolveDataset('Symptom2Disease.csv');

function parseCsvLine(line: string): string[] {
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

interface Row {
  label: string;
  tokens: string[];
}

async function loadRows(csvPath: string): Promise<Row[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(csvPath, 'utf8'), crlfDelay: Infinity });
  const rows: Row[] = [];
  let first = true;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (first) {
      first = false;
      continue;
    }
    const f = parseCsvLine(line);
    const label = (f[1] || '').trim();
    const text = (f[2] || '').trim();
    if (!label || !text) continue;
    rows.push({ label, tokens: tokenize(text) });
  }
  return rows;
}

function trainNB(rows: Row[]): { classes: Map<string, Map<string, number>>; totals: Map<string, number>; vocab: Set<string>; docCounts: Map<string, number> } {
  const classes = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  const docCounts = new Map<string, number>();
  const vocab = new Set<string>();
  for (const r of rows) {
    if (!classes.has(r.label)) classes.set(r.label, new Map());
    const v = classes.get(r.label)!;
    docCounts.set(r.label, (docCounts.get(r.label) ?? 0) + 1);
    for (const t of r.tokens) {
      v.set(t, (v.get(t) ?? 0) + 1);
      totals.set(r.label, (totals.get(r.label) ?? 0) + 1);
      vocab.add(t);
    }
  }
  return { classes, totals, vocab, docCounts };
}

function predictNB(model: ReturnType<typeof trainNB>, tokens: string[], totalDocs: number): Array<{ label: string; logP: number }> {
  const V = model.vocab.size;
  const alpha = 0.3;
  const scores: Array<{ label: string; logP: number }> = [];
  for (const [label, v] of model.classes) {
    let logP = Math.log((model.docCounts.get(label) ?? 1) / totalDocs);
    const denom = (model.totals.get(label) ?? 0) + alpha * V;
    for (const t of tokens) {
      logP += Math.log(((v.get(t) ?? 0) + alpha) / denom);
    }
    scores.push({ label, logP });
  }
  return scores.sort((a, b) => b.logP - a.logP);
}

async function main(): Promise<void> {
  const csvPath = process.argv[2] || DEFAULT_CSV;
  const rows = await loadRows(csvPath);
  console.log(`[kb:eval] ${rows.length} rows`);

  // stratified 80/20 split per label
  const byLabel = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byLabel.has(r.label)) byLabel.set(r.label, []);
    byLabel.get(r.label)!.push(r);
  }
  const train: Row[] = [];
  const test: Row[] = [];
  for (const list of byLabel.values()) {
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    const cut = Math.floor(shuffled.length * 0.8);
    train.push(...shuffled.slice(0, cut));
    test.push(...shuffled.slice(cut));
  }
  console.log(`[kb:eval] train=${train.length} test=${test.length}`);

  const model = trainNB(train);
  const totalDocs = train.length;

  let top1 = 0;
  let top3 = 0;
  let specialtyAgree = 0;
  const confusion = new Map<string, Map<string, number>>();
  for (const r of test) {
    const preds = predictNB(model, r.tokens, totalDocs);
    if (preds[0]?.label === r.label) top1++;
    if (preds.slice(0, 3).some((p) => p.label === r.label)) top3++;
    if (labelToSpecialty(preds[0]?.label ?? '') === labelToSpecialty(r.label)) specialtyAgree++;
    if (!confusion.has(r.label)) confusion.set(r.label, new Map());
    const row = confusion.get(r.label)!;
    row.set(preds[0]?.label ?? '?', (row.get(preds[0]?.label ?? '?') ?? 0) + 1);
  }

  console.log(`\nResults:`);
  console.log(`  top-1 accuracy:      ${(top1 / test.length * 100).toFixed(1)}%  (${top1}/${test.length})`);
  console.log(`  top-3 accuracy:      ${(top3 / test.length * 100).toFixed(1)}%  (${top3}/${test.length})`);
  console.log(`  specialty agreement: ${(specialtyAgree / test.length * 100).toFixed(1)}%  (${specialtyAgree}/${test.length})`);

  const wrong = test.length - top1;
  if (wrong > 0) {
    console.log(`\nMost common confusions (true -> predicted):`);
    const pairs: Array<[string, string, number]> = [];
    for (const [t, row] of confusion) for (const [p, n] of row) if (t !== p) pairs.push([t, p, n]);
    pairs.sort((a, b) => b[2] - a[2]).slice(0, 8).forEach(([t, p, n]) => console.log(`  ${t} -> ${p}: ${n}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
