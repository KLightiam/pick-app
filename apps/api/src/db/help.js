// Plain-language help for the database errors people hit when setting Pick up.

// Errors that mean "not up yet": nothing listening, or Postgres still starting.
const NOT_READY = new Set(['ECONNREFUSED', 'ECONNRESET', '57P03']);

/** Retries a first query until the database answers, e.g. right after `docker compose up`. */
export async function waitForDb(pool, { timeoutMs = 30_000, intervalMs = 1000, log = console.log } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (!NOT_READY.has(err.code) || Date.now() + intervalMs > deadline) throw err;
      if (attempt === 0) log('Waiting for the database to start…');
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/** What went wrong and what to do, for a database error, or null if there's nothing more helpful to say. */
export function explainDbError(err, databaseUrl) {
  let where = 'the database';
  try {
    const u = new URL(databaseUrl);
    where = `the database at ${u.hostname}:${u.port || 5432}`;
  } catch { /* keep the generic wording */ }

  const Where = where[0].toUpperCase() + where.slice(1);

  if (NOT_READY.has(err.code)) {
    return `Can't reach ${where}. Make sure Docker Desktop is running, then start the database with \`pnpm db:up\` and try again.`;
  }
  if (err.code === 'ENOTFOUND') return `Can't find ${where}. Check DATABASE_URL in apps/api/.env.`;
  if (err.code === '28P01' || err.code === '28000') {
    return `${Where} turned down the username or password. That usually means another PostgreSQL on this computer is answering instead of Pick's Docker database, which runs on port 5433. Make sure DATABASE_URL in apps/api/.env is postgres://pick:pick@localhost:5433/pick, and that \`pnpm db:up\` has started the database.`;
  }
  if (err.code === '3D000') return `${Where} has no database with that name. Check DATABASE_URL in apps/api/.env.`;
  if (/postgis/i.test(err.message ?? '')) {
    return `${Where} doesn't have PostGIS, which Pick needs for maps. Use the Docker database (\`pnpm db:up\`), or install PostGIS.`;
  }
  return null;
}
