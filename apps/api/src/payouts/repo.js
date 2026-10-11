const ACCOUNT = `driver_id AS "driverId", provider, method, account_name AS "accountName",
  account_number AS "accountNumber", network, provider_ref AS "providerRef", ready, updated_at AS "updatedAt"`;
const PAYOUT = `id, driver_id AS "driverId", amount, currency, provider, provider_ref AS "providerRef", status,
  failure_reason AS "failureReason", requested_by AS "requestedBy", created_at AS "createdAt", completed_at AS "completedAt"`;

// Postgres storage for where drivers are paid, and every payout sent.
export function pgPayoutsRepo(db) {
  return {
    async findAccount(driverId) {
      const { rows } = await db().query(`SELECT ${ACCOUNT} FROM payout_accounts WHERE driver_id = $1`, [driverId]);
      return rows[0] ?? null;
    },

    /** Adds or replaces the driver's payout account. */
    async saveAccount(a) {
      const { rows } = await db().query(
        `INSERT INTO payout_accounts (driver_id, provider, method, account_name, account_number, network, provider_ref, ready)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (driver_id) DO UPDATE
           SET provider = $2, method = $3, account_name = $4, account_number = $5, network = $6,
               provider_ref = $7, ready = $8, updated_at = now()
         RETURNING ${ACCOUNT}`,
        [a.driverId, a.provider, a.method, a.accountName ?? null, a.accountNumber ?? null, a.network ?? null, a.providerRef, a.ready],
      );
      return rows[0];
    },

    async setAccountReady(driverId, ready) {
      const { rows } = await db().query(
        `UPDATE payout_accounts SET ready = $2, updated_at = now() WHERE driver_id = $1 RETURNING ${ACCOUNT}`,
        [driverId, ready],
      );
      return rows[0] ?? null;
    },

    /** Starts a payout. Returns null if one to this driver is already on its way. */
    async createPayout({ driverId, amount, currency, provider, requestedBy, at }) {
      const { rows } = await db().query(
        `INSERT INTO payouts (driver_id, amount, currency, provider, requested_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (driver_id) WHERE status = 'pending' DO NOTHING
         RETURNING ${PAYOUT}`,
        [driverId, amount, currency, provider, requestedBy ?? null, at],
      );
      return rows[0] ?? null;
    },

    async findPayout(id) {
      const { rows } = await db().query(`SELECT ${PAYOUT} FROM payouts WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    /** Records the provider's reference and, unless it's still pending, the outcome. Only moves a pending payout. */
    async updatePayout(id, { status, providerRef, reason, at }) {
      const { rows } = await db().query(
        `UPDATE payouts
            SET status = $2, provider_ref = COALESCE($3, provider_ref), failure_reason = $4,
                completed_at = CASE WHEN $2 = 'pending' THEN NULL ELSE $5::timestamptz END
          WHERE id = $1 AND status = 'pending'
          RETURNING ${PAYOUT}`,
        [id, status, providerRef ?? null, reason ?? null, at],
      );
      return rows[0] ?? null;
    },

    async listForDriver(driverId, { limit = 20 } = {}) {
      const { rows } = await db().query(
        `SELECT ${PAYOUT} FROM payouts WHERE driver_id = $1 ORDER BY created_at DESC LIMIT $2`, [driverId, limit],
      );
      return rows;
    },

    /** For the admin dashboard, newest first. */
    async list({ country, status, limit = 50 } = {}) {
      const { rows } = await db().query(
        `SELECT p.id, p.driver_id AS "driverId", u.name AS "driverName", u.phone AS "driverPhone", p.amount, p.currency,
                p.provider, p.status, p.failure_reason AS "failureReason", a.name AS "requestedBy",
                p.created_at AS "createdAt", p.completed_at AS "completedAt"
           FROM payouts p JOIN users u ON u.id = p.driver_id LEFT JOIN users a ON a.id = p.requested_by
          WHERE ($1::text IS NULL OR u.country = $1) AND ($2::text IS NULL OR p.status = $2)
          ORDER BY p.created_at DESC LIMIT $3`,
        [country ?? null, status ?? null, limit],
      );
      return rows;
    },

    /** Drivers with a ready account, money owed and no payout on its way, with when they were last paid. */
    async candidates() {
      const { rows } = await db().query(
        `SELECT a.driver_id AS "driverId", u.country, b.balance, b.currency,
                (SELECT max(created_at) FROM payouts WHERE driver_id = a.driver_id) AS "lastPayoutAt"
           FROM payout_accounts a
           JOIN users u ON u.id = a.driver_id
           JOIN drivers d ON d.user_id = a.driver_id
           JOIN driver_balances b ON b.driver_id = a.driver_id
          WHERE a.ready AND d.approved AND b.balance > 0
            AND NOT EXISTS (SELECT 1 FROM payouts WHERE driver_id = a.driver_id AND status = 'pending')`,
      );
      return rows;
    },

    /** Payouts still pending since before `before`: Pick never heard how they went. */
    async listStale(before) {
      const { rows } = await db().query(
        `SELECT ${PAYOUT} FROM payouts WHERE status = 'pending' AND created_at < $1 ORDER BY created_at`, [before],
      );
      return rows;
    },
  };
}
