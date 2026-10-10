/**
 * DocBot rule engine — maps symptoms to a suggested specialty, asks follow-ups,
 * and detects emergency phrases. All output is guidance, never a diagnosis.
 */

export interface DocBotResult {
  reply: string;
  suggestedSpecialty: string | null;
  emergency: boolean;
  quickReplies: string[];
  actionButtons: { label: string; action: string; payload?: string }[];
  followUp: FollowUpState;
}

export const DISCLAIMER =
  'DocBot provides general guidance only and is not a medical diagnosis. Always consult a qualified doctor.';

export const EMERGENCY_DISCLAIMER =
  'DocBot TeleMed is NOT an emergency medical service. If this is a life-threatening emergency, contact your local emergency services immediately.';

/** Emergency keyword groups; any strong match triggers the emergency card. */
const EMERGENCY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /chest pain|chest pressure|chest tightness|crushing.*(chest|pain)/i, label: 'chest pain' },
  { re: /can('|)t breathe|difficulty breathing|shortness of breath|breathless|struggling to breathe/i, label: 'difficulty breathing' },
  { re: /unconscious|passed out|fainted|not waking|no pulse|cardiac arrest/i, label: 'unconsciousness' },
  { re: /severe bleeding|bleeding heavily|blood loss|hemorrhag|won't stop bleeding|bleeding won't stop/i, label: 'severe bleeding' },
  { re: /stroke|face droop|slurred speech|sudden weakness (one side|of (the )?body)|numb (one side|on one side)/i, label: 'stroke symptoms' },
  { re: /anaphyla|severe allergic|throat swelling|throat closing/i, label: 'severe allergic reaction' },
  { re: /suicid|kill myself|end my life|self[- ]harm|hurt myself/i, label: 'self-harm crisis' },
  { re: /seizure|convulsion/i, label: 'seizure' },
];

export function detectEmergency(text: string): string | null {
  for (const { re, label } of EMERGENCY_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}

/**
 * Symptom → specialty knowledge base.
 * keyword sets are matched against the lowercased message.
 */
export const SPECIALTY_RULES: {
  specialty: string;
  keywords: string[][];
  followUp?: string;
}[] = [
  {
    specialty: 'ENT',
    keywords: [
      ['sore throat', 'throat pain', 'throat'],
      ['ear pain', 'ear ache', 'earache', 'ear'],
      ['blocked nose', 'stuffy nose', 'runny nose', 'nasal', 'nose'],
      ['hearing', 'deaf'],
      ['sinus', 'tonsil'],
    ],
  },
  {
    specialty: 'Cardiologist',
    keywords: [
      ['chest discomfort', 'heart', 'palpitation', 'cardiac', 'chest flutter'],
      ['high blood pressure', 'bp', 'cholesterol'],
      ['swollen ankles'],
    ],
  },
  {
    specialty: 'Dermatologist',
    keywords: [
      ['rash', 'skin', 'acne', 'pimple', 'itching', 'eczema', 'psoriasis', 'hives', 'mole'],
      ['hair loss', 'hair fall', 'bald'],
    ],
  },
  {
    specialty: 'Orthopedic',
    keywords: [
      ['joint pain', 'knee', 'elbow', 'shoulder pain', 'back pain', 'spine', 'neck pain'],
      ['fracture', 'broken bone', 'sprain', 'bone injury', 'twisted'],
    ],
  },
  {
    specialty: 'Pediatrician',
    keywords: [
      ['child', 'kid', 'baby', 'infant', 'toddler', 'son', 'daughter', 'newborn'],
      ['child fever', 'kid fever'],
    ],
  },
  {
    specialty: 'General Physician',
    keywords: [
      ['fever', 'temperature', 'flu', 'cold', 'cough', 'headache', 'body ache', 'fatigue', 'tired', 'vomiting', 'nausea', 'diarrhea', 'diarrhoea'],
    ],
  },
  {
    specialty: 'Neurologist',
    keywords: [
      ['migraine', 'severe headache', 'numbness', 'tingling', 'dizzy', 'vertigo', 'memory loss', 'tremor', 'blackout'],
    ],
  },
  {
    specialty: 'Psychiatrist',
    keywords: [
      ['depress', 'anxiety', 'panic attack', 'stress', 'sleep problem', 'insomnia', 'mental health'],
    ],
  },
  {
    specialty: 'Gynecologist',
    keywords: [['period', 'menstrual', 'pregnan', 'gynec', 'vaginal', 'pcod', 'pcos']],
  },
  {
    specialty: 'Ophthalmologist',
    keywords: [['eye pain', 'blurred vision', 'vision', 'red eye', 'eyesight']],
  },
  {
    specialty: 'Dentist',
    keywords: [['tooth', 'teeth', 'gum', 'dental', 'toothache', 'molar']],
  },
  {
    specialty: 'Pulmonologist',
    keywords: [['asthma', 'wheez', 'chronic cough', 'copd', 'smoker']],
  },
  {
    specialty: 'Gastroenterologist',
    keywords: [['stomach pain', 'abdominal pain', 'acidity', 'acid reflux', 'heartburn', 'constipation', 'gas', 'bloating', 'liver', 'jaundice']],
  },
  {
    specialty: 'Urologist',
    keywords: [['urine', 'urinary', 'burning urination', 'kidney stone', 'bladder', 'prostate']],
  },
  {
    specialty: 'Endocrinologist',
    keywords: [['diabetes', 'thyroid', 'sugar level', 'hormone', 'weight gain', 'weight loss']],
  },
];

export const SYMPTOM_QUESTION =
  'What symptoms are you experiencing? You can describe them in your own words (e.g. "sore throat, blocked nose and ear pain").';
export const DURATION_QUESTION =
  'How long have you had these symptoms (hours, days, weeks)?';
export const SEVERITY_QUESTION =
  'How severe are they — mild, moderate, or severe?';
export const LOCATION_QUESTION =
  'Where are you located (city or area)? I will look for doctors nearby.';

const RULES_LIST = SPECIALTY_RULES;

/** Count how many keyword groups of a rule match the text. */
function scoreRule(text: string, rule: (typeof RULES_LIST)[number]): number {
  let score = 0;
  for (const group of rule.keywords) {
    if (group.some((k) => text.includes(k))) score += 1;
  }
  return score;
}

export function matchSpecialty(text: string): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const rule of RULES_LIST) {
    const s = scoreRule(text.toLowerCase(), rule);
    if (s > bestScore) {
      bestScore = s;
      best = rule.specialty;
    }
  }
  return best;
}

