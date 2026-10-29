-- Discord alerts (Phase 3C). The webhook URL is a secret: stored here only,
-- never returned by any route.
CREATE TABLE alert_settings (
  account_id      TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  discord_webhook TEXT,
  -- NULL = never tested, 1 = a test message went through, 0 = Discord said it is gone.
  webhook_ok      INTEGER,
  -- JSON AlertRules; NULL until the first successful test message.
  rules           TEXT,
  -- Cron bookkeeping: the account is due when next_sync_at <= now (+ slack).
  next_sync_at    INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX alert_settings_next_sync ON alert_settings(next_sync_at);

-- Latest normalized garden per account ({"v":1,"garden":{...}}); no history.
CREATE TABLE garden_snapshot (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  fetched_at INTEGER NOT NULL,
  json       TEXT NOT NULL
);

-- Dedupe: a row is a CLAIM to send (type, key) once. Pruned after 7 days.
CREATE TABLE alert_log (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  key        TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (account_id, type, key)
);
CREATE INDEX alert_log_sent_at ON alert_log(sent_at);
