-- Ratings, trip sharing and problem reports.

-- After a trip, the rider rates the driver and the driver rates the rider, once each.
CREATE TABLE ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid NOT NULL REFERENCES trips(id),
  from_user  uuid NOT NULL REFERENCES users(id),
  to_user    uuid NOT NULL REFERENCES users(id),
  stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, from_user)
);
CREATE INDEX ratings_to_user_idx ON ratings (to_user);

-- A link a rider sends to someone so they can follow the trip without the app.
CREATE TABLE trip_shares (
  token      text PRIMARY KEY,
  trip_id    uuid NOT NULL REFERENCES trips(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_shares_trip_idx ON trip_shares (trip_id);

-- A rider or driver reporting a problem with a trip, for admins to follow up.
CREATE TABLE reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid NOT NULL REFERENCES trips(id),
  reporter_id     uuid NOT NULL REFERENCES users(id),
  about_user_id   uuid REFERENCES users(id),
  category        text NOT NULL CHECK (category IN ('safety', 'behaviour', 'driving', 'payment', 'lost_item', 'other')),
  details         text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by     uuid REFERENCES users(id),
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_open_idx ON reports (created_at) WHERE status = 'open';
