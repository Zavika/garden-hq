import fixture from "../fixtures/bazaar-response.sample.json";
import { describe, expect, it } from "vitest";
import {
  BAZAAR_CROPS,
  COMPOST_ID,
  cropValues,
  extractBazaar,
  plotCoinCost,
  wantedProductIds,
  type BazaarSnapshot,
} from "./bazaar";
import { ALL_CROPS } from "./crops";

// Compact single-line text, as Hypixel serves it.
const fixtureText = JSON.stringify(fixture);

const IDS = [
  "ENCHANTED_CARROT",
  "CARROT_ITEM",
  "ENCHANTED_CARROT_ON_A_STICK",
  "COMPOST",
  "INK_SACK:3",
  "ENCHANTMENT_TURBO_MOONFLOWER_2",
  "ENCHANTED_WHEAT",
  "NOT_IN_BODY",
];

describe("extractBazaar", () => {
  const snap = extractBazaar(fixtureText, IDS);

  it("reads sellOffer as the lowest ask and instantSell as the best bid", () => {
    // Live semantics: buy_summary holds the asks (what an instant buyer pays),
    // sell_summary holds the bids (what an instant seller receives).
    expect(snap.prices.ENCHANTED_CARROT).toEqual({
      sellOffer: 495.4,
      instantSell: 466.2,
    });
    expect(snap.prices.COMPOST).toEqual({
      sellOffer: 7072.8,
      instantSell: 6220.1,
    });
  });

  it("does not confuse prefix-colliding product ids", () => {
    expect(snap.prices.ENCHANTED_CARROT_ON_A_STICK).toEqual({
      sellOffer: null,
      instantSell: null,
    });
    const onlyStick = extractBazaar(fixtureText, [
      "ENCHANTED_CARROT_ON_A_STICK",
    ]);
    expect(Object.keys(onlyStick.prices)).toEqual([
      "ENCHANTED_CARROT_ON_A_STICK",
    ]);
    const onlyCarrot = extractBazaar(fixtureText, ["ENCHANTED_CARROT"]);
    expect(onlyCarrot.prices.ENCHANTED_CARROT?.sellOffer).toBe(495.4);
  });

  it("gives null for an empty book while the other side stays set", () => {
    expect(snap.prices.ENCHANTMENT_TURBO_MOONFLOWER_2).toEqual({
      sellOffer: 1601531.4,
      instantSell: null,
    });
  });

  it("uses min/max, not array position", () => {
    // Fixture arrays for ENCHANTED_WHEAT are deliberately shuffled.
    expect(snap.prices.ENCHANTED_WHEAT).toEqual({
      sellOffer: 993.3,
      instantSell: 923.8,
    });
  });

  it("omits ids that are absent from the body", () => {
    expect("NOT_IN_BODY" in snap.prices).toBe(false);
  });

  it("handles ids with special characters", () => {
    expect(snap.prices["INK_SACK:3"]).toEqual({
      sellOffer: 4.8,
      instantSell: 0.5,
    });
  });

  it("parses lastUpdated, null when missing", () => {
    expect(snap.lastUpdated).toBe(1794344509024);
    expect(
      extractBazaar('{"success":true,"products":{}}', []).lastUpdated,
    ).toBe(null);
  });

  it("returns an empty snapshot for empty or non-JSON bodies", () => {
    expect(extractBazaar("", IDS)).toEqual({ prices: {}, lastUpdated: null });
    expect(extractBazaar("<html>502 Bad Gateway</html>", IDS)).toEqual({
      prices: {},
      lastUpdated: null,
    });
  });

  it("omits a product whose book has a malformed number", () => {
    const body =
      '{"success":true,"lastUpdated":5,"products":{' +
      '"BAD":{"product_id":"BAD","sell_summary":[{"amount":1,"pricePerUnit":abc,"orders":1}],"buy_summary":[{"amount":1,"pricePerUnit":3.5,"orders":1}],"quick_status":{}},' +
      '"GOOD":{"product_id":"GOOD","sell_summary":[{"amount":1,"pricePerUnit":2,"orders":1}],"buy_summary":[{"amount":1,"pricePerUnit":3.5,"orders":1}],"quick_status":{}}}}';
    const out = extractBazaar(body, ["BAD", "GOOD"]);
    expect("BAD" in out.prices).toBe(false);
    expect(out.prices.GOOD).toEqual({ sellOffer: 3.5, instantSell: 2 });
  });

  it("scans a 3 MB body quickly (loose smoke check)", () => {
    const decoy = readDecoy();
    const copies = Math.ceil(3_000_000 / decoy.length);
    const body =
      '{"success":true,"lastUpdated":1,"products":{' +
      Array.from({ length: copies }, (_, i) =>
        decoy.replace(/DECOY/g, `DECOY_${i}`),
      ).join(",") +
      "," +
      fixtureProduct("ENCHANTED_CARROT") +
      "}}";
    expect(body.length).toBeGreaterThan(3_000_000);
    const start = Date.now();
    const out = extractBazaar(body, wantedProductIds());
    const ms = Date.now() - start;
    expect(out.prices.ENCHANTED_CARROT?.sellOffer).toBe(495.4);
    expect(ms).toBeLessThan(100);
  });
});

