import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { correlationPermutation, kendallTau, pearson, ranks, spearman, wilson } from "./index.ts";

/** This function gives each order of `items`, by recursion: a second method, apart from the method of Heap in the code. */
function allOrders(items: readonly number[]): number[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((head, i) => allOrders([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [head, ...rest]));
}

const integers = (min: number, max: number) => fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: min, maxLength: max });

describe("pearson", () => {
  it("gives the value of a hand calculation", () => {
    // The centered lists are [-2, -1, 0, 1, 2] and [-1, -2, 1, 0, 2]: 8 / sqrt(10 * 10).
    expect(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBe(0.8);
    expect(pearson([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
  });

  it("gives 0 when a list has no spread, or has fewer than 2 values", () => {
    expect(pearson([1, 2, 3], [5, 5, 5])).toBe(0);
    expect(pearson([7], [3])).toBe(0);
    expect(pearson([], [])).toBe(0);
  });

  it("keeps its value at the ends of the range of a double", () => {
    expect(pearson([1e200, 2e200, 3e200, 5e200], [1, 2, 3, 5])).toBeCloseTo(1, 12);
    expect(pearson([1e-200, 2e-200, 3e-200, 5e-200], [1, 2, 3, 5])).toBeCloseTo(1, 12);
    expect(pearson([1e300, -1e300, 1e300, -1e300], [1, -1, -1, 1])).toBe(0);
  });

  it("gives the same value to the bit when a list is multiplied by a power of 2", () => {
    fc.assert(
      fc.property(integers(2, 30), fc.integer({ min: -900, max: 900 }), fc.integer({ min: -900, max: 900 }), (a, k, j) => {
        const b = a.map((v, i) => (v * 7 + i * i) % 1001);
        expect(pearson(a.map((v) => v * 2 ** k), b.map((v) => v * 2 ** j))).toBe(pearson(a, b));
      }),
    );
  });

  it("gives a value from -1 to 1", () => {
    const values = fc.array(uniformDouble({ min: -1e6, max: 1e6 }), { minLength: 2, maxLength: 40 });
    fc.assert(
      fc.property(values, values, (a, b) => {
        const n = Math.min(a.length, b.length);
        const r = pearson(a.slice(0, n), b.slice(0, n));
        expect(r).toBeGreaterThanOrEqual(-1);
        expect(r).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("is equal to spearman on the ranks, to the bit", () => {
    fc.assert(
      fc.property(integers(0, 30), (a) => {
        const b = a.map((v, i) => (v * 13 + i) % 17);
        expect(spearman(a, b)).toBe(pearson(ranks(a), ranks(b)));
      }),
    );
  });

  it("refuses lists of different lengths and values that are not finite", () => {
    expect(() => pearson([1, 2], [1])).toThrow(RangeError);
    expect(() => pearson([1, Number.NaN], [1, 2])).toThrow(RangeError);
    expect(() => pearson([1, 2], [1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });
});

describe("correlationPermutation", () => {
  it("reads each order when n! is the runs or less, and gives the exact p", () => {
    const a = [1, 2, 3, 4];
    // Only the same order and the reverse order have a correlation of 1 in absolute value.
    expect(correlationPermutation(a, a)).toEqual({ observed: 1, p: 2 / 24, runs: 24, exact: true });
    expect(correlationPermutation(a, a, { side: "greater" })).toEqual({ observed: 1, p: 1 / 24, runs: 24, exact: true });
    expect(correlationPermutation(a, a, { side: "less" })).toEqual({ observed: 1, p: 1, runs: 24, exact: true });
  });

  it("gives the exact p of a count over each order, for each method and each side", () => {
    const r = random("correlation-exact");
    const a = Array.from({ length: 6 }, () => r.normal());
    const b = a.map((v) => v + 2 * r.normal());
    const methods = [
      ["pearson", pearson],
      ["spearman", spearman],
    ] as const;
    for (const [method, statistic] of methods) {
      const observed = statistic(a, b);
      const values = allOrders(b).map((order) => statistic(a, order));
      const sides = {
        both: values.filter((v) => Math.abs(v) >= Math.abs(observed) - 1e-12).length,
        greater: values.filter((v) => v >= observed - 1e-12).length,
        less: values.filter((v) => v <= observed + 1e-12).length,
      };
      for (const [side, hits] of Object.entries(sides)) {
        const result = correlationPermutation(a, b, { method, side: side as keyof typeof sides, runs: 720 });
        expect(result).toEqual({ observed, p: hits / 720, runs: 720, exact: true });
      }
    }
  });

  it("draws random orders when n! is over the runs, and the p is near the exact p", () => {
    const a = [1, 2, 3, 4, 5, 6, 7];
    const b = [3, 1, 4, 7, 2, 6, 5];
    const exact = correlationPermutation(a, b, { runs: 5040 });
    expect(exact.exact).toBe(true);
    const drawn = correlationPermutation(a, b, { runs: 5039 });
    expect(drawn.exact).toBe(false);
    expect(drawn.runs).toBe(5039);
    expect(drawn.observed).toBe(exact.observed);
    // The standard error of the drawn p is at most 0.5 / sqrt(5039), or 0.007.
    expect(Math.abs(drawn.p - exact.p)).toBeLessThan(0.03);
  });

  it("gives the same result for the same seed", () => {
    const r = random(7);
    const a = Array.from({ length: 40 }, () => r.normal());
    const b = Array.from({ length: 40 }, () => r.normal());
    const options = { runs: 500, seed: "same" };
    expect(correlationPermutation(a, b, options)).toEqual(correlationPermutation(a, b, options));
  });

  it("rejects the null at the level or less, when the lists are independent", () => {
    // A valid test has P(p <= level) <= level. Here 400 pairs of independent lists, 199 runs each, at the level 0.05.
    const r = random("correlation-null");
    let rejected = 0;
    for (let trial = 0; trial < 400; trial++) {
      const a = Array.from({ length: 12 }, () => r.normal());
      const b = Array.from({ length: 12 }, () => r.normal());
      if (correlationPermutation(a, b, { runs: 199, seed: trial }).p <= 0.05) rejected++;
    }
    const share = wilson(rejected, 400);
    expect(share.low).toBeLessThanOrEqual(0.05);
    expect(share.high).toBeGreaterThanOrEqual(0.05);
  });

  it("finds a strong correlation with the smallest p of the runs", () => {
    const r = random("correlation-power");
    const a = Array.from({ length: 30 }, (_, i) => i);
    const b = a.map((v) => v + 3 * r.normal());
    const result = correlationPermutation(a, b, { runs: 999 });
    expect(result.observed).toBeGreaterThan(0.9);
    expect(result.p).toBe(1 / 1000);
  });

  it("gives the p of the side greater of b as the p of the side less of -b", () => {
    fc.assert(
      fc.property(integers(8, 20), fc.integer(), (a, seed) => {
        const b = a.map((v, i) => (v * 31 + i * 5) % 97);
        const negated = b.map((v) => -v);
        const greater = correlationPermutation(a, b, { side: "greater", runs: 200, seed });
        const less = correlationPermutation(a, negated, { side: "less", runs: 200, seed });
        expect(less.p).toBe(greater.p);
        expect(correlationPermutation(a, negated, { runs: 200, seed }).p).toBe(correlationPermutation(a, b, { runs: 200, seed }).p);
      }),
      { numRuns: 50 },
    );
  });

  it("gives the same spearman result after a function that keeps the order of the values", () => {
    const r = random("correlation-monotone");
    const a = Array.from({ length: 25 }, () => r.normal());
    const b = a.map((v) => v + r.normal());
    const options = { method: "spearman", runs: 300 } as const;
    expect(correlationPermutation(a.map((v) => v ** 3), b.map(Math.exp), options)).toEqual(correlationPermutation(a, b, options));
  });

  it("takes a function of the two lists as its statistic", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [2, 1, 4, 3, 5];
    const method = (x: readonly number[], y: readonly number[]): number => kendallTau(x, y);
    const result = correlationPermutation(a, b, { method });
    expect(result.observed).toBe(kendallTau(a, b));
    expect(result.exact).toBe(true);
    expect(result.runs).toBe(120);
    const hits = allOrders(b).filter((order) => Math.abs(kendallTau(a, order)) >= Math.abs(result.observed) - 1e-12).length;
    expect(result.p).toBe(hits / 120);
  });

  it("gives the observed value 0 and the p 1 when a list has no spread", () => {
    expect(correlationPermutation([1, 2, 3], [4, 4, 4])).toEqual({ observed: 0, p: 1, runs: 6, exact: true });
  });

  it("refuses wrong input", () => {
    expect(() => correlationPermutation([1, 2], [1])).toThrow(RangeError);
    expect(() => correlationPermutation([1, 2], [1], { method: kendallTau })).toThrow(RangeError);
    expect(() => correlationPermutation([1, Number.POSITIVE_INFINITY], [1, 2])).toThrow(RangeError);
    expect(() => correlationPermutation([1, Number.NaN], [1, 2], { method: "spearman" })).toThrow(RangeError);
    expect(() => correlationPermutation([1, 2], [1, 2], { runs: 0 })).toThrow(RangeError);
    expect(() => correlationPermutation([1, 2], [1, 2], { method: "kendall" as "pearson" })).toThrow(RangeError);
    expect(() => correlationPermutation([1, 2], [1, 2], { side: "two" as "both" })).toThrow(RangeError);
    expect(() => correlationPermutation([1, 2], [1, 2], { method: () => Number.NaN })).toThrow(RangeError);
  });

  it("takes Infinity in a list for the method spearman, because the ranks are finite", () => {
    expect(correlationPermutation([1, 2, Number.POSITIVE_INFINITY], [1, 2, 3], { method: "spearman" }).observed).toBe(1);
  });
});
