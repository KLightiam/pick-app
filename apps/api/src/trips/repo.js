import { hasRoom } from './capacity.js';

const pointJson = (col) => `CASE WHEN ${col} IS NULL THEN NULL
  ELSE json_build_object('lat', ST_Y(${col}::geometry), 'lng', ST_X(${col}::geometry)) END`;

const SELECT = `
  SELECT id, rider_id AS "riderId", driver_id AS "driverId", status,
         ride_type AS "rideType", seats, driver_mode AS "driverMode", match_type AS "matchType",
         ${pointJson('pickup')} AS pickup,
         ${pointJson('dropoff')} AS dropoff,
         ${pointJson('alight')} AS alight,
         remaining_km AS "remainingKm",
         pickup_address AS "pickupAddress", dropoff_address AS "dropoffAddress",
         fare_estimate AS "fareEstimate", usual_fare AS "usualFare", fare_final AS "fareFinal", currency,
         payment_method AS "paymentMethod",
         requested_at AS "requestedAt", accepted_at AS "acceptedAt", arrived_at AS "arrivedAt",
         started_at AS "startedAt", completed_at AS "completedAt",
         cancelled_at AS "cancelledAt", cancelled_by AS "cancelledBy", cancel_reason AS "cancelReason"
    FROM trips`;

const point = (lat, lng) => `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

/** Thrown when a rider already has an active trip. */
export class ActiveTripConflict extends Error {}

/** Thrown when the driver no longer has room for the booking. */
export class NoRoomConflict extends Error {}

const isUniqueViolation = (err) => err.code === '23505';

// Postgres storage for trips and the driver each trip was offered to.
export function pgTripsRepo(db) {
  const findById = async (id, client = db()) => {
    const { rows } = await client.query(`${SELECT} WHERE id = $1`, [id]);
    return rows[0] ?? null;
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

    async findActiveForDriver(driverId) {
      const { rows } = await db().query(
        `${SELECT} WHERE driver_id = $1 AND status IN ('accepted', 'arrived', 'in_progress') ORDER BY accepted_at`,
        [driverId],
      );
      return rows;
    },

    async create(t) {
      try {
        const { rows } = await db().query(
          `INSERT INTO trips (rider_id, pickup, dropoff, alight, pickup_address, dropoff_address,
                              fare_estimate, currency, ride_type, seats, driver_mode, match_type, remaining_km,
                              usual_fare, payment_method)
           VALUES ($1, ${point('$2', '$3')}, ${point('$4', '$5')}, ${point('$6', '$7')}, $8, $9,
                   $10, $11, $12, $13, $14, $15, $16, $17, $18)
           RETURNING id`,
          [t.riderId, t.pickup.lat, t.pickup.lng, t.dropoff.lat, t.dropoff.lng, t.alight.lat, t.alight.lng,
            t.pickupAddress ?? null, t.dropoffAddress ?? null, t.fareEstimate, t.currency,
            t.rideType, t.seats, t.driverMode, t.matchType, t.remainingKm, t.usualFare, t.paymentMethod ?? 'cash'],
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

    /** Requests offered to this driver that nobody has accepted or cancelled yet, oldest first. */
    async listOpenOffers(driverId) {
      const { rows } = await db().query(
        `${SELECT} WHERE status = 'requested' AND id IN (SELECT trip_id FROM trip_offers WHERE driver_id = $1)
          ORDER BY requested_at`,
        [driverId],
      );
      return rows;
    },

    async wasOffered(tripId, driverId) {
      const { rowCount } = await db().query(
        'SELECT 1 FROM trip_offers WHERE trip_id = $1 AND driver_id = $2', [tripId, driverId],
      );
      return rowCount > 0;
    },

    /**
     * Assigns the driver if the trip is still waiting and the car has room.
     * Returns the trip, or null if it is no longer waiting. Throws NoRoomConflict if the car is full.
     * Locks the driver's row so two accepts can't overfill the car.
     */
    async accept(tripId, driverId) {
      const client = await db().connect();
      try {
        await client.query('BEGIN');
        const { rows: [driver] } = await client.query(
          'SELECT seats, seats_offered AS "seatsOffered" FROM drivers WHERE user_id = $1 FOR UPDATE', [driverId],
        );
        const { rows: [load] } = await client.query(
          `SELECT count(*)::int AS bookings, COALESCE(sum(seats), 0)::int AS "seatsUsed",
                  COALESCE(bool_or(ride_type = 'solo'), false) AS "hasSolo"
             FROM trips WHERE driver_id = $1 AND status IN ('accepted', 'arrived', 'in_progress')`,
          [driverId],
        );
        const trip = await findById(tripId, client);
        if (trip?.status !== 'requested') {
          await client.query('ROLLBACK');
          return null;
        }
        if (!driver || !hasRoom(driver, load, trip)) throw new NoRoomConflict();
        await client.query(
          `UPDATE trips SET driver_id = $2, status = 'accepted', accepted_at = now() WHERE id = $1`,
          [tripId, driverId],
        );
        await client.query('COMMIT');
        return findById(tripId);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    /** Moves the trip to `arrived` or `in_progress` if it is still in status `from`. Returns the trip or null. */
    async advance(tripId, { from, to, at }) {
      const column = { arrived: 'arrived_at', in_progress: 'started_at' }[to];
      const { rows } = await db().query(
        `UPDATE trips SET status = $3, ${column} = $4 WHERE id = $1 AND status = $2 RETURNING id`,
        [tripId, from, to, at],
      );
      return rows[0] ? findById(rows[0].id) : null;
    },

    /** Marks a trip in progress as completed with its final fare. Returns the trip or null. */
    async complete(tripId, { at, fareFinal }) {
      const { rows } = await db().query(
        `UPDATE trips SET status = 'completed', completed_at = $2, fare_final = $3
          WHERE id = $1 AND status = 'in_progress' RETURNING id`,
        [tripId, at, fareFinal],
      );
      return rows[0] ? findById(rows[0].id) : null;
    },

    /** The driver's passengers who were in the car at any point between `from` and `to`. */
    async ridesOverlapping(driverId, { from, to }) {
      const { rows } = await db().query(
        `${SELECT} WHERE driver_id = $1 AND status IN ('in_progress', 'completed')
            AND started_at < $3 AND (completed_at IS NULL OR completed_at > $2)`,
        [driverId, from, to],
      );
      return rows;
    },

    /** Cancels the trip if it is still in status `from`. Returns the trip, or null if it changed meanwhile. */
    async cancel(tripId, { from, by, reason }) {
      const { rows } = await db().query(
        `UPDATE trips SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4
          WHERE id = $1 AND status = $2 RETURNING id`,
        [tripId, from, by, reason ?? null],
      );
      return rows[0] ? findById(rows[0].id) : null;
    },
  };
}
