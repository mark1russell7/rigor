import { describe, expect, it } from "vitest";
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

  it("throws for an empty list and for a NaN", () => {
    expect(() => modeCount([])).toThrow(RangeError);
    expect(() => modeCount([1, Number.NaN])).toThrow(RangeError);
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
