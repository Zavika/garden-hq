import { describe, expect, it } from "vitest";
import electionResponse from "../fixtures/election-response.sample.json";
import { normalizeMayor } from "./mayor";

describe("normalizeMayor", () => {
  it("strips Minecraft colour codes from names and descriptions", () => {
    const mayor = normalizeMayor({
      mayor: {
        key: "finnegan",
        name: "§bFinnegan",
        perks: [
          {
            name: "§6Farming Simulator",
            description: "§7Pests spawn §a+25%§7 less.",
          },
        ],
        minister: {
          key: "jerry",
          name: "§dJerry",
          perk: { name: "§eMinister Perk", description: "§7Text" },
        },
      },
    });
    expect(mayor).toEqual({
      key: "finnegan",
      name: "Finnegan",
      perks: [
        { name: "Farming Simulator", description: "Pests spawn +25% less." },
      ],
      minister: {
        key: "jerry",
        name: "Jerry",
        perk: { name: "Minister Perk", description: "Text" },
      },
    });
  });

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
