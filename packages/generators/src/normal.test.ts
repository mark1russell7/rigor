import { describe, expect, it } from "vitest";
import { normalCdf, normalQuantile } from "./normal.ts";

const relative = (got: number, want: number): number => (got === want ? 0 : Math.abs(got - want) / Math.abs(want));

// The reference values come from `mpmath` at 200 bits, for the exact double of each input. The lists hold the worst
// inputs of a measure of 2026-11-09 over 8 700 inputs of the cdf and 9 700 inputs of the quantile. The bounds are the
// measured errors with a small margin. A change that loses accuracy fails here.
const CDF: readonly (readonly [number, number])[] = [
  [-37.39, 2.8403651198652468e-306],
  [-34.37987840175629, 2.5200163021737226e-259],
  [-20.5, 1.0764673258790961e-93],
  [-12.34, 2.7577941516989773e-35],
  [-7.77, 3.924306316131574e-15],
  [-7.61, 1.370479613286933e-14],
  [-3.3, 0.0004834241423837775],
  [-1.234, 0.10860145212152428],
  [-0.69, 0.24509709367430949],
  [-0.6, 0.2742531177500736],
  [-0.1, 0.460172162722971],
  [0.3, 0.6179114221889527],
  [0.74, 0.7703500028352094],
  [0.88, 0.8105703452232879],
  [1.7, 0.955434537241457],
  [4.1, 0.9999793424930875],
  [8.2, 0.9999999999999999],
];

const QUANTILE: readonly (readonly [number, number])[] = [
  [1e-300, -37.0470962993612],
  [1e-100, -21.273453560965326],
  [1e-20, -9.262340089798407],
  [1e-5, -4.264890793922825],
  [0.01, -2.326347874040841],
  [0.05, -1.6448536269514726],
  [0.061370521783828735, -1.5433699369669607],
  [0.074, -1.4466320671589785],
  [0.2, -0.8416212335729142],
  [0.4, -0.2533471031357997],
  [0.4999, -0.00025066283008800747],
  [0.6, 0.2533471031357997],
  [0.691, 0.49868686414212193],
  [0.9, 1.2815515655446006],
  [0.99, 2.3263478740408408],
  [0.9999999999, 6.361340889697422],
];

describe("normalCdf", () => {
  it("gives the values of the tables within 2 epsilon, also in the tails", () => {
    const tables: readonly (readonly [number, number])[] = [
      [1.96, 0.9750021048517795],
      [-1.96, 0.024997895148220435],
      [-1, 0.15865525393145707],
      [-0.5, 0.3085375387259869],
      [-5, 2.866515718791939e-7],
      [-10, 7.619853024160527e-24],
      [-20, 2.7536241186062337e-89],
    ];
    for (const [x, want] of tables) expect(relative(normalCdf(x), want), String(x)).toBeLessThanOrEqual(2 * Number.EPSILON);
    expect(normalCdf(0)).toBe(0.5);
  });

  it("gives each value of mpmath within 5 epsilon, from -38 to 9", () => {
    for (const [x, want] of CDF) expect(relative(normalCdf(x), want), String(x)).toBeLessThanOrEqual(5 * Number.EPSILON);
  });

  it("increases across the change from the series to the fraction at 0.75", () => {
    for (const edge of [-0.75, 0.75]) {
      let last = normalCdf(edge - 1e-9);
      for (let k = -999; k <= 1000; k++) {
        const value = normalCdf(edge + k * 1e-12);
        expect(value).toBeGreaterThanOrEqual(last);
        last = value;
      }
    }
  });

  it("gives the ends at the infinities and below the smallest double, and throws for NaN", () => {
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(-38.4)).toBeGreaterThan(0);
    expect(normalCdf(-39)).toBe(0);
    expect(() => normalCdf(Number.NaN)).toThrow(RangeError);
  });
});

describe("normalQuantile", () => {
  it("gives each value of mpmath within 1.5 epsilon in the tails and 6 epsilon from 0.075 to 0.925", () => {
    for (const [p, want] of QUANTILE) {
      const bound = p < 0.075 || p > 0.925 ? 1.5 : 6;
      expect(relative(normalQuantile(p), want), String(p)).toBeLessThanOrEqual(bound * Number.EPSILON);
    }
  });

  it("gives 1.959963984540054 within 1 ulp at 0.025 and 0.975, and 0 at 0.5", () => {
    const want = 1.959963984540054;
    expect(Math.abs(normalQuantile(0.975) - want)).toBeLessThanOrEqual(Number.EPSILON);
    expect(Math.abs(normalQuantile(0.025) + want)).toBeLessThanOrEqual(Number.EPSILON);
    expect(normalQuantile(0.5)).toBe(0);
  });

  it("increases across the change of method at 0.075", () => {
    let last = normalQuantile(0.075 - 1e-9);
    for (let k = -999; k <= 1000; k++) {
      const value = normalQuantile(0.075 + k * 1e-12);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it("goes back to p through normalCdf, from the smallest double to 1 - 1e-10", () => {
    for (const p of [Number.MIN_VALUE, 1e-310, 1e-305, 1e-200, 1e-50, 1e-3, 0.3, 0.7, 0.999, 1 - 1e-10]) {
      const x = normalQuantile(p);
      expect(Number.isFinite(x), String(p)).toBe(true);
      // Below the normal doubles, the cdf has few bits. The bound there is 1e-3.
      expect(relative(normalCdf(x), p), String(p)).toBeLessThan(p < 1e-300 ? 1e-3 : 1e-12);
    }
  });

  it("gives the infinite ends at 0 and 1, and throws for a p out of its range", () => {
    expect(normalQuantile(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(normalQuantile(1)).toBe(Number.POSITIVE_INFINITY);
    for (const p of [Number.NaN, -0.1, 1.1]) expect(() => normalQuantile(p)).toThrow(RangeError);
  });
});
