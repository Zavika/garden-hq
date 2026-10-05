export function VisitorsPanel({
  visitors,
}: {
  visitors: { id: string; name: string }[];
}) {
  return (
    <section className="card" aria-label="Visitors">
      <h2>Visitors ({visitors.length}/5)</h2>
      {visitors.length === 0 ? (
        <p>Nobody is waiting at the Barn.</p>
      ) : (
        <ul>
          {visitors.map((v) => (
            <li key={v.id}>{v.name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
