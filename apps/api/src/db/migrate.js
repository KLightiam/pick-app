import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db, closeDb } from './pool.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../db/migrations');

const pool = db();
await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, ran_at timestamptz NOT NULL DEFAULT now())');
const { rows } = await pool.query('SELECT name FROM schema_migrations');
const done = new Set(rows.map((r) => r.name));

for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(file)) continue;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(await readFile(path.join(dir, file), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`applied ${file}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
await closeDb();
