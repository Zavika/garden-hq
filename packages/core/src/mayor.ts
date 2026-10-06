import { asArray, asRecord, asString } from "./coerce";
import { stripFormatting } from "./text";
import type { Mayor, MayorPerk } from "./types";

function normalizePerk(raw: unknown): MayorPerk | null {
  const data = asRecord(raw);
  const name = stripFormatting(asString(data.name));
  if (name === "") return null;
  return { name, description: stripFormatting(asString(data.description)) };
}

// VERIFY: shape of /v2/resources/skyblock/election (`mayor.key|name|perks[]`,
// `mayor.minister.{key,name,perk}`) is from public docs, not a captured response.
export function normalizeMayor(raw: unknown): Mayor | null {
  const mayor = asRecord(asRecord(raw).mayor);
  const name = stripFormatting(asString(mayor.name));
  if (name === "") return null;

  const minister = asRecord(mayor.minister);
  const ministerName = stripFormatting(asString(minister.name));

  return {
    key: asString(mayor.key),
    name,
    perks: asArray(mayor.perks)
      .map(normalizePerk)
      .filter((perk): perk is MayorPerk => perk !== null),
    minister:
      ministerName === ""
        ? null
        : {
            key: asString(minister.key),
            name: ministerName,
            perk: normalizePerk(minister.perk),
          },
  };
}
