import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

type Param = string | number | null;

class Stmt {
  constructor(
    readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: Param[] = [],
  ) {}

  bind(...params: Param[]): Stmt {
    return new Stmt(this.db, this.sql, params);
  }

  /** D1 numbered params (?1, reused or out of order) are named params in node:sqlite. */
  private bindArgs(): unknown[] {
    if (!/\?\d+/.test(this.sql)) return this.params;
    const named: Record<string, Param> = {};
    this.params.forEach((p, n) => {
      named[`?${n + 1}`] = p;
    });
    return [named];
  }

  exec() {
    const s = this.db.prepare(this.sql);
    const args = this.bindArgs();
    // Heuristic: RETURNING clauses and leading SQL comments are unsupported.
    const isRead = /^\s*(select|with)\b/i.test(this.sql);
    if (isRead) return { results: s.all(...args), meta: { changes: 0 } };
    return {
      results: [],
      meta: { changes: Number(s.run(...args).changes) },
    };
  }

  async run() {
    return { success: true, ...this.exec() };
  }

  async all() {
    return { success: true, ...this.exec() };
  }

  async first<T>(): Promise<T | null> {
    return (this.exec().results[0] as T | undefined) ?? null;
  }
}

/** Fresh in-memory database with every migration applied; a subset of D1Database. */
export function makeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dir = fileURLToPath(new URL("../migrations", import.meta.url));
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(join(dir, f), "utf8"));
  }
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => ({ success: true, ...s.exec() }));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
