import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalCdf, normalQuantile } from "./normal.ts";
import { Z95 } from "./tests.ts";

// The quantiles of `NormalDist().inv_cdf` of the Python module `statistics`, a separate implementation in C.
const QUANTILES: readonly (readonly [number, number])[] = [
  [0.75, 0.6744897501960817],
  [0.9, 1.2815515655446008],
  [0.95, 1.6448536269514715],
  [0.975, 1.9599639845400536],
  [0.99, 2.3263478740408408],
  [0.995, 2.5758293035489],
  [0.999, 3.090232306167813],
  [1e-10, -6.361340902404056],
  [1e-100, -21.27345356096532],
  [1e-300, -37.0470962993612],
];

// The values `erfc(-x / sqrt(2)) / 2` of `math.erfc` of the C library, through Python.
const CDF: readonly (readonly [number, number])[] = [
  [-37, 5.7255712225251394e-300],
  [-20, 2.753624118606332e-89],
  [-10, 7.619853024160595e-24],
  [-5, 2.8665157187919455e-7],
  [-3, 0.0013498980316300959],
  [-2, 0.022750131948179216],
  [-1, 0.15865525393145707],
  [1, 0.8413447460685428],
  [2, 0.9772498680518209],
  [3, 0.9986501019683699],
];

const relative = (actual: number, expected: number): number =>
  actual === expected ? 0 : Math.abs(actual - expected) / Math.abs(expected);

/* ---------- The copy in lag, word for word, as the reference of the move ---------- */

/** The copy of lag (`histogram-model.ts`): the rational approximation of Acklam, with a relative error below 1.2e-9. */
function lagNormalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - low) return -lagNormalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

describe("normalQuantile", () => {
  it("gives the known quantiles to 1e-12", () => {
    for (const [p, x] of QUANTILES) expect(relative(normalQuantile(p), x), `p = ${p}`).toBeLessThan(1e-12);
  });

  it("gives 0 at the median and Z95 at 0.975", () => {
    expect(normalQuantile(0.5)).toBe(0);
    expect(relative(normalQuantile(0.975), Z95)).toBeLessThan(1e-15);
  });

  it("is odd about 0.5", () => {
    for (let k = 1; k < 500; k++) {
      const p = k / 1000;
      expect(normalQuantile(1 - p)).toBeCloseTo(-normalQuantile(p), 13);
    }
  });

  it("goes back to p through normalCdf, to 1e-12, from 1e-300 to 0.999", () => {
    const ps: number[] = [];
    for (let e = 1; e <= 300; e++) ps.push(10 ** -e, 2.5 * 10 ** -e, 5 * 10 ** -e);
    for (let k = 1; k < 1000; k++) ps.push(k / 1000);
    for (const p of ps) expect(relative(normalCdf(normalQuantile(p)), p), `p = ${p}`).toBeLessThan(1e-12);
  });

  it("goes back to p for each p of fast-check", () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-300, max: 0.999, noNaN: true }), (p) => relative(normalCdf(normalQuantile(p)), p) < 1e-12),
    );
  });

  it("increases with p", () => {
    let last = Number.NEGATIVE_INFINITY;
    for (let k = 1; k < 10_000; k++) {
      const x = normalQuantile(k / 10_000);
      expect(x).toBeGreaterThan(last);
      last = x;
    }
  });

  it("gives the infinite ends at 0 and 1, and throws for a p out of its range", () => {
    expect(normalQuantile(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(normalQuantile(1)).toBe(Number.POSITIVE_INFINITY);
    for (const p of [Number.NaN, -0.1, 1.1]) expect(() => normalQuantile(p)).toThrow(RangeError);
  });

  it("gives the quantiles of the copy in lag to its stated error of 1.2e-9", () => {
    for (let k = 1; k < 10_000; k++) {
      const p = k / 10_000;
      expect(relative(lagNormalQuantile(p), normalQuantile(p)), `p = ${p}`).toBeLessThan(1.2e-9);
    }
  });
});

describe("normalCdf", () => {
  it("gives the known values to 1e-12, also in the far lower tail", () => {
    for (const [x, p] of CDF) expect(relative(normalCdf(x), p), `x = ${x}`).toBeLessThan(1e-12);
  });

  it("gives 0.5 at 0, and the sum of the two sides is 1", () => {
    expect(normalCdf(0)).toBe(0.5);
    for (let k = 1; k <= 80; k++) {
      const x = k / 10;
      expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1, 15);
    }
  });

  it("gives the ends at the infinities, and throws for NaN", () => {
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(() => normalCdf(Number.NaN)).toThrow(RangeError);
  });
});
