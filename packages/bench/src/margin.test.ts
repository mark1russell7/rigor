import { describe, expect, it } from "vitest";
import { type PairedTime, timeVerdict, verdictMargin, verdictPower } from "./index.ts";

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

  it("takes the margin of the verdict with a pool: the larger of margin and the pooled noise", () => {
    // The floor 0.1 gives the pooled noise 0.1, above the margin 0.05. The ratio 0.93 is between exp(-0.1) and exp(-0.05).
    const pool = { records: [], floor: 0.1 };
    const pooled = verdictPower({ ...base, ratio: 0.93, verdict: { ...verdict, pool } });
    expect(pooled.outcomes.same).toBeGreaterThan(pooled.outcomes.faster);
    expect(pooled.power).toBe(pooled.outcomes.same);
    const plain = verdictPower({ ...base, ratio: 0.93, verdict });
    expect(plain.power).toBe(plain.outcomes.faster);
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

describe("the bias check of the noise cap", () => {
  // 12 A/A cases have the ratio 1.2 and 8 have the ratio 1, so the A/A median ratio is 1.2, out of [exp(-0.1), exp(0.1)].
  const biasedAa = [...ofRatios(steps(1.2, 1.2, 12), "ab"), ...ofRatios(steps(1, 1, 8), "ae")];
  const candidate = ofRatios(steps(0.55, 0.65, 21), "c");
  const bootstrap = { runs: 2000, seed: 7 };

  it("gives cannot decide for an A/A median ratio out of the cap, and the reason names the bias", () => {
    const free = timeVerdict(candidate, biasedAa, { bootstrap });
    expect(free.outcome).toBe("faster");
    // A spread level of 0.3 gives the spread 0, so only the bias check decides.
    const v = timeVerdict(candidate, biasedAa, { bootstrap, noiseCap: 0.1, spreadLevel: 0.3 });
    expect(v.noise).toMatchObject({ noisy: false, biased: true });
    expect(v.noise!.aaMedian).toBeCloseTo(1.2, 10);
    expect(v.outcome).toBe("cannot decide");
    expect(v.reason).toMatch(/A\/A median ratio of the run is 1\.2/);
    expect(v.reason).toMatch(/Without the cap, the outcome is "faster"/);
  });

  it("finds a biased run also noisy at the default spread level", () => {
    const v = timeVerdict(candidate, biasedAa, { bootstrap, noiseCap: 0.1 });
    expect(v.noise).toMatchObject({ noisy: true, biased: true });
    expect(v.outcome).toBe("cannot decide");
  });

  it("keeps the outcome for an A/A median ratio in the cap", () => {
    const v = timeVerdict(candidate, aa, { bootstrap, noiseCap: 0.1 });
    expect(v.noise).toMatchObject({ noisy: false, biased: false, aaMedian: 1 });
    expect(v.outcome).toBe("faster");
  });
});

describe("verdictMargin", () => {
  it("gives the margin of the options, and 0.05 by default", () => {
    expect(verdictMargin()).toBe(0.05);
    expect(verdictMargin({ margin: 0.02 })).toBe(0.02);
    expect(() => verdictMargin({ margin: -1 })).toThrow(RangeError);
  });

  it("gives the larger of the margin and the noise of the pooled band", () => {
    const quiet = ofRatios(steps(1, 1, 10), "q");
    const loud = ofRatios(steps(0.8, 1.25, 10), "l");
    expect(verdictMargin({ margin: 0.05, pool: { records: quiet } })).toBe(0.05);
    expect(verdictMargin({ margin: 0.05, pool: { records: loud } })).toBeGreaterThan(0.05);
    expect(verdictMargin({ margin: 0.05, pool: { records: quiet, floor: 0.1 } })).toBe(0.1);
  });

  it("is the margin that the verdict uses: an interval in the zone is same", () => {
    const loud = ofRatios(steps(0.8, 1.25, 10), "l");
    const m = verdictMargin({ margin: 0.05, pool: { records: loud } });
    const v = timeVerdict(ofRatios(steps(Math.exp(-m / 2), Math.exp(-m / 4), 21), "c"), aa, { ...options, pool: { records: loud } });
    expect(v.interval!.low).toBeGreaterThanOrEqual(Math.exp(-m));
    expect(v.outcome).toBe("same");
  });
});
