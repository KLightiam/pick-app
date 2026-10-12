import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from '../config.js';
import { db, closeDb } from './pool.js';
import { explainDbError, waitForDb } from './help.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../db/migrations');

async function migrate(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, ran_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));

  let applied = 0;
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
      applied++;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  if (!applied) console.log('The database is up to date');
}

const pool = db();
try {
  await waitForDb(pool); // right after `pnpm db:up`, Postgres takes a few seconds to start
  await migrate(pool);
} catch (err) {
  const help = explainDbError(err, config.databaseUrl);
  console.error(help ? `\n${help}\n\n(${err.message})\n` : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
