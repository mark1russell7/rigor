import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import { binomialInterval, binomialTest, medianInterval, negativeBinomialInterval, quantileInterval, quantileSamples, signTest } from "./index.ts";

/* ---------- The copies in the engines, word for word, as the references of the moves ---------- */

// systems packages/kind/src/stats.ts and packages/harness/src/verdict.ts
const systemsBelow = (n: number, j: number): number => {
  let term = 1;
  let sum = 0;
  for (let i = 0; i <= j; i += 1) {
    sum += term;
    term = (term * (n - i)) / (i + 1);
  }
  return sum / 2 ** n;
};
const systemsMedianInterval = (sorted: readonly number[]): [number, number] => {
  const n = sorted.length;
  let k = 0;
  while (k + 1 <= n / 2 && systemsBelow(n, k) <= 0.025) k += 1;
  return k === 0 ? [sorted[0]!, sorted[n - 1]!] : [sorted[k - 1]!, sorted[n - k]!];
};

// systems packages/cells/src/callers.ts (targetConnections, at random)
const systemsBinomial = (total: number, p: number, cover: number): { lo: number; hi: number } => {
  const choose = (k: number): number => (k === 0 ? 1 : (choose(k - 1) * (total - k + 1)) / k);
  const chance = Array.from({ length: total + 1 }, (_, k) => choose(k) * p ** k * (1 - p) ** (total - k));
  const below = (k: number): number => chance.slice(0, k).reduce((sum, each) => sum + each, 0);
  const above = (k: number): number => chance.slice(k + 1).reduce((sum, each) => sum + each, 0);
  const tail = (1 - cover) / 2;
  let lo = 0;
  while (below(lo + 1) <= tail) lo += 1;
  let hi = total;
  while (above(hi - 1) <= tail) hi -= 1;
  return { lo, hi };
};

// systems packages/cells/src/callers.ts (negativeBinomial)
const systemsNegativeBinomial = (successes: number, p: number, cover: number): { lo: number; hi: number } => {
  const tail = (1 - cover) / 2;
  let chance = p ** successes;
  let below = 0;
  let lo = 0;
  for (let k = 0; ; k += 1) {
    if (below <= tail) lo = k;
    if (below + chance >= 1 - tail) return { lo, hi: k };
    below += chance;
    chance *= ((k + successes) / (k + 1)) * (1 - p);
  }
};

/** The exact rank of the median interval: the largest k where 40 times the sum of C(n, j < k) is not more than 2^n. */
const exactRank = (n: number): number => {
  const two = 2n ** BigInt(n);
  let choose = 1n;
  let sum = 0n;
  let k = 0;
  while (k + 1 <= n / 2) {
    sum += choose;
    if (40n * sum > two) break;
    k += 1;
    choose = (choose * BigInt(n - k + 1)) / BigInt(k);
  }
  return Math.max(1, k);
};

