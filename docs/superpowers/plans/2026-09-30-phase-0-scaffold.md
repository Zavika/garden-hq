# Phase 0 — Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Garden HQ pnpm monorepo — shared TS/ESLint/Prettier tooling, an empty `packages/core` (vitest-tested), an empty `apps/web` (Vite+React+TS) that imports `core`, an empty `apps/worker` (Hono on Cloudflare Workers via Wrangler) that imports `core`, and a CI workflow that typechecks/lints/tests/builds everything — matching CLAUDE.md section 8, "Phase 0 — scaffold."

**Architecture:** pnpm workspaces with two consumer apps (`apps/web`, `apps/worker`) and one pure-logic package (`packages/core`) that both apps depend on via `workspace:*`. `packages/core` is consumed as TypeScript source directly (no build step) — both Vite and Wrangler's esbuild bundle TS from `node_modules` symlinks fine, so there is nothing to compile ahead of time in Phase 0. All game logic will land in `core` starting Phase 1; for now it holds one placeholder function (`pingCore`) whose only job is to prove the workspace wiring and both toolchains end-to-end.

**Tech Stack:** pnpm workspaces, TypeScript (strict), Vitest, ESLint 9 flat config + typescript-eslint, Prettier, Vite + React, Hono + Cloudflare Workers (Wrangler), GitHub Actions.

**Spec:** `CLAUDE.md` (sections 4 "Topology", 5 "Repo layout", 8 "Build order — Phase 0", 9 "Conventions for Claude Code")

## Global Constraints

- TypeScript strict everywhere; **no `any`** in `packages/core` (CLAUDE.md §9).
- All game logic lives in `packages/core` as pure TypeScript (no fetch, no DOM) — both `apps/web` and `apps/worker` import it (CLAUDE.md §4).
- Every `packages/core` function gets a vitest test; never a live API call in tests (CLAUDE.md §9).
- Repo layout must match CLAUDE.md §5 exactly: `apps/web`, `apps/worker`, `packages/core`, `.github/workflows/ci.yml`.
- `ci.yml` must run typecheck, test, and (on `main`) deploy (CLAUDE.md §5, §8: "Each phase ends with passing tests and a working deploy").
- The Hypixel API key and any other secrets are backend-only — nothing to wire yet in Phase 0, but no `.env` files get committed (`.gitignore` must exclude them) (CLAUDE.md §3).
- Mobile-first UI is a later-phase concern; Phase 0's web app just needs to build and run — no layout work yet.

## Manual / external setup (outside this plan — flag to the user, do not attempt)

This plan gets everything to build, typecheck, lint, and test locally, and it scaffolds a deploy job — but it **cannot** make the deploy job actually succeed, because that requires human action outside the repo:

1. A GitHub remote for this repo doesn't exist yet. Someone needs to create it and `git push` before Actions will even run.
2. A Cloudflare account + API token (Workers Scripts:Edit, Cloudflare Pages:Edit) must be created, and added to the GitHub repo as secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. The Cloudflare Pages project (`garden-hq-web`) must be created once (dashboard, or `wrangler pages project create garden-hq-web`) before `wrangler pages deploy` can target it.

Until those three things happen, the `deploy` job in CI is expected to fail — that's fine for Phase 0. The `build` job (typecheck/lint/test/build) is what must pass.

---

### Task 1: Repo & workspace bootstrap

**Files:**
- Create: `.gitignore`
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)

**Interfaces:**
- Produces: the pnpm workspace itself — every later task's `pnpm --filter <name>` and `pnpm -r` commands depend on this existing and `packages: [apps/*, packages/*]` being registered.

- [ ] **Step 1: Initialize git**

```bash
git init
git status
```

Expected: `Initialized empty Git repository...`, and `CLAUDE.md` shows as untracked.

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
dist/
.wrangler/
.vite/
coverage/
*.local
.DS_Store
.env
.env.*
!.env.example
```

- [ ] **Step 3: Enable pnpm via corepack and record the resolved version**

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v
```

Expected: prints a version like `9.x.x` or `10.x.x`. Note this exact value — it's used as `<PNPM_VERSION>` in the next step.

- [ ] **Step 4: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 5: Write root `package.json`**

Replace `<PNPM_VERSION>` with the exact value from Step 3.

