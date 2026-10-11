-- People can delete their account from the app (an App Store and Google Play rule). The row stays, so trips,
-- payments and reports keep their history, but the phone number, name and anything personal is removed.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
