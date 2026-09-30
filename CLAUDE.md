# Garden HQ — Hypixel SkyBlock Garden manager

A gamified companion web app for the **Hypixel SkyBlock Garden**. The player links a Minecraft username, the app pulls their Garden from the Hypixel API, renders it as a pixel-art 5x5 plot map, and tells them what to do next: which contest is coming, when the composter needs fuel, which plot to unlock, which visitors are waiting, and when Greenhouse mutations need attention. Notifications go out through Discord and web push.

It is an **out-of-game website**, not a Minecraft mod. It never automates gameplay.

---

## 1. Concept mapping (real garden idea → SkyBlock)

| Original idea | SkyBlock version |
|---|---|
| Build out your zone (pots, grass, beds) | 5x5 plot grid around the Barn. 24 plots, 96x96 blocks each. Unlocked plots come from the API; the player assigns a crop/preset to each plot in the app |
| Weather + location | SkyBlock clock: season, day/night (Sunflower by day, Moonflower by night), Jacob's Contest schedule, current Mayor perks (Finnegan, Jacob) |
| Crop database (seasons, water, pests) | Static data files: 13 crops, garden-level unlocks, base drops, which pest each crop attracts, contest crops, tool per crop, Greenhouse mutations and their recipes |
| Water demand | Composter fuel and organic matter; Greenhouse mutations that need watering and dry out |
| Pest defence | 14 pest types, pest count warning (fortune drops at 4+ pests), trap bait guide |
| Gamify + notifications | Daily quests, streaks, "next best action" planner, Discord/web push alerts |

---

## 2. Game facts the app relies on

Verify each against the wiki (hypixelskyblock.minecraft.wiki) before hardcoding. Store in `/data/*.json`, never inline in components.

**Garden levels:** 1–15. XP per level: 0, 70, 70, 140, 240, 600, 1500, 2000, 2500, 3000, then 10,000 each for 11–15 (cumulative 60,120). Garden XP comes from visitors and milestones.

**Crops and unlock level:**
Wheat 1, Carrot 2, Potato 3, Pumpkin 4, Sugar Cane 5, Melon 6, Cactus 7, Cocoa Beans 8, Mushroom 9, Nether Wart 10, Sunflower 11, Moonflower 11, Wild Rose 12.

**Plots:** 24 plots in 4 tiers gated by garden level 1 / 3 / 5 / 7. API IDs look like `beginner_1`, `intermediate_3`. Cost depends on how many plots are already bought *in that tier*, not the plot number. Tier A costs 1, 2, 4, 8 Compost; tier B 16, 24, 32, 48; tier C starts at 64, 96, 128, then Compost Bundles. Each plot gives +3 Farming Fortune. Build a lookup `data/plots.json` mapping each ID → grid (x, y), tier, and the full cost ladder.

**Composter:** 1 Compost per 10 minutes at base, each costing 4,000 Organic Matter + 2,000 Fuel. Upgrades: speed, multi_drop, fuel_cap, organic_matter_cap, cost_reduction. The app simulates forward from the API's `last_save` to predict "fuel runs out at…" and "full at…". Get upgrade formulas from the Composter wiki page.

**Visitors:** max 5 in queue. Base timer ~15 min, shortened by farming and serving visitors. Rewards: Farming XP, Garden XP, Copper. Visitors have rarities and requirements.

**Pests:** unlock at garden level 5. One pest type per crop (13) plus extras, up to 8 at once. At 4+ pests Farming Fortune drops. Pests also spawn once per hour while the Garden is unloaded (offline). Pest Traps (max 3) use bait:
- Compost → Mosquito, Earthworm
- Plant Matter → Locust, Slug
- Dung → Beetle, Fly
- Honey Jar → Moth, Cricket
- Tasty Cheese → Rat, Mite

**Greenhouse (0.24, Dec 2025):** unlocked at garden level 7 via the Carpenter visitor. Up to 3 Greenhouse plots. Crops grow over real hours/days, online or offline. 40 Mutations are made by arranging crops around empty soil; many need watering, and placed mutations decay over time. Yield bonus: +3% per unique non-mutated crop (max 12). Mutation recipes were rebalanced several times in 2026, so keep `data/mutations.json` versioned with a `lastVerified` date.

**Chips:** consumable perk items upgraded with Sowdust. Chip state is not reliably exposed by the API; track it manually.

**Jacob's Contests:** Hypixel has no official schedule endpoint. Use community sources:
- `https://api.elitebot.dev/contests/at/now` (crowdsourced from SkyHanni users)
- fallback: `https://jacobs.strassburger.dev/api/jacobcontests` (requires a visible credit link)

**SkyBlock calendar:** derive from the SkyBlock epoch (commonly `1560275700000` ms; verify). 1 SkyBlock day = 20 real minutes; 1 year = 124 real hours; 12 months of 31 days. Put this in one tested module.

---

## 3. Data sources

