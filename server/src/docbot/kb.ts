/**
 * DocBot knowledge base — trained on Final_Augmented_dataset_Diseases_and_Symptoms
 * (246,945 rows, 773 diseases, 377 symptom columns; see scripts/kb-import.ts).
 *
 * Pipeline for a patient message:
 *   1. extractSymptoms — canonical symptom phrases found in the text
 *      (word-boundary matching + a curated synonym map for everyday wording).
 *   2. predictDiseases — scores every disease by the fraction of its dataset
 *      rows that show the matched symptoms, IDF-weighted so common symptoms
 *      ("fever") carry less signal than specific ones ("knee swelling").
 *   3. buildKbReply — enriches the rule-engine result with the top conditions,
 *      the specialty of the best match, and a booking action. Guidance only —
 *      the reply always carries the not-a-diagnosis disclaimer.
 */
import { getDb } from '../db/index.js';
import type { FollowUpState } from './rules.js';
import { loadTextModel, classify } from './text-kb.js';
import type { TextModel, TextPrediction } from './text-kb.js';
import { loadTriage, assessTriage, detectRedFlag } from './triage.js';
import type { TriageAssessment, TriageData } from './triage.js';

export interface DocBotResult {
  reply: string;
  suggestedSpecialty: string | null;
  emergency: boolean;
  quickReplies: string[];
  actionButtons: { label: string; action: string; payload?: string }[];
  followUp: FollowUpState;
}

