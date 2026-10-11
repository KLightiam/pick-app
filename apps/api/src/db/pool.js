import pg from 'pg';
import { config } from '../config.js';

let pool;

// Created on first use so the app can start (and be tested) without a database.
export function db() {
  pool ??= new pg.Pool({ connectionString: config.databaseUrl });
  return pool;
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
}
