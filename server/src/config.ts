/**
 * Minimal .env loader (works from both tsx and compiled dist).
 * Precedence: process.env > server/.env > root/.env
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(file: string): void {
  const p = path.resolve(here, file);
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile('../../.env');
loadEnvFile('../.env');

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}
function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  env: str('NODE_ENV', 'development'),
  port: num('PORT', 4000),
  corsOrigins: str('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwtSecret: str('JWT_SECRET', 'dev-only-secret-change-me'),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '12h'),
  otpExpiryMinutes: num('OTP_EXPIRY_MINUTES', 10),

  adminEmail: str('ADMIN_EMAIL', 'admin@docbot.dev'),
  adminPassword: str('ADMIN_PASSWORD', 'ChangeMe!123'),

  databaseUrl: str('DATABASE_URL', ''),

  aiProvider: str('AI_PROVIDER', 'openai'),
  aiApiKey: str('AI_API_KEY', ''),
  aiModel: str('AI_MODEL', 'gpt-4o-mini'),
  aiBaseUrl: str('AI_BASE_URL', 'https://api.openai.com/v1'),

  googleMapsApiKey: str('GOOGLE_MAPS_API_KEY', ''),

  defaultEmergencyNumber: str('DEFAULT_EMERGENCY_NUMBER', '112'),

  uploadsDir: path.resolve(here, '../uploads'),
  // PGlite's shared-memory files break under OneDrive/Dropbox sync, so default
  // to a local temp dir. Override with DATA_DIR if you want it in the project.
  dataDir: process.env.DATA_DIR || path.join(os.tmpdir(), 'docbot-telemed-data'),
} as const;

export type AppConfig = typeof config;
