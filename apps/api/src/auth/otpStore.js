// Postgres storage for one-time sign-in codes.
export function pgOtpStore(db) {
  return {
    async countSince(phone, since) {
      const { rows } = await db().query(
        'SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at > $2',
        [phone, since],
      );
      return rows[0].n;
    },
    async create({ phone, codeHash, expiresAt }) {
      await db().query(
        'INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, $3)',
        [phone, codeHash, expiresAt],
      );
    },
    async latestActive(phone, at) {
      const { rows } = await db().query(
        `SELECT id, code_hash AS "codeHash", attempts FROM otp_codes
          WHERE phone = $1 AND used_at IS NULL AND expires_at > $2
          ORDER BY created_at DESC LIMIT 1`,
        [phone, at],
      );
      return rows[0] ?? null;
    },
    async addAttempt(id) {
      await db().query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [id]);
    },
    async markUsed(id, at) {
      await db().query('UPDATE otp_codes SET used_at = $2 WHERE id = $1', [id, at]);
    },
  };
}
