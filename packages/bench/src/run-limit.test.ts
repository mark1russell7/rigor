import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PairedTime } from "./paired.ts";
import { type JobAaStats, aaLimitOf, aaLimits, aaStats, runLimit } from "./run-limit.ts";

/** The A/A statistics of coeval K214: 16 cases in 6 CI jobs, the families and the limits of its file. */
const COEVAL = JSON.parse(readFileSync(new URL("./run-limit.fixture.json", import.meta.url), "utf8")) as {
  families: Record<string, string[]>;
  jobs: JobAaStats[];
  limits: Record<string, { margin: number; noiseCap: number }>;
  fallback: { margin: number; noiseCap: number };
};
const familyOf = (name: string): string | undefined => Object.entries(COEVAL.families).find(([, list]) => list.includes(name))?.[0];
const MARGIN_FLOOR = Math.log(1.015);

describe("runLimit", () => {
  it("gives the worst value plus the spread, rounded up: the limits of the packing gates k130 and k66", () => {
    expect(runLimit([1.313239, 1.376462, 1.370875, 1.381275, 1.30803])).toMatchObject({ limit: 1.4546, worst: 1.381275 });
    expect(runLimit([1.790471, 1.819161, 1.827744, 1.753129, 1.753593]).limit).toBe(1.9024);
    expect(runLimit([1, 1, 1, 1, 1]).limit).toBe(1);
  });

  it("gives the worst value minus the spread, rounded down, for a measure where higher is better", () => {
    expect(runLimit([100, 102, 105, 101, 103], { better: "higher", digits: 0 })).toMatchObject({ limit: 95, worst: 100, spread: 5 });
    expect(runLimit([0.51, 0.52, 0.53, 0.5, 0.52], { better: "higher", digits: 2 }).limit).toBe(0.47);
  });

  it("keeps the limit at the bound", () => {
    expect(runLimit([0.001, 0.002, 0.003, 0.004, 0.005], { bound: MARGIN_FLOOR }).limit).toBe(0.0149);
    expect(runLimit([10, 11, 12, 13, 14], { better: "higher", bound: 5 }).limit).toBe(5);
  });

  it("refuses too few values, a value that is not finite and bad options", () => {
    expect(() => runLimit([1, 2, 3, 4])).toThrow(/5 values or more, not 4/);
    expect(runLimit([1, 2], { minimum: 2 }).limit).toBe(3);
    expect(() => runLimit([1, 2, 3, 4, Number.NaN])).toThrow(/finite/);
    expect(() => runLimit([1, 2, 3, 4, 5], { minimum: 0 })).toThrow(/minimum/);
    expect(() => runLimit([1, 2, 3, 4, 5], { digits: 1.5 })).toThrow(/digits/);
    expect(() => runLimit([1, 2, 3, 4, 5], { bound: Infinity })).toThrow(/bound/);
    expect(() => runLimit([1, 2, 3, 4, 5], { spread: "half" as "range" })).toThrow(/spread/);
  });

  it("adds only the worse half of the spread with the option worse-half", () => {
    // The median is 0.02 and the worst value is 0.05, so the limit is 0.05 + 0.03.
    const cap = runLimit([0.02, 0.01, 0.05, 0.02, 0.03], { spread: "worse-half" });
    expect(cap).toMatchObject({ limit: 0.08, worst: 0.05 });
    expect(cap.spread).toBeCloseTo(0.03, 12);
    expect(runLimit([100, 102, 105, 101, 103], { better: "higher", digits: 0, spread: "worse-half" })).toMatchObject({ limit: 98, worst: 100, spread: 2 });
    expect(runLimit([1, 1, 1, 1, 1], { spread: "worse-half" }).limit).toBe(1);
  });

  it("does not widen a worse-half limit for a value on the better side of the median, as a range limit does", () => {
    const spreads = [0.02, 0.025, 0.03, 0.035, 0.04];
    const quieter = [0.001, 0.025, 0.03, 0.035, 0.04];
    expect(runLimit(quieter, { spread: "worse-half" }).limit).toBe(runLimit(spreads, { spread: "worse-half" }).limit);
    expect(runLimit(quieter).limit).toBeGreaterThan(runLimit(spreads).limit);
  });
});

