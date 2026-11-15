import { describe, expect, it } from "vitest";
import { cpuEntry } from "./model.ts";
import { type ProcessLimits, type ProcessRead, isValidRead, processCaseLine, processVerdict } from "./process-verdict.ts";

const TREE: ProcessLimits = { limit: 1.1, slow: 1.2, maxSlow: 2 };

/** This function gives one read of the case "tree" for each ratio, in the processes p0, p1 and so on. */
function reads(...ratios: readonly number[]): ProcessRead[] {
  return ratios.map((ratio, i) => ({ process: `p${i}`, case: "tree", ratio, aa: [0.98, 1.02] }));
}

describe("processVerdict", () => {
  // The cases of the decision of the Vex speed gate (packages/core/bench/processes.test.ts), with the same results.
  it("passes on the median, with slow processes up to the largest count", () => {
    const v = processVerdict(reads(1, 1.3, 1.02, 1.35, 0.98), { k: 5, limits: TREE });
    expect(v.cases[0]).toMatchObject({ outcome: "within", median: 1.02, slowCount: 2, more: 0 });
    expect(v.outcome).toBe("pass");
  });

  it("is beyond when the median is above the limit", () => {
    const [c] = processVerdict(reads(1.12, 1.15, 1.11, 1, 1), { k: 5, limits: TREE }).cases;
    expect(c?.outcome).toBe("beyond");
    expect(c?.reason).toBe("The median 1.11 is above the limit 1.1.");
  });

  it("is beyond when more processes than maxSlow are above the slow line", () => {
    const v = processVerdict(reads(1, 1.3, 1.25, 1.21, 1, 1, 1), { k: 7, limits: TREE });
    expect(v.cases[0]).toMatchObject({ outcome: "beyond", median: 1, slowCount: 3 });
    expect(v.cases[0]?.reason).toBe("3 valid processes are above the slow line 1.2, and the limit is 2.");
    expect(v).toMatchObject({ outcome: "block", blocks: ["tree"] });
  });

  it("counts a ratio on the slow line as not slow", () => {
    expect(processVerdict(reads(1.2, 1.2, 1.2, 1), { k: 4, limits: TREE }).cases[0]?.slowCount).toBe(0);
  });

  it("uses only the first k valid processes, and leaves out the invalid ones", () => {
    const list: ProcessRead[] = [{ process: "bad", case: "tree", ratio: 5, aa: [1.01, 1.3] }, ...reads(1, 1.05, 1.3)];
    const [c] = processVerdict(list, { k: 2, limits: TREE }).cases;
    expect(c).toMatchObject({ outcome: "within", ratios: [1, 1.05], used: ["p0", "p1"], invalid: ["bad"] });
  });

  it("cannot decide with fewer than k valid processes, and tells the count that the case still needs", () => {
    const list: ProcessRead[] = [...reads(1), { process: "bad", case: "tree", ratio: 1, aa: [1.01, 1.3] }];
    const v = processVerdict(list, { k: 3, limits: TREE });
    expect(v.cases[0]).toMatchObject({ outcome: "cannot decide", more: 2 });
    expect(v.cases[0]?.reason).toBe("The case has 1 valid processes of 3, and 1 processes have an A/A band without 1. It needs 2 more.");
    expect(v).toMatchObject({ outcome: "no read", noRead: ["tree"], more: 2 });
  });

  it("blocks a case with a fault, and cannot decide a case that a process did not read", () => {
    const fault = processVerdict([...reads(1), { process: "p1", case: "tree", ratio: 1, fault: "tier 1" }], { k: 1, limits: TREE });
    expect(fault.cases[0]).toMatchObject({ outcome: "beyond", faults: ["p1: tier 1"] });
    const missing = processVerdict(reads(1), { k: 1, limits: TREE, processes: ["p0", "stopped"] });
    expect(missing.cases[0]).toMatchObject({ outcome: "cannot decide", missing: ["stopped"], more: 0 });
  });

  it("never fails on the slow count when it is a record only", () => {
    const record: ProcessLimits = { limit: 1.5, slow: 1.2 };
    const [c] = processVerdict(reads(1.3, 1.4, 1.3), { k: 3, limits: record }).cases;
    expect(c).toMatchObject({ outcome: "within", slowCount: 3, maxSlow: undefined });
    expect(c === undefined ? "" : processCaseLine(c)).toContain("3 above the slow line 1.2 (a record only)");
  });

  it("gives no read for no reads", () => {
    expect(processVerdict([], { k: 2, limits: TREE })).toMatchObject({ outcome: "no read", cases: [], more: 0 });
  });

  it("is beyond before k valid processes when the reads already fail a check", () => {
    // 3 of k = 5 above the limit: the median of each set of 5 is above the limit.
    const median = processVerdict(reads(1.2, 1.15, 1.12), { k: 5, limits: { limit: 1.1 } });
    expect(median.cases[0]).toMatchObject({ outcome: "beyond", more: 0 });
    // 3 above the slow line with maxSlow 2.
    const slow = processVerdict(reads(1.25, 1, 1.3, 1.21), { k: 9, limits: TREE });
    expect(slow.cases[0]).toMatchObject({ outcome: "beyond", slowCount: 3, more: 0 });
    // 2 of k = 4 above the limit: the other processes can still put the median at the limit or below it.
    expect(processVerdict(reads(1.2, 1.2), { k: 4, limits: { limit: 1.1, slow: 2 } }).cases[0]).toMatchObject({ outcome: "cannot decide", more: 2 });
  });

  it("reads the worst median of k jobs with slow at the limit and maxSlow 0", () => {
    const jobs = (worst: number): ProcessRead[] => [1.01, 1.03, 0.99, 1.02, worst].map((ratio, i) => ({ process: `job ${i}`, case: "route", ratio, aa: [0.97, 1.03] }));
    const limits = { limit: 1.05, maxSlow: 0 };
    expect(processVerdict(jobs(1.04), { k: 5, limits }).outcome).toBe("pass");
    expect(processVerdict(jobs(1.06), { k: 5, limits }).cases[0]).toMatchObject({ outcome: "beyond", median: 1.02, slowCount: 1 });
  });

  it("takes the limits of each case from a function, and keeps the order of the cases", () => {
    const list: ProcessRead[] = [
      { process: "a", case: "small", ratio: 1.3 },
      { process: "a", case: "large", ratio: 1.3 },
      { process: "b", case: "small", ratio: 1.3 },
      { process: "b", case: "large", ratio: 1.3 },
    ];
    const v = processVerdict(list, { k: 2, limits: (name) => ({ limit: name === "large" ? 1.4 : 1.2 }) });
    expect(v.cases.map((c) => [c.case, c.outcome])).toEqual([["small", "beyond"], ["large", "within"]]);
  });

  it("refuses a bad option and a bad read", () => {
    const one = reads(1);
    expect(() => processVerdict(one, { k: 0, limits: TREE })).toThrow(/k is a whole number/);
    expect(() => processVerdict(one, { k: 1.5, limits: TREE })).toThrow(/k is a whole number/);
    expect(() => processVerdict(one, { k: 1, limits: { limit: 0 } })).toThrow(/limit of the case/);
    expect(() => processVerdict(one, { k: 1, limits: { limit: 1, slow: Number.NaN } })).toThrow(/slow line/);
    expect(() => processVerdict(one, { k: 1, limits: { limit: 1, maxSlow: -1 } })).toThrow(/maxSlow/);
    expect(() => processVerdict(reads(0), { k: 1, limits: TREE })).toThrow(/ratio/);
    expect(() => processVerdict(reads(Number.POSITIVE_INFINITY), { k: 1, limits: TREE })).toThrow(/ratio/);
    expect(() => processVerdict([{ process: "p", case: "c", ratio: 1, aa: [1.1, 0.9] }], { k: 1, limits: TREE })).toThrow(/A\/A band/);
    expect(() => processVerdict([...one, ...one], { k: 1, limits: TREE })).toThrow(/two reads/);
    expect(() => processVerdict(one, { k: 1, limits: TREE, processes: ["other"] })).toThrow(/does not name/);
    expect(() => processVerdict(one, { k: 1, limits: TREE, processes: ["p0", "p0"] })).toThrow(/twice/);
  });
});

