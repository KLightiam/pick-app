const COLUMNS = 'id, phone, name, role, country, created_at AS "createdAt"';

// Postgres storage for users. Drivers also get a row in `drivers`, unapproved until reviewed.
export function pgUsersRepo(db) {
  return {
    async findByPhone(phone) {
      const { rows } = await db().query(`SELECT ${COLUMNS} FROM users WHERE phone = $1`, [phone]);
      return rows[0] ?? null;
    },
    async findById(id) {
      const { rows } = await db().query(`SELECT ${COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
      return rows[0] ?? null;
    },
    /**
     * Removes what identifies the person and returns the storage keys of their documents, for deleting the files.
     * Trips, payments, ratings and reports stay for Pick's records, without the name, number or comments.
     */
    async deleteAccount(id) {
      const client = await db().connect();
      try {
        await client.query('BEGIN');
        const { rows: [user] } = await client.query('SELECT phone FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
        if (!user) {
          await client.query('ROLLBACK');
          return null;
        }
        const { rows: docs } = await client.query(
          'DELETE FROM driver_documents WHERE driver_id = $1 RETURNING storage_key AS "storageKey"', [id],
        );
        await client.query('DELETE FROM payout_accounts WHERE driver_id = $1', [id]);
        await client.query('DELETE FROM push_tokens WHERE user_id = $1', [id]);
        await client.query('DELETE FROM otp_codes WHERE phone = $1', [user.phone]);
        await client.query('DELETE FROM trip_shares WHERE trip_id IN (SELECT id FROM trips WHERE rider_id = $1)', [id]);
        await client.query('UPDATE ratings SET comment = NULL WHERE from_user = $1', [id]);
        await client.query(
          `UPDATE drivers SET online = false, approved = false, vehicle_make = NULL, vehicle_plate = NULL, location = NULL,
                  location_at = NULL, mode = 'anywhere', destination = NULL, destination_address = NULL, route = NULL
            WHERE user_id = $1`,
          [id],
        );
        await client.query(
          `UPDATE users SET phone = 'deleted:' || id, name = NULL, deleted_at = now() WHERE id = $1`, [id],
        );
        await client.query('COMMIT');
        return { documentKeys: docs.map((d) => d.storageKey) };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async create({ phone, country, role, name }) {
      const client = await db().connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO users (phone, country, role, name) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
          [phone, country, role, name ?? null],
        );
        if (role === 'driver') {
          await client.query('INSERT INTO drivers (user_id) VALUES ($1)', [rows[0].id]);
        }
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