export interface FollowUpState {
  symptomsKnown?: boolean;
  durationAsked?: boolean;
  severityAsked?: boolean;
  locationAsked?: boolean;
  specialty?: string | null;
}

export function runRuleEngine(rawText: string, state: FollowUpState = {}): DocBotResult {
  const text = rawText.toLowerCase();

  // 1) Emergency first — never continue the normal flow.
  const emergencyLabel = detectEmergency(rawText);
  if (emergencyLabel) {
    return {
      reply:
        `Your symptoms may require immediate medical attention (possible ${emergencyLabel}). ` +
        EMERGENCY_DISCLAIMER,
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

  // 2) Explicit specialty request ("show me dermatologists") — word-boundary
  // match so "frequently" never triggers ENT and "heart" never triggers ENT's 'ear'.
  for (const rule of RULES_LIST) {
    const base = rule.specialty.toLowerCase();
    const baseRe = new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (baseRe.test(text) || (base === 'ent' && /\bent\b/i.test(rawText))) {
      return {
        reply: `Here are our approved ${rule.specialty} doctors you can book with right now.`,
        suggestedSpecialty: rule.specialty,
        emergency: false,
        quickReplies: ['Find nearby doctors', 'Search hospitals'],
        actionButtons: [{ label: `Show ${rule.specialty} Doctors`, action: 'show_specialty', payload: rule.specialty }],
        followUp: { ...state, specialty: rule.specialty },
      };
    }
  }

  // 3) Greetings / help
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/i.test(rawText) || text.includes('help')) {
    return {
      reply:
        'Hello! I am DocBot, your medical guidance assistant. ' + SYMPTOM_QUESTION,
      suggestedSpecialty: null,
      emergency: false,
      quickReplies: ['I have a sore throat', 'I have chest discomfort', 'My child has a fever'],
      actionButtons: [],
      followUp: { symptomsKnown: false },
    };
  }

  // 4) Symptom matching
  const specialty = matchSpecialty(text);
  if (specialty) {
    const noLocation = !/\b(near|nearby|in |around|city|area|located)\b/i.test(rawText);
    const needsLocation = state.locationAsked !== true && noLocation && state.symptomsKnown === true;
    if (needsLocation) {
      return {
        reply: `Based on your symptoms, a ${specialty} specialist may be appropriate. ${LOCATION_QUESTION}`,
        suggestedSpecialty: specialty,
        emergency: false,
        quickReplies: [`Show ${specialty} doctors`, 'Find nearby doctors'],
        actionButtons: [{ label: `Show ${specialty} Doctors`, action: 'show_specialty', payload: specialty }],
        followUp: { ...state, symptomsKnown: true, specialty },
      };
    }
    return {
      reply:
        `Based on the symptoms you described, a ${specialty} specialist may be appropriate. ` +
        `These symptoms can have several causes, so this is guidance, not a diagnosis. Would you like to see available ${specialty} doctors near you?`,
      suggestedSpecialty: specialty,
      emergency: false,
      quickReplies: ['Find nearby doctors', 'Search hospitals'],
      actionButtons: [{ label: `Show ${specialty} Doctors`, action: 'show_specialty', payload: specialty }],
      followUp: { ...state, symptomsKnown: true, specialty },
    };
  }

  // 5) No match — ask follow-ups
  return {
    reply: SYMPTOM_QUESTION,
    suggestedSpecialty: null,
    emergency: false,
    quickReplies: ['I have a fever and cough', 'I have a skin rash', 'I need a dentist'],
    actionButtons: [],
    followUp: { symptomsKnown: false },
  };
}
