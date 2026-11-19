import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Random, random } from "@mark1russell7/rigor-generators";
import { type ClassForecast, type VectorScaling, scaledProbabilities, vectorScaling } from "./index.ts";

/** The softmax of a list of logits. */
function softmax(z: readonly number[]): number[] {
  const top = Math.max(...z);
  const w = z.map((v) => Math.exp(v - top));
  const sum = w.reduce((s, v) => s + v, 0);
  return w.map((v) => v / sum);
}

/** Forecasts of `classes` classes from random logits, each with a label drawn from the forecast after the map `truth`. */
function draws(r: Random, classes: number, n: number, truth: VectorScaling): ClassForecast[] {
  return Array.from({ length: n }, () => {
    const probabilities = softmax(Array.from({ length: classes }, () => 1.5 * r.normal()));
    return { probabilities, label: r.weighted(scaledProbabilities(probabilities, truth)) };
  });
}

const centered = (values: readonly number[]): number[] => {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.map((v) => v - mean);
};

describe("vectorScaling: recovery of a known map", () => {
  it.each(["vs-recovery-1", "vs-recovery-2", "vs-recovery-3"])("finds each slope and each bias inside 4 standard errors at seed %s", (seed) => {
    const truth = { slopes: [2, 1, 0.5, 1.5], biases: [0.3, -0.2, 0, 0.4] };
    const fit = vectorScaling(4, draws(random(seed), 4, 4000, truth));
    expect(fit.converged).toBe(true);
    expect(fit.iterations).toBeLessThan(30);
    expect(fit.skipped).toBe(0);
    for (let c = 0; c < 4; c++) expect(Math.abs(fit.slopes[c]! - truth.slopes[c]!)).toBeLessThan(4 * fit.slopeSe[c]!);
    // A constant added to each bias does not change the map. The prior sets the center, so the test compares centered biases.
    const want = centered(truth.biases);
    const got = centered(fit.biases);
    for (let c = 0; c < 4; c++) expect(Math.abs(got[c]! - want[c]!)).toBeLessThan(4 * fit.biasSe[c]!);
  });

  it("finds the identity map for calibrated forecasts", () => {
    const identity = { slopes: [1, 1, 1], biases: [0, 0, 0] };
    const fit = vectorScaling(3, draws(random("vs-identity"), 3, 4000, identity));
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(fit.slopes[c]! - 1)).toBeLessThan(4 * fit.slopeSe[c]!);
      expect(Math.abs(fit.biases[c]!)).toBeLessThan(4 * fit.biasSe[c]!);
    }
  });

  it("finds one temperature for all classes with the form scalar", () => {
    const truth = { slopes: [0.5, 0.5, 0.5], biases: [0.2, 0, -0.2] };
    const fit = vectorScaling(3, draws(random("vs-scalar"), 3, 4000, truth), { form: "scalar" });
    expect(new Set(fit.slopes).size).toBe(1);
    expect(new Set(fit.slopeSe).size).toBe(1);
    expect(Math.abs(fit.slopes[0]! - 0.5)).toBeLessThan(4 * fit.slopeSe[0]!);
    const got = centered(fit.biases);
    for (let c = 0; c < 3; c++) expect(Math.abs(got[c]! - truth.biases[c]!)).toBeLessThan(4 * fit.biasSe[c]!);
  });

  it("gives a log-likelihood at the fit of the diagonal form that is not less than the scalar form and the identity", () => {
    const forecasts = draws(random("vs-order"), 3, 2000, { slopes: [2, 1, 0.5], biases: [0, 0, 0] });
    const identity = forecasts.reduce((s, f) => s + Math.log(f.probabilities[f.label]!), 0);
    const scalar = vectorScaling(3, forecasts, { form: "scalar" });
    const diagonal = vectorScaling(3, forecasts);
    expect(scalar.logLikelihood).toBeGreaterThan(identity);
    expect(diagonal.logLikelihood).toBeGreaterThanOrEqual(scalar.logLikelihood - 1e-6);
  });
});