describe("aaStats", () => {
  /** The A/A rounds of one case: the ratios b / a, with the order turned each round. */
  const rounds = (name: string, ratios: readonly number[]): PairedTime[] =>
    ratios.map((ratio, round) => ({ case: name, round, first: round % 2 === 0 ? "a" : "b", a: 10, b: 10 * ratio }));

  it("gives the median log ratio and the spread of each case, in the order of the first record", () => {
    const ratios = [1.01, 0.98, 1.02, 0.99, 1.05];
    const stats = aaStats([...rounds("y", ratios), ...rounds("x", [1, 1, 1])]);
    expect(stats.map((s) => s.case)).toEqual(["y", "x"]);
    expect(stats[0]!.median).toBeCloseTo(Math.log(1.01), 12);
    expect(stats[0]!.rounds).toBe(5);
    // The 0.9 quantile of abs(log ratio) over 5 rounds: 0.6 of the way from the 4th to the 5th value.
    const logs = ratios.map((r) => Math.abs(Math.log(r))).sort((p, q) => p - q);
    expect(stats[0]!.spread).toBeCloseTo(logs[3]! + 0.6 * (logs[4]! - logs[3]!), 12);
    expect(stats[1]).toMatchObject({ median: 0, spread: 0, rounds: 3 });
  });

  it("refuses records that caseRatios refuses and a bad level", () => {
    const unturned: PairedTime[] = [0, 1, 2].map((round) => ({ case: "x", round, first: "a", a: 1, b: 1 }));
    expect(() => aaStats(unturned)).toThrow(/turns each round/);
    expect(() => aaStats(rounds("x", [1, 1]), 1)).toThrow(/level/);
  });
});

describe("aaLimits", () => {
  it("gives the limits of the coeval file when each job stays", () => {
    const limits = aaLimits(COEVAL.jobs, { family: familyOf, marginFloor: MARGIN_FLOOR, cut: Infinity });
    for (const [name, expected] of Object.entries(COEVAL.limits)) {
      const own = limits.families[name]!;
      expect(own.source).toBe("family");
      expect(aaLimitOf(limits, name)).toEqual({ ...expected, source: "family" });
    }
    expect({ margin: limits.fallback.margin.limit, noiseCap: limits.fallback.noiseCap.limit }).toEqual(COEVAL.fallback);
    expect(limits.fallback.jobs).toHaveLength(6);
    expect(limits.fallback.cases).toHaveLength(16);
  });

  it("drops the job whose spread is far above the other jobs, and names it", () => {
    const limits = aaLimits(COEVAL.jobs, { family: familyOf, marginFloor: MARGIN_FLOOR });
    const plan = limits.families["plan"]!;
    expect(plan.dropped.map((d) => d.job)).toEqual(["41574523074/2"]);
    expect(plan.dropped[0]!.spread).toBeCloseTo(0.1478, 4);
    expect(plan.dropped[0]!.score).toBeGreaterThan(3.5);
    expect(plan.jobs).toHaveLength(5);
    expect(aaLimitOf(limits, "plan").noiseCap).toBe(0.0681);
    expect(limits.families["reference"]!.dropped.map((d) => d.job)).toEqual(["41574523074/1"]);
    expect(aaLimitOf(limits, "reference").noiseCap).toBe(0.0624);
    // Two jobs of the family tree have a high spread, so neither is far above the others.
    expect(limits.families["tree"]!.dropped).toEqual([]);
    expect(aaLimitOf(limits, "tree")).toEqual({ ...COEVAL.limits["tree"], source: "family" });
  });

  it("gives the fallback limits to a family with too few jobs and to a case with no family", () => {
    const jobs = COEVAL.jobs.map((job, i) => (i < 2 ? job : { ...job, cases: job.cases.filter((c) => familyOf(c.case) !== "formula") }));
    const limits = aaLimits(jobs, { family: familyOf, marginFloor: MARGIN_FLOOR, cut: Infinity });
    const formula = limits.families["formula"]!;
    expect(formula).toMatchObject({ source: "fallback", jobs: ["41574523074/1", "41574523074/2"] });
    expect(aaLimitOf(limits, "formula")).toEqual({ margin: limits.fallback.margin.limit, noiseCap: limits.fallback.noiseCap.limit, source: "fallback" });
    expect(aaLimitOf(limits, undefined).source).toBe("fallback");
    expect(aaLimitOf(limits, "nope").source).toBe("fallback");
  });

  it("refuses too few jobs and two jobs with one label", () => {
    expect(() => aaLimits(COEVAL.jobs.slice(0, 4))).toThrow(/5 jobs or more, not 4/);
    expect(() => aaLimits([...COEVAL.jobs, COEVAL.jobs[0]!])).toThrow(/two jobs have the label/);
    // A dropped job counts against the minimum, and the error names it.
    const noisy = COEVAL.jobs.slice(0, 5).map((job, i) => (i === 0 ? { ...job, cases: job.cases.map((c) => ({ ...c, spread: 5 })) } : job));
    expect(() => aaLimits(noisy)).toThrow(/not 4\. The jobs that went out: 41574523074\/1\./);
  });
});
