// @vitest-environment node
/// <reference types="node" />
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BROWSER_KEYS,
  NO_PERSONAL_DATA_TABLES,
  SERVER_TABLES,
} from "./privacy";

const migrationsDir = fileURLToPath(
  new URL("../../../worker/migrations/", import.meta.url),
);

function migrationTables(): Set<string> {
  const created = new Set<string>();
  const dropped = new Set<string>();
  for (const f of fs.readdirSync(migrationsDir)) {
    if (!f.endsWith(".sql")) continue;
    const sql = fs.readFileSync(migrationsDir + f, "utf8");
    for (const m of sql.matchAll(
      /CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE(?:\s+IF NOT EXISTS)?\s+["`[]?(\w+)/gi,
    )) {
      created.add(m[1] as string);
    }
    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+["`[]?\w+["`\]]?\s+RENAME\s+TO\s+["`[]?(\w+)/gi,
    )) {
      created.add(m[1] as string);
    }
    for (const m of sql.matchAll(
      /DROP\s+TABLE(?:\s+IF EXISTS)?\s+["`[]?(\w+)/gi,
    )) {
      dropped.add(m[1] as string);
    }
  }
  for (const d of dropped) created.delete(d);
  return created;
}

function constIn(relPath: string, name: string): string {
  const text = fs.readFileSync(
    fileURLToPath(new URL(relPath, import.meta.url)),
    "utf8",
  );
  const m = new RegExp(`const ${name} = "([^"]+)"`).exec(text);
  if (!m) throw new Error(`${name} not found in ${relPath}`);
  return m[1] as string;
}

describe("privacy drift", () => {
  const described = [
    ...SERVER_TABLES.map((t) => t.table),
    ...NO_PERSONAL_DATA_TABLES,
  ];

  it("describes every migrated table", () => {
    const missing = [...migrationTables()].filter(
      (t) => !described.includes(t),
    );
    expect(missing).toEqual([]);
  });

  it("lists no table that the migrations do not create", () => {
    const tables = migrationTables();
    expect(described.filter((t) => !tables.has(t))).toEqual([]);
  });

  it("matches the browser storage keys in code", () => {
    const keys = BROWSER_KEYS.map((k) => k.key).sort();
    const inCode = [
      constIn("../state/storage.ts", "STORAGE_KEY"),
      constIn("../state/sync.ts", "KEY"),
    ].sort();
    expect(keys).toEqual(inCode);
  });
});