describe("vectorScaling: edges", () => {
  it("gives the prior means for no forecasts", () => {
    expect(vectorScaling(3, [])).toMatchObject({ slopes: [1, 1, 1], biases: [0, 0, 0], logLikelihood: 0, converged: true, skipped: 0 });
  });

  it("does not use a forecast that gives the probability 0 to its true class, and counts it", () => {
    const forecasts: ClassForecast[] = [
      { probabilities: [0.7, 0.3, 0], label: 0 },
      { probabilities: [0.2, 0.8, 0], label: 1 },
      { probabilities: [0.5, 0.5, 0], label: 2 },
    ];
    const fit = vectorScaling(3, forecasts);
    expect(fit.skipped).toBe(1);
    expect(Number.isFinite(fit.logLikelihood)).toBe(true);
    // No forecast gives class 2 a probability over 0, so its parameters keep the prior means.
    expect(fit.slopes[2]).toBeCloseTo(1, 12);
    expect(fit.biases[2]).toBeCloseTo(0, 12);
  });

  it("keeps each parameter finite when a class is never the true class", () => {
    const forecasts = Array.from({ length: 50 }, (_, i): ClassForecast => ({ probabilities: [0.6, 0.3, 0.1], label: i % 2 }));
    const fit = vectorScaling(3, forecasts, { priorSd: 1 });
    expect(fit.converged).toBe(true);
    for (const v of [...fit.slopes, ...fit.biases]) expect(Number.isFinite(v)).toBe(true);
    expect(fit.biases[2]).toBeLessThan(fit.biases[0]!);
  });

  it("throws a RangeError for each bad input", () => {
    const ok: ClassForecast = { probabilities: [0.5, 0.5], label: 0 };
    expect(() => vectorScaling(0, [])).toThrow(RangeError);
    expect(() => vectorScaling(2, [{ probabilities: [1], label: 0 }])).toThrow(/1 probabilities, not 2/);
    expect(() => vectorScaling(2, [{ ...ok, label: 2 }])).toThrow(/label/);
    expect(() => vectorScaling(2, [{ ...ok, label: 0.5 }])).toThrow(/label/);
    expect(() => vectorScaling(2, [{ probabilities: [1.2, -0.2], label: 0 }])).toThrow(/from 0 to 1/);
    expect(() => vectorScaling(2, [{ probabilities: [0.5, 0.4], label: 0 }])).toThrow(/sum/);
    expect(() => vectorScaling(2, [ok], { form: "full" as "scalar" })).toThrow(/form/);
    expect(() => vectorScaling(2, [ok], { priorSd: 0 })).toThrow(/prior SD/);
    expect(() => vectorScaling(2, [ok], { tolerance: -1 })).toThrow(/tolerance/);
    expect(() => vectorScaling(2, [ok], { maxIterations: 0 })).toThrow(/maxIterations/);
  });
});

describe("scaledProbabilities", () => {
  it("gives the same probabilities for the identity map", () => {
    const p = [0.1, 0.6, 0.3];
    const out = scaledProbabilities(p, { slopes: [1, 1, 1], biases: [0, 0, 0] });
    for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(p[c]!, 14);
  });

  it("gives the weights over their sum", () => {
    const out = scaledProbabilities([0.2, 0.8], { slopes: [2, 1], biases: [Math.log(3), 0] });
    const w = [0.04 * 3, 0.8];
    expect(out[0]).toBeCloseTo(w[0]! / (w[0]! + w[1]!), 14);
  });

  it("keeps a probability of 0 at 0, sums to 1, and does not change for a constant added to each bias", () => {
    const vector = fc.integer({ min: 2, max: 6 }).chain((n) =>
      fc.tuple(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: n, maxLength: n }),
        fc.array(fc.double({ min: 0.1, max: 4, noNaN: true }), { minLength: n, maxLength: n }),
        fc.array(fc.double({ min: -3, max: 3, noNaN: true }), { minLength: n, maxLength: n }),
        fc.double({ min: -5, max: 5, noNaN: true }),
      ),
    );
    fc.assert(
      fc.property(vector, ([raw, slopes, biases, shift]) => {
        fc.pre(raw.some((v) => v > 1e-12));
        const sum = raw.reduce((s, v) => s + v, 0);
        const p = raw.map((v) => v / sum);
        const out = scaledProbabilities(p, { slopes, biases });
        expect(out.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
        for (let c = 0; c < p.length; c++) if (p[c] === 0) expect(out[c]).toBe(0);
        const moved = scaledProbabilities(p, { slopes, biases: biases.map((b) => b + shift) });
        for (let c = 0; c < p.length; c++) expect(moved[c]).toBeCloseTo(out[c]!, 12);
      }),
      { numRuns: 200 },
    );
  });

  it("throws a RangeError for each bad input", () => {
    const map = { slopes: [1, 1], biases: [0, 0] };
    expect(() => scaledProbabilities([1], map)).toThrow(/2 slopes and 2 biases for 1/);
    expect(() => scaledProbabilities([0, 0], map)).toThrow(/no probability is over 0/);
    expect(() => scaledProbabilities([2, 0], map)).toThrow(/from 0 to 1/);
    expect(() => scaledProbabilities([0.5, 0.5], { slopes: [1, Number.NaN], biases: [0, 0] })).toThrow(/finite/);
  });
});
