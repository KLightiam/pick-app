-- Core schema for Pick: users, drivers with live locations, and trips.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL UNIQUE,
  name        text,
  role        text NOT NULL CHECK (role IN ('rider', 'driver', 'admin')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drivers (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_make  text,
  vehicle_plate text,
  approved      boolean NOT NULL DEFAULT false,
  online        boolean NOT NULL DEFAULT false,
  location      geography(Point, 4326),
  location_at   timestamptz
);
CREATE INDEX drivers_location_idx ON drivers USING GIST (location);

CREATE TABLE trips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id        uuid NOT NULL REFERENCES users(id),
  driver_id       uuid REFERENCES drivers(user_id),
  status          text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled')),
  pickup          geography(Point, 4326) NOT NULL,
  dropoff         geography(Point, 4326) NOT NULL,
  pickup_address  text,
  dropoff_address text,
  fare_estimate   integer,  -- minor currency units
  fare_final      integer,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX trips_rider_idx ON trips (rider_id);
CREATE INDEX trips_driver_idx ON trips (driver_id);
