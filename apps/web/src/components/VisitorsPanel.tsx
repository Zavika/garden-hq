import { VisitorAvatar } from "./PixelArt";

export function VisitorsPanel({
  visitors,
}: {
  visitors: { id: string; name: string }[];
}) {
  return (
    <section className="card" aria-label="Visitors">
      <h2>
        Visitors <span className="num">({visitors.length}/5)</span>
      </h2>
      {visitors.length === 0 ? (
        <p>Nobody is waiting at the Barn.</p>
      ) : (
        <ul className="chips">
          {visitors.map((v) => (
            <li key={v.id} className="chip">
              <VisitorAvatar name={v.name} />
              <span>{v.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
