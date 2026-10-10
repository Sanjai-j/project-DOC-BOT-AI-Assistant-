import { getDb } from '../db/index.js';

export interface AppSettings {
  emergency_number: string;
  default_slot_minutes: number;
  video_reminder_30: boolean;
  video_reminder_10: boolean;
}

const DEFAULTS: AppSettings = {
  emergency_number: '112',
  default_slot_minutes: 30,
  video_reminder_30: true,
  video_reminder_10: true,
};

let cache: { data: AppSettings; loadedAt: number } | null = null;
const TTL = 15_000;

export async function getSettings(force = false): Promise<AppSettings> {
  if (!force && cache && Date.now() - cache.loadedAt < TTL) return cache.data;
  const db = await getDb();
  const { rows } = await db.query<{ key: string; value: string }>(
    'SELECT key, value FROM application_settings'
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const data: AppSettings = {
    emergency_number: map.emergency_number ?? DEFAULTS.emergency_number,
    default_slot_minutes: Number(map.default_slot_minutes ?? DEFAULTS.default_slot_minutes),
    video_reminder_30: (map.video_reminder_30 ?? 'true') === 'true',
    video_reminder_10: (map.video_reminder_10 ?? 'true') === 'true',
  };
  cache = { data, loadedAt: Date.now() };
  return data;
}

export async function setSetting(key: keyof AppSettings, value: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO application_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
  cache = null;
}
