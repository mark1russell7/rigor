import { describe, expect, it } from "vitest";
import { random, type Random } from "@mark1russell7/rigor-generators";
import { bestSmoothLaw, modeCount, smoothLawScores, type SmoothLaw } from "./distribution.ts";

/** This function gives `n` values of a quantile function at even steps, so a test needs no random numbers. */
const evenly = (n: number, quantileOf: (p: number) => number): number[] => Array.from({ length: n }, (_, i) => quantileOf((i + 0.5) / n));

/** This function gives the quantile of the standard normal law by the rational form of Hastings. */
function normalQuantile(p: number): number {
  const tail = Math.min(p, 1 - p);
  const t = Math.sqrt(-2 * Math.log(tail));
  const z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return p < 0.5 ? -z : z;
}

const N = 2000;
const SAMPLES: readonly (readonly [SmoothLaw, readonly number[]])[] = [
  ["uniform", evenly(N, (p) => 10 + 20 * p)],
  ["normal", evenly(N, (p) => 100 + 10 * normalQuantile(p))],
  ["exponential", evenly(N, (p) => 1 - 5 * Math.log(1 - p))],
  ["log-normal", evenly(N, (p) => Math.exp(1 + 0.8 * normalQuantile(p)))],
  ["pareto", evenly(N, (p) => 2 * (1 - p) ** (-1 / 1.5))],
];

/** This function gives two or more clusters of equal mass. */
const clusters = (centres: readonly number[], width: number): number[] => centres.flatMap((c) => evenly(N / centres.length, (p) => c + width * normalQuantile(p)));

/** This function gives `count` clusters of `size` values, each `width` wide, with the centres 100 apart. */
const spaced = (count: number, size: number, width: number): number[] =>
  Array.from({ length: count }, (_, c) => evenly(size, (p) => 100 * c + width * normalQuantile(p))).flat();

const DRAWS: readonly (readonly [SmoothLaw, (r: Random) => number])[] = [
  ["uniform", (r) => r.range(10, 30)],
  ["normal", (r) => r.normal(100, 10)],
  ["exponential", (r) => 1 - 5 * Math.log(1 - r.next())],
  ["log-normal", (r) => Math.exp(r.normal(1, 0.8))],
  ["pareto", (r) => 2 * (1 - r.next()) ** (-1 / 1.5)],
];

