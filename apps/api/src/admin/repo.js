// Queries behind the admin dashboard. Admins see every country; most lists take an optional country filter.

const pointJson = (col) => `CASE WHEN ${col} IS NULL THEN NULL
  ELSE json_build_object('lat', ST_Y(${col}::geometry), 'lng', ST_X(${col}::geometry)) END`;

export function pgAdminRepo(db) {
  return {
    async overview({ since, country }) {
      const c = country ?? null;
      const [drivers, riders, trips, money] = await Promise.all([
        db().query(
          `SELECT count(*) FILTER (WHERE NOT d.approved)::int AS pending,
                  count(*) FILTER (WHERE d.approved)::int AS approved,
                  count(*) FILTER (WHERE d.approved AND d.online)::int AS online
             FROM drivers d JOIN users u ON u.id = d.user_id
            WHERE u.deleted_at IS NULL AND ($1::text IS NULL OR u.country = $1)`, [c]),
        db().query(
          `SELECT count(*)::int AS riders FROM users WHERE role = 'rider' AND deleted_at IS NULL AND ($1::text IS NULL OR country = $1)`, [c]),
        db().query(
          `SELECT t.status, count(*)::int AS count
             FROM trips t JOIN users u ON u.id = t.rider_id
            WHERE t.requested_at >= $1 AND ($2::text IS NULL OR u.country = $2)
            GROUP BY t.status`, [since, c]),
        db().query(
          `SELECT p.currency,
                  count(*)::int AS rides,
                  COALESCE(sum(p.amount), 0)::int AS fares,
                  COALESCE(sum(p.amount) FILTER (WHERE p.method = 'cash'), 0)::int AS cash,
                  COALESCE(sum(p.amount) FILTER (WHERE p.method = 'app' AND p.status = 'paid'), 0)::int AS "appPaid",
                  COALESCE(sum(p.amount) FILTER (WHERE p.method = 'app' AND p.status = 'pending'), 0)::int AS "appUnpaid",
                  COALESCE(sum(p.commission), 0)::int AS commission
             FROM payments p JOIN users u ON u.id = p.rider_id
            WHERE p.created_at >= $1 AND ($2::text IS NULL OR u.country = $2)
            GROUP BY p.currency ORDER BY p.currency`, [since, c]),
      ]);
      return {
        drivers: drivers.rows[0],
        riders: riders.rows[0].riders,
        trips: Object.fromEntries(trips.rows.map((r) => [r.status, r.count])),
        money: money.rows,
      };
    },

    /** status: 'pending' | 'approved' | 'all'. q matches name, phone or plate. */
    async listDrivers({ status, country, q, limit = 100 }) {
      const { rows } = await db().query(
        `SELECT d.user_id AS id, u.name, u.phone, u.country, u.created_at AS "joinedAt",
                d.vehicle_make AS "vehicleMake", d.vehicle_plate AS "vehiclePlate", d.seats,
                d.approved, d.approved_at AS "approvedAt", d.online, d.mode,
                COALESCE(b.rides, 0)::int AS rides, COALESCE(b.balance, 0)::int AS balance, b.currency,
                COALESCE(docs.approved, 0)::int AS "documentsApproved", COALESCE(docs.pending, 0)::int AS "documentsPending",
                (SELECT CASE WHEN count(*) = 0 THEN NULL
                             ELSE json_build_object('average', round(avg(r.stars), 1), 'count', count(*)) END
                   FROM ratings r WHERE r.to_user = d.user_id) AS rating
           FROM drivers d
           JOIN users u ON u.id = d.user_id
           LEFT JOIN driver_balances b ON b.driver_id = d.user_id
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE latest.status = 'approved') AS approved,
                    count(*) FILTER (WHERE latest.status = 'pending') AS pending
               FROM (SELECT DISTINCT ON (kind) status FROM driver_documents
                      WHERE driver_id = d.user_id ORDER BY kind, uploaded_at DESC) latest
           ) docs ON true
          WHERE u.deleted_at IS NULL AND ($1 = 'all' OR ($1 = 'pending' AND NOT d.approved) OR ($1 = 'approved' AND d.approved))
            AND ($2::text IS NULL OR u.country = $2)
            AND ($3::text IS NULL OR u.name ILIKE '%' || $3 || '%' OR u.phone LIKE '%' || $3 || '%'
                 OR d.vehicle_plate ILIKE '%' || $3 || '%')
          ORDER BY d.approved, u.created_at DESC
          LIMIT $4`,
        [status, country ?? null, q || null, limit],
      );
      return rows;
    },

    /** Approves or suspends a driver. Suspending also takes them offline. Returns false if no such driver. */
    async setApproval(driverId, { approved, by }) {
      const { rowCount } = await db().query(
        `UPDATE drivers
            SET approved = $2,
                approved_at = CASE WHEN $2 THEN now() END,
                approved_by = CASE WHEN $2 THEN $3::uuid END,
                online = online AND $2
          WHERE user_id = $1`,
        [driverId, approved, by],
      );
      return rowCount === 1;
    },

    /** Newest first. `before` is a requested_at timestamp for the next page. */
    async listTrips({ status, country, before, limit = 50 }) {
      const { rows } = await db().query(
        `SELECT t.id, t.status, t.ride_type AS "rideType", t.seats, t.driver_mode AS "driverMode",
                t.match_type AS "matchType", t.pickup_address AS "pickupAddress", t.dropoff_address AS "dropoffAddress",
                ${pointJson('t.pickup')} AS pickup, ${pointJson('t.dropoff')} AS dropoff,
                t.fare_estimate AS "fareEstimate", t.fare_final AS "fareFinal", t.currency,
                t.payment_method AS "paymentMethod", p.status AS "paymentStatus",
                t.requested_at AS "requestedAt", t.completed_at AS "completedAt",
                t.cancelled_by AS "cancelledBy", t.cancel_reason AS "cancelReason",
                json_build_object('id', r.id, 'name', r.name, 'phone', r.phone) AS rider,
                CASE WHEN dv.id IS NULL THEN NULL
                     ELSE json_build_object('id', dv.id, 'name', dv.name, 'phone', dv.phone) END AS driver
           FROM trips t
           JOIN users r ON r.id = t.rider_id
           LEFT JOIN users dv ON dv.id = t.driver_id
           LEFT JOIN payments p ON p.trip_id = t.id
          WHERE ($1::text IS NULL OR t.status = $1)
            AND ($2::text IS NULL OR r.country = $2)
            AND ($3::timestamptz IS NULL OR t.requested_at < $3)
          ORDER BY t.requested_at DESC
          LIMIT $4`,
        [status ?? null, country ?? null, before ?? null, limit],
      );
      return rows;
    },

    /** Every driver with money to settle, biggest first. */
    async listBalances({ country }) {
      const { rows } = await db().query(
        `SELECT b.driver_id AS "driverId", u.name, u.phone, u.country, b.currency, b.rides,
                b.owed_to_driver AS "owedToDriver", b.cash_collected AS "cashCollected",
                b.commission_on_cash AS "commissionOnCash", b.paid_to_driver AS "paidToDriver",
                b.paid_by_driver AS "paidByDriver", b.balance,
                COALESCE(a.ready, false) AS "payoutReady", a.method AS "payoutMethod",
                EXISTS (SELECT 1 FROM payouts WHERE driver_id = b.driver_id AND status = 'pending') AS "payoutPending"
           FROM driver_balances b JOIN users u ON u.id = b.driver_id
           LEFT JOIN payout_accounts a ON a.driver_id = b.driver_id
          WHERE b.balance <> 0 AND ($1::text IS NULL OR u.country = $1)
          ORDER BY abs(b.balance) DESC`,
        [country ?? null],
      );
      return rows;
    },

    async recordSettlement({ driverId, direction, amount, currency, reference, note, recordedBy }) {
      const { rows } = await db().query(
        `INSERT INTO settlements (driver_id, direction, amount, currency, reference, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, driver_id AS "driverId", direction, amount, currency, reference, note,
                   recorded_by AS "recordedBy", created_at AS "createdAt"`,
        [driverId, direction, amount, currency, reference ?? null, note ?? null, recordedBy],
      );
      return rows[0];
    },

    async listSettlements({ driverId, limit = 50 }) {
      const { rows } = await db().query(
        `SELECT s.id, s.driver_id AS "driverId", u.name AS "driverName", s.direction, s.amount, s.currency,
                s.reference, s.note, a.name AS "recordedBy", s.created_at AS "createdAt"
           FROM settlements s JOIN users u ON u.id = s.driver_id JOIN users a ON a.id = s.recorded_by
          WHERE $1::uuid IS NULL OR s.driver_id = $1
          ORDER BY s.created_at DESC LIMIT $2`,
        [driverId ?? null, limit],
      );
      return rows;
    },

    async driverCountry(driverId) {
      const { rows } = await db().query(
        `SELECT u.country FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id = $1`, [driverId],
      );
      return rows[0]?.country ?? null;
    },
  };
}
