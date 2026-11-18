import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fitConcentration, polyaLogLikelihood, polyaPredictive, type PolyaUnit } from "./index.ts";

const HALF = { x: 0.5, y: 0.5 } as const;

/** Each sequence of the values with the given length. */
function sequences(values: readonly string[], length: number): string[][] {
  if (length === 0) return [[]];
  return sequences(values, length - 1).flatMap((head) => values.map((value) => [...head, value]));
}

describe("polyaPredictive", () => {
  it("gives the base probability for the first observation and for independent observations", () => {
    expect(polyaPredictive(0.3, 2, 0, 0)).toBe(0.3);
    expect(polyaPredictive(0.3, Number.POSITIVE_INFINITY, 4, 5)).toBe(0.3);
  });

  it("moves to the earlier observations of the unit, more for a small concentration", () => {
    expect(polyaPredictive(0.5, 1, 1, 1)).toBeCloseTo(0.75, 12);
    expect(polyaPredictive(0.5, 1, 0, 1)).toBeCloseTo(0.25, 12);
    expect(polyaPredictive(0.5, 0.001, 1, 1)).toBeGreaterThan(0.999);
    expect(polyaPredictive(0.5, 1000, 1, 1)).toBeCloseTo(0.5, 3);
  });

  it("throws for bad input", () => {
    expect(() => polyaPredictive(1.5, 1, 0, 0)).toThrow(RangeError);
    expect(() => polyaPredictive(0.5, 0, 0, 0)).toThrow(RangeError);
    expect(() => polyaPredictive(0.5, Number.NaN, 0, 0)).toThrow(RangeError);
    expect(() => polyaPredictive(0.5, 1, 2, 1)).toThrow(RangeError);
    expect(() => polyaPredictive(0.5, 1, 0, 1.5)).toThrow(RangeError);
  });
});

describe("polyaLogLikelihood", () => {
  it("gives the product of the predictive probabilities", () => {
    expect(polyaLogLikelihood(["x", "x"], HALF, 1)).toBeCloseTo(Math.log(0.5) + Math.log(0.75), 12);
    expect(polyaLogLikelihood(["x", "y"], HALF, Number.POSITIVE_INFINITY)).toBeCloseTo(2 * Math.log(0.5), 12);
    expect(polyaLogLikelihood([], HALF, 1)).toBe(0);
  });

  it("is the same for each order of the observations, and the sequences of one length sum to 1", () => {
    const law = fc.record({
      weights: fc.array(fc.double({ min: 0.05, max: 1, noNaN: true }), { minLength: 2, maxLength: 3 }),
      concentration: fc.double({ min: 0.01, max: 100, noNaN: true }),
      seq: fc.array(fc.nat({ max: 2 }), { minLength: 1, maxLength: 6 }),
    });
    fc.assert(
      fc.property(law, ({ weights, concentration, seq }) => {
        const values = weights.map((_, i) => `v${i}`);
        const sum = weights.reduce((a, b) => a + b, 0);
        const base = Object.fromEntries(values.map((value, i) => [value, (weights[i] as number) / sum]));
        const observations = seq.map((i) => values[i % values.length] as string);
        const forward = polyaLogLikelihood(observations, base, concentration);
        expect(polyaLogLikelihood([...observations].reverse(), base, concentration)).toBeCloseTo(forward, 9);
        const total = sequences(values, 3).reduce((all, each) => all + Math.exp(polyaLogLikelihood(each, base, concentration)), 0);
        expect(total).toBeCloseTo(1, 9);
      }),
    );
  });

  it("throws for bad input", () => {
    expect(() => polyaLogLikelihood(["z"], HALF, 1)).toThrow(RangeError);
    expect(() => polyaLogLikelihood(["x"], { x: 0.5, y: 0.4 }, 1)).toThrow(RangeError);
    expect(() => polyaLogLikelihood(["x"], HALF, -1)).toThrow(RangeError);
  });
});

describe("fitConcentration", () => {
  const pair = (first: string, second: string): PolyaUnit => ({ observations: [first, second], base: HALF });

  it("finds 1 for three equal pairs and one pair that differs, with equal base probabilities", () => {
    // The likelihood ratio to independence is ((a + 2) / (a + 1))^3 * a / (a + 1). Its largest value is at a = 1.
    const fit = fitConcentration([pair("x", "x"), pair("y", "y"), pair("x", "x"), pair("x", "y")]);
    expect(fit).toBeCloseTo(1, 4);
  });

  it("gives Infinity when the repeats agree no more than independent draws", () => {
    expect(fitConcentration([pair("x", "y"), pair("y", "x"), pair("x", "x"), pair("y", "y")])).toBe(Number.POSITIVE_INFINITY);
    expect(fitConcentration([{ observations: ["x"], base: HALF }, { observations: [], base: HALF }])).toBe(Number.POSITIVE_INFINITY);
  });

  it("goes to the low end of the search for copies", () => {
    expect(fitConcentration([pair("x", "x"), pair("y", "y")])).toBeLessThan(0.002);
    expect(fitConcentration([pair("x", "x"), pair("y", "y")], { low: 0.1 })).toBeCloseTo(0.1, 6);
  });

  it("gives a log-likelihood that is not less than that of each other concentration of the range", () => {
    const units = fc.array(
      fc.record({ p: fc.double({ min: 0.05, max: 0.95, noNaN: true }), first: fc.boolean(), second: fc.boolean() }),
      { minLength: 1, maxLength: 12 },
    );
    fc.assert(
      fc.property(units, fc.double({ min: 0.001, max: 1000, noNaN: true }), (rows, other) => {
        const list = rows.map(({ p, first, second }) => ({ observations: [first ? "x" : "y", second ? "x" : "y"], base: { x: p, y: 1 - p } }));
        const total = (a: number): number => list.reduce((sum, unit) => sum + polyaLogLikelihood(unit.observations, unit.base, a), 0);
        const fit = fitConcentration(list);
        expect(total(fit)).toBeGreaterThanOrEqual(Math.max(total(other), total(Number.POSITIVE_INFINITY)) - 1e-6);
      }),
    );
  });

  it("throws for bad input", () => {
    expect(() => fitConcentration([])).toThrow(RangeError);
    expect(() => fitConcentration([pair("x", "x")], { low: 2, high: 1 })).toThrow(RangeError);
    expect(() => fitConcentration([{ observations: ["x"], base: { x: 2 } }])).toThrow(RangeError);
  });
});
