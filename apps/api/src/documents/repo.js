const COLUMNS = `id, driver_id AS "driverId", kind, status, storage_key AS "storageKey", content_type AS "contentType",
  size_bytes AS "sizeBytes", uploaded_at AS "uploadedAt", reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt",
  reject_reason AS "rejectReason"`;

// Postgres storage for driver document records (the files themselves are in storage.js).
export function pgDocumentsRepo(db) {
  return {
    async create(d) {
      const { rows } = await db().query(
        `INSERT INTO driver_documents (driver_id, kind, storage_key, content_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
        [d.driverId, d.kind, d.storageKey, d.contentType, d.sizeBytes],
      );
      return rows[0];
    },

    async findById(id) {
      const { rows } = await db().query(`SELECT ${COLUMNS} FROM driver_documents WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    /** Every upload by the driver, newest first. */
    async listForDriver(driverId) {
      const { rows } = await db().query(
        `SELECT ${COLUMNS} FROM driver_documents WHERE driver_id = $1 ORDER BY uploaded_at DESC`, [driverId],
      );
      return rows;
    },

    /** Approves or rejects a document that is still waiting. Returns it, or null if it was already reviewed. */
    async review(id, { status, by, reason }) {
      const { rows } = await db().query(
        `UPDATE driver_documents SET status = $2, reviewed_by = $3, reviewed_at = now(), reject_reason = $4
          WHERE id = $1 AND status = 'pending' RETURNING ${COLUMNS}`,
        [id, status, by, status === 'rejected' ? reason ?? null : null],
      );
      return rows[0] ?? null;
    },
  };
}