describe("medianInterval", () => {
  it("gives x_(2) to x_(10) of 11 values, at 98.8 %", () => {
    const eleven = [5, 1, 9, 3, 11, 7, 2, 10, 4, 8, 6];
    const interval = medianInterval(eleven);
    expect([interval.low, interval.high, interval.rank]).toEqual([2, 10, 2]);
    expect(interval.coverage).toBeCloseTo(1 - 24 / 2048, 12);
  });

  it("gives the full range of 5 values or fewer, with a coverage less than the level", () => {
    expect(medianInterval([3, 4, 5])).toMatchObject({ low: 3, high: 5, rank: 1 });
    expect(medianInterval([7])).toMatchObject({ low: 7, high: 7, rank: 1 });
    expect(medianInterval([1, 2, 3, 4, 5]).coverage).toBeCloseTo(1 - 2 / 32, 12);
    expect(medianInterval([1, 2, 3, 4, 5, 6]).coverage).toBeGreaterThanOrEqual(0.95);
    expect(medianInterval([1, 2, 3, 4, 5, 6, 7, 8, 9]).rank).toBe(2);
  });

  it("gives the exact rank for each n from 1 to 400", () => {
    for (let n = 1; n <= 400; n++) {
      const values = Array.from({ length: n }, (_, i) => i + 1);
      expect(medianInterval(values).rank, `n = ${n}`).toBe(exactRank(n));
    }
  });

  it("gives the same interval as the copy in systems, to the bit", () => {
    const r = random("medianInterval");
    for (let n = 1; n <= 300; n++) {
      const values = Array.from({ length: n }, () => r.normal(10, 3)).sort((a, b) => a - b);
      const interval = medianInterval(values);
      expect([interval.low, interval.high], `n = ${n}`).toEqual(systemsMedianInterval(values));
    }
  });

  it("sorts the values, and a smaller level gives a narrower interval", () => {
    const values = Array.from({ length: 41 }, (_, i) => (i * 17) % 41);
    expect(medianInterval(values)).toEqual(medianInterval([...values].sort((a, b) => a - b)));
    expect(medianInterval(values, 0.5).rank).toBeGreaterThan(medianInterval(values, 0.99).rank);
  });

  it("throws for an empty list, a NaN and a level out of its range", () => {
    expect(() => medianInterval([])).toThrow(RangeError);
    expect(() => medianInterval([1, Number.NaN])).toThrow(RangeError);
    expect(() => medianInterval([1, 2], 1)).toThrow(RangeError);
    expect(() => medianInterval([1, 2], 0)).toThrow(RangeError);
  });
});

describe("binomialInterval", () => {
  it("gives the same interval as the copy in systems", () => {
    for (const cover of [0.9, 0.95, 0.99])
      for (const p of [0.05, 0.25, 1 / 3, 0.5, 0.7])
        for (let n = 0; n <= 120; n++) {
          const interval = binomialInterval(n, p, cover);
          expect({ lo: interval.low, hi: interval.high }, `n = ${n}, p = ${p}, level = ${cover}`).toEqual(systemsBinomial(n, p, cover));
        }
  });

  it("gives each tail outside the interval at most (1 - level) / 2, and the coverage", () => {
    const interval = binomialInterval(24, 0.5);
    expect([interval.low, interval.high]).toEqual([7, 17]);
    expect(interval.coverage).toBeGreaterThanOrEqual(0.95);
    expect(binomialInterval(1000, 0.5).coverage).toBeGreaterThanOrEqual(0.95);
  });

  it("gives one count for p = 0 and p = 1", () => {
    expect(binomialInterval(10, 0)).toEqual({ low: 0, high: 0, coverage: 1 });
    expect(binomialInterval(10, 1)).toEqual({ low: 10, high: 10, coverage: 1 });
  });

  it("throws for a parameter out of its range", () => {
    expect(() => binomialInterval(-1, 0.5)).toThrow(RangeError);
    expect(() => binomialInterval(2.5, 0.5)).toThrow(RangeError);
    expect(() => binomialInterval(10, 1.5)).toThrow(RangeError);
    expect(() => binomialInterval(10, 0.5, 1)).toThrow(RangeError);
  });
});

describe("negativeBinomialInterval", () => {
  it("gives the same interval as the copy in systems", () => {
    for (const cover of [0.9, 0.95, 0.99])
      for (const p of [0.1, 0.25, 0.5, 0.75, 0.9])
        for (let r = 1; r <= 60; r++) {
          const interval = negativeBinomialInterval(r, p, cover);
          expect({ lo: interval.low, hi: interval.high }, `r = ${r}, p = ${p}, level = ${cover}`).toEqual(systemsNegativeBinomial(r, p, cover));
        }
  });

  it("gives the figures of the systems cells, and the coverage", () => {
    expect(negativeBinomialInterval(24, 0.5)).toMatchObject({ low: 12, high: 39 });
    expect(negativeBinomialInterval(3, 0.5)).toMatchObject({ low: 0, high: 9 });
    expect(negativeBinomialInterval(24, 0.5).coverage).toBeGreaterThanOrEqual(0.95);
  });

  it("does not stop on a first chance that is too small for a number", () => {
    const interval = negativeBinomialInterval(2000, 0.5);
    expect(interval.low).toBeLessThan(2000);
    expect(interval.high).toBeGreaterThan(2000);
  });

  it("gives 0 for no success, and for p = 1", () => {
    expect(negativeBinomialInterval(0, 0.5)).toEqual({ low: 0, high: 0, coverage: 1 });
    expect(negativeBinomialInterval(5, 1)).toEqual({ low: 0, high: 0, coverage: 1 });
  });

  it("throws for a parameter out of its range", () => {
    expect(() => negativeBinomialInterval(-1, 0.5)).toThrow(RangeError);
    expect(() => negativeBinomialInterval(3, 0)).toThrow(RangeError);
    expect(() => negativeBinomialInterval(3, 0.5, 0)).toThrow(RangeError);
  });
});

