import { useNavigate } from "react-router-dom";
import { SyncSection } from "../components/SyncSection";
import { useStorage, useStoredData } from "../state/StorageProvider";

function timeZones(current: string): string[] {
  const zones = new Set<string>(["UTC", "Europe/Warsaw", current]);
  try {
    for (const zone of Intl.supportedValuesOf("timeZone")) zones.add(zone);
  } catch {
    // Older engines: keep the short list.
  }
  return [...zones].sort();
}

export function SettingsScreen() {
  const navigate = useNavigate();
  const storage = useStorage();
  const { link, timeZone } = useStoredData();

  return (
    <section className="card">
      <h1>Settings</h1>

      <label>
        Time zone
        <select
          value={timeZone}
          onChange={(e) => storage.setTimeZone(e.target.value)}
        >
          {timeZones(timeZone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>

      <SyncSection />

      {link !== null ? (
        <>
          <p>Linked as {link.name}</p>
          {link.profiles.length > 1 ? (
            <label>
              Profile
              <select
                value={link.profileId}
                onChange={(e) =>
                  storage.setLink({ ...link, profileId: e.target.value })
                }
              >
                {link.profiles.map((p) => (
                  <option key={p.profileId} value={p.profileId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" onClick={() => navigate("/link")}>
            Switch username
          </button>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => {
          storage.clearAll();
          navigate("/link");
        }}
      >
        Clear local data
      </button>
      <p className="muted">
        Clears this device only. Your cloud copy stays and reloads on next sync.
      </p>
    </section>
  );
}
