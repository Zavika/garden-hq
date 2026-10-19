import {
  MAX_GREENHOUSES,
  type GreenhouseSave,
  type StoredLink,
  type SyncOp,
  type SyncStateResponse,
} from "@garden-hq/core";
import { utcDay } from "../limits";
import {
  ACCOUNT_COLUMNS,
  toAccountRow,
  type AccountRow,
  type DbAccount,
} from "../auth";

export async function createAccount(
  db: D1Database,
  a: { id: string; codeHash: string; link: StoredLink; now: number },
): Promise<void> {
  // One atomic batch: the account row and its creation-log row (no account id,
  // so deleteAccount never removes it) land together or not at all.
  await db.batch([
    db
      .prepare(
        "INSERT INTO accounts (id, code_hash, mc_uuid, mc_name, profile_id, profiles, tz, revision, created_at, last_seen_at) " +
          "VALUES (?1,?2,?3,?4,?5,?6,'Europe/Warsaw',0,?7,?7)",
      )
      .bind(
        a.id,
        a.codeHash,
        a.link.uuid,
        a.link.name,
        a.link.profileId,
        JSON.stringify(a.link.profiles),
        a.now,
      ),
    db
      .prepare("INSERT INTO account_creations (created_at) VALUES (?1)")
      .bind(a.now),
  ]);
}

