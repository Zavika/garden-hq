import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { LinkResponse } from "@garden-hq/core";
import { ApiError } from "../api/client";
import { useLink } from "../state/queries";
import { useStorage } from "../state/StorageProvider";
import { useNow } from "../state/useNow";

function RateLimitNotice({ retryAfter }: { retryAfter: number | undefined }) {
  const now = useNow();
  const [startedAt] = useState(now);
  const total = retryAfter ?? 60;
  const remaining = Math.max(0, Math.ceil(total - (now - startedAt) / 1000));
  return (
    <p role="alert">
      Too many requests. Try again in <span aria-live="off">{remaining}</span>s.
    </p>
  );
}

function errorMessage(error: ApiError): string {
  switch (error.code) {
    case "bad_request":
      return "Enter a valid Minecraft username (3-16 letters, numbers or underscores).";
    case "unknown_player":
      return "We couldn't find that player.";
    case "not_found":
      return "We couldn't find that player.";
    case "no_garden":
      return "That player has no SkyBlock garden yet.";
    case "bad_api_key":
    case "missing_api_key":
      return import.meta.env.DEV
        ? "Linking is temporarily unavailable. Dev hint: set HYPIXEL_API_KEY in apps/worker/.dev.vars."
        : "Linking is temporarily unavailable. Please try again later.";
    case "network":
      return "We couldn't reach the server. Check your connection.";
    case "upstream_down":
      return "Hypixel is unavailable right now. Try again in a moment.";
    default:
      return "Something went wrong on our side. Try again in a moment.";
  }
}

export function LinkScreen() {
  const navigate = useNavigate();
  const storage = useStorage();
  const link = useLink();
  const [name, setName] = useState("");
  const [pending, setPending] = useState<LinkResponse | null>(null);
  const [chosen, setChosen] = useState<string>("");

  function finish(result: LinkResponse, profileId: string) {
    storage.setLink({
      name: result.name,
      uuid: result.uuid,
      profileId,
      profiles: result.profiles,
    });
    navigate("/", { replace: true });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    link.mutate(name.trim(), {
      onSuccess: (result) => {
        if (result.profiles.length > 1) {
          setPending(result);
          setChosen(result.profileId);
        } else {
          finish(result, result.profileId);
        }
      },
    });
  }

  if (pending !== null) {
    return (
      <section className="card">
        <h1>Choose a profile</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            finish(pending, chosen);
          }}
        >
          {pending.profiles.map((p) => (
            <label key={p.profileId} className="radio-row">
              <input
                type="radio"
                name="profile"
                value={p.profileId}
                checked={chosen === p.profileId}
                onChange={() => setChosen(p.profileId)}
              />
              {p.name}
            </label>
          ))}
          <button type="submit">Continue</button>
        </form>
      </section>
    );
  }

  const error = link.error;
  return (
    <section className="card">
      <h1>Garden HQ</h1>
      <form onSubmit={onSubmit}>
        <label>
          Minecraft username
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" disabled={link.isPending || name.trim() === ""}>
          {link.isPending ? "Linking…" : "Link"}
        </button>
      </form>
      {error instanceof ApiError ? (
        error.code === "rate_limited" ? (
          <RateLimitNotice
            key={link.submittedAt}
            retryAfter={error.retryAfter}
          />
        ) : (
          <p role="alert">{errorMessage(error)}</p>
        )
      ) : null}
      <p>
        <Link className="link-target" to="/settings">
          Restore from a sync code
        </Link>
      </p>
    </section>
  );
}
