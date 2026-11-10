CREATE TABLE quest_log (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  slot       INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  params     TEXT NOT NULL,
  baseline   REAL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  done_at    INTEGER,
  xp         INTEGER NOT NULL,
  PRIMARY KEY (account_id, day, slot)
);
CREATE TABLE achievements (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  xp          INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);
