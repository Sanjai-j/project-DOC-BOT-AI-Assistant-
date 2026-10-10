/**
 * DB adapter: hosted Postgres (Supabase/RDS) via node-postgres,
 * with a zero-setup embedded Postgres (PGlite) fallback for local dev.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';

/** Minimal result shape shared by both drivers. */
export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

/** Subset of a pg client used inside transactions. */
export interface PoolClient {
  query(text: string, params?: any[]): Promise<any>;
  release(): void;
}

export interface DB {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  readonly kind: 'pglite' | 'pg';
  close(): Promise<void>;
}

let db: DB | null = null;

function makePg(url: string): DB {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const impl: DB = {
    kind: 'pg',
    async query<T = any>(text: string, params?: any[]) {
      return (await pool.query(text, params)) as unknown as QueryResult<T>;
    },
    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
      const client = (await pool.connect()) as unknown as PoolClient;
      try {
        await client.query('BEGIN');
        const res = await fn(client);
        await client.query('COMMIT');
        return res;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return impl;
}

async function makePglite(): Promise<DB> {
  const { PGlite } = await import('@electric-sql/pglite');
  fs.mkdirSync(config.dataDir, { recursive: true });
  const dataDir = path.join(config.dataDir, 'pglite');
  const instance = new PGlite(dataDir);
  await instance.waitReady;

  const impl: DB = {
    kind: 'pglite',
    async query<T = any>(text: string, params?: any[]) {
      if (!params || params.length === 0) {
        // exec() supports multi-statement SQL (schema scripts) on the simple protocol
        const res = await (instance as any).exec(text);
        const last = Array.isArray(res) ? res[res.length - 1] : res;
        return (last ?? { rows: [], rowCount: 0 }) as QueryResult<T>;
      }
      const res = await (instance.query as any)(text, params);
      return res as QueryResult<T>;
    },
    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
      const client = {
        query: (t: string, p?: any[]) => (instance.query as any)(t, p),
        release: () => {},
      };
      await client.query('BEGIN');
      try {
        const res = await fn(client as unknown as PoolClient);
        await client.query('COMMIT');
        return res;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    },
    close: () => instance.close(),
  };
  return impl;
}

export async function getDb(): Promise<DB> {
  if (db) return db;
  if (config.databaseUrl) {
    try {
      db = makePg(config.databaseUrl);
      await db.query('SELECT 1');
      console.log('[db] Using Postgres via DATABASE_URL');
      return db;
    } catch (err) {
      db = null;
      console.error('[db] DATABASE_URL connection failed, falling back to PGlite:', (err as Error).message);
    }
  }
  db = await makePglite();
  console.log('[db] Using embedded Postgres (PGlite) at', path.join(config.dataDir, 'pglite'));
  return db;
}

/** For scripts (seed) that need a fresh handle without the shared pool. */
export async function createStandaloneDb(): Promise<DB> {
  if (config.databaseUrl) return makePg(config.databaseUrl);
  return makePglite();
}
