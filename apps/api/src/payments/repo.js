const COLUMNS = `id, trip_id AS "tripId", rider_id AS "riderId", driver_id AS "driverId", method, provider,
  amount, commission, currency, status, provider_ref AS "providerRef", checkout_url AS "checkoutUrl",
  created_at AS "createdAt", paid_at AS "paidAt"`;

// Postgres storage for payments, one per completed trip.
export function pgPaymentsRepo(db) {
  return {
    /** Records the payment for a trip. Returns the existing one if the trip already has a payment. */
    async create(p) {
      const { rows } = await db().query(
        `INSERT INTO payments (trip_id, rider_id, driver_id, method, provider, amount, commission, currency, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (trip_id) DO NOTHING
         RETURNING ${COLUMNS}`,
        [p.tripId, p.riderId, p.driverId, p.method, p.provider, p.amount, p.commission, p.currency, p.status],
      );
      return rows[0] ?? this.findByTrip(p.tripId);
    },

    async findByTrip(tripId) {
      const { rows } = await db().query(`SELECT ${COLUMNS} FROM payments WHERE trip_id = $1`, [tripId]);
      return rows[0] ?? null;
    },

    async findByRef(providerRef) {
      const { rows } = await db().query(`SELECT ${COLUMNS} FROM payments WHERE provider_ref = $1`, [providerRef]);
      return rows[0] ?? null;
    },

    async findById(id) {
      const { rows } = await db().query(`SELECT ${COLUMNS} FROM payments WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async findUnpaidForRider(riderId) {
      const { rows } = await db().query(
        `SELECT ${COLUMNS} FROM payments WHERE rider_id = $1 AND status = 'pending' ORDER BY created_at LIMIT 1`,
        [riderId],
      );
      return rows[0] ?? null;
    },

    async setCheckout(id, { providerRef, checkoutUrl }) {
      const { rows } = await db().query(
        `UPDATE payments SET provider_ref = $2, checkout_url = $3 WHERE id = $1 AND status = 'pending'
         RETURNING ${COLUMNS}`,
        [id, providerRef, checkoutUrl],
      );
      return rows[0] ?? null;
    },

    /** Marks a pending payment paid. Returns it, or null if it was already paid. */
    async markPaid(id, at) {
      const { rows } = await db().query(
        `UPDATE payments SET status = 'paid', paid_at = $2 WHERE id = $1 AND status = 'pending' RETURNING ${COLUMNS}`,
        [id, at],
      );
      return rows[0] ?? null;
    },

    /** The driver's payments since `since`, newest first. */
    async listForDriver(driverId, { since }) {
      const { rows } = await db().query(
        `SELECT ${COLUMNS} FROM payments WHERE driver_id = $1 AND created_at >= $2 ORDER BY created_at DESC`,
        [driverId, since],
      );
      return rows;
    },
  };
}
