import { binomialTest } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { type JobReads, processNoiseCap } from "./noise-cap.ts";
import type { ProcessRead } from "./process-verdict.ts";

/** This function gives a read with the noise `n`: the band is `[1, exp(n)]`, or `[exp(n / 2), exp(n)]` for a biased read. */
const read = (process: string, n: number, biased = false): ProcessRead => ({ process, case: "c0", ratio: 1, aa: [biased ? Math.exp(n / 2) : 1, Math.exp(n)] });

/** This function gives a job of 11 reads with the noises `base + 0.01 * j` for j from 0 to 10, times `scale`. */
const job = (label: string, base: number, scale = 1): JobReads => ({ job: label, reads: Array.from({ length: 11 }, (_, j) => read(`p${j + 1}`, (base + 0.01 * j) * scale)) });

/** Five quiet jobs: their 55 noises are all different, from 0.010 to 0.114. */
const QUIET = [0, 1, 2, 3, 4].map((i) => job(`j${i}`, 0.01 + 0.001 * i));
const FAST = { runs: 200 };

describe("processNoiseCap", () => {
  it("gives the 0.95 quantile of the quiet reads, rounded up, and the decide rate of each job at the cap", () => {
    const cap = processNoiseCap(QUIET, { k: 11, bootstrap: FAST });
    if (cap.source !== "jobs") throw new Error("expected a cap");
    // Of 55 sorted noises, the 0.95 quantile is between the 52nd (0.111) and the 53rd (0.112): 0.1113.
    expect(cap.quantile.estimate).toBeCloseTo(0.1113, 12);
    expect(cap.cap).toBeGreaterThanOrEqual(cap.quantile.estimate);
    expect(cap.cap).toBeLessThanOrEqual(0.1114);
    expect(cap.quantile.low).toBeLessThanOrEqual(cap.quantile.estimate);
    expect(cap.quantile.high).toBeGreaterThanOrEqual(cap.quantile.estimate);
    // The noises 0.112, 0.113 and 0.114 are above the cap: one read in each of the jobs j2, j3 and j4.
    expect(cap.decides.map((d) => d.valid)).toEqual([11, 11, 10, 10, 10]);
    expect(cap.decides[2]!.decide).toBe(binomialTest(11, 22, 10 / 11, "greater"));
    expect(cap.decideRate).toBeCloseTo((2 + 3 * binomialTest(11, 22, 10 / 11, "greater")) / 5, 12);
    expect(cap.decides[0]).toMatchObject({ job: "j0", median: expect.closeTo(0.06, 12), reads: 11 });
    expect(cap.dropped).toEqual([]);
  });

  it("drops a loud job by the robust z-score of its median read noise, and names it", () => {
    const cap = processNoiseCap([...QUIET, job("loud", 0.01, 10)], { k: 11, bootstrap: FAST });
    expect(cap.jobs).toEqual(["j0", "j1", "j2", "j3", "j4"]);
    expect(cap.dropped).toEqual([{ job: "loud", spread: expect.closeTo(0.6, 12), score: expect.any(Number) }]);
    expect(cap.dropped[0]!.score).toBeGreaterThan(3.5);
    // The quiet jobs are the jobs of QUIET, so the cap and its interval are the same.
    const { jobs: _jobs, dropped: _dropped, ...rest } = processNoiseCap(QUIET, { k: 11, bootstrap: FAST });
    expect(cap).toMatchObject(rest);
    expect(processNoiseCap([...QUIET, job("loud", 0.01, 10)], { k: 11, cut: Infinity, bootstrap: FAST }).dropped).toEqual([]);
  });

  it("gives no cap with fewer quiet jobs than the minimum", () => {
    expect(processNoiseCap(QUIET.slice(0, 4), { k: 11 })).toEqual({ source: "too few", jobs: ["j0", "j1", "j2", "j3"], dropped: [] });
    expect(processNoiseCap(QUIET.slice(0, 4), { k: 11, minimum: 4, bootstrap: FAST }).source).toBe("jobs");
    expect(processNoiseCap([], { k: 11 })).toEqual({ source: "too few", jobs: [], dropped: [] });
  });

  it("counts a biased read in the quantile, but not as a valid read", () => {
    const biased: JobReads = { job: "j0", reads: QUIET[0]!.reads.map((r, i) => (i === 0 ? read(r.process, 0.01, true) : r)) };
    const cap = processNoiseCap([biased, ...QUIET.slice(1)], { k: 11, bootstrap: FAST });
    if (cap.source !== "jobs") throw new Error("expected a cap");
    expect(cap.quantile.estimate).toBeCloseTo(0.1113, 12);
    expect(cap.decides[0]!.valid).toBe(10);
  });

  it("reads the decide chance over the option processes", () => {
    const cap = processNoiseCap(QUIET, { k: 11, processes: 11, bootstrap: FAST });
    if (cap.source !== "jobs") throw new Error("expected a cap");
    // With 11 processes, a decision needs each read valid: (10 / 11) ** 11 for a job with 10 of 11 valid reads.
    expect(cap.decides[4]!.decide).toBeCloseTo((10 / 11) ** 11, 12);
    expect(cap.decides[0]!.decide).toBe(1);
  });

  it("gives the same interval for the same seed", () => {
    const a = processNoiseCap(QUIET, { k: 11, bootstrap: { runs: 300, seed: 7 } });
    const b = processNoiseCap(QUIET, { k: 11, bootstrap: { runs: 300, seed: 7 } });
    expect(a).toEqual(b);
  });

  it("refuses a bad option, two jobs with one label, a job with no reads and a read with no band", () => {
    expect(() => processNoiseCap(QUIET, { k: 0 })).toThrow(/k is a whole number/u);
    expect(() => processNoiseCap(QUIET, { k: 11, processes: 10 })).toThrow(/processes are a whole number/u);
    expect(() => processNoiseCap(QUIET, { k: 11, level: 1 })).toThrow(/level is a number between 0 and 1/u);
    expect(() => processNoiseCap(QUIET, { k: 11, minimum: 0 })).toThrow(/minimum is a whole number/u);
    expect(() => processNoiseCap(QUIET, { k: 11, cut: 0 })).toThrow(/cut is a number above 0/u);
    expect(() => processNoiseCap(QUIET, { k: 11, digits: 13 })).toThrow(/digits are a whole number/u);
    expect(() => processNoiseCap([QUIET[0]!, QUIET[0]!], { k: 11 })).toThrow(/two jobs have the label "j0"/u);
    expect(() => processNoiseCap([{ job: "empty", reads: [] }], { k: 11 })).toThrow(/has no reads/u);
    expect(() => processNoiseCap([{ job: "bare", reads: [{ process: "p1", case: "c0", ratio: 1 }] }], { k: 11 })).toThrow(/no A\/A band/u);
  });
});
