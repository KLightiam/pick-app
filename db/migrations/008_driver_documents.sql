-- Documents drivers upload (licence, insurance, ...) for an admin to check before approval.
-- The file itself is in object storage (or on disk in development) under storage_key.
CREATE TABLE driver_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  kind          text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  storage_key   text NOT NULL UNIQUE,
  content_type  text NOT NULL,
  size_bytes    integer NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  reject_reason text
);
CREATE INDEX driver_documents_driver_idx ON driver_documents (driver_id, kind, uploaded_at DESC);
