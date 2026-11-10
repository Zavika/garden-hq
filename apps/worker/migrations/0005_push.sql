CREATE TABLE push_subscriptions (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, endpoint)
);
ALTER TABLE alert_settings ADD COLUMN push_ok INTEGER; -- NULL = never tested, 1 = a test push went through
