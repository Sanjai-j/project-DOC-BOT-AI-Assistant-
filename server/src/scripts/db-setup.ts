/**
 * Ensures the database is initialized and schema is applied.
 * With DATABASE_URL: runs schema.sql against the hosted DB.
 * With PGlite: creates a persistent data dir at server/data/pglite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStandaloneDb } from '../db/index.js';
import { config } from '../config.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');

export async function setupDb(): Promise<void> {
  const db = await createStandaloneDb();
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await db.query(sql);
  console.log(
    `[db:setup] Schema applied to ${config.databaseUrl ? 'hosted Postgres' : 'embedded PGlite (server/data/pglite)'}`
  );
  await db.close();
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  setupDb().catch((e) => {
    console.error('[db:setup] FAILED:', e);
    process.exit(1);
  });
}
