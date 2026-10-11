// Approves a driver so they can go online, until the admin dashboard exists.
// Usage: pnpm --filter @pick/api approve-driver +233241234567
import { parseMarketPhone } from '@pick/shared';
import { db, closeDb } from '../db/pool.js';

const parsed = parseMarketPhone(process.argv[2]);
if (!parsed) {
  console.error('Usage: approve-driver <phone>, e.g. +233241234567');
  process.exit(1);
}
const { rowCount } = await db().query(
  `UPDATE drivers SET approved = true
    WHERE user_id = (SELECT id FROM users WHERE phone = $1 AND role = 'driver')`,
  [parsed.phone],
);
console.log(rowCount ? `Approved ${parsed.phone}` : `No driver account for ${parsed.phone}`);
await closeDb();