```json
{
  "name": "garden-hq",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@<PNPM_VERSION>",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "pnpm -r --if-present run build",
    "test": "pnpm -r --if-present run test",
    "typecheck": "pnpm -r --if-present run typecheck"
  }
}
```

- [ ] **Step 6: Verify the workspace installs cleanly**

```bash
pnpm install
```

Expected: exits 0. No packages exist under `apps/` or `packages/` yet, so pnpm just creates the root lockfile — that's fine.

- [ ] **Step 7: Commit**

```bash
git add .gitignore pnpm-workspace.yaml package.json pnpm-lock.yaml CLAUDE.md
git commit -m "chore: bootstrap pnpm workspace"
```

---

### Task 2: Shared TypeScript, ESLint, and Prettier config

**Files:**
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json` (root — add lint/format scripts and devDependencies)

**Interfaces:**
- Produces: `tsconfig.base.json` (every package's `tsconfig.json` will `"extends": "../../tsconfig.base.json"`), root `eslint.config.js` (lints the whole repo from one place — no per-package ESLint config), `pnpm lint` / `pnpm format` / `pnpm format:write` root scripts.

- [ ] **Step 1: Add root devDependencies**

```bash
pnpm add -D -w typescript eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-config-prettier prettier
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

- [ ] **Step 3: Write `eslint.config.js`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.wrangler/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  eslintConfigPrettier,
);
```

- [ ] **Step 4: Write `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all"
}
```

- [ ] **Step 5: Write `.prettierignore`**

```
pnpm-lock.yaml
dist
.wrangler
```

- [ ] **Step 6: Add lint/format scripts to root `package.json`**

Modify the `"scripts"` block to:

```json
{
  "scripts": {
    "build": "pnpm -r --if-present run build",
    "test": "pnpm -r --if-present run test",
    "typecheck": "pnpm -r --if-present run typecheck",
    "lint": "eslint .",
    "format": "prettier --check .",
    "format:write": "prettier --write ."
  }
}
```

- [ ] **Step 7: Format and verify**

```bash
pnpm run format:write
pnpm run format
pnpm run lint
```

Expected: `format` reports no files need changes; `lint` exits 0.

- [ ] **Step 8: Commit**

```bash
git add tsconfig.base.json eslint.config.js .prettierrc.json .prettierignore package.json pnpm-lock.yaml
git commit -m "chore: add shared TypeScript, ESLint, and Prettier config"
```

---

### Task 3: `packages/core` scaffold with a vitest proof

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.test.ts`
- Create: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `@garden-hq/core` package, exporting `pingCore(): string` from `./src/index.ts` (via `"exports": { ".": "./src/index.ts" }` — consumed as source, no build step). Phase 1 replaces this file with the real `calendar.ts`, `garden.ts`, etc. per CLAUDE.md §5.

- [ ] **Step 1: Write `packages/core/package.json`**

```json
{
  "name": "@garden-hq/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Add devDependencies**

```bash
pnpm add -D --filter @garden-hq/core typescript vitest
```

- [ ] **Step 3: Write `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write the failing test — `packages/core/src/index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { pingCore } from "./index";

describe("pingCore", () => {
  it("returns a confirmation string", () => {
    expect(pingCore()).toBe("garden-hq core is alive");
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

```bash
pnpm --filter @garden-hq/core test
```

Expected: FAIL — `./index` cannot be resolved (the file doesn't exist yet).

- [ ] **Step 6: Write `packages/core/src/index.ts`**

```ts
export function pingCore(): string {
  return "garden-hq core is alive";
}
```

- [ ] **Step 7: Run it and confirm it passes**

```bash
pnpm --filter @garden-hq/core test
```

Expected: PASS, 1 test.

- [ ] **Step 8: Typecheck and lint**

```bash
pnpm --filter @garden-hq/core typecheck
pnpm run lint
```

Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/core package.json pnpm-lock.yaml
git commit -m "feat(core): scaffold @garden-hq/core with a vitest smoke test"
```

---

### Task 4: `apps/web` scaffold (Vite + React + TS, consumes `core`)

**Files:**
- Create: `apps/web/**` (scaffolded by `create-vite`, then customized)
- Modify: `apps/web/package.json`
- Modify: `apps/web/tsconfig.app.json`
- Modify: `apps/web/src/App.tsx`
- Delete: `apps/web/eslint.config.js` (and its now-unneeded devDependencies)

