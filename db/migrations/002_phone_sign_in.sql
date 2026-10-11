-- Phone number sign-in: which market a user belongs to, and one-time SMS codes.
ALTER TABLE users ADD COLUMN country text NOT NULL DEFAULT 'GH' CHECK (country IN ('GH', 'DE'));
ALTER TABLE users ALTER COLUMN country DROP DEFAULT;

ALTER TABLE trips ADD COLUMN currency text CHECK (currency IN ('GHS', 'EUR'));

CREATE TABLE otp_codes (
  id          bigserial PRIMARY KEY,
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);
