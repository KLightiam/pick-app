const SELECT = `
  SELECT id, rider_id AS "riderId", driver_id AS "driverId", status,
         json_build_object('lat', ST_Y(pickup::geometry), 'lng', ST_X(pickup::geometry)) AS pickup,
         json_build_object('lat', ST_Y(dropoff::geometry), 'lng', ST_X(dropoff::geometry)) AS dropoff,
         pickup_address AS "pickupAddress", dropoff_address AS "dropoffAddress",
         fare_estimate AS "fareEstimate", currency,
         requested_at AS "requestedAt", accepted_at AS "acceptedAt",
         cancelled_at AS "cancelledAt", cancelled_by AS "cancelledBy", cancel_reason AS "cancelReason"
    FROM trips`;

const RETURNING = `RETURNING id`;

/** Thrown when a write breaks the one-active-trip rule. */
export class ActiveTripConflict extends Error {}

const isUniqueViolation = (err) => err.code === '23505';

// Postgres storage for trips and the drivers each trip was offered to.
export function pgTripsRepo(db) {
  const findById = async (id) => {
    const { rows } = await db().query(`${SELECT} WHERE id = $1`, [id]);
    return rows[0] ?? null;
  };
  // Runs an UPDATE ... RETURNING id and reloads the trip, or returns null if no row matched.
  const updateAndLoad = async (sql, params) => {
    const { rows } = await db().query(sql, params);
    return rows[0] ? findById(rows[0].id) : null;
  };

  return {
    findById,

    async findActiveForRider(riderId) {
      const { rows } = await db().query(
        `${SELECT} WHERE rider_id = $1 AND status IN ('requested', 'accepted', 'arrived', 'in_progress')`,
        [riderId],
      );
      return rows[0] ?? null;
    },

    async create({ riderId, pickup, dropoff, pickupAddress, dropoffAddress, fareEstimate, currency }) {
      try {
        const { rows } = await db().query(
          `INSERT INTO trips (rider_id, pickup, dropoff, pickup_address, dropoff_address, fare_estimate, currency)
           VALUES ($1, ST_MakePoint($3, $2)::geography, ST_MakePoint($5, $4)::geography, $6, $7, $8, $9)
           ${RETURNING}`,
          [riderId, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng,
            pickupAddress ?? null, dropoffAddress ?? null, fareEstimate, currency],
        );
        return findById(rows[0].id);
      } catch (err) {
        if (isUniqueViolation(err)) throw new ActiveTripConflict();
        throw err;
      }
    },

    async addOffers(tripId, driverIds) {
      await db().query(
        `INSERT INTO trip_offers (trip_id, driver_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [tripId, driverIds],
      );
    },

    async listOfferedDrivers(tripId) {
      const { rows } = await db().query('SELECT driver_id AS id FROM trip_offers WHERE trip_id = $1', [tripId]);
      return rows.map((r) => r.id);
    },

    async wasOffered(tripId, driverId) {
      const { rowCount } = await db().query(
        'SELECT 1 FROM trip_offers WHERE trip_id = $1 AND driver_id = $2', [tripId, driverId],
      );
      return rowCount > 0;
    },

    /** Assigns the driver if the trip is still waiting. Returns the trip, or null if someone else got it. */
    async accept(tripId, driverId) {
      try {
        return await updateAndLoad(
          `UPDATE trips SET driver_id = $2, status = 'accepted', accepted_at = now()
            WHERE id = $1 AND status = 'requested' ${RETURNING}`,
          [tripId, driverId],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new ActiveTripConflict();
        throw err;
      }
    },

    /** Cancels the trip if it is still in status `from`. Returns the trip, or null if it changed meanwhile. */
    async cancel(tripId, { from, by, reason }) {
      return updateAndLoad(
        `UPDATE trips SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4
          WHERE id = $1 AND status = $2 ${RETURNING}`,
        [tripId, from, by, reason ?? null],
      );
    },
  };
}
