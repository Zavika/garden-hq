import { useContests } from "../state/queries";
import { PublicPageLinks } from "./PublicPageLinks";

export function Footer() {
  const contests = useContests();
  const source = contests.data?.source;

  return (
    <footer className="footer">
      <p>Not affiliated with Hypixel or Mojang.</p>
      <p>
        Credits: Jacob&apos;s Contest schedule from{" "}
        {source ? (
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.name}
          </a>
        ) : (
          <a href="https://api.elitebot.dev" target="_blank" rel="noreferrer">
            EliteBot
          </a>
        )}
        .
      </p>
      <PublicPageLinks />
    </footer>
  );
}
