/**
 * Optional LLM adapter for DocBot.
 * Works with any OpenAI-compatible API (OpenAI, Groq, OpenRouter, Together, Ollama...).
 * Without AI_API_KEY the caller falls back to the deterministic rule engine.
 */
import { config } from '../config.js';
import type { DocBotResult } from './rules.js';
import { DISCLAIMER, EMERGENCY_DISCLAIMER, detectEmergency } from './rules.js';

const SYSTEM_PROMPT = `
You are DocBot, the AI assistant of the DocBot TeleMed telemedicine web application.
Your ONLY job is:
1. Understand the patient's symptoms from their description.
2. Suggest ONE appropriate medical SPECIALTY (never a disease or diagnosis).
3. Encourage the patient to book a doctor via the app.

HARD RULES (violations are rejected):
- NEVER diagnose, name diseases as conclusions, or prescribe medication.
- NEVER give treatment instructions beyond general self-care advice like rest and hydration.
- Use wording like "These symptoms can have several causes. A <specialty> may be appropriate for further evaluation."
- If symptoms may be urgent (chest pain, difficulty breathing, unconsciousness, severe bleeding,
  stroke symptoms, severe allergic reaction, suicidal thoughts, seizures) you MUST set "emergency": true
  and reply that immediate medical attention may be needed. Do NOT continue normal triage.
- Always remind that you are not a replacement for a qualified doctor.

Respond ONLY with a JSON object matching:
{
  "reply": string,
  "suggestedSpecialty": string | null,   // one of: General Physician, ENT, Cardiologist, Dermatologist,
                                          // Neurologist, Orthopedic, Pediatrician, Gynecologist, Ophthalmologist,
                                          // Psychiatrist, Dentist, Pulmonologist, Gastroenterologist, Urologist, Endocrinologist
  "emergency": boolean,
  "quickReplies": string[]               // up to 3 short suggested user replies
}
`;

export function llmAvailable(): boolean {
  return Boolean(config.aiApiKey);
}

export async function askLLM(
  history: { role: 'user' | 'assistant'; content: string }[],
  fallback: DocBotResult
): Promise<DocBotResult> {
  if (!llmAvailable()) return fallback;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`${config.aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.aiApiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel,
        temperature: 0.2,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'system',
            content: `Safety reminders: ${DISCLAIMER} Emergency protocol: ${EMERGENCY_DISCLAIMER}`,
          },
          ...history.slice(-12),
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');

    const parsed = JSON.parse(content) as Partial<DocBotResult>;
    const text = typeof parsed.reply === 'string' ? parsed.reply : fallback.reply;

    // Emergency detection ALWAYS runs locally — the LLM can never hide an emergency.
    const localEmergency = detectEmergency(history.at(-1)?.content ?? '');
    const emergency = Boolean(parsed.emergency) || localEmergency;

    const specialty =
      typeof parsed.suggestedSpecialty === 'string' && parsed.suggestedSpecialty.trim().length > 0
        ? parsed.suggestedSpecialty
        : fallback.suggestedSpecialty;

    return {
      reply: emergency ? `${text} ${EMERGENCY_DISCLAIMER}` : `${text}\n\n${DISCLAIMER}`,
      suggestedSpecialty: emergency ? null : specialty,
      emergency: emergency === true,
      quickReplies: Array.isArray(parsed.quickReplies) ? parsed.quickReplies.slice(0, 3) : fallback.quickReplies,
      actionButtons: emergency
        ? [
            { label: 'Call Emergency Services', action: 'call_emergency' },
            { label: 'Emergency Help', action: 'emergency_help' },
          ]
        : specialty
          ? [{ label: `Show ${specialty} Doctors`, action: 'show_specialty', payload: specialty }]
          : [],
      followUp: {},
    };
  } catch (e) {
    console.error('[docbot llm] failed, using rule engine instead:', (e as Error).message);
    return fallback;
  }
}