**Interfaces:**
- Consumes: `pingCore` from `@garden-hq/core` (Task 3).
- Produces: `@garden-hq/web`, buildable via `pnpm --filter @garden-hq/web build` → `apps/web/dist`.

- [ ] **Step 1: Scaffold with create-vite**

```bash
pnpm create vite@latest apps/web -- --template react-ts
```

Expected: creates `apps/web/` with the standard Vite React+TS template (non-interactive because both the project path and `--template` are given as args).

- [ ] **Step 2: Rename the package and mark it private**

Open `apps/web/package.json` and change `"name"` to `"@garden-hq/web"`, ensure `"private": true` is present.

- [ ] **Step 3: Add the `typecheck` script**

Add to `apps/web/package.json` `"scripts"`:

```json
"typecheck": "tsc -b --noEmit"
```

- [ ] **Step 4: Link `@garden-hq/core` as a workspace dependency**

```bash
pnpm add --filter @garden-hq/web @garden-hq/core@workspace:*
```

- [ ] **Step 5: Remove the template's own ESLint setup**

Open `apps/web/package.json`, find every devDependency whose name starts with `eslint` or is `globals` or `typescript-eslint` (added by the `create-vite` template), then:

```bash
pnpm remove --filter @garden-hq/web <each-name-listed-above>
```

Delete the file:

```bash
rm apps/web/eslint.config.js
```

(Root `eslint.config.js` from Task 2 already covers `apps/web/**/*.{ts,tsx}` — a second config would conflict.)

- [ ] **Step 6: Point the app tsconfig at the shared base**

