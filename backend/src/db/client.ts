import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Handle = { db: DB; close: () => Promise<void> };

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * postgres://… → node-postgres pool (dev, staging, prod).
 * "pglite" → an in-process Postgres (tests, quick demos) — same SQL, nothing to install.
 */
export async function openDb(url: string, { migrate = false } = {}): Promise<Handle> {
  if (url === 'pglite' || url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const dir = url.startsWith('pglite:') ? url.slice('pglite:'.length) : undefined;
    const client = new PGlite(dir);
    const db = drizzle(client, { schema });
    if (migrate) {
      const { migrate: run } = await import('drizzle-orm/pglite/migrator');
      await run(db, { migrationsFolder: MIGRATIONS });
    }
    return { db: db as unknown as DB, close: () => client.close() };
  }
  const { Pool } = (await import('pg')).default;
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  if (migrate) {
    const { migrate: run } = await import('drizzle-orm/node-postgres/migrator');
    await run(db, { migrationsFolder: MIGRATIONS });
  }
  return { db: db as unknown as DB, close: () => pool.end() };
}
