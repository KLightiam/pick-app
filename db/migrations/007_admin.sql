-- Admin dashboard: who approved each driver, money settled with drivers by
-- hand (until automatic payouts), and each driver's running balance with Pick.
ALTER TABLE drivers
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES users(id);

-- to_driver: Pick paid the driver what app riders paid for them.
-- from_driver: the driver paid Pick the commission on cash rides.
CREATE TABLE settlements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES drivers(user_id),
  direction   text NOT NULL CHECK (direction IN ('to_driver', 'from_driver')),
  amount      integer NOT NULL CHECK (amount > 0),
  currency    text NOT NULL,
  reference   text,
  note        text,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX settlements_driver_idx ON settlements (driver_id, created_at);

-- Positive balance: Pick owes the driver. Negative: the driver owes Pick.
CREATE VIEW driver_balances AS
WITH p AS (
  SELECT driver_id, currency, count(*) AS rides,
         COALESCE(sum(amount - commission) FILTER (WHERE method = 'app' AND status = 'paid'), 0) AS owed_to_driver,
         COALESCE(sum(amount) FILTER (WHERE method = 'cash'), 0) AS cash_collected,
         COALESCE(sum(commission) FILTER (WHERE method = 'cash'), 0) AS commission_on_cash
    FROM payments GROUP BY driver_id, currency
), s AS (
  SELECT driver_id, currency,
         COALESCE(sum(amount) FILTER (WHERE direction = 'to_driver'), 0) AS paid_to_driver,
         COALESCE(sum(amount) FILTER (WHERE direction = 'from_driver'), 0) AS paid_by_driver
    FROM settlements GROUP BY driver_id, currency
)
SELECT driver_id, currency,
       COALESCE(p.rides, 0)::int AS rides,
       COALESCE(p.owed_to_driver, 0)::int AS owed_to_driver,
       COALESCE(p.cash_collected, 0)::int AS cash_collected,
       COALESCE(p.commission_on_cash, 0)::int AS commission_on_cash,
       COALESCE(s.paid_to_driver, 0)::int AS paid_to_driver,
       COALESCE(s.paid_by_driver, 0)::int AS paid_by_driver,
       (COALESCE(p.owed_to_driver, 0) - COALESCE(p.commission_on_cash, 0)
         - COALESCE(s.paid_to_driver, 0) + COALESCE(s.paid_by_driver, 0))::int AS balance
  FROM p FULL JOIN s USING (driver_id, currency);
