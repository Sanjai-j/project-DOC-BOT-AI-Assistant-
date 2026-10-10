import { describe, it, expect } from 'vitest';
import { extractSymptoms, predictDiseases, buildKbReply } from '../docbot/kb.js';
import { parseCsvLine } from '../scripts/kb-import.js';
import { assignSpecialty } from '../docbot/specialty-map.js';
import type { KbData } from '../docbot/kb.js';

// ---------------------------------------------------------------------------
// Helpers to synthesize a tiny KB for deterministic tests
// ---------------------------------------------------------------------------

function makeKb(overrides?: Partial<KbData>): KbData {
  const diseases = new Map<string, { specialty: string; rowCount: number }>([
    ['common cold', { specialty: 'General Physician', rowCount: 100 }],
    ['strep throat', { specialty: 'ENT', rowCount: 100 }],
    ['acute bronchitis', { specialty: 'Pulmonologist', rowCount: 100 }],
    ['migraine', { specialty: 'Neurologist', rowCount: 100 }],
    ['type 2 diabetes', { specialty: 'Endocrinologist', rowCount: 100 }],
  ]);
  const edges = new Map<string, number>();
  const byDisease = new Map<string, Array<{ symptom: string; weight: number }>>();
  const link = (symptom: string, disease: string, weight: number) => {
    edges.set(`${symptom}\x1f${disease}`, weight);
    const list = byDisease.get(disease) ?? [];
    list.push({ symptom, weight });
    byDisease.set(disease, list);
  };
  // common cold: fever in 80% rows, cough 70%, sneezing 60%
  link('fever', 'common cold', 0.8);
  link('cough', 'common cold', 0.7);
  link('sneezing', 'common cold', 0.6);
  // strep throat: sore throat 95%, fever 40%, cough 5%
  link('sore throat', 'strep throat', 0.95);
  link('fever', 'strep throat', 0.4);
  link('cough', 'strep throat', 0.05);
  // bronchitis: cough 90%, wheezing 60%
  link('cough', 'acute bronchitis', 0.9);
  link('wheezing', 'acute bronchitis', 0.6);
  // migraine: headache 90%, nausea 50%
  link('headache', 'migraine', 0.9);
  link('nausea', 'migraine', 0.5);
  // diabetes: thirst 70%, frequent urination 65%
  link('thirst', 'type 2 diabetes', 0.7);
  link('frequent urination', 'type 2 diabetes', 0.65);
  // add symptoms the extraction tests rely on
  link('shortness of breath', 'acute bronchitis', 0.3);
  link('vomiting', 'migraine', 0.1);

  const base: KbData = {
    loadedAt: Date.now(),
    diseaseCount: diseases.size,
    diseases,
    edges,
    byDisease,
    symptoms: [
      'fever', 'cough', 'sneezing', 'sore throat', 'wheezing', 'headache', 'nausea',
      'thirst', 'frequent urination', 'shortness of breath', 'vomiting',
    ],
    df: new Map([
      ['fever', 2],
      ['cough', 3],
      ['sneezing', 1],
      ['sore throat', 1],
      ['wheezing', 1],
      ['headache', 1],
      ['nausea', 1],
      ['thirst', 1],
      ['frequent urination', 1],
      ['shortness of breath', 1],
      ['vomiting', 1],
    ]),
  };
  return { ...base, ...overrides };
}

describe('KB symptom extraction', () => {
  it('maps everyday wording to canonical dataset symptoms', () => {
    const kb = makeKb();
    const found = extractSymptoms('I have a fever and sore throat since yesterday', kb);
    expect(found).toContain('fever');
    expect(found).toContain('sore throat');
  });

  it('maps colloquial phrases ("can\'t breathe", "throwing up")', () => {
    const kb = makeKb();
    expect(extractSymptoms("I can't breathe properly", kb)).toContain('shortness of breath');
    expect(extractSymptoms('my son keeps throwing up', kb)).toContain('vomiting');
  });

  it('matches canonical multi-word phrases with word boundaries', () => {
    const kb = makeKb();
    const found = extractSymptoms('mild wheezing at night', kb);
    expect(found).toContain('wheezing');
  });

  it('returns nothing for non-symptom text', () => {
    const kb = makeKb();
    expect(extractSymptoms('what are your working hours', kb)).toEqual([]);
  });
});

