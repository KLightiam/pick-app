-- Payments: riders choose cash or the app when booking. A payment is recorded
-- when the trip ends: cash is collected by the driver, app payments are
-- pending until Paystack (Ghana) or Stripe (Germany) confirms them.
ALTER TABLE trips
  ADD COLUMN payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'app'));

CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid NOT NULL UNIQUE REFERENCES trips(id),
  rider_id     uuid NOT NULL REFERENCES users(id),
  driver_id    uuid NOT NULL REFERENCES users(id),
  method       text NOT NULL CHECK (method IN ('cash', 'app')),
  provider     text CHECK (provider IN ('paystack', 'stripe', 'test')),
  amount       integer NOT NULL CHECK (amount >= 0),
  commission   integer NOT NULL CHECK (commission >= 0),
  currency     text NOT NULL,
  status       text NOT NULL CHECK (status IN ('cash', 'pending', 'paid')),
  provider_ref text UNIQUE,
  checkout_url text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz
);
CREATE INDEX payments_rider_pending_idx ON payments (rider_id) WHERE status = 'pending';
CREATE INDEX payments_driver_idx ON payments (driver_id, created_at);
