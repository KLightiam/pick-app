-- Trip progress: when the driver arrived, picked the passenger up and dropped them off,
-- and the usual fare the final price is worked out from.
ALTER TABLE trips
  ADD COLUMN usual_fare integer,
  ADD COLUMN arrived_at timestamptz,
  ADD COLUMN started_at timestamptz;

CREATE INDEX trips_driver_started_idx ON trips (driver_id, started_at) WHERE started_at IS NOT NULL;
