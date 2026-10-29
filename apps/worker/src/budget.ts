/**
 * Counts subrequests against the free plan's 50-per-invocation limit (fetch,
 * KV and D1 all count). It only counts; the caller asks `canAfford` before
 * each unit of work, because a throwing fetch wrapper would be swallowed by the
 * Hypixel client's retry loop.
 */
export class Budget {
  used = 0;

  constructor(readonly limit: number) {}

  charge(n: number): void {
    this.used += n;
  }

  canAfford(n: number): boolean {
    return this.used + n <= this.limit;
  }
}

export function countingFetch(
  fetchFn: typeof fetch,
  budget: Budget,
): typeof fetch {
  return ((input, init) => {
    budget.charge(1);
    return fetchFn(input, init);
  }) as typeof fetch;
}
