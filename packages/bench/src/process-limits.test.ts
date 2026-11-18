import { Z95, binomialTest, wilson } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import type { JobReads } from "./noise-cap.ts";
import { processLimits } from "./process-limits.ts";
import { type ProcessRead, processVerdict } from "./process-verdict.ts";

/** This function gives a read with the ratio `ratio` and the band `aa`. */
const read = (process: string, ratio: number, aa: readonly [number, number] = [0.99, 1.01]): ProcessRead => ({ process, case: "c0", ratio, aa });

/** This function gives a job of 11 reads with the ratios `base + 0.001 * j` for j from 0 to 10. Its median is `base + 0.005`. */
const job = (label: string, base: number): JobReads => ({ job: label, reads: Array.from({ length: 11 }, (_, j) => read(`p${j + 1}`, base + 0.001 * j)) });

/** Five jobs with the medians 1.005, 1.015, 1.025, 1.035 and 1.045. */
const FIVE = [0, 1, 2, 3, 4].map((i) => job(`j${i}`, 1 + 0.01 * i));

describe("processLimits", () => {
  it("gives the worst job median plus the spread of the medians as the limit and the slow line", () => {
    const fit = processLimits(FIVE, { k: 11 });
    if (fit.source !== "jobs") throw new Error("expected limits");
    expect(fit.median.values.map((m) => Number(m.toFixed(12)))).toEqual([1.005, 1.015, 1.025, 1.035, 1.045]);
    expect(fit.median.worst).toBeCloseTo(1.045, 12);
    expect(fit.median.spread).toBeCloseTo(0.04, 12);
    expect(fit.limits.limit).toBe(1.085);
    expect(fit.limits.slow).toBe(1.085);
    expect(fit.jobs).toEqual(["j0", "j1", "j2", "j3", "j4"]);
  });

  it("rounds the limit up to the digits", () => {
    const fit = processLimits(FIVE, { k: 11, digits: 2 });
    expect(fit.source === "jobs" && fit.limits.limit).toBe(1.09);
  });

  it("gives the smallest count of slow processes with a chance under the risk at the upper Wilson end of the slow rate", () => {
    // The limit is 1.085. In each job, the reads 9, 10 and 11 go above it, so 15 of the 55 used reads are slow.
    const slow = FIVE.map((j) => ({ ...j, reads: j.reads.map((r, i) => (i >= 8 ? { ...r, ratio: 1.2 } : r)) }));
    const fit = processLimits(slow, { k: 11 });
    if (fit.source !== "jobs") throw new Error("expected limits");
    expect(fit.median.values.map((m) => Number(m.toFixed(12)))).toEqual([1.005, 1.015, 1.025, 1.035, 1.045]);
    expect(fit.slow).toMatchObject({ above: 15, reads: 55, rate: wilson(15, 55, Z95) });
    const tail = (count: number): number => binomialTest(count + 1, 11, fit.slow.rate.high, "greater");
    expect(fit.slow.chance).toBe(tail(fit.slow.maxSlow));
    expect(fit.slow.chance).toBeLessThan(0.01);
    expect(tail(fit.slow.maxSlow - 1)).toBeGreaterThanOrEqual(0.01);
    expect(fit.limits.maxSlow).toBe(fit.slow.maxSlow);
    // A larger risk and a smaller z each give a smaller count.
    const loose = processLimits(slow, { k: 11, risk: 0.2 });
    const narrow = processLimits(slow, { k: 11, z: 1 });
    expect(loose.source === "jobs" && loose.limits.maxSlow).toBeLessThan(fit.slow.maxSlow);
    expect(narrow.source === "jobs" && narrow.limits.maxSlow).toBeLessThanOrEqual(fit.slow.maxSlow);
  });

  it("gives limits that pass each of their jobs in processVerdict", () => {
    const slow = FIVE.map((j) => ({ ...j, reads: j.reads.map((r, i) => (i >= 9 ? { ...r, ratio: 1.2 } : r)) }));
    const fit = processLimits(slow, { k: 11 });
    if (fit.source !== "jobs") throw new Error("expected limits");
    for (const j of slow) expect(processVerdict(j.reads, { k: 11, limits: fit.limits }).cases[0]?.outcome, j.job).toBe("within");
  });

  it("uses the first k valid reads of a job, as processVerdict does", () => {
    // A read with a band without 1 is not valid, and the reads after the first k valid reads are not used.
    const first = { job: "j0", reads: [read("p0", 9, [1.02, 1.05]), ...FIVE[0]!.reads, read("p12", 9)] };
    const fit = processLimits([first, ...FIVE.slice(1)], { k: 11 });
    expect(fit.source === "jobs" && fit.median.values[0]).toBeCloseTo(1.005, 12);
    expect(fit.source === "jobs" && fit.slow.reads).toBe(55);
  });

  it("leaves out a noisy read with the noise cap, and keeps the cap in the limits", () => {
    const noisy = { job: "j0", reads: [read("p0", 0.5, [0.9, 1.1]), ...FIVE[0]!.reads] };
    const fit = processLimits([noisy, ...FIVE.slice(1)], { k: 11, noiseCap: 0.05 });
    if (fit.source !== "jobs") throw new Error("expected limits");
    expect(fit.median.values[0]).toBeCloseTo(1.005, 12);
    expect(fit.limits.noiseCap).toBe(0.05);
    // Without the cap, the noisy read is valid: the first 11 reads are 0.5 and 1.000 to 1.009, so the median is 1.004.
    const open = processLimits([noisy, ...FIVE.slice(1)], { k: 11 });
    expect(open.source === "jobs" && open.median.values[0]).toBeCloseTo(1.004, 12);
    expect(open.source === "jobs" && "noiseCap" in open.limits).toBe(false);
  });

  it("counts a read with no band as valid when the case has no noise cap", () => {
    const bare = FIVE.map((j) => ({ ...j, reads: j.reads.map((r): ProcessRead => ({ process: r.process, case: r.case, ratio: r.ratio })) }));
    expect(processLimits(bare, { k: 11 })).toEqual(processLimits(FIVE, { k: 11 }));
    expect(() => processLimits(bare, { k: 11, noiseCap: 0.05 })).toThrow(/has no valid read/u);
  });

  it("gives no limits for fewer jobs than the minimum, and names the jobs", () => {
    expect(processLimits(FIVE.slice(0, 4), { k: 11 })).toEqual({ source: "too few", jobs: ["j0", "j1", "j2", "j3"] });
    expect(processLimits(FIVE.slice(0, 4), { k: 11, minimum: 4 }).source).toBe("jobs");
  });

  it("refuses a bad option, two jobs with one label, a bad ratio and a job with no valid read", () => {
    expect(() => processLimits(FIVE, { k: 0 })).toThrow(/k is a whole number/u);
    expect(() => processLimits(FIVE, { k: 11, minimum: 0 })).toThrow(/minimum/u);
    expect(() => processLimits(FIVE, { k: 11, z: 0 })).toThrow(/z is a finite number/u);
    expect(() => processLimits(FIVE, { k: 11, risk: 1 })).toThrow(/risk/u);
    expect(() => processLimits(FIVE, { k: 11, noiseCap: Number.NaN })).toThrow(/noise cap/u);
    expect(() => processLimits([...FIVE, job("j0", 1)], { k: 11 })).toThrow(/two jobs have the label "j0"/u);
    expect(() => processLimits([...FIVE, { job: "bad", reads: [read("p1", 1, [1.1, 1.2])] }], { k: 11 })).toThrow(/the job "bad" has no valid read/u);
    // A ratio that is not valid stops the derivation, also in a read that the median does not use.
    expect(() => processLimits([...FIVE, { job: "nan", reads: [read("p1", 1), read("p2", Number.NaN, [1.1, 1.2])] }], { k: 11 })).toThrow(/the ratio of "p2" in the job "nan" is not a finite number above 0/u);
    expect(() => processLimits([...FIVE, { job: "zero", reads: [read("p1", 0)] }], { k: 11 })).toThrow(/above 0, but 0/u);
  });
});
