import { describe, expect, it } from "vitest";
import { makeD1 } from "./d1";

const ACCOUNT =
  "INSERT INTO accounts (id, code_hash, mc_uuid, mc_name, profile_id, created_at, last_seen_at) VALUES (?, ?, 'u', 'n', 'p', 1, 1)";

describe("makeD1", () => {
  it("applies migrations and creates the three tables", async () => {
    const db = makeD1();
    const { results } = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all();
    const names = results.map((r) => (r as { name: string }).name);
    expect(names).toEqual(
      expect.arrayContaining(["accounts", "greenhouses", "plot_assignments"]),
    );
  });

  it("batch is atomic: a failing statement rolls back the earlier one", async () => {
    const db = makeD1();
    await expect(
      db.batch([
        db.prepare(ACCOUNT).bind("a1", "h1"),
        db.prepare("INSERT INTO accounts (id) VALUES (?)").bind("a2"),
      ]),
    ).rejects.toThrow();
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM accounts")
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("deleting an account cascades to its children", async () => {
    const db = makeD1();
    await db.prepare(ACCOUNT).bind("a1", "h1").run();
    await db
      .prepare(
        "INSERT INTO plot_assignments (account_id, plot_id, crop_id, updated_at) VALUES (?, ?, ?, 1)",
      )
      .bind("a1", "beginner_1", "wheat")
      .run();
    await db
      .prepare(
        "INSERT INTO greenhouses (account_id, plot_id, updated_at) VALUES (?, ?, 1)",
      )
      .bind("a1", "beginner_1")
      .run();
    await db.prepare("DELETE FROM accounts WHERE id = ?").bind("a1").run();
    for (const t of ["plot_assignments", "greenhouses"]) {
      const row = await db
        .prepare(`SELECT COUNT(*) AS n FROM ${t}`)
        .first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
  });

  it("supports reused and out-of-order numbered params", async () => {
    const db = makeD1();
    const row = await db
      .prepare("SELECT ?2 AS b, ?1 AS a, ?1 AS c")
      .bind("x", "y")
      .first<{ a: string; b: string; c: string }>();
    expect(row).toEqual({ a: "x", b: "y", c: "x" });
  });

  it("json_set / json_remove work with a bound path on a TEXT column", async () => {
    const db = makeD1();
    await db.prepare(ACCOUNT).bind("a1", "h1").run();
    await db
      .prepare(
        "INSERT INTO greenhouses (account_id, plot_id, updated_at) VALUES (?1, ?2, 1)",
      )
      .bind("a1", "g")
      .run();
    const path = '$."1,2"';
    await db
      .prepare(
        "UPDATE greenhouses SET cells = json_set(cells, ?1, ?2) WHERE account_id = ?3",
      )
      .bind(path, "wheat", "a1")
      .run();
    let row = await db
      .prepare("SELECT cells FROM greenhouses")
      .first<{ cells: string }>();
    expect(JSON.parse(row?.cells ?? "")).toEqual({ "1,2": "wheat" });
    await db
      .prepare(
        "UPDATE greenhouses SET cells = json_remove(cells, ?1) WHERE account_id = ?2",
      )
      .bind(path, "a1")
      .run();
    row = await db
      .prepare("SELECT cells FROM greenhouses")
      .first<{ cells: string }>();
    expect(JSON.parse(row?.cells ?? "")).toEqual({});
  });

  it("conditional INSERT ... SELECT inserts once, then is a no-op", async () => {
    const db = makeD1();
    const sql =
      "INSERT INTO accounts (id, code_hash, mc_uuid, mc_name, profile_id, created_at, last_seen_at) " +
      "SELECT ?1, ?2, 'u', 'n', 'p', 1, 1 WHERE (SELECT COUNT(*) FROM accounts) < ?3 " +
      "AND NOT EXISTS (SELECT 1 FROM accounts WHERE code_hash = ?2)";
    const first = await db.prepare(sql).bind("a1", "h1", 5).run();
    const second = await db.prepare(sql).bind("a2", "h1", 5).run();
    expect(first.meta.changes).toBe(1);
    expect(second.meta.changes).toBe(0);
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM accounts")
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});
