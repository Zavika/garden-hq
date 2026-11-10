// Audited 2026-11-10 against apps/worker/migrations and the web state modules.
// A drift test (privacy.drift.test.ts) fails when a table or storage key changes.
export const PRIVACY_CONTACT_URL = "https://github.com/Zavika/garden-hq/issues";

export interface StoredTable {
  table: string;
  what: string;
}

export const SERVER_TABLES: readonly StoredTable[] = [
  {
    table: "accounts",
    what: "Your Minecraft UUID and name, your selected profile and profile list, your time zone, your last-seen date and a daily change counter. Your sync code is stored only as a hash.",
  },
  {
    table: "plot_assignments",
    what: "The crop you assigned to each plot.",
  },
  {
    table: "greenhouses",
    what: "Your Greenhouse layout and timers.",
  },
  {
    table: "quest_log",
    what: "Your quest and XP progress.",
  },
  {
    table: "achievements",
    what: "The achievements you have earned.",
  },
  {
    table: "garden_snapshot",
    what: "The latest copy of your Hypixel Garden data. It is replaced on each sync.",
  },
  {
    table: "alert_settings",
    what: "Your Discord webhook URL and which alerts are on. The webhook URL is never shown again (only its last 4 characters) and is never logged.",
  },
  {
    table: "alert_log",
    what: "Which alerts were already sent, so none repeats.",
  },
];

// Tables that hold no personal data.
export const NO_PERSONAL_DATA_TABLES: readonly string[] = ["account_creations"];

export const NO_PERSONAL_DATA_NOTE =
  "account_creations holds timestamps only. It is used to rate-limit account creation and holds no identifiers.";

export const ALERT_LOG_RETENTION_DAYS = 7;

export const BROWSER_KEYS: readonly { key: string; what: string }[] = [
  {
    key: "garden-hq:v1",
    what: "Your linked Minecraft username and UUID, your selected SkyBlock profile, your plot crop assignments, your Greenhouse layout and timers, your quest and XP progress, and your time zone.",
  },
  {
    key: "garden-hq:sync:v1",
    what: "Your sync code and the changes waiting to upload.",
  },
];

export const RECIPIENTS: readonly { name: string; what: string }[] = [
  {
    name: "Hypixel API",
    what: "Our server sends your profile ID or UUID to fetch your Garden.",
  },
  {
    name: "Mojang API",
    what: "Looks up your username when you link.",
  },
  {
    name: "EliteBot",
    what: "Provides the contest schedule. We send no personal data.",
  },
  {
    name: "playerdb.co",
    what: "Backup username lookup, used only when the Mojang API is unavailable.",
  },
  {
    name: "Discord",
    what: "Receives alert text at the webhook you provide.",
  },
  {
    name: "Cloudflare",
    what: "Hosts the site and runs Workers, D1, KV and logs.",
  },
];
