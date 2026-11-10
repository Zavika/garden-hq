import { PublicPageLinks } from "../components/PublicPageLinks";
import {
  ALERT_LOG_RETENTION_DAYS,
  BROWSER_KEYS,
  NO_PERSONAL_DATA_NOTE,
  PRIVACY_CONTACT_URL,
  RECIPIENTS,
  SERVER_TABLES,
} from "./privacy";

export function PrivacyScreen() {
  return (
    <section className="card">
      <h1>Privacy</h1>
      <p>Last updated 2026-11-10</p>
      <p>
        This is a plain-language notice, not legal advice. Minecraft usernames
        and UUIDs are public information. The app only reads what the public
        Hypixel API returns for the name you enter.
      </p>

      <h2>What we store in your browser</h2>
      <ul>
        {BROWSER_KEYS.map((k) => (
          <li key={k.key}>
            <code>{k.key}</code>: {k.what}
          </li>
        ))}
      </ul>

      <p>
        When you link a username, we cache the public username-to-UUID lookup on
        our server (Cloudflare KV) for 24 hours, even without Cloud save. It is
        not tied to an account.
      </p>

      <h2>What we store on our server (only if you turn on Cloud save)</h2>
      <p>
        Apart from that cache, we store the data below in Cloudflare D1 only
        after you turn on Cloud save (and Alerts).
      </p>
      <ul>
        {SERVER_TABLES.map((t) => (
          <li key={t.table}>
            <code>{t.table}</code>: {t.what}
          </li>
        ))}
      </ul>
      <p>{NO_PERSONAL_DATA_NOTE}</p>
      <p>
        Our server uses your IP address as a short-lived rate-limit key (seconds
        to minutes), and Cloudflare also sees it to deliver the site. It is
        never stored in the database.
      </p>

      <h2>Retention and deleting your data</h2>
      <p>
        <code>alert_log</code> entries are deleted automatically after{" "}
        {ALERT_LOG_RETENTION_DAYS} days. Everything else is kept until you
        delete it; there is no other automatic deletion yet. Accounts with no
        activity for 60 days are only skipped by the alert checker.
      </p>
      <p>
        To delete your server data, open Settings, go to Cloud save and press
        Delete cloud data. This removes every row listed above for your account.
        Clearing your browser data removes the local copy.
      </p>

      <h2>Who else receives data</h2>
      <ul>
        {RECIPIENTS.map((r) => (
          <li key={r.name}>
            <strong>{r.name}</strong>: {r.what}
          </li>
        ))}
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>No cookies.</li>
        <li>No analytics.</li>
        <li>No advertising.</li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions or requests? Open an issue:{" "}
        <a
          className="privacy-contact"
          href={PRIVACY_CONTACT_URL}
          target="_blank"
          rel="noreferrer"
        >
          {PRIVACY_CONTACT_URL}
        </a>
      </p>

      <PublicPageLinks />
    </section>
  );
}
