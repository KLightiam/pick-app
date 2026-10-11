-- Ride requests: which drivers were offered a trip, who cancelled, and
-- at most one active trip per rider and per driver.
ALTER TABLE trips
  ADD COLUMN accepted_at   timestamptz,
  ADD COLUMN cancelled_at  timestamptz,
  ADD COLUMN cancelled_by  text CHECK (cancelled_by IN ('rider', 'driver', 'system')),
  ADD COLUMN cancel_reason text;

CREATE UNIQUE INDEX trips_one_active_per_rider ON trips (rider_id)
  WHERE status IN ('requested', 'accepted', 'arrived', 'in_progress');
CREATE UNIQUE INDEX trips_one_active_per_driver ON trips (driver_id)
  WHERE status IN ('accepted', 'arrived', 'in_progress');

CREATE TABLE trip_offers (
  trip_id    uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  driver_id  uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, driver_id)
);
CREATE INDEX trip_offers_driver_idx ON trip_offers (driver_id);