describe("quantileInterval", () => {
  const ladder = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

  it("gives the interval of the median at p = 1/2", () => {
    for (const n of [6, 11, 12, 30, 101]) {
      const values = ladder(n);
      const [median, quantile] = [medianInterval(values), quantileInterval(values, 0.5)];
      expect([quantile.low, quantile.high]).toEqual([median.low, median.high]);
      expect(quantile.coverage).toBeCloseTo(median.coverage, 12);
    }
  });

  it("gives the ranks that a table gives for p90 of 100 values", () => {
    // P(X <= 83) of Binomial(100, 0.9) is 0.0206 and P(X <= 84) is 0.0399. P(X >= 96) is 0.0237 and P(X >= 95) is 0.0576.
    const v = quantileInterval(ladder(100), 0.9);
    expect(v).toMatchObject({ lowRank: 84, highRank: 96, low: 84, high: 96 });
    expect(v.coverage).toBeCloseTo(1 - 0.0206 - 0.0237, 3);
  });

  it("has no upper bound under the count that quantileSamples gives, and has one at that count", () => {
    expect(quantileInterval(ladder(367), 0.99).high).toBe(Infinity);
    expect(quantileInterval(ladder(367), 0.99).highRank).toBe(368);
    const v = quantileInterval(ladder(368), 0.99);
    expect(v.high).toBe(368);
    expect(v.highRank).toBe(368);
  });

  it("has no lower bound when the sample is too small for it", () => {
    const v = quantileInterval(ladder(4), 0.5);
    expect(v).toMatchObject({ low: -Infinity, lowRank: 0, high: Infinity, highRank: 5, coverage: 1 });
  });

  it("does not depend on the order of the values", () => {
    const values = ladder(500);
    expect(quantileInterval([...values].reverse(), 0.95)).toEqual(quantileInterval(values, 0.95));
  });

  it("holds the true quantile at the stated rate", () => {
    const rng = random("quantile-interval");
    const trials = 2000;
    let held = 0;
    for (let trial = 0; trial < trials; trial++) {
      const values = Array.from({ length: 200 }, () => rng.next());
      const v = quantileInterval(values, 0.9);
      if (v.low <= 0.9 && 0.9 <= v.high) held += 1;
    }
    expect(held / trials).toBeGreaterThan(0.94);
    expect(held / trials).toBeLessThan(0.995);
  });

  it("refuses bad input", () => {
    expect(() => quantileInterval([], 0.5)).toThrow(RangeError);
    expect(() => quantileInterval([1, Number.NaN], 0.5)).toThrow(RangeError);
    expect(() => quantileInterval([1], 0)).toThrow(RangeError);
    expect(() => quantileInterval([1], 1)).toThrow(RangeError);
    expect(() => quantileInterval([1], 0.5, 1)).toThrow(RangeError);
  });
});

describe("quantileSamples", () => {
  it("gives the counts of the common quantiles at the level 0.95", () => {
    expect([0.5, 0.95, 0.99, 0.999].map((p) => quantileSamples(p))).toEqual([6, 72, 368, 3688]);
  });

  it("gives the smallest n with p^n in the tail", () => {
    for (const p of [0.5, 0.75, 0.9, 0.95, 0.99, 0.999]) {
      for (const level of [0.8, 0.9, 0.95, 0.99]) {
        const [n, tail] = [quantileSamples(p, level), (1 - level) / 2];
        expect(p ** n).toBeLessThanOrEqual(tail);
        expect(p ** (n - 1)).toBeGreaterThan(tail);
      }
    }
  });

  it("refuses bad input", () => {
    expect(() => quantileSamples(1)).toThrow(RangeError);
    expect(() => quantileSamples(0)).toThrow(RangeError);
    expect(() => quantileSamples(0.5, 0)).toThrow(RangeError);
  });
});

