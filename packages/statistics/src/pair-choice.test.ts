import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PAIR_FULL_SEARCH, RATING_START_UNCERTAINTY, type RatedItem, choosePair, pairInformation, ratingUncertainty } from "./index.ts";

const item = (id: string, rating: number, picks = 0, se?: number): RatedItem => ({ id, rating, picks, se });

describe("pairInformation", () => {
  it("is highest when the result and the two ratings are not sure", () => {
    const fresh = item("a", 1500);
    expect(ratingUncertainty(fresh)).toBe(RATING_START_UNCERTAINTY);
    expect(ratingUncertainty(item("b", 1500, 3))).toBe(RATING_START_UNCERTAINTY / 2);
    expect(ratingUncertainty(item("c", 1500, 3, 80))).toBe(80);
    // Equal ratings give p = 0.5, so the variance of the result is 0.25.
    expect(pairInformation(fresh, item("b", 1500))).toBeCloseTo(0.25 * 2 * RATING_START_UNCERTAINTY ** 2, 6);
    expect(pairInformation(fresh, item("b", 1500))).toBeGreaterThan(pairInformation(fresh, item("b", 1900)));
    expect(pairInformation(fresh, item("b", 1500))).toBeGreaterThan(pairInformation(fresh, item("b", 1500, 50)));
  });

  it("is symmetric, and does not change when the two ratings move together", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 800, max: 2200, noNaN: true }),
        fc.double({ min: 800, max: 2200, noNaN: true }),
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.nat(100),
        (ra, rb, shift, picks) => {
          const a = item("a", ra, picks);
          const b = item("b", rb, 0, 40);
          expect(pairInformation(a, b)).toBeCloseTo(pairInformation(b, a), 8);
          expect(pairInformation(item("a", ra + shift, picks), item("b", rb + shift, 0, 40))).toBeCloseTo(pairInformation(a, b), 6);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("choosePair", () => {
  it("needs two different items", () => {
    expect(choosePair([], { seed: 1 })).toBeUndefined();
    expect(choosePair([item("a", 1500), item("a", 1600)], { seed: 1 })).toBeUndefined();
  });

  it("gives the same pair for a seed, and takes only the items of the pool", () => {
    const pool = ["a", "b", "c"].map((id, index) => item(id, 1400 + 50 * index, index));
    expect(choosePair(pool, { seed: "duel-7" })).toEqual(choosePair(pool, { seed: "duel-7" }));
    for (let seed = 0; seed < 50; seed++) {
      const pair = choosePair(pool, { seed })!;
      expect(["a", "b", "c"]).toContain(pair.a);
      expect(["a", "b", "c"]).toContain(pair.b);
      expect(pair.a).not.toBe(pair.b);
    }
  });

  it("gives a pair of two items of the pool for each seed and pool, with the information of that pair", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.constantFrom("a", "b", "c", "d", "e", "f"), rating: fc.integer({ min: 1000, max: 2000 }), picks: fc.nat(20) }), { maxLength: 12 }),
        fc.oneof(fc.nat(), fc.string()),
        (pool, seed) => {
          const pair = choosePair(pool, { seed });
          const ids = new Set<string>(pool.map((entry) => entry.id));
          if (ids.size < 2) {
            expect(pair).toBeUndefined();
            return;
          }
          expect(ids.has(pair!.a) && ids.has(pair!.b) && pair!.a !== pair!.b).toBe(true);
          const first = (id: string) => pool.find((entry) => entry.id === id)!;
          // A second item with the same key does not count, so the information is of the first item of each key.
          expect(pair!.information).toBeCloseTo(pairInformation(first(pair!.a), first(pair!.b)), 6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("puts the items with few picks first, and pairs an item with a near rating", () => {
    // Forty items with many picks, and two new items far apart in the order.
    const many = Array.from({ length: 40 }, (_, index) => item(`s${index}`, 1000 + 25 * index, 60, 40));
    const pool = [...many, item("low", 1010), item("high", 1960)];
    const ratingOf = new Map(pool.map((entry) => [entry.id, entry.rating]));
    let fresh = 0;
    let near = 0;
    const seeds = 300;
    for (let seed = 0; seed < seeds; seed++) {
      const pair = choosePair(pool, { seed, candidates: 8 })!;
      const sides = [pair.a, pair.b];
      if (sides.includes("low") || sides.includes("high")) fresh++;
      if (Math.abs(ratingOf.get(pair.a)! - ratingOf.get(pair.b)!) <= 200) near++;
    }
    // A new item has a weight of 1 against 1/61 for each old item, so about 75 % of the first items are new.
    expect(fresh / seeds).toBeGreaterThan(0.6);
    expect(near / seeds).toBeGreaterThan(0.9);
  });

  it("puts each item on the left about half of the time", () => {
    const pool = [item("a", 1500), item("b", 1500)];
    let left = 0;
    for (let seed = 0; seed < 400; seed++) if (choosePair(pool, { seed })!.a === "a") left++;
    expect(left).toBeGreaterThan(160);
    expect(left).toBeLessThan(240);
  });

  it("takes a recent pair only when each pair is recent", () => {
    const pool = [item("a", 1500), item("b", 1500), item("c", 1500)];
    const recent = [["a", "b"], ["c", "a"]] as const;
    for (let seed = 0; seed < 40; seed++) {
      const pair = choosePair(pool, { seed, recent })!;
      expect([pair.a, pair.b].sort()).toEqual(["b", "c"]);
    }
    expect(choosePair(pool, { seed: 1, recent: [...recent, ["b", "c"]] })).toBeDefined();
  });

  it("refuses a bad count of candidates, a bad item and a bad information", () => {
    const pool = [item("a", 1500), item("b", 1500)];
    expect(() => choosePair(pool, { seed: 1, candidates: 0 })).toThrow(RangeError);
    expect(() => choosePair([item("a", Number.NaN), item("b", 1500)], { seed: 1 })).toThrow(RangeError);
    expect(() => choosePair([item("a", 1500, -1), item("b", 1500)], { seed: 1 })).toThrow(RangeError);
    expect(() => choosePair(pool, { seed: 1, information: () => Number.NaN })).toThrow(RangeError);
  });
});

describe("choosePair with an information function", () => {
  const pool = (n: number): RatedItem[] => Array.from({ length: n }, (_, i) => item(`s${i}`, 1500 + i));
  // Two groups: the even items and the odd items. A pair is permitted only inside a group.
  const sameGroup = (a: RatedItem, b: RatedItem): number | undefined => (Number(a.id.slice(1)) % 2 === Number(b.id.slice(1)) % 2 ? 1 : undefined);

  it("gives only permitted pairs, in a small pool and in a large pool", () => {
    for (const size of [5, PAIR_FULL_SEARCH + 40]) {
      for (let seed = 0; seed < 200; seed++) {
        const pair = choosePair(pool(size), { seed, information: sameGroup });
        expect(pair).toBeDefined();
        expect(Number(pair!.a.slice(1)) % 2).toBe(Number(pair!.b.slice(1)) % 2);
      }
    }
  });

  it("leaves out an item with no permitted pair, and gives nothing when no pair is permitted", () => {
    // Only s0 and s1 make a pair. Each other item has no permitted pair, so the draw goes on to s0 or s1.
    const only = (a: RatedItem, b: RatedItem) => ([a.id, b.id].sort().join() === "s0,s1" ? 1 : undefined);
    for (let seed = 0; seed < 100; seed++) {
      const pair = choosePair(pool(30), { seed, information: only })!;
      expect([pair.a, pair.b].sort().join()).toBe("s0,s1");
    }
    expect(choosePair(pool(30), { seed: 1, information: () => undefined })).toBeUndefined();
  });

  it("takes the pair with the most information, and a recent pair only when each permitted pair is recent", () => {
    const most = (a: RatedItem, b: RatedItem) => ([a.id, b.id].sort().join() === "s1,s2" ? 10 : 1);
    for (let seed = 0; seed < 50; seed++) {
      const pair = choosePair(pool(3), { seed, information: most })!;
      if ([pair.a, pair.b].includes("s0")) continue;
      expect([pair.a, pair.b].sort()).toEqual(["s1", "s2"]);
    }
    const recent = [["s0", "s2"]] as const;
    for (let seed = 0; seed < 50; seed++) {
      const pair = choosePair(pool(4), { seed, recent, information: sameGroup })!;
      expect([pair.a, pair.b].sort()).toEqual(["s1", "s3"]);
    }
  });
});
