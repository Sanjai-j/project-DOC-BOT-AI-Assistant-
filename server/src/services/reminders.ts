/**
 * Reminder scheduler for confirmed video consultations.
 * 30 min and 10 min before start, the doctor (and patient) get an in-app
 * notification; the client surfaces it as a browser notification + alarm sound.
 */
import { getDb } from '../db/index.js';
import { notify } from './notifications.js';
import { getSettings } from './settings.js';
import { toDateStr, formatTime12h } from './slots.js';

let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    const db = await getDb();
    const settings = await getSettings();
    const { rows } = await db.query(
      `SELECT a.id, a.date, a.start_time, a.end_time, a.patient_id, a.doctor_id,
              pu.full_name AS patient_name, du.full_name AS doctor_name,
              v.reminder_30_sent, v.reminder_10_sent
       FROM appointments a
       JOIN video_consultations v ON v.appointment_id = a.id
       JOIN users pu ON pu.id = a.patient_id
       JOIN users du ON du.id = a.doctor_id
       WHERE a.consultation_type = 'VIDEO' AND a.status = 'CONFIRMED'
         AND v.reminder_30_sent = false`
    );
    for (const r of rows) {
      const start = new Date(`${toDateStr(new Date(r.date))}T${String(r.start_time).slice(0, 5)}:00`);
      const minsToStart = (start.getTime() - Date.now()) / 60_000;

      if (minsToStart <= 0) {
        // window passed; avoid spamming forever
        await db.query(`UPDATE video_consultations SET reminder_30_sent = true, reminder_10_sent = true WHERE appointment_id = $1`, [r.id]);
        continue;
      }
      if (minsToStart <= 30 && settings.video_reminder_30 && !r.reminder_30_sent) {
        const when = formatTime12h(String(r.start_time).slice(0, 5));
        await notify({
          userId: r.doctor_id,
          title: `Video consultation at ${when}`,
          body: `Video consultation with ${r.patient_name} is scheduled at ${when}.`,
          type: 'warning',
          link: '/doctor/video',
        });
        await notify({
          userId: r.patient_id,
          title: `Video consultation at ${when}`,
          body: `Your video consultation with Dr. ${r.doctor_name} is scheduled at ${when}.`,
          type: 'warning',
          link: '/patient/video',
        });
        await db.query(`UPDATE video_consultations SET reminder_30_sent = true WHERE appointment_id = $1`, [r.id]);
      }
      if (minsToStart <= 10 && settings.video_reminder_10 && !r.reminder_10_sent) {
        await notify({
          userId: r.doctor_id,
          title: `Video consultation starts in 10 minutes`,
          body: `Call ${r.patient_name} at ${formatTime12h(String(r.start_time).slice(0, 5))}. Press Start Call when ready.`,
          type: 'warning',
          link: '/doctor/video',
        });
        await db.query(`UPDATE video_consultations SET reminder_10_sent = true WHERE appointment_id = $1`, [r.id]);
      }
    }
  } catch (e) {
    console.error('[reminders] tick failed:', (e as Error).message);
  }
}

export function startReminderScheduler(): void {
  if (timer) return;
  timer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
  console.log('[reminders] scheduler started (checks every minute)');
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
