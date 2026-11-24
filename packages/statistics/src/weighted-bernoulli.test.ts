import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { poissonBinomialTest, WEIGHTED_TAIL_TOLERANCE, weightedBernoulliTest } from "./index.ts";

/** The chance `P(S >= threshold)` with the tolerance of the threshold, from a sum over each of the 2^n outcomes of the trials. */
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
    if (sum >= threshold * (1 - WEIGHTED_TAIL_TOLERANCE)) tail += chance;
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
    // A counterexample of an oracle with no tolerance: the threshold is 2e-15 over the largest weight.
    const ps = [0.8357973102966515, 0.6573055439801069, 1.332267629550188e-15];
    const weights = [1.4432899320127038e-14, 9.181450859258245, 3.441691376337986e-14];
    const near = weightedBernoulliTest(9.181450859258247, ps, weights);
    expect(near.low).toBeLessThanOrEqual(tailOfEachOutcome(9.181450859258247, ps, weights));
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

  it("refuses an input of more steps than maxWork, before the work starts", () => {
    const ps = Array.from({ length: 2000 }, () => 0.01);
    const weights = ps.map((_, i) => 1 + (i % 7) / 7);
    expect(() => weightedBernoulliTest(10, ps, weights)).toThrow(/maxWork/u);
    expect(() => weightedBernoulliTest(10, ps.slice(0, 20), weights.slice(0, 20), { maxWork: 1000 })).toThrow(RangeError);
    expect(weightedBernoulliTest(10, ps.slice(0, 20), weights.slice(0, 20)).high).toBeGreaterThan(0);
    expect(() => weightedBernoulliTest(1, [0.5], [1], { maxWork: 0 })).toThrow(RangeError);
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
