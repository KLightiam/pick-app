-- Commuter rides: drivers either commute to a destination or go anywhere,
-- choose how many seats to share, and passengers ride solo or shared.
ALTER TABLE drivers
  ADD COLUMN seats               integer NOT NULL DEFAULT 4 CHECK (seats BETWEEN 1 AND 8),
  ADD COLUMN mode                text NOT NULL DEFAULT 'anywhere' CHECK (mode IN ('commute', 'anywhere')),
  ADD COLUMN destination         geography(Point, 4326),
  ADD COLUMN destination_address text,
  ADD COLUMN route               geography(LineString, 4326),
  ADD COLUMN seats_offered       integer NOT NULL DEFAULT 1 CHECK (seats_offered >= 1),
  ADD CONSTRAINT drivers_seats_offered_fit CHECK (seats_offered <= seats),
  ADD CONSTRAINT drivers_commute_has_destination CHECK (mode = 'anywhere' OR destination IS NOT NULL);
CREATE INDEX drivers_route_idx ON drivers USING GIST (route);

ALTER TABLE trips
  ADD COLUMN ride_type    text NOT NULL DEFAULT 'solo' CHECK (ride_type IN ('solo', 'shared')),
  ADD COLUMN seats        integer NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 8),
  ADD COLUMN driver_mode  text CHECK (driver_mode IN ('commute', 'anywhere')),
  ADD COLUMN match_type   text CHECK (match_type IN ('exact', 'beyond', 'partial', 'anywhere')),
  ADD COLUMN alight       geography(Point, 4326),
  ADD COLUMN remaining_km double precision;

-- Drivers can now carry several shared bookings at once; seat limits are checked when they accept.
DROP INDEX trips_one_active_per_driver;
