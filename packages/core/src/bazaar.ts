import bazaarData from "../../../data/bazaar.json";

/**
 * Bazaar order-book semantics (verified against the live response, see
 * data/VERIFY.md): Hypixel's `buy_summary` lists the SELL OFFERS (asks) that an
 * instant buyer pays, lowest first; `sell_summary` lists the BUY ORDERS (bids)
 * that an instant seller receives, highest first. So:
 *   sellOffer   = lowest price in buy_summary  (what buying costs / list price)
 *   instantSell = highest price in sell_summary (what selling right now yields)
 * Both are taken as min/max so array ordering cannot matter.
 */
export interface BazaarPrice {
  sellOffer: number | null;
  instantSell: number | null;
}
export type BazaarPrices = Record<string, BazaarPrice>;
export interface BazaarSnapshot {
  prices: BazaarPrices;
  lastUpdated: number | null;
}
export interface BazaarCropEntry {
  cropId: string;
  rawId: string;
  enchantedId: string;
  rawPerEnchanted: number;
}

interface BazaarData {
  lastVerified: string;
  compostId: string;
  looseCompostMaxCost: number;
  crops: BazaarCropEntry[];
}

const DATA = bazaarData as BazaarData;

export const BAZAAR_CROPS: readonly BazaarCropEntry[] = DATA.crops;
export const COMPOST_ID: string = DATA.compostId;
/** Largest plot rung known to be paid in loose Compost (above: bundles). */
export const LOOSE_COMPOST_MAX_COST: number = DATA.looseCompostMaxCost;

/** Raw crops are valued per this many items (matches the enchanted recipe). */
const CROP_BATCH = 160;

export function wantedProductIds(): string[] {
  const ids = new Set<string>();
  for (const crop of BAZAAR_CROPS) {
    ids.add(crop.rawId);
    ids.add(crop.enchantedId);
  }
  ids.add(COMPOST_ID);
  return [...ids];
}

const PRICE_RE = /"pricePerUnit":([^,}\]\s]*)/g;

/** Returns all prices in a book, or null if any is not a finite number. */
function readBook(text: string): number[] | null {
  const out: number[] = [];
  for (const match of text.matchAll(PRICE_RE)) {
    const raw = match[1] ?? "";
    const n = raw === "" ? Number.NaN : Number(raw);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

/** Text of the array that follows `"<name>":[` inside `slice`, or null. */
function bookText(slice: string, name: string): string | null {
  const marker = `"${name}":[`;
  const start = slice.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  // Entries are flat objects with no nested arrays: the first `]` ends the book.
  const end = slice.indexOf("]", from);
  if (end < 0) return null;
  return slice.slice(from, end);
}

/**
 * Text-scan extraction; never JSON.parse the whole body (it is ~3.4 MB).
 * One pass over the body: visit every `"product_id":"ID"` occurrence, keep it only
 * if ID is wanted and the text just before is exactly `"ID":{` (so prefix
 * collisions and decoys never match), then read the two books from the slice up
 * to the next `"product_id":"`.
 */
export function extractBazaar(
  body: string,
  ids: readonly string[],
): BazaarSnapshot {
  const head = body.slice(0, 1000);
  const updated = /"lastUpdated":(\d+)/.exec(head);
  const lastUpdated = updated ? Number(updated[1]) : null;
  const prices: BazaarPrices = {};
  const wanted = new Set(ids);
  const marker = '"product_id":"';
  let at = body.indexOf(marker);
  while (at >= 0) {
    const idStart = at + marker.length;
    const idEnd = body.indexOf('"', idStart);
    if (idEnd < 0) break;
    const next = body.indexOf(marker, idEnd);
    const id = body.slice(idStart, idEnd);
    // The key must be exactly "ID":{ right before product_id (rejects decoys).
    const keyText = '"' + id + '":{';
    if (
      wanted.has(id) &&
      !(id in prices) &&
      body.startsWith(keyText, at - keyText.length)
    ) {
      const slice = body.slice(idEnd, next < 0 ? body.length : next);
      const asks = bookText(slice, "buy_summary");
      const bids = bookText(slice, "sell_summary");
      const askPrices = asks === null ? null : readBook(asks);
      const bidPrices = bids === null ? null : readBook(bids);
      if (askPrices !== null && bidPrices !== null) {
        prices[id] = {
          sellOffer: askPrices.length ? Math.min(...askPrices) : null,
          instantSell: bidPrices.length ? Math.max(...bidPrices) : null,
        };
      }
    }
    at = next;
  }
  return {
    prices,
    lastUpdated:
      lastUpdated !== null && Number.isFinite(lastUpdated) ? lastUpdated : null,
  };
}

export interface CropValue {
  cropId: string;
  unit: "enchanted" | "raw";
  sellOffer: number | null;
  instantSell: number | null;
}

function sideValue(
  entry: BazaarCropEntry,
  snapshot: BazaarSnapshot,
  side: keyof BazaarPrice,
): { value: number | null; fromEnchanted: boolean } {
  const ench = snapshot.prices[entry.enchantedId]?.[side] ?? null;
  if (ench !== null) {
    return {
      value: (ench * CROP_BATCH) / entry.rawPerEnchanted,
      fromEnchanted: true,
    };
  }
  const raw = snapshot.prices[entry.rawId]?.[side] ?? null;
  return {
    value: raw === null ? null : raw * CROP_BATCH,
    fromEnchanted: false,
  };
}

/** Coins for 160 raw crops per crop, best sellOffer first, nulls last. */
export function cropValues(
  snapshot: BazaarSnapshot,
  crops: readonly BazaarCropEntry[] = BAZAAR_CROPS,
): CropValue[] {
  const values = crops.map((entry): CropValue => {
    const sell = sideValue(entry, snapshot, "sellOffer");
    const instant = sideValue(entry, snapshot, "instantSell");
    return {
      cropId: entry.cropId,
      unit: sell.fromEnchanted && instant.fromEnchanted ? "enchanted" : "raw",
      sellOffer: sell.value,
      instantSell: instant.value,
    };
  });
  return values.sort((a, b) => {
    if (a.sellOffer === null && b.sellOffer === null) return 0;
    if (a.sellOffer === null) return 1;
    if (b.sellOffer === null) return -1;
    return b.sellOffer - a.sellOffer;
  });
}

/** Coins to buy `compostNeeded` Compost at the lowest sell offer; null if unknown. */
export function plotCoinCost(
  compostNeeded: number,
  snapshot: BazaarSnapshot,
): number | null {
  const price = snapshot.prices[COMPOST_ID]?.sellOffer ?? null;
  if (price === null) return null;
  return compostNeeded * price;
}