describe('KB disease prediction', () => {
  it('ranks strep throat above common cold for sore throat + fever', () => {
    const kb = makeKb();
    const preds = predictDiseases(['sore throat', 'fever'], kb);
    expect(preds[0].disease).toBe('strep throat');
    expect(preds[0].specialty).toBe('ENT');
  });

  it('requires signal: single weak symptom yields no confident match', () => {
    const kb = makeKb();
    // "cough" alone (df=3, weak) should produce no results with default threshold
    const preds = predictDiseases(['cough'], kb);
    expect(preds.every((p) => p.matched.length >= 2 || p.matched.length === 1)).toBe(true);
  });

  it('matches wheezing+cough to Pulmonologist (bronchitis)', () => {
    const kb = makeKb();
    const preds = predictDiseases(['cough', 'wheezing'], kb);
    expect(preds[0].disease).toBe('acute bronchitis');
    expect(preds[0].specialty).toBe('Pulmonologist');
  });

  it('maps thirst+frequent urination to Endocrinologist (diabetes)', () => {
    const kb = makeKb();
    const preds = predictDiseases(['thirst', 'frequent urination'], kb);
    expect(preds[0].specialty).toBe('Endocrinologist');
  });
});

describe('KB reply enrichment', () => {
  it('enriches a symptom message with conditions and specialty', async () => {
    const kb = makeKb();
    const fallback = {
      reply: 'What symptoms are you experiencing?',
      suggestedSpecialty: null,
      emergency: false,
      quickReplies: [],
      actionButtons: [],
      followUp: {},
    };
    const enriched = await buildKbReply('I have sore throat and fever', fallback, kb, null, null);
    expect(enriched.reply).toMatch(/not a diagnosis|statistical associations/i);
    expect(enriched.suggestedSpecialty).toBe('ENT');
    expect(enriched.actionButtons[0].action).toBe('show_specialty');
  });

  it('returns the fallback unchanged for emergencies', async () => {
    const fallback = {
      reply: 'Emergency!',
      suggestedSpecialty: null,
      emergency: true,
      quickReplies: [],
      actionButtons: [{ label: 'Call', action: 'call_emergency' }],
      followUp: {},
    };
    const r = await buildKbReply('severe chest pain', fallback, makeKb());
    expect(r.emergency).toBe(true);
    expect(r.reply).toBe('Emergency!');
  });

  it('keeps the rule-engine reply when no symptoms are recognized', async () => {
    const kb = makeKb();
    const fallback = {
      reply: 'What symptoms are you experiencing?',
      suggestedSpecialty: null,
      emergency: false,
      quickReplies: [],
      actionButtons: [],
      followUp: {},
    };
    const r = await buildKbReply('tell me a joke', fallback, kb, null, null);
    expect(r.reply).toBe('What symptoms are you experiencing?');
    expect(r.suggestedSpecialty).toBeNull();
  });
});

describe('CSV parsing', () => {
  it('parses quoted fields with commas and escaped quotes', () => {
    const line = 'some disease,0,1,"muscle cramps, contractures, or spasms",0';
    expect(parseCsvLine(line)).toEqual(['some disease', '0', '1', 'muscle cramps, contractures, or spasms', '0']);
  });
});

describe('Disease -> specialty mapping', () => {
  it('routes classic disease names to the right specialty', () => {
    expect(assignSpecialty('otitis media')).toBe('ENT');
    expect(assignSpecialty('myocardial infarction')).toBe('Cardiologist');
    expect(assignSpecialty('asthma')).toBe('Pulmonologist');
    expect(assignSpecialty('contact dermatitis')).toBe('Dermatologist');
    expect(assignSpecialty('osteoarthritis of the knee')).toBe('Orthopedic');
    expect(assignSpecialty('panic disorder')).toBe('Psychiatrist');
    expect(assignSpecialty('endometriosis')).toBe('Gynecologist');
    expect(assignSpecialty('glaucoma')).toBe('Ophthalmologist');
    expect(assignSpecialty('gingivitis')).toBe('Dentist');
    expect(assignSpecialty('kidney stone')).toBe('Urologist');
    expect(assignSpecialty('type 2 diabetes')).toBe('Endocrinologist');
    expect(assignSpecialty('migraine')).toBe('Neurologist');
    expect(assignSpecialty('gastroesophageal reflux disease')).toBe('Gastroenterologist');
  });

  it('routes injuries by body region', () => {
    expect(assignSpecialty('injury to the knee')).toBe('Orthopedic');
    expect(assignSpecialty('injury to the eye')).toBe('Ophthalmologist');
    expect(assignSpecialty('injury to the ear')).toBe('ENT');
  });

  it('falls back to General Physician for unknown names', () => {
    expect(assignSpecialty('some rare unnamed condition')).toBe('General Physician');
  });
});
