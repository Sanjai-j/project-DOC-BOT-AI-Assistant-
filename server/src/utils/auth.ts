import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';

export type Role = 'patient' | 'doctor' | 'admin';

export interface JwtPayload {
  sub: string; // user id
  role: Role;
  name: string;
  doctorCode?: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: JwtPayload): string {
  const opts: SignOptions = { expiresIn: config.jwtExpiresIn } as SignOptions;
  return jwt.sign(payload, config.jwtSecret, opts);
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    return null;
  }
}

/** 6-digit OTP */
export function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function otpExpiryDate(): Date {
  return new Date(Date.now() + config.otpExpiryMinutes * 60_000);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** E.164-ish normalization: keeps digits and leading + */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim().replace(/[\s\-()]/g, '');
  return trimmed.startsWith('+') ? '+' + trimmed.slice(1).replace(/\D/g, '') : trimmed.replace(/\D/g, '');
}

export function isStrongEnoughPassword(pw: string): boolean {
  return typeof pw === 'string' && pw.length >= 8;
}
