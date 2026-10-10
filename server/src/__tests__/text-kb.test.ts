import { describe, it, expect } from 'vitest';
import { tokenize, classify, labelToSpecialty } from '../docbot/text-kb.js';
import type { TextModel } from '../docbot/text-kb.js';
import { buildKbReply, type KbData } from '../docbot/kb.js';

/** Minimal in-memory NB model for deterministic tests. */
function makeModel(): TextModel {
  const cls = (label: string, specialty: string, words: string[]) => {
    const vocab = new Map<string, number>();
    for (const w of words) vocab.set(w, (vocab.get(w) ?? 0) + 1);
    return { label, specialty, docCount: 1, totalTokens: words.length, vocab };
  };
  return {
    loadedAt: Date.now(),
    classes: [
      cls('Common Cold', 'General Physician', ['sneeze', 'runny', 'nose', 'cough', 'chill', 'tired']),
      cls('Pneumonia', 'Pulmonologist', ['cough', 'chest', 'breath', 'fever', 'rust', 'phlegm', 'heart']),
      cls('Psoriasis', 'Dermatologist', ['rash', 'skin', 'scaly', 'peel', 'silver', 'nail', 'itch']),
      cls('Impetigo', 'Dermatologist', ['sore', 'nose', 'yellow', 'ooze', 'crust', 'fever']),
      cls('Migraine', 'Neurologist', ['headache', 'nausea', 'light', 'sensitivity', 'vomit']),
      cls('urinary tract infection', 'Urologist', ['urine', 'burn', 'pee', 'pelvis', 'frequent']),
      cls('Hypertension', 'Cardiologist', ['headache', 'dizzy', 'blood', 'pressure', 'nosebleed']),
    ],
    totalDocs: 7,
    vocabSize: 40,
  };
}

describe('tokenizer', () => {
  it('strips stopwords, short tokens, and light-stems words', () => {
    const toks = tokenize("I've been experiencing a severe headache and vomiting for the past few days");
    expect(toks).not.toContain('the');
    expect(toks).not.toContain('for');
    expect(toks).toContain('headache');
    expect(toks).toContain('severe');
    expect(toks).toContain('vomit');
  });
});

describe('NB classifier (in-memory model)', () => {
  const model = makeModel();

  it('classifies a pneumonia-style description', () => {
    const preds = classify(
      'I have a high fever, trouble breathing, chest hurts and coughing up rust colored phlegm',
      model
    );
    expect(preds[0].label).toBe('Pneumonia');
    expect(preds[0].specialty).toBe('Pulmonologist');
  });

  it('classifies a UTI-style description', () => {
    const preds = classify('burning when I pee and going very frequently', model);
    expect(preds[0].label).toBe('urinary tract infection');
    expect(preds[0].specialty).toBe('Urologist');
  });

  it('classifies a psoriasis-style description', () => {
    const preds = classify('red scaly patches on my skin that peel and itch', model);
    expect(preds[0].label).toBe('Psoriasis');
    expect(preds[0].specialty).toBe('Dermatologist');
  });

  it('migraine beats hypertension for light-sensitivity wording', () => {
    const preds = classify('intense headache with nausea and light sensitivity', model);
    expect(preds[0].label).toBe('Migraine');
    expect(preds[0].specialty).toBe('Neurologist');
  });
});

describe('label -> specialty mapping', () => {
  it('maps dataset labels to bookable specialties', () => {
    expect(labelToSpecialty('Dimorphic Hemorrhoids')).toBe('Gastroenterologist');
    expect(labelToSpecialty('urinary tract infection')).toBe('Urologist');
    expect(labelToSpecialty('Common Cold')).toBe('General Physician');
    expect(labelToSpecialty('Bronchial Asthma')).toBe('Pulmonologist');
  });
});

describe('blended reply pipeline', () => {
  const kb: KbData = {
    loadedAt: Date.now(),
    diseaseCount: 5,
    diseases: new Map([
      ['common cold', { specialty: 'General Physician', rowCount: 100 }],
      ['pneumonia', { specialty: 'Pulmonologist', rowCount: 100 }],
      ['migraine', { specialty: 'Neurologist', rowCount: 100 }],
      ['type 2 diabetes', { specialty: 'Endocrinologist', rowCount: 100 }],
      ['strep throat', { specialty: 'ENT', rowCount: 100 }],
    ]),
    edges: new Map([
      ['fever\x1fcommon cold', 0.8],
      ['cough\x1fcommon cold', 0.7],
      ['fever\x1fpneumonia', 0.9],
      ['cough\x1fpneumonia', 0.85],
      ['shortness of breath\x1fpneumonia', 0.7],
      ['headache\x1fmigraine', 0.9],
      ['nausea\x1fmigraine', 0.5],
      ['thirst\x1ftype 2 diabetes', 0.7],
      ['frequent urination\x1ftype 2 diabetes', 0.65],
    ]),
    byDisease: new Map(),
    symptoms: ['fever', 'cough', 'shortness of breath', 'headache', 'nausea', 'thirst', 'frequent urination'],
    df: new Map([
      ['fever', 2],
      ['cough', 2],
      ['shortness of breath', 1],
      ['headache', 1],
      ['nausea', 1],
      ['thirst', 1],
      ['frequent urination', 1],
    ]),
  };

  const fallback = {
    reply: 'What symptoms are you experiencing?',
    suggestedSpecialty: null,
    emergency: false,
    quickReplies: [],
    actionButtons: [],
    followUp: {},
  };

  it('text-only path fires for confident descriptions with no canonical symptoms', async () => {
    const r = await buildKbReply(
      'there are blisters around my nose with yellow crust oozing fluid and it burns',
      fallback,
      kb,
      makeModel(),
      null
    );
    expect(r.suggestedSpecialty).toBe('Dermatologist');
    expect(r.reply).toMatch(/Impetigo/i);
  });

  it('symptom path still wins when canonical symptoms match strongly', async () => {
    const r = await buildKbReply('I have fever and cough with shortness of breath', fallback, kb, makeModel(), null);
    expect(r.suggestedSpecialty).toBe('Pulmonologist');
  });

  it('returns fallback when neither path fires', async () => {
    const r = await buildKbReply('what are your opening hours', fallback, kb, makeModel(), null);
    expect(r.reply).toBe('What symptoms are you experiencing?');
    expect(r.suggestedSpecialty).toBeNull();
  });

  it('emergencies bypass everything', async () => {
    const emergencyFallback = { ...fallback, reply: 'Emergency!', emergency: true };
    const r = await buildKbReply('severe chest pain', emergencyFallback, kb, makeModel(), null);
    expect(r.emergency).toBe(true);
    expect(r.reply).toBe('Emergency!');
  });
});
