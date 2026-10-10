import { describe, it, expect } from 'vitest';
import { resolveSpecialty, classifyUrgency, matchConditions, detectRedFlag, assessTriage } from '../docbot/triage.js';
import type { TriageData } from '../docbot/triage.js';

function makeData(): TriageData {
  return {
    loadedAt: Date.now(),
    rows: [
      {
        code: 'MED_001',
        condition: 'Common cold',
        symptoms: ['runny nose', 'sneezing', 'sore throat', 'mild cough', 'nasal congestion'],
        specialty: 'General Medicine',
        triage_level: 'routine',
        red_flags: ['difficulty breathing', 'blue lips', 'severe dehydration', 'confusion'],
      },
      {
        code: 'MED_052',
        condition: 'Heart attack',
        symptoms: ['pressure or squeezing chest pain', 'sweating', 'nausea', 'shortness of breath'],
        specialty: 'Emergency Medicine / Cardiology',
        triage_level: 'emergency',
        red_flags: ['persistent or severe chest pressure', 'fainting'],
      },
      {
        code: 'MED_022',
        condition: 'Type 2 diabetes',
        symptoms: ['increased thirst', 'frequent urination', 'fatigue', 'blurred vision'],
        specialty: 'Endocrinology / General Medicine',
        triage_level: 'prompt_evaluation',
        red_flags: ['confusion', 'severe dehydration'],
      },
      {
        code: 'MED_044',
        condition: 'Depression',
        symptoms: ['persistent low mood', 'loss of interest', 'sleep changes', 'low energy'],
        specialty: 'Mental Health Professional',
        triage_level: 'prompt_support',
        red_flags: ['thoughts of self-harm'],
      },
    ],
  };
}

describe('raw specialty resolution', () => {
  it('picks the first bookable specialty from "A / B" strings', () => {
    expect(resolveSpecialty('General Medicine / ENT')).toBe('General Physician');
    expect(resolveSpecialty('ENT')).toBe('ENT');
    expect(resolveSpecialty('Endocrinology / General Medicine')).toBe('Endocrinologist');
    expect(resolveSpecialty('Mental Health Professional')).toBe('Psychiatrist');
    expect(resolveSpecialty('Emergency Medicine / Cardiology')).toBe('General Physician');
    expect(resolveSpecialty('Rheumatology')).toBe('Orthopedic');
    expect(resolveSpecialty('Sleep Medicine / Pulmonology')).toBe('Pulmonologist');
  });
});

describe('urgency classification', () => {
  it('maps triage levels to urgency buckets', () => {
    expect(classifyUrgency('emergency')).toBe('EMERGENCY_NOW');
    expect(classifyUrgency('urgent')).toBe('SAME_DAY');
    expect(classifyUrgency('same_day')).toBe('SAME_DAY');
    expect(classifyUrgency('routine')).toBe('ROUTINE');
    expect(classifyUrgency('prompt_evaluation')).toBe('ROUTINE');
  });
});

describe('condition matching', () => {
  const data = makeData();

  it('ranks diabetes highest for thirst + urination + fatigue', () => {
    const m = matchConditions('I have increased thirst and frequent urination and fatigue', data);
    expect(m[0].row.condition).toBe('Type 2 diabetes');
    expect(m[0].hits).toBeGreaterThanOrEqual(2);
  });

  it('returns no matches for unrelated text', () => {
    expect(matchConditions('what are your opening hours', data)).toHaveLength(0);
  });
});

describe('red-flag detection', () => {
  it('detects built-in clinical red-flag patterns', () => {
    expect(detectRedFlag('I had the sudden worst-ever headache of my life')).toBe('sudden worst-ever headache');
    expect(detectRedFlag('there is vomiting blood since morning')).toBe('vomiting blood');
    expect(detectRedFlag('my stool is black and tarry')).toBeTruthy();
    expect(detectRedFlag('my belly is rigid and hard')).toBeTruthy();
    expect(detectRedFlag('I have a non-blanching rash')).toBe('non-blanching rash');
    expect(detectRedFlag('I fainted at work yesterday')).toBeTruthy();
  });

  it('ignores ordinary text', () => {
    expect(detectRedFlag('I have a runny nose and sneezing')).toBeNull();
    expect(detectRedFlag('mild headache since morning')).toBeNull();
  });
});

describe('assessTriage', () => {
  const data = makeData();

  it('matches with 2+ hits even when the KB found symptoms', () => {
    const a = assessTriage('I have increased thirst and frequent urination and fatigue', data, 3);
    expect(a.matched).toBe(true);
    expect(a.condition).toBe('Type 2 diabetes');
    expect(a.specialty).toBe('Endocrinologist');
  });

  it('allows single-hit matches only when the KB found nothing', () => {
    const a = assessTriage('I have persistent low mood and nothing else to report', data, 0);
    expect(a.matched).toBe(true);
    expect(a.specialty).toBe('Psychiatrist');
  });

  it('defers to the KB when hits are sparse', () => {
    const a = assessTriage('I have a mild headache and fatigue', data, 2);
    expect(a.matched).toBe(false);
  });
});
