-- Per-account daily write budget (see src/limits.ts). ops_day is the UTC day
-- number, floor(now / 86400000); ops_count is the ops applied on that day.
ALTER TABLE accounts ADD COLUMN ops_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN ops_count INTEGER NOT NULL DEFAULT 0;

-- Global account-creation log for the daily cap (see src/limits.ts). One row
-- per account ever created: no account id and no PII, so deleting an account
-- never removes its creation record and create -> DELETE -> create cannot
-- evade the cap. The index makes the 24 h count a range scan.
CREATE TABLE account_creations (created_at INTEGER NOT NULL);
CREATE INDEX account_creations_created_at ON account_creations(created_at);