| Source | Endpoint | Key? | Use |
|---|---|---|---|
| Mojang | `api.mojang.com/users/profiles/minecraft/{name}` | no | username → UUID |
| Hypixel | `/v2/skyblock/profiles?uuid=` | yes | profile list, selected profile, farming skill, crop collections |
| Hypixel | `/v2/skyblock/garden?profile=` | yes | `garden_experience`, `unlocked_plots_ids`, `composter_data`, `active_commissions` (current visitors), `commission_data`, `crop_upgrade_levels`, `resources_collected` (milestones), barn skins |
| Hypixel | `/v2/resources/skyblock/election` | no | current mayor and perks |
| Hypixel | `/v2/skyblock/bazaar` | no | crop / compost / fuel prices for profit hints |
| EliteBot | `/contests/at/now` | no | contest schedule |

**API rules:**
- Get a key from developer.hypixel.net. Development keys are short-lived; apply for a production app key before public launch.
- The key lives **only** in the backend (Worker secret). Never ship it to the browser.
- Respect `RateLimit-*` response headers. Cache public endpoints (election, bazaar) at the edge. Never edge-cache per-player endpoints.
- API data is a snapshot, not live. Show "last synced X min ago" everywhere, and treat the API as truth for what it covers and user input for everything else (plot crop assignments, Greenhouse layout, chips, pest count).

---

## 4. Topology

```
                ┌──────────────────────────────┐
                │        Browser (PWA)         │
                │  React + TS + Vite           │
                │  PixiJS garden map (canvas)  │
                │  Service worker (web push)   │
                └──────────────┬───────────────┘
                               │ HTTPS /api/*
                ┌──────────────▼───────────────┐
                │   Cloudflare Worker (Hono)   │
                │  routes · auth · cache       │
                │  HYPIXEL_API_KEY secret      │
                └───┬───────────┬──────────┬───┘
                    │           │          │
         ┌──────────▼──┐  ┌─────▼─────┐ ┌──▼────────────────┐
         │ D1 (SQLite) │  │ KV cache  │ │ Cron Trigger      │
         │ users, plots│  │ election, │ │ every 5 min:      │
         │ quests, xp, │  │ bazaar,   │ │  sync gardens,    │
         │ alerts, gh  │  │ contests  │ │  compute events,  │
         └─────────────┘  └───────────┘ │  send alerts      │
                                        └──┬────────────┬───┘
                     external APIs         │            │
   ┌────────────┬──────────────┬────────┐  │   ┌────────▼────────┐
   │ Hypixel v2 │ Mojang       │EliteBot│◄─┘   │ Notifiers       │
   └────────────┴──────────────┴────────┘      │ Discord webhook │
                                               │ Web Push (VAPID)│
                                               └─────────────────┘
```

**Rule:** all game logic lives in `packages/core` as pure TypeScript functions (no fetch, no DOM). The web app and the Worker both import it. That keeps it unit-testable and lets the cron job and UI agree on every number.

---

## 5. Repo layout

```
garden-hq/
├─ CLAUDE.md
├─ package.json              # pnpm workspaces
├─ data/                     # curated game data (JSON, versioned)
│  ├─ crops.json             # id, name, apiId, unlockLevel, baseDrops, pest, tool, contestCrop
│  ├─ plots.json             # id, grid x/y, tier, costLadder
│  ├─ pests.json             # id, crop, bait, unlockLevel
│  ├─ mutations.json         # id, rarity, recipe pattern, needsWater, effects, lastVerified
│  ├─ visitors.json          # id, rarity, requirements
│  ├─ garden-levels.json
│  └─ composter.json         # upgrade formulas
├─ packages/
│  └─ core/                  # pure logic + tests (vitest)
│     ├─ calendar.ts         # SkyBlock date, season, day/night, next contest
│     ├─ garden.ts           # normalize API garden → GardenState
│     ├─ plots.ts            # grid build, next-plot cost, cheapest unlock path
│     ├─ composter.ts        # simulate forward from last_save
│     ├─ visitors.ts         # queue status, required items, copper value
│     ├─ contests.ts         # filter schedule by player's crops
│     ├─ greenhouse.ts       # mutation recipe check, water/decay timers
│     ├─ planner.ts          # "next best action" ranking
│     ├─ quests.ts           # daily quest generation + XP/streak rules
│     └─ types.ts
├─ apps/
│  ├─ web/                   # Vite + React + TS
│  │  ├─ src/map/            # PixiJS: plot grid, barn, crop sprites, pests, visitors
│  │  ├─ src/screens/        # Home, Map, Greenhouse, Contests, Quests, Settings
│  │  ├─ src/state/          # Zustand store + TanStack Query
│  │  ├─ public/sprites/     # original pixel art (no ripped game textures)
│  │  └─ sw.ts               # service worker, push handler
│  └─ worker/                # Cloudflare Worker (Hono)
│     ├─ routes/             # /api/link, /api/garden, /api/contests, /api/alerts
│     ├─ hypixel.ts          # client + rate limiting + retries
│     ├─ cron.ts             # sync + event detection + dispatch
│     ├─ notify/discord.ts
│     ├─ notify/webpush.ts
│     └─ schema.sql          # D1 tables
└─ .github/workflows/ci.yml  # typecheck, test, deploy
```

