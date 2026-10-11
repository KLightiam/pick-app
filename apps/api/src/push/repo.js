// Postgres storage for the phones each user gets push notifications on.
export function pgPushTokensRepo(db) {
  return {
    /** Saves the phone's token for this user. A token signed in by someone else moves to them. */
    async save({ userId, token, platform }) {
      await db().query(
        `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET user_id = $2, platform = $3, updated_at = now()`,
        [token, userId, platform],
      );
    },

    async listForUser(userId) {
      const { rows } = await db().query('SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
      return rows.map((r) => r.token);
    },

    /** Forgets a token: on sign-out (userId given), or when Expo says the app was uninstalled. */
    async remove(token, userId) {
      await db().query('DELETE FROM push_tokens WHERE token = $1 AND ($2::uuid IS NULL OR user_id = $2)', [token, userId ?? null]);
    },
  };
}
