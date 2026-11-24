import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { poissonBinomialTest, weightedBernoulliTest } from "./index.ts";

/** The chance `P(S >= threshold)`, from a sum over each of the 2^n outcomes of the trials. */
function tailOfEachOutcome(threshold: number, ps: readonly number[], weights: readonly number[]): number {
  let tail = 0;
  for (let outcome = 0; outcome < 2 ** ps.length; outcome++) {
    let [chance, sum] = [1, 0];
    ps.forEach((p, i) => {
      if (outcome & (1 << i)) {
        chance *= p;
        sum += weights[i] ?? 0;
      } else chance *= 1 - p;
    });
    if (sum >= threshold) tail += chance;
  }
  return tail;
}

const chance = uniformDouble({ min: 0, max: 1 });
const weight = uniformDouble({ min: 0, max: 10 });
/** Up to 10 trials with a chance and a weight each, and a threshold from 0 to the sum of the weights. */
const cases = fc
  .array(fc.tuple(chance, weight), { minLength: 1, maxLength: 10 })
  .chain((trials) => fc.tuple(fc.constant(trials), uniformDouble({ min: 0, max: trials.reduce((s, [, w]) => s + w, 0) })));

describe("weightedBernoulliTest", () => {
  it("bounds the sum over each outcome of up to 10 trials", () => {
    fc.assert(
      fc.property(cases, ([trials, threshold]) => {
        const ps = trials.map(([p]) => p);
        const weights = trials.map(([, w]) => w);
        const exact = tailOfEachOutcome(threshold, ps, weights);
        const { low, high } = weightedBernoulliTest(threshold, ps, weights);
        expect(low).toBeLessThanOrEqual(exact + 1e-12);
        expect(high).toBeGreaterThanOrEqual(exact - 1e-12);
        expect(low).toBeLessThanOrEqual(high);
      }),
    );
  });

  it("gives closer bounds with more cells", () => {
    fc.assert(
      fc.property(cases, ([trials, threshold]) => {
        const ps = trials.map(([p]) => p);
        const weights = trials.map(([, w]) => w);
        const coarse = weightedBernoulliTest(threshold, ps, weights, { cells: 16 });
        const fine = weightedBernoulliTest(threshold, ps, weights, { cells: 4096 });
        expect(fine.high - fine.low).toBeLessThanOrEqual(coarse.high - coarse.low + 1e-12);
      }),
    );
  });

  it("is equal to the Poisson binomial test when each weight is equal", () => {
    fc.assert(
      fc.property(fc.array(chance, { minLength: 1, maxLength: 30 }), fc.nat({ max: 30 }), weight, (ps, k, w) => {
        fc.pre(w > 0 && k <= ps.length);
        const p = poissonBinomialTest(k, ps, "greater");
        expect(weightedBernoulliTest(k * w, ps, ps.map(() => w))).toEqual({ low: p, high: p });
      }),
    );
  });

  it("does not change with the order of the trials", () => {
    fc.assert(
      fc.property(cases, fc.integer(), ([trials, threshold], seed) => {
        const turned = trials.map((trial, i) => [trial, (i * 7919 + seed) % 1009] as const).sort((a, b) => a[1] - b[1]).map(([trial]) => trial);
        const a = weightedBernoulliTest(threshold, trials.map(([p]) => p), trials.map(([, w]) => w));
        const b = weightedBernoulliTest(threshold, turned.map(([p]) => p), turned.map(([, w]) => w));
        expect(b.low).toBeCloseTo(a.low, 12);
        expect(b.high).toBeCloseTo(a.high, 12);
      }),
    );
  });

  it("gives 1 at a threshold of 0 or less, and 0 above the sum of the weights", () => {
    expect(weightedBernoulliTest(0, [0.1, 0.2], [1, 2])).toEqual({ low: 1, high: 1 });
    expect(weightedBernoulliTest(-1, [], [])).toEqual({ low: 1, high: 1 });
    expect(weightedBernoulliTest(3.5, [0.5, 0.5], [1, 2])).toEqual({ low: 0, high: 0 });
    expect(weightedBernoulliTest(1, [0.5], [0])).toEqual({ low: 0, high: 0 });
    // Both trials succeed: 0.5 x 0.25.
    expect(weightedBernoulliTest(3, [0.5, 0.25], [1, 2])).toEqual({ low: 0.125, high: 0.125 });
  });

  it("refuses bad inputs", () => {
    expect(() => weightedBernoulliTest(1, [0.5], [1, 2])).toThrow(RangeError);
    expect(() => weightedBernoulliTest(1, [1.5], [1])).toThrow(RangeError);
    expect(() => weightedBernoulliTest(1, [0.5], [-1])).toThrow(RangeError);
    expect(() => weightedBernoulliTest(1, [0.5], [Number.POSITIVE_INFINITY])).toThrow(RangeError);
    expect(() => weightedBernoulliTest(Number.NaN, [0.5], [1])).toThrow(RangeError);
    expect(() => weightedBernoulliTest(1, [0.5], [1], { cells: 0 })).toThrow(RangeError);
    expect(() => weightedBernoulliTest(1, [0.5], [1], { cells: 1.5 })).toThrow(RangeError);
  });
});
