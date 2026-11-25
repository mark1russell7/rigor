import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gammaCdf, gammaQuantile, pooledRate, pooledRateUpper } from "./index.ts";

/** The chance that a Poisson count with the mean `m` is less than `k`. The gamma law with a whole shape `k` has `P(k, m) = 1 - that chance`. */
function poissonBelow(k: number, m: number): number {
  let term = Math.exp(-m);
  let sum = 0;
  for (let i = 0; i < k; i += 1) {
    sum += term;
    term *= m / (i + 1);
  }
  return sum;
}

describe("gammaCdf", () => {
  it("is the exponential law with the shape 1", () => {
    for (const x of [0.01, 0.5, 1, 3, 20]) expect(gammaCdf(x, 1, 2)).toBeCloseTo(1 - Math.exp(-2 * x), 14);
  });

  it("is 1 minus a Poisson sum with a whole shape, below and above shape + 1", () => {
    for (const k of [2, 5, 17]) for (const m of [0.3, k - 0.5, k + 3, 3 * k]) expect(gammaCdf(m, k, 1)).toBeCloseTo(1 - poissonBelow(k, m), 13);
  });

  it("gives 0 at 0 and below, and 1 at Infinity", () => {
    expect(gammaCdf(0, 2, 1)).toBe(0);
    expect(gammaCdf(-1, 2, 1)).toBe(0);
    expect(gammaCdf(Number.POSITIVE_INFINITY, 2, 1)).toBe(1);
  });

  it("refuses a shape or a rate that is not more than 0, and x NaN", () => {
    expect(() => gammaCdf(1, 0, 1)).toThrow(RangeError);
    expect(() => gammaCdf(1, Number.POSITIVE_INFINITY, 1)).toThrow(RangeError);
    expect(() => gammaCdf(1, 1, -1)).toThrow(RangeError);
    expect(() => gammaCdf(Number.NaN, 1, 1)).toThrow(RangeError);
  });
});

describe("gammaQuantile", () => {
  // The quantiles of the chi-square law with k degrees of freedom: the gamma law with the shape k / 2 and the rate 1 / 2.
  it("gives the quantiles of the chi-square law", () => {
    expect(gammaQuantile(0.95, 0.5, 0.5)).toBeCloseTo(3.841458820694124, 10);
    expect(gammaQuantile(0.95, 5, 0.5)).toBeCloseTo(18.307038053275146, 10);
    expect(gammaQuantile(0.05, 5, 0.5)).toBeCloseTo(3.940299136119255, 10);
    // With 2 degrees of freedom, the law is exponential: the quantile is -2 log(1 - p).
    expect(gammaQuantile(0.99, 1, 0.5)).toBeCloseTo(-2 * Math.log(0.01), 12);
  });

  it("keeps the digits of a level near 1 through the upper tail", () => {
    // Q(2, x) = e^-x (1 + x). The float 1 - 1e-12 keeps about 4 digits of 1e-12, so the tail is compared with 1 - p.
    const p = 1 - 1e-12;
    const x = gammaQuantile(p, 2, 1);
    expect(Math.abs((Math.exp(-x) * (1 + x)) / (1 - p) - 1)).toBeLessThan(1e-9);
  });

  it("is the inverse of gammaCdf over a wide range of shapes", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 1e6, noNaN: true }), fc.double({ min: 0.001, max: 0.999, noNaN: true }), fc.double({ min: 0.01, max: 100, noNaN: true }), (shape, p, rate) => {
        expect(gammaCdf(gammaQuantile(p, shape, rate), shape, rate)).toBeCloseTo(p, 8);
      }),
      { seed: 20261125, numRuns: 200 },
    );
  });

  it("gives 0 at the level 0 and Infinity at the level 1, and refuses a level out of [0, 1]", () => {
    expect(gammaQuantile(0, 3, 1)).toBe(0);
    expect(gammaQuantile(1, 3, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(() => gammaQuantile(1.5, 3, 1)).toThrow(RangeError);
    expect(() => gammaQuantile(Number.NaN, 3, 1)).toThrow(RangeError);
  });
});

describe("pooledRateUpper", () => {
  const law = { shape: 2, mean: 0.5 };
  const unit = { count: 3, exposure: 4 };

  it("is the quantile of the gamma law of the rate after the count", () => {
    // The law after the count has the shape 5 and the rate 2 / 0.5 + 4 = 8. Its quantile is the chi-square quantile with 10 degrees over 16.
    expect(pooledRateUpper(unit, law)).toBeCloseTo(18.307038053275146 / 16, 10);
    expect(pooledRateUpper(unit, law, 0.5)).toBeLessThan(pooledRate(unit, law));
    expect(pooledRateUpper(unit, law, 0.95)).toBeGreaterThan(pooledRate(unit, law));
  });

  it("grows with the level, and comes near count / exposure with a large exposure", () => {
    const levels = [0.6, 0.8, 0.9, 0.95, 0.99];
    const bounds = levels.map((level) => pooledRateUpper(unit, law, level));
    expect([...bounds].sort((a, b) => a - b)).toEqual(bounds);
    const long = pooledRateUpper({ count: 30_000, exposure: 10_000 }, law);
    expect(long).toBeGreaterThan(3);
    expect(long).toBeLessThan(3.06);
  });

  it("gives the mean with the shape Infinity, and 0 with the mean 0", () => {
    expect(pooledRateUpper(unit, { shape: Number.POSITIVE_INFINITY, mean: 0.5 })).toBe(0.5);
    expect(pooledRateUpper(unit, { shape: 2, mean: 0 })).toBe(0);
  });

  it("refuses a level out of (0, 1) and a law that is not valid", () => {
    for (const level of [0, 1, Number.NaN]) expect(() => pooledRateUpper(unit, law, level)).toThrow(RangeError);
    expect(() => pooledRateUpper(unit, { shape: 0, mean: 0.5 })).toThrow(RangeError);
    expect(() => pooledRateUpper({ count: -1, exposure: 4 }, law)).toThrow(RangeError);
  });
});
