// Gives a phone number an admin account for the dashboard. They sign in with
// the usual texted code. Usage: pnpm --filter @pick/api make-admin +233241234567 "Kingsley"
import { parseMarketPhone } from '@pick/shared';
import { db, closeDb } from '../db/pool.js';

const parsed = parseMarketPhone(process.argv[2]);
if (!parsed) {
  console.error('Usage: make-admin <phone> [name], e.g. make-admin +233241234567 "Ama Mensah"');
  process.exit(1);
}
const existing = await db().query('SELECT role FROM users WHERE phone = $1', [parsed.phone]);
if (existing.rows[0] && existing.rows[0].role !== 'admin') {
  console.error(`${parsed.phone} already has a ${existing.rows[0].role} account. Use another number for admin.`);
  await closeDb();
  process.exit(1);
}
await db().query(
  `INSERT INTO users (phone, country, role, name) VALUES ($1, $2, 'admin', $3)
   ON CONFLICT (phone) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name)`,
  [parsed.phone, parsed.country, process.argv[3] ?? null],
);
console.log(`${parsed.phone} is an admin`);
await closeDb();
