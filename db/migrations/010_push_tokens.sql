-- Phones that get push notifications (Expo push tokens), so ride requests and
-- trip updates reach people when the Pick app is closed. A token belongs to
-- whoever signed in on that phone last.
CREATE TABLE push_tokens (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   text NOT NULL CHECK (platform IN ('ios', 'android')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);
