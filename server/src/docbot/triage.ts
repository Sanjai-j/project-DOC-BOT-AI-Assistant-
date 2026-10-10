/**
 * DocBot triage layer — trained on doc_bot_medical_symptom_training_dataset.csv
 * (144 curated conditions with symptom lists, recommended specialties, triage
 * levels, and red flags; see scripts/kb-triage-import.ts).
 *
 * Responsibilities:
 *   - resolve dataset specialties ("General Medicine / ENT") to app specialties
 *   - match a patient message against the 144 condition symptom lists
 *   - classify urgency: EMERGENCY_NOW / SAME_DAY / ROUTINE
 *   - detect red-flag phrases from the condition rows that justify escalation
 *
 * Guidance only — never a diagnosis.
 */
import { getDb } from '../db/index.js';
import { SPECIALTIES } from './specialty-map.js';

export interface TriageAssessment {
  matched: boolean;
  condition: string | null;
  code: string | null;
  specialty: string | null;
  urgency: 'EMERGENCY_NOW' | 'SAME_DAY' | 'ROUTINE';
  urgencyNote: string | null;
  redFlagHit: string | null;
}

export interface TriageData {
  loadedAt: number;
  rows: ConditionRow[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: TriageData | null = null;

/** Test hook. */
export function __resetTriageCache(): void {
  cache = null;
}

export async function loadTriage(force = false): Promise<TriageData | null> {
  if (cache && !force && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  const db = await getDb();
  const { rows } = await db.query<{
    code: string;
    condition: string;
    symptoms: string[];
    specialty: string;
    triage_level: string;
    red_flags: string[];
  }>('SELECT code, condition, symptoms, specialty, triage_level, red_flags FROM kb_triage_conditions');
  if (rows.length === 0) return null;
  cache = { loadedAt: Date.now(), rows };
  return cache;
}

// ---------------------------------------------------------------------------
// Raw dataset specialty -> app specialty
// ---------------------------------------------------------------------------

/** First specialty in "A / B" strings that the app can book. */
export function resolveSpecialty(raw: string): string {
  const parts = raw
    .split('/')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  for (const p of parts) {
    const mapped = RAW_SPECIALTY_MAP.get(p);
    if (mapped) return mapped;
  }
  return 'General Physician';
}

const RAW_SPECIALTY_MAP = new Map<string, string>([
  ['general medicine', 'General Physician'],
  ['ent', 'ENT'],
  ['pulmonology', 'Pulmonologist'],
  ['neurology', 'Neurologist'],
  ['gastroenterology', 'Gastroenterologist'],
  ['general surgery', 'Gastroenterologist'],
  ['urology', 'Urologist'],
  ['cardiology', 'Cardiologist'],
  ['endocrinology', 'Endocrinologist'],
  ['infectious disease', 'General Physician'],
  ['dermatology', 'Dermatologist'],
  ['ophthalmology', 'Ophthalmologist'],
  ['gynecology', 'Gynecologist'],
  ['obstetrics', 'Gynecologist'],
  ['dentistry', 'Dentist'],
  ['orthopedics', 'Orthopedic'],
  ['rheumatology', 'Orthopedic'],
  ['emergency medicine', 'General Physician'],
  ['mental health professional', 'Psychiatrist'],
  ['mental health', 'Psychiatrist'],
  ['pediatrics', 'Pediatrician'],
  ['developmental specialist', 'Pediatrician'],
  ['nephrology', 'Urologist'],
  ['hepatology', 'Gastroenterologist'],
  ['hematology', 'General Physician'],
  ['vascular medicine', 'Cardiologist'],
  ['allergy', 'General Physician'],
  ['audiology', 'ENT'],
  ['sleep medicine', 'Pulmonologist'],
]);

// ---------------------------------------------------------------------------
// Urgency classification
// ---------------------------------------------------------------------------

export function classifyUrgency(triageLevel: string): TriageAssessment['urgency'] {
  const t = triageLevel.toLowerCase();
  if (t === 'emergency') return 'EMERGENCY_NOW';
  if (t.includes('same_day') || t.startsWith('urgent')) return 'SAME_DAY';
  return 'ROUTINE';
}

const URGENCY_NOTES: Record<TriageAssessment['urgency'], string> = {
  EMERGENCY_NOW: 'This may be urgent — please seek emergency care now rather than waiting for a booking.',
  SAME_DAY: 'A doctor should evaluate this soon — consider booking for today or tomorrow.',
  ROUTINE: 'This appears routine — booking a regular appointment is appropriate.',
};

// ---------------------------------------------------------------------------
// Red flags
// ---------------------------------------------------------------------------

/** Red-flag phrases with precise clinical trigger regexes (curated). */
const RED_FLAG_REGEXES: Array<[RegExp, string]> = [
  [/worst[- ]ever headache|thunderclap|sudden (worst|severe) headache/, 'sudden worst-ever headache'],
  [/rigid (and|or) hard (belly|abdomen)|belly (is|feels) rigid|rigid abdomen|board[- ]like/, 'rigid abdomen'],
  [/vomiting blood|throwing up blood|blood in vomit/, 'vomiting blood'],
  [/black (and )?tarry|tarry[- ]?(stool|stools)|black stool|melena/, 'black tarry stool'],
  [/non[- ]blanching rash|rash that does not fade when pressed/, 'non-blanching rash'],
  [/first seizure|seizure lasting|seizures? (lasting|over) (more than )?5/, 'prolonged seizure'],
  [/loss of consciousness|passed out|fainted|fainting|unconscious/, 'loss of consciousness'],
  [/bladder or bowel control|incontinence of stool|loss of bladder.*bowel|can('|no)?t control (my )?(bladder|bowels)/, 'bladder or bowel dysfunction'],
  [/saddle numbness|numb (between|in the) (groin|saddle)/, 'saddle numbness'],
  [/sudden (one[- ]sided|one sided) (leg )?swelling|one leg (is )?swollen and (painful|warm)/, 'one-sided leg swelling (possible DVT)'],
  [/coughing (up )?blood|hemoptysis/, 'coughing blood'],
  [/blue (lips|fingertips)|gray lips|bluish lips/, 'blue or gray lips'],
  [/severe dehydration|can('|no)?t keep (any )?fluids? down/, 'severe dehydration'],
  [/hot dry skin|very high body temperature/, 'possible heat stroke'],
  [/pink frothy sputum/, 'pink frothy sputum'],
];

/**
 * Scan the message for red-flag phrases from the curated clinical list.
 * (The dataset's per-row red-flag strings intentionally double as ordinary
 * symptoms like "shortness of breath", so they are not matched verbatim —
 * emergency detection remains the safety net for urgent symptom wording.)
 */
export function detectRedFlag(text: string): string | null {
  for (const [re, label] of RED_FLAG_REGEXES) {
    if (re.test(text)) return label;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Condition matching
// ---------------------------------------------------------------------------

interface ConditionRow {
  code: string;
  condition: string;
  symptoms: string[];
  specialty: string;
  triage_level: string;
  red_flags: string[];
}

export type TriageConditionRow = ConditionRow;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseHits(text: string, phrases: string[]): number {
  const t = norm(text);
  let hits = 0;
  for (const p of phrases) {
    if (p.length < 3) continue;
    const re = new RegExp(`(^|\\s)${escapeRe(p)}(s|es)?($|\\s)`, 'i');
    if (re.test(t)) hits++;
  }
  return hits;
}

/** Rank the 144 conditions by how many of their symptom phrases the message hits. */
export function matchConditions(text: string, data: TriageData, limit = 3): Array<{ row: ConditionRow; hits: number }> {
  const scored = data.rows
    .map((row) => ({ row, hits: phraseHits(text, row.symptoms) }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
  return scored;
}

// ---------------------------------------------------------------------------
// Full assessment
// ---------------------------------------------------------------------------

/**
 * Triage a message. `kbSymptomCount` is the number of canonical KB symptoms
 * recognized by docbot/kb.ts — when it already matched well, triage defers.
 */
export function assessTriage(text: string, data: TriageData, kbSymptomCount: number): TriageAssessment {
  const base: TriageAssessment = {
    matched: false,
    condition: null,
    code: null,
    specialty: null,
    urgency: 'ROUTINE',
    urgencyNote: null,
    redFlagHit: null,
  };

  const matches = matchConditions(text, data, 3);
  if (matches.length === 0) return base;
  const best = matches[0];

  // require at least 2 symptom-phrase hits, or 1 when the KB found nothing
  if (best.hits < 2 && kbSymptomCount > 0) return base;
  if (best.hits < 1) return base;

  const urgency = classifyUrgency(best.row.triage_level);
  return {
    matched: true,
    condition: best.row.condition,
    code: best.row.code,
    specialty: resolveSpecialty(best.row.specialty),
    urgency,
    urgencyNote: URGENCY_NOTES[urgency],
    redFlagHit: null,
  };
}