function fixtureProduct(id: string): string {
  const key = `"${id}":{"product_id":"${id}"`;
  const i = fixtureText.indexOf(key);
  const j = fixtureText.indexOf('"product_id":"', i + key.length);
  const end = j < 0 ? fixtureText.length - 2 : fixtureText.lastIndexOf(',"', j);
  return fixtureText.slice(i, end);
}

function readDecoy(): string {
  return fixtureProduct("ENCHANTED_CARROT").replace(
    /ENCHANTED_CARROT/g,
    "DECOY",
  );
}

function snapshot(
  prices: Record<string, [number | null, number | null]>,
): BazaarSnapshot {
  const out: BazaarSnapshot["prices"] = {};
  for (const [id, [sellOffer, instantSell]] of Object.entries(prices)) {
    out[id] = { sellOffer, instantSell };
  }
  return { prices: out, lastUpdated: 1 };
}

describe("cropValues", () => {
  const carrot = BAZAAR_CROPS.find((c) => c.cropId === "carrot");
  const wheat = BAZAAR_CROPS.find((c) => c.cropId === "wheat");

  it("values 160 raw crops from the enchanted price (ratio 160)", () => {
    if (!carrot) throw new Error("carrot missing");
    const values = cropValues(snapshot({ [carrot.enchantedId]: [500, 400] }));
    const v = values.find((x) => x.cropId === "carrot");
    expect(v).toEqual({
      cropId: "carrot",
      unit: "enchanted",
      sellOffer: (500 * 160) / carrot.rawPerEnchanted,
      instantSell: (400 * 160) / carrot.rawPerEnchanted,
    });
    expect(carrot.rawPerEnchanted).toBe(160);
    expect(v?.sellOffer).toBe(500);
  });

  it("scales by another ratio", () => {
    if (!wheat) throw new Error("wheat missing");
    const v = cropValues(snapshot({ [wheat.enchantedId]: [100, 50] }), [
      { ...wheat, rawPerEnchanted: 80 },
    ])[0];
    expect(v?.sellOffer).toBe(200);
    expect(v?.instantSell).toBe(100);
    expect(v?.unit).toBe("enchanted");
  });

  it("falls back to the raw price when the enchanted product is missing", () => {
    if (!carrot) throw new Error("carrot missing");
    const v = cropValues(snapshot({ [carrot.rawId]: [6, 0.5] })).find(
      (x) => x.cropId === "carrot",
    );
    expect(v).toEqual({
      cropId: "carrot",
      unit: "raw",
      sellOffer: 960,
      instantSell: 80,
    });
  });

  it("falls back per side and marks the unit raw", () => {
    if (!carrot) throw new Error("carrot missing");
    const v = cropValues(
      snapshot({
        [carrot.enchantedId]: [500, null],
        [carrot.rawId]: [6, 0.5],
      }),
    ).find((x) => x.cropId === "carrot");
    expect(v).toEqual({
      cropId: "carrot",
      unit: "raw",
      sellOffer: 500,
      instantSell: 80,
    });
  });

  it("sorts best sellOffer first with nulls last", () => {
    if (!carrot || !wheat) throw new Error("crops missing");
    const values = cropValues(
      snapshot({
        [wheat.enchantedId]: [900, 800],
        [carrot.enchantedId]: [500, 400],
      }),
    );
    expect(values[0]?.cropId).toBe("wheat");
    expect(values[1]?.cropId).toBe("carrot");
    expect(values.slice(2).every((v) => v.sellOffer === null)).toBe(true);
  });

  it("only returns crops listed in BAZAAR_CROPS", () => {
    const ids = cropValues(snapshot({})).map((v) => v.cropId);
    expect(ids.sort()).toEqual(BAZAAR_CROPS.map((c) => c.cropId).sort());
    expect(ids).not.toContain("sunflower");
  });
});

describe("plotCoinCost", () => {
  it("multiplies compost needed by the compost sell offer", () => {
    expect(plotCoinCost(64, snapshot({ [COMPOST_ID]: [7000, 6000] }))).toBe(
      448000,
    );
  });
  it("is null when compost is unknown", () => {
    expect(plotCoinCost(64, snapshot({}))).toBeNull();
    expect(
      plotCoinCost(64, snapshot({ [COMPOST_ID]: [null, 6000] })),
    ).toBeNull();
  });
  it("is 0 for 0 compost", () => {
    expect(plotCoinCost(0, snapshot({ [COMPOST_ID]: [7000, 6000] }))).toBe(0);
  });
});

describe("bazaar data", () => {
  it("wantedProductIds has no duplicates and includes COMPOST", () => {
    const ids = wantedProductIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(COMPOST_ID);
    expect(COMPOST_ID).toBe("COMPOST");
  });
  it("every bazaar crop exists in ALL_CROPS", () => {
    for (const c of BAZAAR_CROPS) {
      expect(ALL_CROPS.some((a) => a.id === c.cropId)).toBe(true);
    }
  });
});
