import { describe, expect, it } from "vitest";
import { type PairedTime, timeVerdict, verdictPower } from "./index.ts";

/** The records of one round for each ratio: case `k` has the ratio `ratios[k]`. */
const ofRatios = (ratios: readonly number[], prefix: string): PairedTime[] => ratios.map((r, k) => ({ case: `${prefix}${k}`, round: 0, first: "a", a: 10, b: 10 * r }));

/** The `count` ratios at equal steps from `low` to `high`, both included. */
const steps = (low: number, high: number, count: number): number[] => Array.from({ length: count }, (_, k) => low + ((high - low) * k) / (count - 1));

// The A/A arm has the ratio 1 in each case, so the interval of the rule `difference` is the bootstrap interval of the candidate median.
const aa = ofRatios(steps(1, 1, 10), "aa");
const options = { margin: 0.05, bootstrap: { runs: 2000, seed: 7 } };
const low = Math.exp(-options.margin);
const high = Math.exp(options.margin);

describe("the margin comes before faster and slower", () => {
  it("gives same for an interval in the margin and below 1", () => {
    const v = timeVerdict(ofRatios(steps(0.965, 0.975, 21), "c"), aa, options);
    expect(v.interval!.high).toBeLessThan(1);
    expect(v.interval!.low).toBeGreaterThanOrEqual(low);
    expect(v.outcome).toBe("same");
    expect(v.reason).toMatch(/in the margin of 0\.05/);
  });

  it("gives same for an interval in the margin and above 1", () => {
    const v = timeVerdict(ofRatios(steps(1.025, 1.035, 21), "c"), aa, options);
    expect(v.interval!.low).toBeGreaterThan(1);
    expect(v.interval!.high).toBeLessThanOrEqual(high);
    expect(v.outcome).toBe("same");
  });

  it("gives faster for an interval below the margin", () => {
    const v = timeVerdict(ofRatios(steps(0.9, 0.92, 21), "c"), aa, options);
    expect(v.interval!.high).toBeLessThan(low);
    expect(v.outcome).toBe("faster");
  });

  it("gives faster for an interval below 1 that crosses the low end of the margin", () => {
    const v = timeVerdict(ofRatios(steps(0.9, 0.98, 21), "c"), aa, options);
    expect(v.interval!.low).toBeLessThan(low);
    expect(v.interval!.high).toBeGreaterThan(low);
    expect(v.interval!.high).toBeLessThan(1);
    expect(v.outcome).toBe("faster");
  });

  it("gives cannot decide for an interval that holds 1 and crosses an end of the margin", () => {
    const v = timeVerdict(ofRatios(steps(0.8, 1.22, 21), "c"), aa, options);
    expect(v.interval!.low).toBeLessThan(1);
    expect(v.interval!.high).toBeGreaterThan(1);
    expect(v.interval!.low < low || v.interval!.high > high).toBe(true);
    expect(v.outcome).toBe("cannot decide");
    expect(v.reason).toMatch(/holds 1 and crosses the margin/);
  });

  it("keeps the outcome without a margin: the margin 0 gives faster below 1", () => {
    const candidate = ofRatios(steps(0.965, 0.975, 21), "c");
    const v = timeVerdict(candidate, aa, { ...options, margin: 0 });
    expect(v.outcome).toBe("faster");
    expect(v.reason).toMatch(/below 1\.$/);
    expect(timeVerdict(ofRatios(steps(1.025, 1.035, 21), "c"), aa, { ...options, margin: 0 }).outcome).toBe("slower");
  });

  it("keeps the outcome of the rule band, which has no margin", () => {
    const candidate = ofRatios(steps(0.965, 0.975, 21), "c");
    const band = timeVerdict(candidate, aa, { rule: "band", kind: "case", bootstrap: options.bootstrap });
    // The A/A cases have the ratio 1, so the band is [1, 1]. The interval is below the band.
    expect(band.outcome).toBe("faster");
  });
});

describe("the true outcome of verdictPower", () => {
  const verdict = { bootstrap: { runs: 300, seed: 1 } };
  // A small noise gives narrow intervals, so the shares of `same` and `faster` differ at the ratio 0.97.
  const base = { cases: 10, trials: 10, seed: 3, sigma: 0.02 };

  it("takes same as the true outcome of a ratio in the margin", () => {
    const p = verdictPower({ ...base, ratio: 0.97, verdict });
    expect(p.outcomes.same).toBeGreaterThan(p.outcomes.faster);
    expect(p.power).toBe(p.outcomes.same);
    const above = verdictPower({ ...base, ratio: 1.03, verdict });
    expect(above.outcomes.same).toBeGreaterThan(above.outcomes.slower);
    expect(above.power).toBe(above.outcomes.same);
  });

  it("keeps faster and slower as the true outcome of a ratio out of the margin", () => {
    const fast = verdictPower({ ...base, ratio: 0.93, verdict });
    expect(fast.outcomes.faster).toBeGreaterThan(0);
    expect(fast.power).toBe(fast.outcomes.faster);
    const slow = verdictPower({ ...base, ratio: 1.08, verdict });
    expect(slow.outcomes.slower).toBeGreaterThan(0);
    expect(slow.power).toBe(slow.outcomes.slower);
  });

  it("keeps faster below 1 with the margin 0 and with the rule band", () => {
    const zero = verdictPower({ ...base, ratio: 0.97, verdict: { ...verdict, margin: 0 } });
    expect(zero.outcomes.faster).toBeGreaterThan(zero.outcomes.same);
    expect(zero.power).toBe(zero.outcomes.faster);
    const band = verdictPower({ ...base, ratio: 0.97, verdict: { ...verdict, rule: "band" } });
    expect(band.outcomes.faster).toBeGreaterThan(band.outcomes.same);
    expect(band.power).toBe(band.outcomes.faster);
  });
});
