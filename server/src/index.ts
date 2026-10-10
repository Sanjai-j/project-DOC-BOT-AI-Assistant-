/**
 * DocBot TeleMed — API server entry.
 */
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb } from './db/index.js';
import authRoutes from './routes/auth.js';
import doctorRoutes from './routes/doctors.js';
import appointmentRoutes from './routes/appointments.js';
import videoRoutes from './routes/video.js';
import hospitalRoutes from './routes/hospitals.js';
import chatRoutes from './routes/chat.js';
import notificationRoutes from './routes/notifications.js';
import emergencyRoutes from './routes/emergency.js';
import adminRoutes from './routes/admin.js';
import { errorHandler, notFoundHandler, apiLimiter, onMulterError } from './middleware/common.js';
import { startReminderScheduler } from './services/reminders.js';
import { attachSignaling } from './realtime/socket.js';
import { getSettings } from './services/settings.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    const db = await getDb();
    await db.query('SELECT 1');
    const settings = await getSettings();
    res.json({ ok: true, db: db.kind, emergencyNumber: settings.emergency_number, time: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// Public profile photos uploaded at registration (photos only, NOT ID documents)
app.use(
  '/api/photos',
  express.static(config.uploadsDir, {
    setHeaders: (res, filePath) => {
      if (!/\.(jpe?g|png|webp)$/i.test(filePath)) res.status(403);
    },
  })
);

app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', notFoundHandler);

// Production single-service mode: if the client has been built, serve it
// straight from Express (with an SPA fallback). Keeps deploys to one service
// and avoids CORS entirely. No-op in dev, where Vite serves the client.
const clientDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../client/dist'
);
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`[boot] serving client build from ${clientDist}`);
}

app.use(onMulterError);
app.use(errorHandler);

async function main(): Promise<void> {
  const db = await getDb();
  const schema = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'db', 'schema.sql'), 'utf8');
  await db.query(schema);
  console.log('[boot] schema ensured');

  const server = http.createServer(app);
  attachSignaling(server);
  server.listen(config.port, () => {
    console.log(`[server] DocBot TeleMed API listening on http://localhost:${config.port}`);
  });
  startReminderScheduler();
}

main().catch((e) => {
  console.error('[boot] fatal:', e);
  process.exit(1);
});
