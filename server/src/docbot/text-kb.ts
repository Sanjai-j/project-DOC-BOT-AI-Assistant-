/**
 * DocBot text classifier — trained on Symptom2Disease.csv (1,200 labeled
 * patient symptom descriptions across 24 diseases; see scripts/kb-text-import.ts).
 *
 * Multinomial Naive Bayes over token counts with Laplace smoothing. The label
 * vocabulary is tiny (24 diseases) and descriptions share a symptom lexicon,
 * which suits NB well. Predictions from this classifier are blended with the
 * symptom-flag knowledge base (docbot/kb.ts): language evidence raises/lowers
 * the visibility of conditions, and a confident language match can steer the
 * specialty when the flag-based matcher is ambivalent.
 */
import { getDb } from '../db/index.js';
import { assignSpecialty } from './specialty-map.js';

export interface TextPrediction {
  label: string;
  specialty: string;
  score: number; // calibrated 0..1 confidence
}

export interface TextModel {
  loadedAt: number;
  classes: Array<{ label: string; specialty: string; docCount: number; totalTokens: number; vocab: Map<string, number> }>;
  totalDocs: number;
  vocabSize: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: TextModel | null = null;

/** Test hook — forces the next call to reload from the database. */
export function __resetTextKbCache(): void {
  cache = null;
}

export async function loadTextModel(force = false): Promise<TextModel | null> {
  if (cache && !force && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  const db = await getDb();
  const { rows } = await db.query<{ label: string; specialty: string; doc_count: number; total_tokens: number; vocab: Record<string, number> }>(
    'SELECT label, specialty, doc_count, total_tokens, vocab FROM kb_text_classes'
  );
  if (rows.length === 0) return null;
  let vocabSize = 0;
  const classes = rows.map((r) => {
    const vocab = new Map<string, number>(Object.entries(r.vocab ?? {}));
    vocabSize = Math.max(vocabSize, vocab.size);
    return {
      label: r.label,
      specialty: r.specialty,
      docCount: r.doc_count,
      totalTokens: r.total_tokens,
      vocab,
    };
  });
  // union vocabulary size
  const union = new Set<string>();
  for (const c of classes) for (const t of c.vocab.keys()) union.add(t);
  cache = {
    loadedAt: Date.now(),
    classes,
    totalDocs: classes.reduce((s, c) => s + c.docCount, 0),
    vocabSize: union.size,
  };
  return cache;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do',
  'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until',
  'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
  'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just',
  'dont', 'doesnt', 'didnt', 'cant', 'couldnt', 'wouldnt', 'shouldnt', 'im', 'ive', 'ill', 'id',
  'also', 'because', 'since', 'even', 'get', 'got', 'getting', 'often', 'really', 'very', 'much',
  'lot', 'lots', 'every', 'day', 'days', 'week', 'weeks', 'night', 'nights', 'time', 'times',
  'past', 'few', 'like', 'feel', 'feels', 'feeling', 'felt', 'experiencing', 'experienced',
  'suffering', 'suffering', 'going', 'coming', 'make', 'makes', 'making', 'made', 'unable',
]);

/** Tokenize free text into lowercase stems (very light Porter-ish suffix strip). */
export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

  const out: string[] = [];
  for (const t of raw) {
    let stem = t;
    if (stem.length > 4 && stem.endsWith('ing')) stem = stem.slice(0, -3);
    else if (stem.length > 4 && stem.endsWith('ies')) stem = stem.slice(0, -3) + 'y';
    else if (stem.length > 4 && (stem.endsWith('ed') || stem.endsWith('es'))) stem = stem.slice(0, -2);
    else if (stem.length > 4 && stem.endsWith('s') && !stem.endsWith('ss')) stem = stem.slice(0, -1);
    out.push(stem);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Naive Bayes classification
// ---------------------------------------------------------------------------

/**
 * Log-probability scoring with Laplace smoothing (alpha = 0.3). Returns the
 * top `limit` labels with softmax-calibrated scores.
 */
export function classify(text: string, model: TextModel, limit = 3): TextPrediction[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  const V = model.vocabSize;
  const alpha = 0.3;
  const logScores: Array<{ label: string; specialty: string; logP: number }> = [];
  for (const c of model.classes) {
    let logP = Math.log(c.docCount / model.totalDocs);
    const denom = c.totalTokens + alpha * V;
    for (const t of tokens) {
      const count = c.vocab.get(t) ?? 0;
      logP += Math.log((count + alpha) / denom);
    }
    logScores.push({ label: c.label, specialty: c.specialty, logP });
  }
  logScores.sort((a, b) => b.logP - a.logP);

  // softmax over log-probs for a readable confidence
  const max = logScores[0].logP;
  const exps = logScores.map((s) => Math.exp(s.logP - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return logScores.slice(0, limit).map((s, i) => ({
    label: s.label,
    specialty: s.specialty,
    score: exps[i] / sum,
  }));
}

// ---------------------------------------------------------------------------
// Label -> specialty resolution (with curated overrides)
// ---------------------------------------------------------------------------

/**
 * Dataset labels that do not map cleanly through assignSpecialty(); these go
 * through the mapping first and fall back to this table.
 */
const LABEL_SPECIALTY_OVERRIDES: Record<string, string> = {
  'Dimorphic Hemorrhoids': 'Gastroenterologist',
  'urinary tract infection': 'Urologist',
  'Cervical spondylosis': 'Orthopedic',
  'Bronchial Asthma': 'Pulmonologist',
  'Varicose Veins': 'Cardiologist',
  'Common Cold': 'General Physician',
  'Fungal infection': 'Dermatologist',
  'Chicken pox': 'General Physician',
  Typhoid: 'General Physician',
  Malaria: 'General Physician',
  Dengue: 'General Physician',
  allergy: 'Dermatologist',
  'drug reaction': 'Dermatologist',
  Jaundice: 'Gastroenterologist',
  'peptic ulcer disease': 'Gastroenterologist',
  'gastroesophageal reflux disease': 'Gastroenterologist',
  Impetigo: 'Dermatologist',
  Psoriasis: 'Dermatologist',
  Acne: 'Dermatologist',
  Arthritis: 'Orthopedic',
  Hypertension: 'Cardiologist',
  Migraine: 'Neurologist',
  diabetes: 'Endocrinologist',
  Pneumonia: 'Pulmonologist',
};

export function labelToSpecialty(label: string): string {
  if (LABEL_SPECIALTY_OVERRIDES[label]) return LABEL_SPECIALTY_OVERRIDES[label];
  return assignSpecialty(label);
}

/**
 * Resolve a dataset label to an app specialty at import time. Exported for the
 * import script; also consulted at runtime as a fallback when a label has no
 * class row (should not happen).
 */
export function resolveLabelSpecialty(label: string): string {
  return labelToSpecialty(label);
}
