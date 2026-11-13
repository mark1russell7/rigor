import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plackettLuceOrder, random } from "./random.ts";

interface Entry {
  readonly key: string;
  readonly logWeight: number;
}

const keyOf = (entry: Entry): string => entry.key;
const logWeightOf = (entry: Entry): number => entry.logWeight;

/** Lists of entries with distinct keys, and log-weights that are finite or -Infinity. */
const entries = fc.uniqueArray(
  fc.record({
    key: fc.string({ maxLength: 6 }),
    logWeight: fc.oneof(fc.double({ min: -20, max: 20, noNaN: true }), fc.constant(Number.NEGATIVE_INFINITY)),
  }),
  { selector: (entry) => entry.key, maxLength: 30 },
);

const seeds = fc.oneof(fc.integer({ min: 0, max: 0xffffffff }), fc.string());

/** The count of each first item over `runs` seeds. */
function firstCounts(list: readonly Entry[], runs: number, label: string): Map<string, number> {
  const counts = new Map<string, number>(list.map((entry) => [entry.key, 0]));
  for (let run = 0; run < runs; run++) {
    const first = plackettLuceOrder(`${label}-${run}`, list, logWeightOf, keyOf)[0] as Entry;
    counts.set(first.key, (counts.get(first.key) as number) + 1);
  }
  return counts;
}

/** True when a count is within 5 standard deviations of its binomial mean. */
function nearBinomial(count: number, runs: number, p: number): boolean {
  return Math.abs(count - runs * p) <= 5 * Math.sqrt(runs * p * (1 - p));
}

describe("plackettLuceOrder: the laws of an order", () => {
  it("gives a permutation of the list, and does not change the list", () => {
    fc.assert(
      fc.property(seeds, entries, (seed, list) => {
        const copy = list.map((entry) => ({ ...entry }));
        const order = plackettLuceOrder(seed, list, logWeightOf, keyOf);
        expect(order).toHaveLength(list.length);
        expect(new Set(order)).toEqual(new Set(list));
        expect(list).toEqual(copy);
      }),
      { numRuns: 200 },
    );
  });

  it("gives the same order for the same seed, and the same order for each order of the list", () => {
    fc.assert(
      fc.property(seeds, entries, (seed, list) => {
        // Only the weights of 0 tie, so the list without them has one order for each seed.
        const finite = list.filter((entry) => entry.logWeight > Number.NEGATIVE_INFINITY);
        const order = plackettLuceOrder(seed, finite, logWeightOf, keyOf);
        expect(plackettLuceOrder(seed, finite, logWeightOf, keyOf)).toEqual(order);
        expect(plackettLuceOrder(seed, [...finite].reverse(), logWeightOf, keyOf)).toEqual(order);
      }),
      { numRuns: 200 },
    );
  });

  it("keeps the order of the other items when the list loses an item", () => {
    fc.assert(
      fc.property(seeds, entries, fc.nat(), (seed, list, at) => {
        fc.pre(list.length > 0);
        const lost = list[at % list.length] as Entry;
        const order = plackettLuceOrder(seed, list, logWeightOf, keyOf).filter((entry) => entry !== lost);
        expect(plackettLuceOrder(seed, list.filter((entry) => entry !== lost), logWeightOf, keyOf)).toEqual(order);
      }),
      { numRuns: 200 },
    );
  });

  it("puts an item with a much larger log-weight first", () => {
    fc.assert(
      fc.property(seeds, entries, (seed, list) => {
        // A Gumbel draw of this generator is from -3.4 to 22.2, so a margin of 40 always wins.
        const top = Math.max(0, ...list.map(logWeightOf).filter(Number.isFinite));
        const huge: Entry = { key: "\u0000huge", logWeight: top + 40 };
        const order = plackettLuceOrder(seed, [...list, huge], logWeightOf, keyOf);
        expect(order[0]).toBe(huge);
      }),
      { numRuns: 200 },
    );
  });

  it("puts the items with the log-weight -Infinity last, in the order of the list", () => {
    fc.assert(
      fc.property(seeds, entries, (seed, list) => {
        const order = plackettLuceOrder(seed, list, logWeightOf, keyOf);
        const zero = list.filter((entry) => entry.logWeight === Number.NEGATIVE_INFINITY);
        expect(order.slice(order.length - zero.length)).toEqual(zero);
      }),
      { numRuns: 200 },
    );
  });
});

describe("plackettLuceOrder: the Plackett-Luce law", () => {
  it("puts each item first about equally often when the weights are equal", () => {
    const list = ["a", "b", "c", "d", "e"].map((key) => ({ key, logWeight: 0 }));
    const runs = 5000;
    const counts = firstCounts(list, runs, "equal");
    for (const count of counts.values()) expect(nearBinomial(count, runs, 1 / 5)).toBe(true);
  });

  it("puts item i first with the probability w_i / sum(w)", () => {
    const weights = [1, 2, 3, 4];
    const list = weights.map((w, i) => ({ key: `k${i}`, logWeight: Math.log(w) }));
    const runs = 10_000;
    const counts = firstCounts(list, runs, "weighted");
    weights.forEach((w, i) => expect(nearBinomial(counts.get(`k${i}`) as number, runs, w / 10)).toBe(true));
  });

  it("gives each full order of three items the product of the shares of the items that remain", () => {
    const weights: Record<string, number> = { a: 1, b: 2, c: 5 };
    const list = Object.entries(weights).map(([key, w]) => ({ key, logWeight: Math.log(w) }));
    const runs = 12_000;
    const counts = new Map<string, number>();
    for (let run = 0; run < runs; run++) {
      const order = plackettLuceOrder(run, list, logWeightOf, keyOf)
        .map(keyOf)
        .join("");
      counts.set(order, (counts.get(order) ?? 0) + 1);
    }
    for (const order of ["abc", "acb", "bac", "bca", "cab", "cba"]) {
      const [x, y] = [weights[order[0] as string] as number, weights[order[1] as string] as number];
      const z = weights[order[2] as string] as number;
      const p = (x / (x + y + z)) * (y / (y + z));
      expect(nearBinomial(counts.get(order) ?? 0, runs, p)).toBe(true);
    }
  });
});

describe("plackettLuceOrder: the draws and the checks", () => {
  it("adds to each log-weight the first Gumbel draw of the stream random(seed).fork(key)", () => {
    const list = [
      { key: "x", logWeight: 0.3 },
      { key: "y", logWeight: -1 },
      { key: "z", logWeight: 1.2 },
    ];
    const sums = list.map((entry) => ({ key: entry.key, sum: entry.logWeight + random("draws").fork(entry.key).gumbel() }));
    const expected = [...sums].sort((p, q) => q.sum - p.sum).map((entry) => entry.key);
    expect(plackettLuceOrder("draws", list, logWeightOf, keyOf).map(keyOf)).toEqual(expected);
  });

  it("uses String as the default key, and gives an empty order for an empty list", () => {
    const order = plackettLuceOrder(3, ["p", "q", "r"], () => 0);
    expect([...order].sort()).toEqual(["p", "q", "r"]);
    expect(plackettLuceOrder(3, [], () => 0)).toEqual([]);
  });

  it("refuses a key that occurs twice, a bad log-weight and a bad seed", () => {
    expect(() => plackettLuceOrder(1, ["a", "b", "a"], () => 0)).toThrow(/occurs twice/);
    expect(() => plackettLuceOrder(1, ["a"], () => Number.NaN)).toThrow(RangeError);
    expect(() => plackettLuceOrder(1, ["a"], () => Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => plackettLuceOrder(Number.NaN, ["a"], () => 0)).toThrow(RangeError);
  });
});
