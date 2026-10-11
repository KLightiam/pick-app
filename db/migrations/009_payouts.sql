-- Automatic payouts: Pick sends drivers what it owes them. Ghana: mobile money
-- through Paystack transfers. Germany: bank payouts through Stripe Connect.

-- Where a driver is paid. provider_ref is the Paystack transfer recipient code
-- or the Stripe connected account id. Stripe accounts aren't ready until the
-- driver finishes Stripe's onboarding (identity and bank details).
CREATE TABLE payout_accounts (
  driver_id      uuid PRIMARY KEY REFERENCES drivers(user_id),
  provider       text NOT NULL CHECK (provider IN ('paystack', 'stripe', 'test')),
  method         text NOT NULL CHECK (method IN ('mobile_money', 'stripe')),
  account_name   text,
  account_number text,
  network        text,
  provider_ref   text NOT NULL,
  ready          boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- requested_by is the admin who pressed Pay now, or null for the weekly run.
CREATE TABLE payouts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id      uuid NOT NULL REFERENCES drivers(user_id),
  amount         integer NOT NULL CHECK (amount > 0),
  currency       text NOT NULL,
  provider       text NOT NULL CHECK (provider IN ('paystack', 'stripe', 'test')),
  provider_ref   text UNIQUE,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  failure_reason text,
  requested_by   uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
-- One payout on its way per driver at a time, so the same money is never sent twice.
CREATE UNIQUE INDEX payouts_one_pending_idx ON payouts (driver_id) WHERE status = 'pending';
CREATE INDEX payouts_driver_idx ON payouts (driver_id, created_at);

-- Payouts count as paid to the driver while on their way and once paid; a failed one gives the money back to the balance.
CREATE OR REPLACE VIEW driver_balances AS
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
    FROM (SELECT driver_id, currency, direction, amount FROM settlements
          UNION ALL
          SELECT driver_id, currency, 'to_driver', amount FROM payouts WHERE status <> 'failed') moved
   GROUP BY driver_id, currency
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