export async function loadAccount(
  db: D1Database,
  id: string,
): Promise<AccountRow | null> {
  const row = await db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?1`)
    .bind(id)
    .first<DbAccount>();
  return row === null ? null : toAccountRow(row);
}

interface DbAssignment {
  plot_id: string;
  crop_id: string;
}

interface DbGreenhouse {
  plot_id: string;
  cells: string;
  last_watered_at: number | null;
  watering_interval_hours: number | null;
}

function parseCells(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function readState(
  db: D1Database,
  account: AccountRow,
): Promise<SyncStateResponse> {
  const [assignRes, ghRes] = await db.batch([
    db
      .prepare(
        "SELECT plot_id, crop_id FROM plot_assignments WHERE account_id = ?1",
      )
      .bind(account.id),
    db
      .prepare(
        "SELECT plot_id, cells, last_watered_at, watering_interval_hours FROM greenhouses WHERE account_id = ?1",
      )
      .bind(account.id),
  ]);
  const assignments: Record<string, string> = {};
  for (const r of (assignRes?.results ?? []) as DbAssignment[]) {
    assignments[r.plot_id] = r.crop_id;
  }
  const greenhouses: Record<string, GreenhouseSave> = {};
  for (const r of (ghRes?.results ?? []) as DbGreenhouse[]) {
    greenhouses[r.plot_id] = {
      cells: parseCells(r.cells),
      lastWateredAt: r.last_watered_at,
      wateringIntervalHours: r.watering_interval_hours,
    };
  }
  return {
    link: {
      name: account.mcName,
      uuid: account.mcUuid,
      profileId: account.profileId,
      profiles: account.profiles,
    },
    assignments,
    greenhouses,
    timeZone: account.tz,
    revision: account.revision,
  };
}

function stmtFor(
  db: D1Database,
  A: string,
  op: SyncOp,
  now: number,
): D1PreparedStatement {
  switch (op.t) {
    case "setAssignment":
      return op.cropId === null
        ? db
            .prepare(
              "DELETE FROM plot_assignments WHERE account_id = ?1 AND plot_id = ?2",
            )
            .bind(A, op.plotId)
        : db
            .prepare(
              "INSERT INTO plot_assignments (account_id, plot_id, crop_id, updated_at) VALUES (?1,?2,?3,?4) " +
                "ON CONFLICT (account_id, plot_id) DO UPDATE SET crop_id = excluded.crop_id, updated_at = excluded.updated_at",
            )
            .bind(A, op.plotId, op.cropId, now);
    case "markGreenhouse":
      return db
        .prepare(
          "INSERT INTO greenhouses (account_id, plot_id, cells, last_watered_at, watering_interval_hours, updated_at) " +
            "SELECT ?1, ?2, '{}', NULL, NULL, ?3 " +
            "WHERE (SELECT COUNT(*) FROM greenhouses WHERE account_id = ?1) < ?4 " +
            "AND NOT EXISTS (SELECT 1 FROM greenhouses WHERE account_id = ?1 AND plot_id = ?2)",
        )
        .bind(A, op.plotId, now, MAX_GREENHOUSES);
    case "unmarkGreenhouse":
      return db
        .prepare(
          "DELETE FROM greenhouses WHERE account_id = ?1 AND plot_id = ?2",
        )
        .bind(A, op.plotId);
    case "setGreenhouseCell": {
      const path = `$."${op.cellKey}"`; // cellKey is validated /^\d,\d$/ by parseOps
      return op.contentId === null
        ? db
            .prepare(
              "UPDATE greenhouses SET cells = json_remove(CASE WHEN json_valid(cells) THEN cells ELSE '{}' END, ?3), updated_at = ?4 WHERE account_id = ?1 AND plot_id = ?2",
            )
            .bind(A, op.plotId, path, now)
        : db
            .prepare(
              "UPDATE greenhouses SET cells = json_set(CASE WHEN json_valid(cells) THEN cells ELSE '{}' END, ?3, ?5), updated_at = ?4 WHERE account_id = ?1 AND plot_id = ?2",
            )
            .bind(A, op.plotId, path, now, op.contentId);
    }
    case "markGreenhouseWatered":
      return db
        .prepare(
          "UPDATE greenhouses SET last_watered_at = ?3, updated_at = ?4 WHERE account_id = ?1 AND plot_id = ?2",
        )
        .bind(A, op.plotId, op.at, now);
    case "setWateringInterval":
      return db
        .prepare(
          "UPDATE greenhouses SET watering_interval_hours = ?3, updated_at = ?4 WHERE account_id = ?1 AND plot_id = ?2",
        )
        .bind(A, op.plotId, op.hours, now);
    case "setTimeZone":
      return db
        .prepare("UPDATE accounts SET tz = ?2 WHERE id = ?1")
        .bind(A, op.timeZone);
    case "setLink":
      return db
        .prepare(
          "UPDATE accounts SET mc_uuid = ?2, mc_name = ?3, profile_id = ?4, profiles = ?5 WHERE id = ?1",
        )
        .bind(
          A,
          op.link.uuid,
          op.link.name,
          op.link.profileId,
          JSON.stringify(op.link.profiles),
        );
  }
}

/**
 * Applies ops in order and bumps the revision in ONE atomic batch (at most
 * MAX_OPS_PER_REQUEST + 1 statements; the op cap keeps the invocation under
 * D1's query limit, see data/VERIFY.md). An empty list does nothing, so a no-op
 * request never invalidates other devices' ETags. Ops for an unknown account
 * insert nothing: the FK rejects the batch and updates match no row.
 */
export async function applyOpsToDb(
  db: D1Database,
  accountId: string,
  ops: readonly SyncOp[],
  now: number,
): Promise<void> {
  if (ops.length === 0) return;
  const stmts = ops.map((op) => stmtFor(db, accountId, op, now));
  stmts.push(
    db
      .prepare(
        "UPDATE accounts SET revision = revision + 1, last_seen_at = ?2, " +
          "ops_count = CASE WHEN ops_day = ?3 THEN ops_count + ?4 ELSE ?4 END, ops_day = ?3 WHERE id = ?1",
      )
      .bind(accountId, now, utcDay(now), ops.length),
  );
  await db.batch(stmts);
}

export async function deleteAccount(
  db: D1Database,
  accountId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM plot_assignments WHERE account_id = ?1")
      .bind(accountId),
    db.prepare("DELETE FROM greenhouses WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM accounts WHERE id = ?1").bind(accountId),
  ]);
}
