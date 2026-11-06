import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import { optionFloor, tQuantile } from "./power.ts";

// Values of a published table of the Student t law, to 5 places.
const TABLE: readonly (readonly [number, number, number])[] = [
  [0.975, 1, 12.7062],
  [0.975, 5, 2.57058],
  [0.975, 10, 2.22814],
  [0.975, 30, 2.04227],
  [0.995, 5, 4.03214],
  [0.995, 20, 2.84534],
  [0.9, 3, 1.63774],
  [0.8, 10, 0.87906],
];

describe("tQuantile", () => {
  it.each(TABLE)("gives the table value at p %s and df %s", (p, df, value) => {
    expect(tQuantile(p, df)).toBeCloseTo(value, 4);
  });

  it("is odd about p of 0.5, and goes to the normal law at a large df", () => {
    expect(tQuantile(0.5, 7)).toBeCloseTo(0, 10);
    expect(tQuantile(0.025, 10)).toBeCloseTo(-tQuantile(0.975, 10), 10);
    expect(tQuantile(0.975, 1e7)).toBeCloseTo(1.95996, 4);
  });

  it("rises with p and falls with df", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.51, max: 0.98, noNaN: true }), fc.integer({ min: 1, max: 200 }), (p, df) => {
        expect(tQuantile(p + 0.01, df)).toBeGreaterThan(tQuantile(p, df));
        expect(tQuantile(p, df + 1)).toBeLessThan(tQuantile(p, df));
      }),
    );
  });

  it("refuses a p out of the open interval and a bad df", () => {
    expect(() => tQuantile(0, 3)).toThrow(RangeError);
    expect(() => tQuantile(1, 3)).toThrow(RangeError);
    expect(() => tQuantile(0.9, 0)).toThrow(RangeError);
    expect(() => tQuantile(0.9, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

/** This function gives the share of seeded draws in which a pooled t test of two groups of `n` finds the shift. The level is that of a family of `tests`. */
function simulatedPower(n: number, tests: number, shift: number, seed: string, trials: number): number {
  const r = random(seed);
  const critical = tQuantile(1 - 0.05 / (2 * tests), 2 * n - 2);
  let found = 0;
  for (let t = 0; t < trials; t++) {
    const a = Array.from({ length: n }, () => r.normal(0, 1));
    const b = Array.from({ length: n }, () => r.normal(shift, 1));
    const ma = a.reduce((s, x) => s + x, 0) / n;
    const mb = b.reduce((s, x) => s + x, 0) / n;
    const pooled = (a.reduce((s, x) => s + (x - ma) ** 2, 0) + b.reduce((s, x) => s + (x - mb) ** 2, 0)) / (2 * n - 2);
    if (Math.abs(mb - ma) / Math.sqrt((2 * pooled) / n) > critical) found++;
  }
  return found / trials;
}

describe("optionFloor", () => {
  const SIGMA = 0.0243;
  const DELTA = 0.0389;

  it("gives the counts of the t form, above the counts of the normal form", () => {
    const floors = [1, 2, 3, 5, 6, 10, 18, 67].map((tests) => optionFloor({ sigma: SIGMA, delta: DELTA, tests }));
    expect(floors).toEqual([8, 9, 10, 11, 12, 13, 14, 17]);
  });

  it.each([1, 5, 67])("has a simulated power of 0.78 or more at the floor for %s tests, and less one count below", (tests) => {
    const n = optionFloor({ sigma: 1, delta: DELTA / SIGMA, tests });
    const at = simulatedPower(n, tests, DELTA / SIGMA, `rigor-statistics/optionFloor/at/${tests}`, 2000);
    const below = simulatedPower(n - 1, tests, DELTA / SIGMA, `rigor-statistics/optionFloor/below/${tests}`, 2000);
    expect(at).toBeGreaterThanOrEqual(0.78);
    expect(below).toBeLessThan(at);
  });

  it("gives the first count that meets its form, and depends only on the ratio of delta to sigma", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.3, max: 3, noNaN: true }),
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: 0.01, max: 10, noNaN: true }),
        (ratio, tests, scale) => {
          const n = optionFloor({ sigma: 1, delta: ratio, tests });
          const need = (count: number): number => {
            const df = 2 * count - 2;
            return 2 * ((tQuantile(1 - 0.05 / (2 * tests), df) + tQuantile(0.8, df)) / ratio) ** 2;
          };
          expect(n).toBeGreaterThanOrEqual(need(n));
          if (n > 2) expect(n - 1).toBeLessThan(need(n - 1));
          expect(optionFloor({ sigma: scale, delta: ratio * scale, tests })).toBe(n);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("does not fall when the family grows or the power rises", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.3, max: 3, noNaN: true }), fc.integer({ min: 1, max: 100 }), (ratio, tests) => {
        const n = optionFloor({ sigma: 1, delta: ratio, tests });
        expect(optionFloor({ sigma: 1, delta: ratio, tests: tests + 1 })).toBeGreaterThanOrEqual(n);
        expect(optionFloor({ sigma: 1, delta: ratio, tests, power: 0.9 })).toBeGreaterThanOrEqual(n);
      }),
      { numRuns: 60 },
    );
  });

  it("refuses options out of their ranges", () => {
    expect(() => optionFloor({ sigma: 0, delta: 1, tests: 1 })).toThrow(RangeError);
    expect(() => optionFloor({ sigma: 1, delta: -1, tests: 1 })).toThrow(RangeError);
    expect(() => optionFloor({ sigma: 1, delta: 1, tests: 1.5 })).toThrow(RangeError);
    expect(() => optionFloor({ sigma: 1, delta: 1, tests: 1, alpha: 1 })).toThrow(RangeError);
    expect(() => optionFloor({ sigma: 1, delta: 1, tests: 1, power: 0.5 })).toThrow(RangeError);
  });
});
