import { getDb } from '../db/index.js';

export interface Slot {
  start: string; // HH:MM (24h)
  end: string;
  status: 'available' | 'booked' | 'break' | 'past';
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface DaySlots {
  date: string; // YYYY-MM-DD
  weekday: string;
  slots: Slot[];
}

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Patient-facing time format like "10:00 AM" */
export function formatTime12h(t: string): string {
  const [hStr, mStr] = t.split(':');
  let h = Number(hStr);
  const m = mStr ?? '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.padStart(2, '0')} ${ampm}`;
}

export function dateToWeekday(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDay();
}

/**
 * Generate bookable slots for a doctor on a date.
 * Excludes: inactive availability, unavailable dates, breaks, past times, booked slots.
 */
export async function getDoctorSlotsForDate(
  doctorId: string,
  dateStr: string
): Promise<DaySlots> {
  const db = await getDb();
  const weekday = dateToWeekday(dateStr);

  const availRes = await db.query(
    `SELECT start_time, end_time, slot_minutes, break_start, break_end
     FROM doctor_availability
     WHERE doctor_id = $1 AND weekday = $2 AND is_active = true
     ORDER BY start_time`,
    [doctorId, weekday]
  );

  const dayName = WEEKDAYS[weekday];
  if (availRes.rows.length === 0) {
    return { date: dateStr, weekday: dayName, slots: [] };
  }

  // Leave / unavailable dates
  const off = await db.query('SELECT 1 FROM doctor_unavailable_dates WHERE doctor_id = $1 AND date = $2', [
    doctorId,
    dateStr,
  ]);
  if (off.rowCount && off.rowCount > 0) {
    return { date: dateStr, weekday: dayName, slots: [] };
  }

  // Booked/pending slots for that date
  const bookedRes = await db.query(
    `SELECT start_time FROM appointments
     WHERE doctor_id = $1 AND date = $2 AND status IN ('PENDING','CONFIRMED','COMPLETED')`,
    [doctorId, dateStr]
  );
  const bookedStarts = new Set(bookedRes.rows.map((r) => String(r.start_time).slice(0, 5)));

  const slots: Slot[] = [];
  for (const row of availRes.rows) {
    const startM = parseTimeToMinutes(String(row.start_time).slice(0, 5));
    const endM = parseTimeToMinutes(String(row.end_time).slice(0, 5));
    const dur = row.slot_minutes ?? 30;
    const breakStart = row.break_start ? parseTimeToMinutes(String(row.break_start).slice(0, 5)) : null;
    const breakEnd = row.break_end ? parseTimeToMinutes(String(row.break_end).slice(0, 5)) : null;

    for (let t = startM; t + dur <= endM; t += dur) {
      const s = minutesToTime(t);
      const e = minutesToTime(t + dur);
      let status: Slot['status'] = 'available';
      if (breakStart !== null && breakEnd !== null && t >= breakStart && t < breakEnd) status = 'break';
      else if (bookedStarts.has(s)) status = 'booked';
      else if (isPast(dateStr, s)) status = 'past';
      slots.push({ start: s, end: e, status });
    }
  }
  slots.sort((a, b) => parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start));
  return { date: dateStr, weekday: dayName, slots };
}

function isPast(dateStr: string, timeStr: string): boolean {
  const now = new Date();
  const d = new Date(dateStr + 'T00:00:00');
  if (d.toDateString() !== now.toDateString()) return d < now;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m <= now.getHours() * 60 + now.getMinutes();
}

/** Next 7 days as YYYY-MM-DD (for the slot picker) */
export function nextNDates(n = 7): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(toDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Does the doctor have at least one open slot on the given date?
 * Used by the "Available this week" filter (hospitals map filter reuses it too).
 */
export async function doctorHasOpenSlotOn(doctorId: string, dateStr: string): Promise<boolean> {
  const { slots } = await getDoctorSlotsForDate(doctorId, dateStr);
  return slots.some((s) => s.status === 'available');
}