Open `apps/web/tsconfig.app.json` and add a top-level `"extends"` key (alongside the existing `"compilerOptions"`, `"include"`, etc. — don't remove those):

```json
{
  "extends": "../../tsconfig.base.json",
  ...
}
```

- [ ] **Step 7: Wire in `pingCore` to prove the workspace link**

In `apps/web/src/App.tsx`, add near the top:

```tsx
import { pingCore } from "@garden-hq/core";
```

And inside the JSX the component returns, add:

```tsx
<p>{pingCore()}</p>
```

- [ ] **Step 8: Install and build**

```bash
pnpm install
pnpm --filter @garden-hq/web build
```

Expected: exits 0, creates `apps/web/dist/`.

- [ ] **Step 9: Typecheck and lint**

```bash
pnpm --filter @garden-hq/web typecheck
pnpm run lint
```

Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): scaffold Vite+React+TS app consuming @garden-hq/core"
```

---

### Task 5: `apps/worker` scaffold (Hono on Cloudflare Workers via Wrangler, consumes `core`)

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/wrangler.toml`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.test.ts`
- Create: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `pingCore` from `@garden-hq/core` (Task 3).
- Produces: `@garden-hq/worker`, a Hono app default-exported from `src/index.ts`, with a `GET /health` route. `pnpm --filter @garden-hq/worker dev` runs it locally; `pnpm --filter @garden-hq/worker deploy` deploys it (requires the manual Cloudflare setup noted above).

- [ ] **Step 1: Write `apps/worker/package.json`**

```json
{
  "name": "@garden-hq/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Add dependencies**

```bash
pnpm add --filter @garden-hq/worker hono @garden-hq/core@workspace:*
pnpm add -D --filter @garden-hq/worker wrangler typescript vitest @cloudflare/workers-types
```

- [ ] **Step 3: Write `apps/worker/wrangler.toml`**

```toml
name = "garden-hq-worker"
main = "src/index.ts"
compatibility_date = "2026-09-30"
compatibility_flags = ["nodejs_compat"]
```

- [ ] **Step 4: Write `apps/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Write the failing test — `apps/worker/src/index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import app from "./index";

describe("GET /health", () => {
  it("returns ok status and the core ping", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      status: "ok",
      core: "garden-hq core is alive",
    });
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

```bash
pnpm --filter @garden-hq/worker test
```

Expected: FAIL — `./index` cannot be resolved.

- [ ] **Step 7: Write `apps/worker/src/index.ts`**

```ts
import { Hono } from "hono";
import { pingCore } from "@garden-hq/core";

const app = new Hono();

app.get("/health", (c) =>
  c.json({
    status: "ok",
    core: pingCore(),
  }),
);

export default app;
```

- [ ] **Step 8: Run it and confirm it passes**

```bash
pnpm --filter @garden-hq/worker test
```

Expected: PASS, 1 test.

- [ ] **Step 9: Typecheck and lint**

```bash
pnpm --filter @garden-hq/worker typecheck
pnpm run lint
```

Expected: both exit 0.

- [ ] **Step 10: Best-effort bundle check (optional — skip if it prompts for Cloudflare auth in a non-interactive shell)**

```bash
pnpm --filter @garden-hq/worker exec wrangler deploy --dry-run
```

Expected: bundles successfully without publishing. This does not require the manual Cloudflare setup — `--dry-run` skips the API call.

- [ ] **Step 11: Commit**

```bash
git add apps/worker package.json pnpm-lock.yaml
git commit -m "feat(worker): scaffold Hono/Wrangler app consuming @garden-hq/core"
```

---

### Task 6: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` scripts (Tasks 1–5), `apps/worker`'s `wrangler` devDependency (Task 5), `apps/web`'s build output at `apps/web/dist` (Task 4).

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Enable corepack
        run: corepack enable
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Typecheck
        run: pnpm typecheck
      - name: Lint
        run: pnpm lint
      - name: Test
        run: pnpm test
      - name: Build
        run: pnpm build

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Enable corepack
        run: corepack enable
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Build web
        run: pnpm --filter @garden-hq/web build
      - name: Deploy worker
        run: pnpm --filter @garden-hq/worker exec wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Deploy web (Cloudflare Pages)
        run: pnpm --filter @garden-hq/worker exec wrangler pages deploy ../web/dist --project-name=garden-hq-web
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Note: the `deploy` job will fail until the three manual steps listed under "Manual / external setup" above are done — that's expected, not a bug in this task.

- [ ] **Step 2: Validate YAML syntax**

```bash
node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))" 2>/dev/null || pnpm dlx yaml-lint .github/workflows/ci.yml
```

If neither is available, visually re-check indentation against the block above — GitHub Actions YAML is indentation-sensitive.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add typecheck/lint/test/build pipeline with a deploy job"
```

---

### Task 7: Full monorepo verification pass

**Files:** none (verification only)

- [ ] **Step 1: Clean install from scratch**

```bash
rm -rf node_modules apps/web/node_modules apps/worker/node_modules packages/core/node_modules
pnpm install
```

Expected: exits 0.

- [ ] **Step 2: Run every workspace script from the root**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all four exit 0. `pnpm test` shows passing suites for both `@garden-hq/core` and `@garden-hq/worker`. `pnpm build` produces `apps/web/dist`.

- [ ] **Step 3: Confirm the repo layout matches CLAUDE.md §5**

```bash
ls apps/web apps/worker packages/core .github/workflows
```

Expected: `apps/web`, `apps/worker`, `packages/core` each have content; `.github/workflows/ci.yml` exists.

- [ ] **Step 4: Commit anything left over (e.g. a refreshed lockfile)**

```bash
git status
git add -A
git commit -m "chore: verify phase 0 scaffold end-to-end" --allow-empty-message -m "All workspace scripts (typecheck/lint/test/build) pass from a clean install."
```

If `git status` shows nothing to commit, skip this step.

---

## Self-Review

**Spec coverage:**
- pnpm monorepo, TS strict, vitest, ESLint, Prettier → Tasks 1–2. ✅
- Empty web app deploying → Task 4 (builds) + Task 6 (deploy job, gated on manual Cloudflare setup). ✅
- Empty worker app deploying → Task 5 (builds/tests) + Task 6 (deploy job). ✅
- `packages/core` importable by both apps, pure TS, no `any` → Task 3 (source) + Task 4/5 (consumption) + Task 2 (lint rule scoped to `packages/core`). ✅
- CI: typecheck, test, deploy → Task 6. ✅
- Repo layout exactly matching CLAUDE.md §5 → Task 7 Step 3 checks it explicitly. ✅

**Placeholder scan:** no TBDs; every step has literal file contents or literal commands.

**Type consistency:** `pingCore(): string` is defined once in Task 3 Step 6 and consumed identically (same name, same return type, same literal return value asserted in tests) in Task 4 Step 7 and Task 5 Steps 5/7.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-30-phase-0-scaffold.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