/** The exact tail of Binomial(n, num / den) from k = from to k = to, as a ratio of big integers, to 30 digits. */
function exactTail(n: number, num: bigint, den: bigint, from: number, to: number): number {
  let choose = 1n;
  let sum = 0n;
  for (let i = 0; i <= to; i++) {
    if (i > 0) choose = (choose * BigInt(n - i + 1)) / BigInt(i);
    if (i >= from) sum += choose * num ** BigInt(i) * (den - num) ** BigInt(n - i);
  }
  const scale = 10n ** 30n;
  return Number((sum * scale) / den ** BigInt(n)) / 1e30;
}

describe("binomialTest", () => {
  it("gives the exact one-sided tail of a small case", () => {
    // P(X <= 1) for n = 5 and p = 0.3: 0.7^5 + 5 * 0.3 * 0.7^4.
    expect(binomialTest(1, 5, 0.3, "less")).toBeCloseTo(0.52822, 12);
    expect(binomialTest(0, 10, 0.5, "less")).toBeCloseTo(1 / 1024, 15);
    expect(binomialTest(10, 10, 0.5, "greater")).toBeCloseTo(1 / 1024, 15);
  });

  it("agrees with the exact sum in big integers at n = 1000 and p = 0.95, in each tail", () => {
    for (const k of [880, 900, 925, 940, 950, 960, 990]) {
      const less = exactTail(1000, 19n, 20n, 0, k);
      const greater = exactTail(1000, 19n, 20n, k, 1000);
      expect(binomialTest(k, 1000, 0.95, "less") / less, `less ${k}`).toBeCloseTo(1, 9);
      expect(binomialTest(k, 1000, 0.95, "greater") / greater, `greater ${k}`).toBeCloseTo(1, 9);
    }
  });

  it("is equal to the one-sided sign test at p = 1/2", () => {
    for (const [k, n] of [
      [0, 0],
      [3, 7],
      [15, 20],
      [60, 100],
      [100, 100],
    ] as const) {
      expect(binomialTest(k, n, 0.5, "greater")).toBeCloseTo(signTest(k, n - k), 12);
    }
  });

  it("gives tails that add to 1 with the term at k counted once", () => {
    const r = random("binomial-test");
    for (let t = 0; t < 50; t++) {
      const n = r.int(1, 300);
      const k = r.int(0, n - 1);
      const p = r.next();
      expect(binomialTest(k, n, p, "less") + binomialTest(k + 1, n, p, "greater")).toBeCloseTo(1, 10);
    }
  });

  it("gives the ends at p = 0, p = 1 and the full range", () => {
    expect(binomialTest(0, 10, 0, "less")).toBe(1);
    expect(binomialTest(1, 10, 0, "greater")).toBe(0);
    expect(binomialTest(9, 10, 1, "less")).toBe(0);
    expect(binomialTest(10, 10, 1, "less")).toBe(1);
    expect(binomialTest(0, 10, 0.4, "greater")).toBe(1);
    expect(binomialTest(10, 10, 0.4, "less")).toBe(1);
    expect(binomialTest(0, 0, 0.4, "less")).toBe(1);
  });

  it("throws for a bad input", () => {
    expect(() => binomialTest(-1, 10, 0.5, "less")).toThrow(RangeError);
    expect(() => binomialTest(1.5, 10, 0.5, "less")).toThrow(RangeError);
    expect(() => binomialTest(11, 10, 0.5, "less")).toThrow(/more than n/);
    expect(() => binomialTest(1, 10, 1.5, "less")).toThrow(/p is from 0 to 1/);
    expect(() => binomialTest(1, 10, Number.NaN, "less")).toThrow(/p is from 0 to 1/);
    expect(() => binomialTest(1, 10, 0.5, "two" as "less")).toThrow(/side is/);
  });
});
