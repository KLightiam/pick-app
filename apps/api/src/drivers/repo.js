const ACTIVE = `('accepted', 'arrived', 'in_progress')`;

const PROFILE = `
  d.user_id AS "userId", u.name, d.vehicle_make AS "vehicleMake", d.vehicle_plate AS "vehiclePlate",
  d.approved, d.online, d.seats, d.mode, d.seats_offered AS "seatsOffered",
  d.destination_address AS "destinationAddress",
  CASE WHEN d.location IS NULL THEN NULL
       ELSE json_build_object('lat', ST_Y(d.location::geometry), 'lng', ST_X(d.location::geometry)) END AS location,
  CASE WHEN d.destination IS NULL THEN NULL
       ELSE json_build_object('lat', ST_Y(d.destination::geometry), 'lng', ST_X(d.destination::geometry)) END AS destination,
  CASE WHEN d.route IS NULL THEN NULL
       ELSE (SELECT json_agg(json_build_object('lat', c->>1, 'lng', c->>0))
               FROM json_array_elements(ST_AsGeoJSON(d.route::geometry)::json->'coordinates') c) END AS route`;

const LOAD = `
  (SELECT json_build_object(
      'bookings', count(*)::int,
      'seatsUsed', COALESCE(sum(t.seats), 0)::int,
      'hasSolo', COALESCE(bool_or(t.ride_type = 'solo'), false))
     FROM trips t WHERE t.driver_id = d.user_id AND t.status IN ${ACTIVE}) AS load`;

// JSON numbers from json_agg come back as strings; turn route points back into numbers.
const fixRoute = (row) => row && {
  ...row,
  route: row.route?.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })) ?? null,
};

const point = (latParam, lngParam) => `ST_SetSRID(ST_MakePoint(${lngParam}, ${latParam}), 4326)`;
const lineFromGeoJson = (param) => `ST_SetSRID(ST_GeomFromGeoJSON(${param}), 4326)::geography`;
const toGeoJson = (route) => JSON.stringify({ type: 'LineString', coordinates: route.map((p) => [p.lng, p.lat]) });

// Postgres storage for drivers: vehicle, availability, mode, route and current load.
export function pgDriversRepo(db) {
  return {
    async findById(userId) {
      const { rows } = await db().query(
        `SELECT ${PROFILE}, ${LOAD} FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id = $1`,
        [userId],
      );
      return fixRoute(rows[0]) ?? null;
    },

    async updateVehicle(userId, { vehicleMake, vehiclePlate, seats }) {
      await db().query(
        `UPDATE drivers SET vehicle_make = $2, vehicle_plate = $3, seats = $4,
                seats_offered = LEAST(seats_offered, $4)
          WHERE user_id = $1`,
        [userId, vehicleMake ?? null, vehiclePlate ?? null, seats],
      );
    },

    /**
     * online: { online: true, location, mode, destination?, destinationAddress?, route?, seatsOffered }
     * or { online: false }. `route` is the commuter's road route, a list of { lat, lng }.
     */
    async setStatus(userId, status) {
      if (!status.online) {
        await db().query('UPDATE drivers SET online = false WHERE user_id = $1', [userId]);
        return;
      }
      const { location, mode, destination, destinationAddress, route, seatsOffered } = status;
      const commute = mode === 'commute';
      await db().query(
        `UPDATE drivers
            SET online = true, mode = $4, seats_offered = $5,
                location = ${point('$2', '$3')}::geography, location_at = now(),
                destination = CASE WHEN $4 = 'commute' THEN ${point('$6', '$7')}::geography END,
                destination_address = CASE WHEN $4 = 'commute' THEN $8 END,
                route = CASE WHEN $4 = 'commute' THEN ${lineFromGeoJson('$9')} END
          WHERE user_id = $1`,
        [userId, location.lat, location.lng, mode, seatsOffered,
          commute ? destination.lat : null, commute ? destination.lng : null,
          commute ? destinationAddress ?? null : null, commute ? toGeoJson(route) : null],
      );
    },

    async updateLocation(userId, location) {
      await db().query(
        `UPDATE drivers SET location = ${point('$2', '$3')}::geography, location_at = now() WHERE user_id = $1`,
        [userId, location.lat, location.lng],
      );
    },

    /** Replaces a commuter's road route, e.g. after they took a different road. */
    async setRoute(userId, route) {
      await db().query(
        `UPDATE drivers SET route = ${lineFromGeoJson('$2')} WHERE user_id = $1 AND mode = 'commute'`,
        [userId, toGeoJson(route)],
      );
    },

    /**
     * Drivers who might serve a pickup: go-anywhere drivers within `anywhereRadiusKm`,
     * and commuters whose route passes within `pickupDetourKm`. Matching is done by the caller.
     */
    async candidates(pickup, { anywhereRadiusKm, pickupDetourKm, limit = 50 }) {
      const { rows } = await db().query(
        `SELECT ${PROFILE}, ${LOAD}
           FROM drivers d JOIN users u ON u.id = d.user_id
          WHERE d.online AND d.approved AND d.location_at > now() - interval '2 minutes'
            AND ((d.mode = 'anywhere' AND ST_DWithin(d.location, ${point('$1', '$2')}::geography, $3 * 1000))
              OR (d.mode = 'commute' AND ST_DWithin(d.route, ${point('$1', '$2')}::geography, $4 * 1000)))
          ORDER BY ST_Distance(d.location, ${point('$1', '$2')}::geography)
          LIMIT $5`,
        [pickup.lat, pickup.lng, anywhereRadiusKm, pickupDetourKm, limit],
      );
      return rows.map(fixRoute);
    },

    /** Available drivers near a point with seats free, nearest first (cars on the rider's map). */
    async nearby(p, { radiusKm, limit }) {
      const { rows } = await db().query(
        `SELECT d.user_id AS "driverId", d.mode,
                ST_Y(d.location::geometry) AS lat,
                ST_X(d.location::geometry) AS lng,
                ST_Distance(d.location, ${point('$1', '$2')}::geography) / 1000 AS "distanceKm"
           FROM drivers d
          WHERE d.online AND d.approved
            AND d.location_at > now() - interval '2 minutes'
            AND ST_DWithin(d.location, ${point('$1', '$2')}::geography, $3 * 1000)
            AND NOT EXISTS (
              SELECT 1 FROM trips t
               WHERE t.driver_id = d.user_id AND t.status IN ${ACTIVE} AND t.ride_type = 'solo')
            AND (SELECT COALESCE(sum(t.seats), 0) FROM trips t
                  WHERE t.driver_id = d.user_id AND t.status IN ${ACTIVE}) < d.seats_offered
          ORDER BY "distanceKm"
          LIMIT $4`,
        [p.lat, p.lng, radiusKm, limit],
      );
      return rows;
    },
  };
}
