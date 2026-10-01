import { describe, expect, it } from "vitest";
import electionResponse from "../fixtures/election-response.sample.json";
import { normalizeMayor } from "./mayor";

describe("normalizeMayor", () => {
  it("normalizes mayor, perks and minister", () => {
    expect(normalizeMayor(electionResponse)).toEqual({
      key: "finnegan",
      name: "Finnegan",
      perks: [
        { name: "Farming Simulator", description: "Fixture text." },
        { name: "Pelt-pocalypse", description: "Fixture text." },
      ],
      minister: {
        key: "jerry",
        name: "Jerry",
        perk: { name: "Fixture Perk", description: "Fixture text." },
      },
    });
  });

  it("handles a mayor with no minister and drops nameless perks", () => {
    expect(
      normalizeMayor({
        mayor: {
          key: "x",
          name: "X",
          perks: [{ description: "no name" }, "junk"],
        },
      }),
    ).toEqual({ key: "x", name: "X", perks: [], minister: null });
  });

  it("returns null when there is no mayor name", () => {
    expect(normalizeMayor(null)).toBeNull();
    expect(normalizeMayor({ mayor: {} })).toBeNull();
    expect(normalizeMayor({ mayor: { key: "x" } })).toBeNull();
  });
});
