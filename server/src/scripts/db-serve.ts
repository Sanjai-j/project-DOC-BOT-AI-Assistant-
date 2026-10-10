/**
 * Exposes the embedded Postgres (PGlite) over the real Postgres wire protocol
 * on localhost:5433 so GUI tools can browse the data:
 *
 *   cd server
 *   npm run db:serve
 *
 * Then connect from pgAdmin 4 / DBeaver / TablePlus / IntelliJ:
 *   Host 127.0.0.1  Port 5434  Database postgres  User postgres  Password: leave blank
 *   (Port 5434 to avoid clashing with a locally installed PostgreSQL, which
 *    typically uses 5432/5433.)
 *
 * While it runs, the tables (users, doctors, appointments, ...) can be opened
 * and queried visually. Ctrl+C stops it. Data is stored in
 * %TEMP%/docbot-telemed-data (the same files the app uses), so what you see
 * here is exactly what the app sees.
 *
 * Note: the dev server locks the data dir — stop `npm run dev` first if the
 * socket server fails to open the database.
 */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { config } from '../config.js';

const PG_PORT = Number(process.env.PG_SERVE_PORT || 5434);

async function main(): Promise<void> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const instance = new PGlite(`${config.dataDir}/pglite`);

  const server = new PGLiteSocketServer({
    db: instance,
    port: PG_PORT,
    host: '127.0.0.1',
  });
  await server.start();
  console.log(`[db:serve] Postgres wire server listening on 127.0.0.1:${PG_PORT}`);
  console.log('[db:serve] Connect with any Postgres GUI:');
  console.log('[db:serve]   Host 127.0.0.1   Port ' + PG_PORT + '   Database postgres   User postgres   Password: (blank)');
  console.log('[db:serve] Tables: users, doctors, hospitals, appointments, video_requests, ...');
  console.log('[db:serve] Press Ctrl+C to stop.');

  const shutdown = async () => {
    await server.stop().catch(() => {});
    await instance.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[db:serve] failed:', e.message);
  console.error('[db:serve] If the app dev server is running, stop it first (it locks the data dir).');
  process.exit(1);
});