describe("isValidRead", () => {
  it("counts a read only when its A/A band contains 1, and counts a read with no band", () => {
    expect(isValidRead({ process: "p", case: "c", ratio: 1, aa: [0.9, 1] })).toBe(true);
    expect(isValidRead({ process: "p", case: "c", ratio: 1, aa: [1.01, 1.2] })).toBe(false);
    expect(isValidRead({ process: "p", case: "c", ratio: 1, aa: [0.8, 0.99] })).toBe(false);
    expect(isValidRead({ process: "p", case: "c", ratio: 1 })).toBe(true);
  });
});

describe("processCaseLine", () => {
  it("gives the outcome, the median, the slow count and the ratio of each process", () => {
    const [c] = processVerdict(reads(1, 1.3, 1.02), { k: 3, limits: TREE }).cases;
    expect(c === undefined ? "" : processCaseLine(c)).toBe(
      "within tree: median 1.02 of 3 valid processes (limit 1.1), 1 above the slow line 1.2 (at most 2), ratios 1, 1.3, 1.02. The median 1.02 is at most the limit 1.1, and 1 valid processes are above the slow line, and the limit is 2.",
    );
  });
});

describe("cpuEntry", () => {
  // The cases of limitsFor of the Vex speed gate, with the same results.
  const BY = { "7763": { limit: 1.2 }, "9V74": { limit: 1.3 }, other: { limit: 1.4 } };

  it("gives the entry of the model that the CPU name contains, with its key", () => {
    expect(cpuEntry(BY, "AMD EPYC 7763 64-Core Processor")).toEqual({ model: "7763", value: { limit: 1.2 } });
    expect(cpuEntry(BY, "AMD EPYC 9V74 80-Core Processor")).toEqual({ model: "9V74", value: { limit: 1.3 } });
  });

  it("gives the entry other for another model, and never reads other as a part of a name", () => {
    expect(cpuEntry(BY, "AMD EPYC 9V45 96-Core Processor")).toEqual({ model: "other", value: { limit: 1.4 } });
    expect(cpuEntry(BY, "another CPU")).toMatchObject({ model: "other" });
  });

  it("ignores the case of the letters, and keeps the spelling of the key", () => {
    const byName = { Xeon: 2.08, other: 1.74 };
    const names = ["INTEL(R) XEON(R) PLATINUM 8573C", "Intel(R) Xeon(R) Platinum 8573C CPU @ 2.30GHz", "intel(r) xeon(r)"];
    expect(names.map((n) => cpuEntry(byName, n))).toEqual(names.map(() => ({ model: "Xeon", value: 2.08 })));
    expect(cpuEntry(byName, "AMD EPYC 9V45 96-CORE PROCESSOR")).toEqual({ model: "other", value: 1.74 });
  });
});