describe("the count of the modes", () => {
  it("gives 1 for a smooth law and for equal values", () => {
    expect(modeCount(evenly(N, normalQuantile))).toBe(1);
    expect(modeCount(evenly(N, (p) => p))).toBe(1);
    expect(modeCount([3, 3, 3])).toBe(1);
  });

  it("gives the count of clear clusters", () => {
    expect(modeCount(clusters([0, 10], 1))).toBe(2);
    expect(modeCount(clusters([0, 10, 20], 1))).toBe(3);
  });

  it("joins clusters with no clear valley", () => {
    expect(modeCount(clusters([0, 1.5], 1))).toBe(1);
  });

  it("leaves out a small cluster until the share lets it in", () => {
    const small = [...evenly(1900, normalQuantile), ...evenly(100, (p) => 20 + normalQuantile(p))];
    expect(modeCount(small)).toBe(1);
    expect(modeCount(small, { minShare: 0.03 })).toBe(2);
  });

  it("needs a deeper valley with a smaller ratio", () => {
    const close = clusters([0, 3.2], 1);
    expect(modeCount(close, { valleyRatio: 0.9 })).toBe(2);
    expect(modeCount(close, { valleyRatio: 0.05 })).toBe(1);
  });

  it("does not depend on the scale or the order of the values", () => {
    const values = clusters([0, 10], 1);
    expect(modeCount(values.map((v) => 1000 * v + 5))).toBe(2);
    expect(modeCount([...values].reverse())).toBe(2);
  });

  it.each([6, 9, 12, 20])("gives %i tight clusters at 50 and at 1,000 values each", (count) => {
    expect(modeCount(spaced(count, 50, 0.5))).toBe(count);
    expect(modeCount(spaced(count, 1000, 0.5))).toBe(count);
  });

  it.each([
    [6, 200, 6],
    [9, 1000, 9],
    [12, 1000, 12],
    [20, 1000, 1],
  ])("reads %i even groups of %i equal values as %i modes", (count, size, modes) => {
    expect(modeCount(spaced(count, size, 0))).toBe(modes);
  });

  it.each([
    [200, 99],
    [1000, 100],
  ])("keeps one mode for a rounded normal law at %i values", (n, ones) => {
    const r = random(`rounded ${n}`);
    let one = 0;
    for (let i = 0; i < 100; i++) if (modeCount(Array.from({ length: n }, () => 2 * Math.round(r.normal(100, 10) / 2))) === 1) one++;
    expect(one).toBe(ones);
  });

  it("keeps one mode for the log areas of whole-number sides", () => {
    const r = random("sides");
    for (let i = 0; i < 100; i++) expect(modeCount(Array.from({ length: 1000 }, () => Math.log(r.int(1, 20) * r.int(1, 20))))).toBe(1);
  });

  it("gives each tight cluster of rounded values", () => {
    expect(modeCount(spaced(12, 200, 2).map(Math.round))).toBe(12);
  });

  it("joins clusters wider than the limit at small sizes", () => {
    expect(modeCount(spaced(12, 50, 5))).toBe(12);
    expect(modeCount(spaced(12, 50, 8))).toBe(1);
  });

  it("gives the same count for random clusters", () => {
    const r = random("clusters");
    for (const count of [6, 12, 20]) {
      const values = Array.from({ length: count }, (_, c) => Array.from({ length: 50 }, () => r.normal(100 * c, 0.5))).flat();
      expect(modeCount(values)).toBe(count);
    }
  });

  it("joins clusters past the limit of the grid, and gives at least 1", () => {
    expect(modeCount(spaced(24, 50, 0.5))).toBe(24);
    expect(modeCount(spaced(30, 50, 0.5))).toBe(1);
  });

  it("joins clusters of too few values for their count", () => {
    expect(modeCount(spaced(24, 10, 0.5))).toBe(1);
  });

  it.each(DRAWS.map(([law, draw]) => [law, draw] as const))("gives 1 for each random sample of 1,000 values of the %s law", (law, draw) => {
    const r = random(`modes ${law}`);
    for (let i = 0; i < 100; i++) expect(modeCount(Array.from({ length: 1000 }, () => draw(r)))).toBe(1);
  });

  it("throws for an empty list, for a NaN and for an infinite value", () => {
    expect(() => modeCount([])).toThrow(RangeError);
    expect(() => modeCount([1, Number.NaN])).toThrow(RangeError);
    expect(() => modeCount([1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
    expect(() => modeCount([Number.NEGATIVE_INFINITY, 1, 2])).toThrow(RangeError);
  });
});

describe("the smooth law of a sample", () => {
  it.each(SAMPLES.map(([law, values]) => [law, values] as const))("gives %s for a sample of that law", (law, values) => {
    expect(bestSmoothLaw(values)).toBe(law);
  });

  it("gives the same law for a change of the order", () => {
    for (const [law, values] of SAMPLES) expect(bestSmoothLaw([...values].reverse())).toBe(law);
  });

  it("gives one score for each law, in one order", () => {
    expect(smoothLawScores([1, 2, 3, 5]).map((s) => s.law)).toEqual(["uniform", "normal", "exponential", "log-normal", "pareto"]);
  });

  it("gives the closed form of the uniform law", () => {
    expect(smoothLawScores([2, 3, 6])[0]?.meanLogDensity).toBeCloseTo(-Math.log(4), 12);
  });

  it("gives the exact likelihood of the normal and the log-normal law", () => {
    const values = [2, 3, 5, 9, 14];
    const exact = (xs: readonly number[]): number => {
      const centre = xs.reduce((sum, x) => sum + x, 0) / xs.length;
      const variance = xs.reduce((sum, x) => sum + (x - centre) ** 2, 0) / xs.length;
      return -0.5 * Math.log(2 * Math.PI * variance) - 0.5;
    };
    const logs = values.map(Math.log);
    const scores = smoothLawScores(values);
    expect(scores[1]?.meanLogDensity).toBeCloseTo(exact(values), 12);
    expect(scores[3]?.meanLogDensity).toBeCloseTo(exact(logs) - logs.reduce((sum, x) => sum + x, 0) / logs.length, 12);
  });

  it("holds the table of the README for random samples", () => {
    const SIZES = [10, 30, 100, 300, 1000];
    const TABLE: Readonly<Record<SmoothLaw, readonly number[]>> = {
      uniform: [0.96, 0.996, 1, 1, 1],
      normal: [0.006, 0.3, 0.684, 0.846, 0.968],
      exponential: [0.454, 0.896, 0.988, 1, 1],
      "log-normal": [0.018, 0.25, 0.714, 0.988, 1],
      pareto: [0.688, 0.87, 0.994, 1, 1],
    };
    for (const [law, draw] of DRAWS) {
      const shares = SIZES.map((n) => {
        const r = random(`law ${law} ${n}`);
        let right = 0;
        for (let i = 0; i < 500; i++) if (bestSmoothLaw(Array.from({ length: n }, () => draw(r))) === law) right++;
        return right / 500;
      });
      expect(shares).toEqual(TABLE[law]);
    }
  }, 60_000);

  it("gives the same gap of log density under a change of units", () => {
    const gap = (values: readonly number[]): number => {
      const scores = smoothLawScores(values);
      return scores[0]!.meanLogDensity - scores[1]!.meanLogDensity;
    };
    const values = SAMPLES[1]![1];
    expect(gap(values.map((v) => 7 * v))).toBeCloseTo(gap(values), 9);
  });

  it("throws for values with no density", () => {
    expect(() => smoothLawScores([])).toThrow(RangeError);
    expect(() => smoothLawScores([0, 1])).toThrow(RangeError);
    expect(() => smoothLawScores([-1, 1])).toThrow(RangeError);
    expect(() => smoothLawScores([1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
    expect(() => smoothLawScores([1, Number.NaN])).toThrow(RangeError);
    expect(() => smoothLawScores([2, 2])).toThrow(RangeError);
    expect(() => bestSmoothLaw([2, 2])).toThrow(RangeError);
  });
});
