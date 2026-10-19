CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  code_hash     TEXT NOT NULL UNIQUE,
  mc_uuid       TEXT NOT NULL,
  mc_name       TEXT NOT NULL,
  profile_id    TEXT NOT NULL,
  profiles      TEXT NOT NULL DEFAULT '[]',
  tz            TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  revision      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE plot_assignments (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plot_id     TEXT NOT NULL,
  crop_id     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, plot_id)
);

CREATE TABLE greenhouses (
  account_id               TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plot_id                  TEXT NOT NULL,
  cells                    TEXT NOT NULL DEFAULT '{}',
  last_watered_at          INTEGER,
  watering_interval_hours  REAL,
  updated_at               INTEGER NOT NULL,
  PRIMARY KEY (account_id, plot_id)
);
