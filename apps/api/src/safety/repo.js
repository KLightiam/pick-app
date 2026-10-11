const REPORT = `r.id, r.trip_id AS "tripId", r.reporter_id AS "reporterId", r.about_user_id AS "aboutUserId", r.category,
  r.details, r.status, r.resolution_note AS "resolutionNote", r.resolved_at AS "resolvedAt", r.created_at AS "createdAt"`;

// Postgres storage for ratings, shared trip links and problem reports.
export function pgSafetyRepo(db) {
  return {
    /** Saves a rating. Returns null if this person already rated this trip. */
    async addRating({ tripId, fromUser, toUser, stars, comment }) {
      const { rows } = await db().query(
        `INSERT INTO ratings (trip_id, from_user, to_user, stars, comment) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (trip_id, from_user) DO NOTHING
         RETURNING id, trip_id AS "tripId", stars, comment, created_at AS "createdAt"`,
        [tripId, fromUser, toUser, stars, comment ?? null],
      );
      return rows[0] ?? null;
    },

    async findRating(tripId, fromUser) {
      const { rows } = await db().query(
        'SELECT stars, comment, created_at AS "createdAt" FROM ratings WHERE trip_id = $1 AND from_user = $2', [tripId, fromUser],
      );
      return rows[0] ?? null;
    },

    /** { average, count } for this person, or null before their first rating. */
    async ratingFor(userId) {
      const { rows } = await db().query(
        `SELECT round(avg(stars), 1)::float AS average, count(*)::int AS count FROM ratings WHERE to_user = $1`, [userId],
      );
      return rows[0].count ? rows[0] : null;
    },

    async addShare({ token, tripId }) {
      await db().query('INSERT INTO trip_shares (token, trip_id) VALUES ($1, $2)', [token, tripId]);
    },

    async tripForShare(token) {
      const { rows } = await db().query('SELECT trip_id AS "tripId" FROM trip_shares WHERE token = $1', [token]);
      return rows[0]?.tripId ?? null;
    },

    async addReport({ tripId, reporterId, aboutUserId, category, details }) {
      const { rows } = await db().query(
        `INSERT INTO reports AS r (trip_id, reporter_id, about_user_id, category, details) VALUES ($1, $2, $3, $4, $5)
         RETURNING ${REPORT}`,
        [tripId, reporterId, aboutUserId ?? null, category, details ?? null],
      );
      return rows[0];
    },

    /** For admins: open reports first (safety at the top), then the rest, newest first. */
    async listReports({ status, country, limit = 100 } = {}) {
      const { rows } = await db().query(
        `SELECT ${REPORT}, a.name AS "resolvedBy",
                json_build_object('id', rp.id, 'name', rp.name, 'phone', rp.phone, 'role', rp.role) AS reporter,
                CASE WHEN ab.id IS NULL THEN NULL
                     ELSE json_build_object('id', ab.id, 'name', ab.name, 'phone', ab.phone, 'role', ab.role) END AS "aboutUser",
                t.pickup_address AS "pickupAddress", t.dropoff_address AS "dropoffAddress", t.requested_at AS "tripAt"
           FROM reports r
           JOIN users rp ON rp.id = r.reporter_id
           LEFT JOIN users ab ON ab.id = r.about_user_id
           LEFT JOIN users a ON a.id = r.resolved_by
           JOIN trips t ON t.id = r.trip_id
          WHERE ($1::text IS NULL OR r.status = $1) AND ($2::text IS NULL OR rp.country = $2)
          ORDER BY r.status = 'resolved', r.category = 'safety' DESC, r.created_at DESC
          LIMIT $3`,
        [status ?? null, country ?? null, limit],
      );
      return rows;
    },

    /** Marks an open report resolved. Returns null if there's no such open report. */
    async resolveReport(id, { by, note }) {
      const { rows } = await db().query(
        `UPDATE reports r SET status = 'resolved', resolved_by = $2, resolved_at = now(), resolution_note = $3
          WHERE id = $1 AND status = 'open' RETURNING ${REPORT}`,
        [id, by, note ?? null],
      );
      return rows[0] ?? null;
    },

    async findReport(id) {
      const { rows } = await db().query(`SELECT ${REPORT} FROM reports r WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },
  };
}
