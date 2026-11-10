import creditsJson from "../../../../data/credits.json";
import { useContests } from "../state/queries";

export interface CreditsData {
  spriteArtist: string;
  sources: readonly { name: string; url: string; use: string }[];
  libraries: readonly { name: string; url: string }[];
}

export function CreditsScreen({ data = creditsJson }: { data?: CreditsData }) {
  const contests = useContests();
  const live = contests.data?.source;

  return (
    <section className="card">
      <h1>Credits</h1>
      <p>Not affiliated with Hypixel or Mojang.</p>

      {data.spriteArtist !== "" ? <p>Sprites by {data.spriteArtist}</p> : null}

      <h2>Sources</h2>
      <ul>
        {data.sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.name}
            </a>{" "}
            - {s.use}
          </li>
        ))}
      </ul>
      {live ? (
        <p>
          Contest schedule currently from{" "}
          <a href={live.url} target="_blank" rel="noreferrer">
            {live.name}
          </a>
          .
        </p>
      ) : null}

      <h2>Built with</h2>
      <ul>
        {data.libraries.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noreferrer">
              {l.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
