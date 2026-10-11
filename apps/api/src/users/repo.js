const COLUMNS = 'id, phone, name, role, country, created_at AS "createdAt"';

// Postgres storage for users. Drivers also get a row in `drivers`, unapproved until reviewed.
export function pgUsersRepo(db) {
  return {
    async findByPhone(phone) {
      const { rows } = await db().query(`SELECT ${COLUMNS} FROM users WHERE phone = $1`, [phone]);
      return rows[0] ?? null;
    },
    async findById(id) {
      const { rows } = await db().query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
      return rows[0] ?? null;
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
