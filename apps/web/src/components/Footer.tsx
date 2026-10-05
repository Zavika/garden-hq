import { useContests } from "../state/queries";

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
        ; game facts from the{" "}
        <a
          href="https://hypixelskyblock.minecraft.wiki"
          target="_blank"
          rel="noreferrer"
        >
          SkyBlock wiki
        </a>
        ; plot layout after SkyHanni.
      </p>
    </footer>
  );
}
