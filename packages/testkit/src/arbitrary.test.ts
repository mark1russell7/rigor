import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uniformDouble } from "./arbitrary.ts";

/** The share of 20000 draws with the seed 7 that pass `test`. */
function share(arbitrary: fc.Arbitrary<number>, test: (x: number) => boolean): number {
  const values = fc.sample(arbitrary, { seed: 7, numRuns: 20_000 });
  return values.filter(test).length / values.length;
}

describe("uniformDouble", () => {
  it("draws uniformly by value, where fc.double draws almost only values near 0", () => {
    // The trap: fc.double draws uniformly over the floats, and the floats are dense near 0.
    expect(share(fc.double({ min: -1, max: 1, noNaN: true }), (x) => Math.abs(x) > 0.2)).toBeLessThan(0.1);
    expect(share(fc.double({ min: 0, max: 6, noNaN: true }), (x) => x > 3.9)).toBeLessThan(0.1);
    // Uniform by value: 80 % and 35 %.
    expect(share(uniformDouble({ min: -1, max: 1 }), (x) => Math.abs(x) > 0.2)).toBeGreaterThan(0.75);
    expect(share(uniformDouble({ min: 0, max: 6 }), (x) => x > 3.9)).toBeGreaterThan(0.3);
  });

  it("gives each tenth of the range about one tenth of the draws, and more draws near min and max", () => {
    const values = fc.sample(uniformDouble({ min: 0, max: 1 }), { seed: 7, numRuns: 20_000 });
    const tenths = Array.from({ length: 10 }, (_, i) => values.filter((x) => Math.min(9, Math.floor(x * 10)) === i).length / values.length);
    for (const part of tenths.slice(1, 9)) expect(part).toBeGreaterThan(0.07);
    for (const part of tenths.slice(1, 9)) expect(part).toBeLessThan(0.1);
    // Approximately 1 draw in 8 is near min, and 1 draw in 16 is near max.
    expect(values.filter((x) => x < 1e-3).length / values.length).toBeGreaterThan(0.1);
    expect(values.filter((x) => x > 1 - 1e-3).length / values.length).toBeGreaterThan(0.04);
    expect(tenths[0]).toBeLessThan(0.3);
    expect(tenths[9]).toBeLessThan(0.2);
  });

  it("keeps each value in the range, also for a range wider than the largest double", () => {
    fc.assert(fc.property(uniformDouble({ min: -3, max: 7 }), (x) => x >= -3 && x <= 7));
    fc.assert(fc.property(uniformDouble({ min: -Number.MAX_VALUE, max: Number.MAX_VALUE }), (x) => Number.isFinite(x)));
    expect(fc.sample(uniformDouble({ min: 2.5, max: 2.5 }), { seed: 1, numRuns: 10 })).toEqual(Array(10).fill(2.5));
  });

  it("shrinks a counterexample toward min", () => {
    const result = fc.check(fc.property(uniformDouble({ min: 0, max: 1 }), (x) => x < 0.5), { seed: 3 });
    expect(result.failed).toBe(true);
    const [x] = result.counterexample!;
    expect(x).toBeGreaterThanOrEqual(0.5);
    expect(x).toBeLessThan(0.5 + 1e-9);
  });

  it("refuses a bound that is not finite and a max below min", () => {
    expect(() => uniformDouble({ min: 0, max: Infinity })).toThrow(/finite/);
    expect(() => uniformDouble({ min: Number.NaN, max: 1 })).toThrow(/finite/);
    expect(() => uniformDouble({ min: 1, max: 0 })).toThrow(/max is min or more/);
  });
});
