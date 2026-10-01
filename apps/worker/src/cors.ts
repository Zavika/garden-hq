import type { Env } from "./env";

export const DEV_ORIGIN = "http://localhost:5173";

/** Origin allow-list: the web app, plus localhost only in dev. */
export function allowedOriginFor(
  env: Pick<Env, "WEB_ORIGIN" | "ENVIRONMENT">,
): (origin: string) => string | null {
  return (origin) => {
    if (env.WEB_ORIGIN !== undefined && origin === env.WEB_ORIGIN)
      return origin;
    if (env.ENVIRONMENT === "dev" && origin === DEV_ORIGIN) return origin;
    return null;
  };
}
