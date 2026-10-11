// Postgres storage for driver availability and location.
export function pgDriversRepo(db) {
  return {
    async findById(userId) {
      const { rows } = await db().query(
        `SELECT d.user_id AS "userId", u.name, d.vehicle_make AS "vehicleMake",
                d.vehicle_plate AS "vehiclePlate", d.approved, d.online
           FROM drivers d JOIN users u ON u.id = d.user_id
          WHERE d.user_id = $1`,
        [userId],
      );
      return rows[0] ?? null;
    },

    async setStatus(userId, { online, location }) {
      await db().query(
        `UPDATE drivers
            SET online = $2,
                location = COALESCE(ST_MakePoint($4, $3)::geography, location),
                location_at = CASE WHEN $3::float8 IS NULL THEN location_at ELSE now() END
          WHERE user_id = $1`,
        [userId, online, location?.lat ?? null, location?.lng ?? null],
      );
    },

    /** Approved, online drivers near a point who are not already on a trip, nearest first. */
    async nearby(point, { radiusKm, limit }) {
      const { rows } = await db().query(
        `SELECT d.user_id AS "driverId",
                ST_Y(d.location::geometry) AS lat,
                ST_X(d.location::geometry) AS lng,
                ST_Distance(d.location, ST_MakePoint($2, $1)::geography) / 1000 AS "distanceKm"
           FROM drivers d
          WHERE d.online AND d.approved
            AND d.location_at > now() - interval '2 minutes'
            AND ST_DWithin(d.location, ST_MakePoint($2, $1)::geography, $3 * 1000)
            AND NOT EXISTS (
              SELECT 1 FROM trips t
               WHERE t.driver_id = d.user_id AND t.status IN ('accepted', 'arrived', 'in_progress'))
          ORDER BY "distanceKm"
          LIMIT $4`,
        [point.lat, point.lng, radiusKm, limit],
      );
      return rows;
    },
  };
}