---

## 6. Data model (D1)

- `users` (id, mc_uuid, mc_name, profile_id, discord_webhook, push_subscription, tz, created_at)
- `garden_snapshots` (user_id, fetched_at, json) — keep last 48h for diffs
- `plot_assignments` (user_id, plot_id, crop_id, note)
- `greenhouse_cells` (user_id, gh_plot, x, y, content, planted_at, last_watered_at)
- `chips` (user_id, chip_id, rarity, level)
- `quests` (user_id, date, quest_id, target, progress, done)
- `player_xp` (user_id, xp, level, streak, last_active_date)
- `alert_rules` (user_id, type, enabled, lead_minutes)
- `alert_log` (user_id, type, key, sent_at) — dedupe so nothing fires twice

---

## 7. Features

### Map (home screen)
- Top-down pixel 5x5 grid, Barn in the centre. Locked plots greyed with their compost cost on hover.
- Unlocked plots show the assigned crop sprite; tap to assign crop.
- Visitor sprites queue at the Barn (from `active_commissions`), with requested items.
- Composter gauge (fuel, organic matter, compost ready) animated from the simulation.
- HUD strip: SkyBlock date, season, day/night icon, next contest countdown + its 3 crops, current Mayor.

### Planner ("what should I do now?")
Ranked list from `planner.ts`:
1. Contest starting soon for a crop you have a plot for
2. Composter out of fuel / full
3. Visitors waiting (show copper + garden XP value)
4. Greenhouse mutation drying out or about to decay
5. Cheapest next plot unlock and compost still needed
6. Next garden level: XP remaining and fastest source
7. Crop milestone closest to completion

### Greenhouse planner
10x10 grid editor per Greenhouse plot. Pick a target mutation → highlight required crop pattern. Water/decay timers are user-started (the API does not expose them). Unique-crop yield bonus shown live.

### Contests
Upcoming list filtered to the player's crops, with real-world local time (Europe/Warsaw default, user-settable).

### Gamification layer
- Player XP + level separate from game XP, earned by completing planner actions (confirmed by the next API sync where possible: plot unlocked, garden XP increased, visitors served count up).
- 3 daily quests generated from the current state, e.g. "Serve 5 visitors", "Unlock plot 6", "Place 3 pest traps".
- Streaks for days with at least one completed quest.
- Achievements: first Greenhouse, all 24 plots, 13 crops planted, 40 mutations logged.
- Only reward things verifiable from the API or clearly user-logged. Never reward just opening the app.

### Notifications
Types: `contest_soon` (default 5 min lead), `composter_fuel_low`, `composter_full`, `visitors_waiting`, `greenhouse_water`, `greenhouse_decay`, `level_up`, `quest_reset`.
Channels: Discord webhook (MVP) and web push (phase 3). Every alert is deduped via `alert_log`.

---

## 8. Build order

Work phase by phase. Each phase ends with passing tests and a working deploy.

**Phase 0 — scaffold**
pnpm monorepo, TS strict, vitest, ESLint, Prettier. Empty web + worker apps deploying.

**Phase 1 — core + data**
Write `data/*.json` from the wiki (crops, plots, pests, levels). Implement `calendar.ts`, `garden.ts`, `plots.ts`, `composter.ts` with unit tests using a saved sample API response in `packages/core/fixtures/`.

**Phase 2 — read-only dashboard**
Worker: `/api/link` (username → uuid → profiles), `/api/garden`. Web: link screen, map with real unlocked plots, composter gauge, visitors, HUD with calendar and contests.

**Phase 3 — planner + notifications**
`planner.ts`, cron sync every 5 min for linked users, Discord webhook alerts, then web push + PWA install.

**Phase 4 — Greenhouse + gamification**
Greenhouse editor, mutation data, timers. Quests, XP, streaks, achievements.

**Phase 5 — polish**
Original pixel art sprites, sound toggle, mobile layout, bazaar profit hints, privacy page, credits page (EliteBot / contest source, wiki).

---

## 9. Conventions for Claude Code

- TypeScript strict everywhere. No `any` in `packages/core`.
- Game numbers come from `/data`, never magic numbers in code.
- Every `core` function gets a vitest test. Use fixtures, never live API calls in tests.
- Normalize API responses at the boundary (`garden.ts`); the rest of the app uses `GardenState`, not raw JSON. Every API field is optional — handle missing data.
- Mobile-first UI. The map must work at 380px width.
- Pixel art: nearest-neighbour scaling, integer zoom levels only.
- Do not copy Hypixel or Minecraft textures. Use original sprites.
- Add a footer: "Not affiliated with Hypixel or Mojang."
- When a game mechanic is uncertain, add a `// VERIFY:` comment and list it in `data/VERIFY.md` instead of guessing silently.
