import { describe, it, expect } from 'vitest';
import { runRuleEngine, detectEmergency, matchSpecialty, DISCLAIMER } from '../docbot/rules.js';

describe('DocBot rule engine — specialty mapping', () => {
  it('maps sore throat + ear pain to ENT', () => {
    const r = runRuleEngine('I have a sore throat, blocked nose and ear pain');
    expect(r.suggestedSpecialty).toBe('ENT');
    expect(r.emergency).toBe(false);
    expect(r.actionButtons[0].label).toContain('ENT');
  });

  it('maps chest discomfort to Cardiologist', () => {
    const r = runRuleEngine('I feel chest discomfort when climbing stairs');
    expect(r.suggestedSpecialty).toBe('Cardiologist');
  });

  it('maps skin rash to Dermatologist', () => {
    expect(matchSpecialty('i have an itchy rash on my arm')).toBe('Dermatologist');
  });

  it('maps joint pain to Orthopedic', () => {
    expect(matchSpecialty('knee joint pain after a fall')).toBe('Orthopedic');
  });

  it("maps child's fever to Pediatrician", () => {
    expect(matchSpecialty('my baby has high temperature')).toBe('Pediatrician');
  });

  it('never claims to diagnose', () => {
    const r = runRuleEngine('sore throat and ear pain for a week');
    expect(r.reply).toMatch(/not a diagnosis|guidance/i);
  });

  it('asks for symptoms when input is empty small talk', () => {
    const r = runRuleEngine('hello');
    expect(r.suggestedSpecialty).toBeNull();
  });
});

describe('DocBot emergency detection', () => {
  it.each([
    'I have severe chest pain',
    'difficulty breathing since morning',
    'my father is unconscious',
    'there is severe bleeding and it will not stop',
    'sudden slurred speech and face drooping',
    'I want to kill myself',
  ])('flags "%s" as emergency', (msg) => {
    const r = runRuleEngine(msg);
    expect(r.emergency).toBe(true);
    expect(r.actionButtons.map((b) => b.action)).toContain('call_emergency');
    expect(r.reply).toMatch(/immediate medical attention/i);
  });

  it('detects emergencies directly', () => {
    expect(detectEmergency('anaphylaxis after peanuts')).toBe('severe allergic reaction');
    expect(detectEmergency('I have a runny nose')).toBeNull();
  });
});

describe('DocBot safety', () => {
  it('includes the disclaimer text constant', () => {
    expect(DISCLAIMER).toMatch(/not a medical diagnosis/i);
  });
});