export interface KbData {
  loadedAt: number;
  diseaseCount: number;
  diseases: Map<string, { specialty: string; rowCount: number }>;
  edges: Map<string, number>; // "symptomName\x1fdiseaseName" -> weight (fraction of disease rows)
  byDisease: Map<string, Array<{ symptom: string; weight: number }>>;
  symptoms: string[];
  df: Map<string, number>; // symptom name -> number of diseases linked
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: KbData | null = null;

/** Test hook — forces the next call to reload from the database. */
export function __resetKbCache(): void {
  cache = null;
}

async function loadKb(force = false): Promise<KbData | null> {
  if (cache && !force && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  const db = await getDb();
  const { rows: dRows } = await db.query<{ name: string; specialty: string; row_count: number }>(
    'SELECT name, specialty, row_count FROM kb_diseases'
  );
  if (dRows.length === 0) return null; // KB not imported yet
  const { rows: sRows } = await db.query<{ name: string; df: number }>('SELECT name, df FROM kb_symptoms');
  const { rows: eRows } = await db.query<{ disease: string; symptom: string; weight: number }>(
    `SELECT d.name AS disease, s.name AS symptom, w.weight
     FROM kb_disease_symptom w
     JOIN kb_diseases d ON d.id = w.disease_id
     JOIN kb_symptoms s ON s.id = w.symptom_id`
  );

  const data: KbData = {
    loadedAt: Date.now(),
    diseaseCount: dRows.length,
    diseases: new Map(dRows.map((d) => [d.name, { specialty: d.specialty, rowCount: d.row_count }])),
    edges: new Map(),
    byDisease: new Map(),
    symptoms: sRows.map((s) => s.name),
    df: new Map(sRows.map((s) => [s.name, s.df])),
  };
  for (const e of eRows) {
    data.edges.set(`${e.symptom}\x1f${e.disease}`, e.weight);
    let list = data.byDisease.get(e.disease);
    if (!list) {
      list = [];
      data.byDisease.set(e.disease, list);
    }
    list.push({ symptom: e.symptom, weight: e.weight });
  }
  cache = data;
  return data;
}

// ---------------------------------------------------------------------------
// Symptom extraction
// ---------------------------------------------------------------------------

/**
 * Normalize free text into comparable lowercase tokens. Apostrophes are
 * removed (not replaced by spaces) so "can't breathe" becomes "cant breathe"
 * and still matches the contraction-aware synonym patterns.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Everyday wording -> canonical dataset symptom. Values are matched with word
 * boundaries (star converts to a prefix match, e.g. "itchy*").
 */
const SYNONYMS: Array<[RegExp, string]> = [
  [/fever|temperature|running a temp/, 'fever'],
  [/sore throat|throat pain|throat hurts/, 'sore throat'],
  [/cough(ing)? up (phlegm|sputum|mucus)/, 'coughing up sputum'],
  [/\bcough(ing)?\b/, 'cough'],
  [/blocked nose|stuffy nose|blocked or stuffy nose|nose is blocked/, 'nasal congestion'],
  [/runny nose/, 'coryza'],
  [/sneez(e|ing)/, 'sneezing'],
  [/short(ness)? of breath|can('|no)?t breathe|breathless|hard to breathe|difficulty breathing/, 'shortness of breath'],
  [/wheez(e|ing)/, 'wheezing'],
  [/chest pain|chest hurts/, 'sharp chest pain'],
  [/chest (pressure|tightness)/, 'chest tightness'],
  [/burning chest/, 'burning chest pain'],
  [/heart ?burn|acid reflux|reflux|acidity/, 'heartburn'],
  [/palpitation|heart (is )?(racing|pounding|fluttering)/, 'palpitations'],
  [/irregular heartbeat|heart skipping/, 'irregular heartbeat'],
  [/dizzy|dizziness|lightheaded/, 'dizziness'],
  [/faint(ed|ing)?|passed out|black(ed)? out/, 'fainting'],
  [/head ?ache/, 'headache'],
  [/migraine/, 'frontal headache'],
  [/vertigo|room (is )?spinning/, 'vertigo'],
  [/stomach ?ache|stomach pain|tummy (ache|pain)/, 'upper abdominal pain'],
  [/belly pain|abdominal pain/, 'abdominal pain'],
  [/bloat(ed|ing)?/, 'stomach bloating'],
  [/gassy|gas pain|flatulence|passing gas/, 'flatulence'],
  [/heartburn after meals/, 'heartburn'],
  [/throw(ing)? up|threw up|puk(e|ing)|vomit(ing)?/, 'vomiting'],
  [/feel(ing)? sick|feel(ing)? like vomiting|nauseous|nausea/, 'nausea'],
  [/loose motions?|diarrhoea|diarrhea/, 'diarrhea'],
  [/constipat(ed|ion)/, 'constipation'],
  [/blood in (my )?stool/, 'blood in stool'],
  [/blood in (my )?urine/, 'blood in urine'],
  [/burn(ing)? when (i )?(pee|urinate)|burning urination|painful urination|it (burns|hurts) to pee/, 'painful urination'],
  [/pee(ing)? (a lot|often|frequently)|frequent urination|urinat(e|ing|ion) (a lot|often|frequently|so much)/, 'frequent urination'],
  [/urinat(e|ing|ion) (a lot|often|frequently|so much)? ?(at night|during the night)|wakes? up (at night )?to pee|getting up at night to pee/, 'excessive urination at night'],
  [/kidney stone/, 'kidney mass'],
  [/itch(y|ing)? skin|skin itch/, 'itching of skin'],
  [/\bitch(y|ing|es)\b/, 'itching of skin'],
  [/\brash(es)?\b/, 'skin rash'],
  [/scaly skin|flaky skin|peeling skin|dry scaly/, 'skin dryness, peeling, scaliness, or roughness'],
  [/red skin|skin (looks|is) red/, 'abnormal appearing skin'],
  [/\bacne\b|pimples|breakout/, 'acne or pimples'],
  [/hair (loss|fall|falling)/, 'hair loss'],
  [/dry skin/, 'skin dryness'],
  [/joint (pain|aches?)/, 'joint pain'],
  [/back ?ache|back pain|lower back pain/, 'back pain'],
  [/low back pain/, 'low back pain'],
  [/neck pain/, 'neck pain'],
  [/knee (pain|hurts)/, 'knee pain'],
  [/swollen (ankle|ankles|feet|foot)/, 'foot or toe swelling'],
  [/swollen legs|leg swelling/, 'leg swelling'],
  [/muscle (ache|pain|soreness)/, 'muscle pain'],
  [/muscle (stiff|cramp)/, 'muscle stiffness or tightness'],
  [/body (ache|aches|pain)/, 'ache all over'],
  [/fatigue|exhausted|weakness|no energy|tired all the time/, 'fatigue'],
  [/\bchills?\b/, 'chills'],
  [/night sweats|sweating (a lot|at night)/, 'sweating'],
  [/weight (gain|gaining)/, 'weight gain'],
  [/weight loss|losing weight(?! wanted)/, 'recent weight loss'],
  [/losing weight wanted|trying to lose weight/, 'recent weight loss'],
  [/\bthirst(y)?\b|always thirsty/, 'thirst'],
  [/blur(red)? vision|blurry eyesight/, 'diminished vision'],
  [/double vision/, 'double vision'],
  [/eye (pain|hurts)/, 'pain in eye'],
  [/red eye|eyes are red/, 'eye redness'],
  [/watery eyes|eyes watering|lacrimation/, 'lacrimation'],
  [/ear (ache|pain|hurts)/, 'ear pain'],
  [/ringing in (my )?ears?/, 'ringing in ear'],
  [/hearing (loss|is bad|getting worse)|can('|no)?t hear well/, 'diminished hearing'],
  [/tooth ?ache|tooth (pain|hurts)/, 'toothache'],
  [/bleed(ing)? gums|gums bleed/, 'bleeding gums'],
  [/swollen glands?|lumps? in (my )?neck/, 'swollen lymph nodes'],
  [/anxiety|anxious|panic(ed|king)?|on edge/, 'anxiety and nervousness'],
  [/\bdepress(ed|ion)\b|feeling low|feeling down/, 'depression'],
  [/insomnia|can('|no)?t sleep|not sleeping|trouble sleeping/, 'insomnia'],
  [/stress(ed)? out|too much stress/, 'anxiety and nervousness'],
  [/delusion|hallucinat/, 'delusions or hallucinations'],
  [/seizure|convulsion|fits\b/, 'seizures'],
  [/numb(ness)?|loss of feeling/, 'loss of sensation'],
  [/tingling|pins and needles|paresthesia/, 'paresthesia'],
  [/tremor|shaking hands|hands? shaking/, 'abnormal involuntary movements'],
  [/memory (loss|problems|getting worse)|forgetful(ness)?/, 'disturbance of memory'],
  [/slurred speech|words are slurred/, 'slurring words'],
  [/periods? (are|is) (painful|hurt)/, 'painful menstruation'],
  [/heavy periods?|menstrual bleeding heavy/, 'heavy menstrual flow'],
  [/missed period|no period/, 'absence of menstruation'],
  [/irregular periods?/, 'unpredictable menstruation'],
  [/hot flashes?/, 'hot flashes'],
  [/vaginal (itch|itching)/, 'vaginal itching'],
  [/vaginal discharge/, 'vaginal discharge'],
  [/pelvic pain/, 'pelvic pain'],
  [/morning sickness/, 'nausea'],
  [/baby|infant|newborn|my child|my kid|my son|my daughter|toddler/, 'symptoms of infants'],
  [/bedwet(ting)?|wets the bed/, 'bedwetting'],
  [/nose ?bleed|nose is bleeding/, 'nosebleed'],
  [/snor(e|ing)|stops breathing in sleep/, 'snoring'],
  [/snoring and gasping|sleep apnea/, 'apnea'],
  [/blood pressure (high|is high)|hypertension/, 'hypertension'],
  [/sugar (level|is high)|diabetes|blood sugar/, 'symptoms of the kidneys'],
  [/thyorid|thyroid/, 'symptoms of the kidneys'],
  [/blood in (my )?sputum|coughing blood/, 'hemoptysis'],
  [/difficulty swallowing|hard to swallow|swallowing problems/, 'difficulty in swallowing'],
  [/lump in (my )?throat|throat feels tight/, 'lump in throat'],
  [/hoarse voice|lost my voice|voice is hoarse/, 'hoarse voice'],
  [/mouth ulcer|canker sore/, 'mouth ulcer'],
  [/swelling of (the )?scrotum|swollen scrotum/, 'swelling of scrotum'],
  [/testicle pain|pain in testicle/, 'pain in testicles'],
  [/erection problems|erectile/, 'impotence'],
  [/loss of sex drive|low libido/, 'loss of sex drive'],
  [/fluid retention|retaining (water|fluid)/, 'fluid retention'],
  [/swollen abdomen|bloated belly|distended abdomen/, 'swollen abdomen'],
  [/yellow (eyes|skin)|jaundice/, 'jaundice'],
  [/pale|pallor|looking pale/, 'pallor'],
  [/easily bruise|bruising easily/, 'bruising'],
  [/allergic reaction|hives|urticaria/, 'allergic reaction'],
  [/feeling cold all the time|always cold/, 'feeling cold'],
  [/feeling hot|feverish|burning up/, 'feeling hot'],
  [/flu[- ]like/, 'flu-like syndrome'],
  [/loss of (appetite|hunger)|not eating enough/, 'decreased appetite'],
  [/always hungry/, 'excessive appetite'],
  [/sad|hopeless|worthless/, 'depression'],
  [/worry(ing)? too much|restless/, 'anxiety and nervousness'],
  [/mood swings|irritable/, 'emotional symptoms'],
  [/night ?mares/, 'nightmares'],
  [/dry mouth/, 'mouth dryness'],
  [/drooling/, 'infant spitting up'],
  [/rectal bleeding|bleeding from (the )?bottom/, 'rectal bleeding'],
  [/pain (during|when) (sex|intercourse)/, 'pain during intercourse'],
  [/itchy (ear|ears)/, 'itchy ear(s)'],
  [/ear (feels )?blocked|plugged ear/, 'plugged feeling in ear'],
  [/pus (in|from) (the )?ear/, 'pus draining from ear'],
  [/bleeding from (the )?ear/, 'bleeding from ear'],
  [/double jointed|hypermobile/, 'problems with movement'],
  [/speech problems|stutter/, 'stuttering or stammering'],
  [/bladder (leak|leaking)|urine leak/, 'involuntary urination'],
];

/** Multi-word canonical symptoms commonly phrased directly by users. */
const DIRECT_PHRASES = [
  'sore throat', 'shortness of breath', 'nasal congestion', 'sharp chest pain',
  'chest tightness', 'burning chest pain', 'sharp abdominal pain', 'upper abdominal pain',
  'lower abdominal pain', 'burning abdominal pain', 'difficulty breathing', 'difficulty in swallowing',
  'difficulty speaking', 'blood in stool', 'blood in urine', 'blood in sputum',
  'swollen lymph nodes', 'skin rash', 'skin swelling', 'skin lesion', 'skin moles',
  'acne or pimples', 'eye redness', 'pain in eye', 'diminished vision', 'double vision',
  'ear pain', 'ringing in ear', 'diminished hearing', 'toothache', 'bleeding gums',
  'muscle pain', 'joint pain', 'joint swelling', 'joint stiffness or tightness',
  'back pain', 'low back pain', 'neck pain', 'neck stiffness or tightness', 'knee pain',
  'leg swelling', 'foot or toe swelling', 'ankle swelling', 'swollen abdomen',
  'recent weight loss', 'weight gain', 'decreased appetite', 'painful urination',
  'frequent urination', 'excessive urination at night', 'involuntary urination',
  'vaginal discharge', 'vaginal itching', 'painful menstruation', 'heavy menstrual flow',
  'irregular menstruation', 'hot flashes', 'pelvic pain', 'loss of sensation',
  'abnormal involuntary movements', 'disturbance of memory', 'slurring words',
  'delusions or hallucinations', 'swelling of scrotum', 'pain in testicles',
  'fluid retention', 'flu-like syndrome', 'sore in nose', 'nosebleed', 'snoring',
  'feeling cold', 'feeling hot', 'heartburn', 'flatulence', 'stomach bloating',
  'swollen lymph nodes', 'dry mouth', 'mouth dryness', 'paresthesia', 'seizures',
  'fainting', 'dizziness', 'vertigo', 'headache', 'frontal headache', 'insomnia',
  'nightmares', 'fatigue', 'chills', 'sweating', 'pallor', 'jaundice', 'hemoptysis',
  'anxiety and nervousness', 'depression', 'emotional symptoms', 'bedwetting',
  'coughing up sputum', 'sneezing', 'coryza', 'wheezing', 'cough', 'fever', 'vomiting',
  'nausea', 'diarrhea', 'constipation', 'thirst', 'allergic reaction', 'impotence',
  'loss of sex drive', 'rectal bleeding', 'mouth ulcer', 'hoarse voice', 'lump in throat',
  'difficulty in swallowing', 'symptoms of infants', 'shortness of breath',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find canonical KB symptoms mentioned in free text.
 * Combines a curated synonym map with word-boundary matching of canonical
 * multi-word phrases. Returns unique canonical names (dataset vocabulary).
 */
export function extractSymptoms(text: string, kb: KbData): string[] {
  const norm = normalize(text);
  const found = new Set<string>();

  for (const [re, canonical] of SYNONYMS) {
    if (re.test(norm) && kb.symptoms.includes(canonical)) found.add(canonical);
  }

  // Word-boundary match of canonical phrases (longest first so "low back pain"
  // wins before "back pain").
  const vocab = [...kb.symptoms].filter((s) => s.includes(' ') || s.length >= 6).sort((a, b) => b.length - a.length);
  for (const phrase of vocab) {
    if (found.has(phrase)) continue;
    const re = new RegExp(`(^|\\s)${escapeRe(phrase)}(s|es)?($|\\s)`);
    if (re.test(norm)) found.add(phrase);
  }

  return [...found];
}

// ---------------------------------------------------------------------------
// Disease prediction (IDF-weighted association)
// ---------------------------------------------------------------------------

function idf(df: number, diseaseCount: number): number {
  return Math.log(1 + diseaseCount / Math.max(df, 1));
}

export interface DiseasePrediction {
  disease: string;
  specialty: string;
  score: number; // 0..1 association strength for display
  matched: string[]; // canonical symptoms that drove the match
}

/**
 * Rank diseases by the IDF-weighted average of symptom weights.
 * score = sum(idf(s) * w(d,s)) / sum(idf(s)) over matched symptoms.
 */
export function predictDiseases(
  matchedSymptoms: string[],
  kb: KbData,
  limit = 3,
  opts: { allowPediatric?: boolean } = {}
): DiseasePrediction[] {
  if (matchedSymptoms.length === 0) return [];
  const results: DiseasePrediction[] = [];
  const idfCache = new Map<string, number>(
    matchedSymptoms.map((s) => [s, idf(kb.df.get(s) ?? 0, kb.diseaseCount)])
  );

  for (const [disease] of kb.diseases) {
    let num = 0;
    let den = 0;
    const matched: string[] = [];
    for (const s of matchedSymptoms) {
      const idfS = idfCache.get(s)!;
      den += idfS;
      const w = kb.edges.get(`${s}\x1f${disease}`);
      if (w && w > 0) {
        num += idfS * w;
        matched.push(s);
      }
    }
    if (matched.length === 0 || den === 0) continue;
    results.push({
      disease,
      specialty: kb.diseases.get(disease)!.specialty,
      score: num / den,
      matched,
    });
  }

  // Childhood diseases are only meaningful when the message is about a child;
  // otherwise they hijack specialties for adult symptom reports.
  if (opts.allowPediatric === false) {
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].specialty === 'Pediatrician') results.splice(i, 1);
    }
  }

  // Require at least 2 distinct matched symptoms (or a single very specific
  // symptom, IDF >= log(1 + N/25)) to avoid overconfident single-symptom calls.
  const specificSingle = idf(25, kb.diseaseCount);
  return results
    .filter((r) => r.matched.length >= 2 || idfCache.get(r.matched[0])! >= specificSingle)
    .sort((a, b) => b.score - a.score || b.matched.length - a.matched.length)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Reply construction
// ---------------------------------------------------------------------------

const NOT_A_DIAGNOSIS =
  'These are statistical associations from medical data, not a diagnosis — please consult a doctor.';

function prettyList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Enrich the rule-engine fallback with KB predictions. Returns the fallback
 * unchanged when no symptoms are recognized (or the KB is empty).
 */
export async function buildKbReply(
  text: string,
  fallback: DocBotResult,
  kbOverride?: KbData | null,
  textModelOverride?: TextModel | null,
  triageOverride?: TriageData | null
): Promise<DocBotResult> {
  if (fallback.emergency) return fallback;
  const kb = kbOverride !== undefined ? kbOverride : await loadKb();
  const textModel = textModelOverride !== undefined ? textModelOverride : await loadTextModel();
  const textPreds: TextPrediction[] = textModel ? classify(text, textModel, 3) : [];
  const triage = triageOverride !== undefined ? triageOverride : await loadTriage();

  // ---- Red-flag escalation: scan for urgent phrases regardless of source.
  const redFlagHit = triage ? detectRedFlag(text) : null;

  // Canonical symptom extraction decides which evidence source leads.
  const matched = kb ? extractSymptoms(text, kb) : [];

  // ---- Text-only path: fires only when no canonical symptoms were recognized
  // but the language classifier is confident about the description (top-1
  // >= 0.45 with a clear margin). Trained on real patient wording, so unusual
  // phrasings still route instead of falling to generic guidance.
  if (matched.length === 0 && textModel && textPreds.length > 0) {
    const margin = textPreds[0].score - (textPreds[1]?.score ?? 0);
    const childRe = /\b(baby|infant|newborn|child|kid|son|daughter|toddler|little (one|boy|girl))\b/i;
    const isChild = childRe.test(text);
    let top = textPreds[0];
    if (isChild) {
      // A sick child always goes to a pediatrician regardless of classifier label.
      const pediatricPred = textPreds.find((p) => p.specialty === 'Pediatrician');
      if (pediatricPred) top = pediatricPred;
      else top = { label: top.label, specialty: 'Pediatrician', score: top.score };
    }
    if (top.score >= 0.45 && margin >= 0.08) {
      const article = /^[aeiou]/i.test(top.specialty) ? 'An' : 'A';
      // Red-flag phrase in a text-only message -> emergency-style reply.
      if (redFlagHit) {
        return {
          reply: `You mentioned something concerning (${redFlagHit}). You should seek medical care urgently — this may require same-day emergency evaluation. `,
          suggestedSpecialty: null,
          emergency: true,
          quickReplies: [],
          actionButtons: [
            { label: 'Call Emergency Services', action: 'call_emergency' },
            { label: 'Emergency Help', action: 'emergency_help' },
          ],
          followUp: {},
        };
      }
      return {
        reply:
          `Based on your description, conditions commonly associated with these symptoms include: ` +
          textPreds
            .map((p) => `${p.label} (${Math.round(p.score * 100)}% match)`)
            .join(', ') +
          `. These are statistical associations from medical data, not a diagnosis — please consult a doctor. ` +
          `${article} ${top.specialty} can evaluate this properly. Would you like to see available ${top.specialty} doctors?`,
        suggestedSpecialty: top.specialty,
        emergency: false,
        quickReplies: [`Show ${top.specialty} doctors`, 'Find nearby doctors'],
        actionButtons: [{ label: `Show ${top.specialty} Doctors`, action: 'show_specialty', payload: top.specialty }],
        followUp: { ...fallback.followUp, symptomsKnown: true, specialty: top.specialty } as FollowUpState,
      };
    }
  }

  // Red-flag escalation beats normal symptom-flow replies.
  if (redFlagHit) {
    return {
      reply: `You mentioned something concerning (${redFlagHit}). You should seek medical care urgently — this may require same-day emergency evaluation. `,
      suggestedSpecialty: null,
      emergency: true,
      quickReplies: [],
      actionButtons: [
        { label: 'Call Emergency Services', action: 'call_emergency' },
        { label: 'Emergency Help', action: 'emergency_help' },
      ],
      followUp: {},
    };
  }

  // ---- Triage layer (dataset 3): when the KB symptoms are sparse but the
  // curated condition list matches well, use it for specialty + urgency.
  let triageAssessment: TriageAssessment | null = null;
  if (triage) {
    triageAssessment = assessTriage(text, triage, matched.length);
  }

  if (!kb || matched.length === 0) {
    if (triageAssessment?.matched) {
      const t = triageAssessment;
      const article = /^[aeiou]/i.test(t.specialty!) ? 'An' : 'A';
      return {
        reply:
          `Based on your description, this resembles patterns of ${t.condition}. ` +
          `${t.urgencyNote} These are general guidelines, not a diagnosis — please consult a doctor. ` +
          `${article} ${t.specialty} can evaluate this properly. Would you like to see available ${t.specialty} doctors?`,
        suggestedSpecialty: t.specialty,
        emergency: false,
        quickReplies: [`Show ${t.specialty} doctors`, 'Find nearby doctors'],
        actionButtons: [{ label: `Show ${t.specialty} Doctors`, action: 'show_specialty', payload: t.specialty! }],
        followUp: { ...fallback.followUp, symptomsKnown: true, specialty: t.specialty } as FollowUpState,
      };
    }
    return fallback;
  }

  const childRe = /\b(baby|infant|newborn|child|kid|son|daughter|toddler|little (one|boy|girl)|my (boy|girl))\b/i;
  const predictions = predictDiseases(matched, kb, 3, { allowPediatric: childRe.test(text) });
  if (predictions.length === 0) {
    // No dataset-disease associations — let the curated triage list decide.
    if (triageAssessment?.matched) {
      const t = triageAssessment;
      const article = /^[aeiou]/i.test(t.specialty!) ? 'An' : 'A';
      return {
        reply:
          `Based on your description, this resembles patterns of ${t.condition}. ` +
          `${t.urgencyNote} These are general guidelines, not a diagnosis — please consult a doctor. ` +
          `${article} ${t.specialty} can evaluate this properly. Would you like to see available ${t.specialty} doctors?`,
        suggestedSpecialty: t.specialty,
        emergency: false,
        quickReplies: [`Show ${t.specialty} doctors`, 'Find nearby doctors'],
        actionButtons: [{ label: `Show ${t.specialty} Doctors`, action: 'show_specialty', payload: t.specialty! }],
        followUp: { ...fallback.followUp, symptomsKnown: true, specialty: t.specialty } as FollowUpState,
      };
    }
    return fallback;
  }

  // Specialty selection: the top-scored disease decides, unless several
  // near-tied diseases (within 2%) share one specialty — then majority wins.
  const maxScore = predictions[0].score;
  const tied = predictions.filter((p) => maxScore - p.score < 0.02);
  const tiedVotes = new Map<string, number>();
  for (const p of tied) tiedVotes.set(p.specialty, (tiedVotes.get(p.specialty) ?? 0) + 1);
  let specialty = predictions[0].specialty;
  let bestVotes = 0;
  for (const [sp, n] of tiedVotes) {
    if (n > bestVotes) {
      bestVotes = n;
      specialty = sp;
    }
  }
  // A sick child should always be evaluated by a pediatrician, regardless of
  // which dataset condition scored highest (e.g. "teething" for fever+vomiting).
  if (childRe.test(text)) specialty = 'Pediatrician';
  const lines: string[] = [];
  // Attach triage urgency guidance when a curated condition matches the same
  // area (specialty agreement), so the reply says how soon to seek care.
  if (triageAssessment?.matched && triageAssessment.specialty === specialty) {
    if (triageAssessment.urgencyNote && triageAssessment.urgency !== 'ROUTINE') {
      lines.push(triageAssessment.urgencyNote);
    }
  }

  lines.push(
    `I understand you are experiencing ${prettyList(matched.map((m) => m.replace(/_/g, ' ')))}.`
  );
  lines.push(
    `Based on medical data for similar symptom combinations, conditions commonly associated with these symptoms include: ${predictions
      .map((p) => `${p.disease.replace(/\b\w/g, (c) => c.toUpperCase())} (${Math.round(p.score * 100)}% match)`)
      .join(', ')}.`
  );
  lines.push(NOT_A_DIAGNOSIS);

  // Blend the language classifier: when it is confident and agrees, name its
  // condition; when it disagrees, mention it without overriding symptom evidence.
  if (textPreds.length > 0 && textPreds[0].score >= 0.35) {
    const tp = textPreds[0];
    if (tp.specialty === specialty) {
      lines.push(`Your description also matches patterns commonly seen in ${tp.label}.`);
    } else {
      lines.push(
        `Your description also resembles patterns seen in ${tp.label}; if that seems more relevant, a ${tp.specialty} can also help.`
      );
    }
  }

  const article = /^[aeiou]/i.test(specialty) ? 'An' : 'A';
  lines.push(`${article} ${specialty} can evaluate this properly. Would you like to see available ${specialty} doctors?`);

  return {
    reply: lines.join(' '),
    suggestedSpecialty: specialty,
    emergency: false,
    quickReplies: [`Show ${specialty} doctors`, 'Find nearby doctors'],
    actionButtons: [{ label: `Show ${specialty} Doctors`, action: 'show_specialty', payload: specialty }],
    followUp: { ...fallback.followUp, symptomsKnown: true, specialty } as FollowUpState,
  };
}
