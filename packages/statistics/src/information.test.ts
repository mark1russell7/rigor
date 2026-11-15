import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { entropy, informationGain } from "./index.ts";

/** A distribution with n values from positive weights. */
const weights = (n: number): fc.Arbitrary<number[]> =>
  fc.array(fc.double({ min: 0.001, max: 1, noNaN: true }), { minLength: n, maxLength: n }).map((w) => {
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / sum);
  });

const table = fc
  .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 5 }))
  .chain(([h, x]) => fc.tuple(weights(h), fc.array(weights(x), { minLength: h, maxLength: h })));

describe("entropy", () => {
  it("gives 0 for one sure outcome and log2(n) for n equal outcomes", () => {
    expect(entropy([1])).toBe(0);
    expect(entropy([0, 1, 0])).toBe(0);
    expect(entropy([0.5, 0.5])).toBeCloseTo(1, 12);
    expect(entropy([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(2, 12);
    expect(entropy([0.5, 0.25, 0.25])).toBeCloseTo(1.5, 12);
  });

  it("refuses a list that is not a distribution", () => {
    expect(() => entropy([])).toThrow(RangeError);
    expect(() => entropy([0.5, 0.4])).toThrow(/sum/);
    expect(() => entropy([1.5, -0.5])).toThrow(/0 or more/);
    expect(() => entropy([Number.NaN, 1])).toThrow(RangeError);
  });
});

describe("informationGain", () => {
  it("gives the full entropy of the prior for an observation that tells each value", () => {
    expect(informationGain([0.5, 0.5], [[1, 0], [0, 1]])).toBeCloseTo(1, 12);
    expect(informationGain([0.25, 0.25, 0.5], [[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBeCloseTo(1.5, 12);
  });

  it("gives 0 for an observation with the same row for each value", () => {
    expect(informationGain([0.3, 0.7], [[0.2, 0.8], [0.2, 0.8]])).toBeCloseTo(0, 12);
  });

  it("gives the gain of a noisy test", () => {
    // A test that is right with the probability 0.9 on a fair variable: 1 - H(0.9, 0.1) bits.
    expect(informationGain([0.5, 0.5], [[0.9, 0.1], [0.1, 0.9]])).toBeCloseTo(1 - entropy([0.9, 0.1]), 12);
  });

  it("is the entropy of the prior minus the expected entropy of the posterior", () => {
    fc.assert(
      fc.property(table, ([prior, likelihood]) => {
        const outcomes = likelihood[0]?.length ?? 0;
        let expected = 0;
        for (let x = 0; x < outcomes; x++) {
          const joint = prior.map((p, h) => p * (likelihood[h]?.[x] ?? 0));
          const px = joint.reduce((a, b) => a + b, 0);
          if (px > 0) expected += px * entropy(joint.map((j) => j / px));
        }
        const gain = informationGain(prior, likelihood);
        expect(gain).toBeCloseTo(entropy(prior) - expected, 9);
        expect(gain).toBeGreaterThanOrEqual(0);
        expect(gain).toBeLessThanOrEqual(entropy(prior));
      }),
    );
  });

  it("does not change when the values of the variable change their order", () => {
    fc.assert(
      fc.property(table, ([prior, likelihood]) => {
        expect(informationGain([...prior].reverse(), [...likelihood].reverse())).toBeCloseTo(informationGain(prior, likelihood), 9);
      }),
    );
  });

  it("refuses a likelihood that does not match the prior", () => {
    expect(() => informationGain([0.5, 0.5], [[1, 0]])).toThrow(/rows/);
    expect(() => informationGain([0.5, 0.5], [[1, 0], [1]])).toThrow(/outcomes/);
    expect(() => informationGain([0.5, 0.5], [[0.6, 0.6], [0.5, 0.5]])).toThrow(/row 0/);
    expect(() => informationGain([0.9], [[1]])).toThrow(/prior/);
  });
});
