import { describe, expect, it } from "vitest";
import { cohenKappa, wilson, wilsonSampleSize } from "./index.ts";

describe("cohenKappa", () => {
  it("gives the kappa of the textbook table of two raters", () => {
    // 50 items: both yes 20, yes and no 5, no and yes 10, both no 15
    const a = [...Array(20).fill("yes"), ...Array(5).fill("yes"), ...Array(10).fill("no"), ...Array(15).fill("no")] as string[];
    const b = [...Array(20).fill("yes"), ...Array(5).fill("no"), ...Array(10).fill("yes"), ...Array(15).fill("no")] as string[];
    const result = cohenKappa(a, b);
    expect(result.n).toBe(50);
    expect(result.observed).toBeCloseTo(0.7);
    expect(result.chance).toBeCloseTo(0.5);
    expect(result.kappa).toBeCloseTo(0.4);
  });

  it("gives 1 for full agreement, and a value below 0 for agreement under chance", () => {
    expect(cohenKappa(["a", "b", "c", "a"], ["a", "b", "c", "a"]).kappa).toBe(1);
    expect(cohenKappa(["a", "b", "a", "b"], ["b", "a", "b", "a"]).kappa).toBeLessThan(0);
  });

  it("gives no kappa when one category takes all items, and refuses lists of two lengths", () => {
    expect(cohenKappa([1, 1, 1], [1, 1, 1]).kappa).toBeUndefined();
    expect(() => cohenKappa([1], [1, 2])).toThrow(RangeError);
    expect(() => cohenKappa([], [])).toThrow(RangeError);
  });
});

describe("wilsonSampleSize", () => {
  it("gives the smallest n at which the Wilson lower end reaches the target", () => {
    for (const [target, expected, size] of [
      [0.9, 0.95, 127],
      [0.9, 0.97, 69],
      [0.85, 0.92, 92],
      [0.8, 0.9, 54],
      [0.95, 0.98, 173],
    ] as const) {
      const n = wilsonSampleSize(target, expected);
      expect(n, `${target} at ${expected}`).toBe(size);
      expect(wilson(Math.round(expected * size), size).low).toBeGreaterThanOrEqual(target);
      expect(wilson(Math.round(expected * (size - 1)), size - 1).low).toBeLessThan(target);
    }
  });

  it("shows that 30 of 30 cannot reach a target of 0.90", () => {
    expect(wilson(30, 30).low).toBeLessThan(0.9);
    expect(wilsonSampleSize(0.9, 1)).toBeGreaterThan(30);
  });

  it("gives no size when the expected proportion is not above the target", () => {
    expect(wilsonSampleSize(0.9, 0.9)).toBeUndefined();
    expect(wilsonSampleSize(0.9, 0.8)).toBeUndefined();
    expect(wilsonSampleSize(0.9, 0.95, undefined, 10)).toBeUndefined();
    expect(() => wilsonSampleSize(1.2, 0.5)).toThrow(RangeError);
  });
});
