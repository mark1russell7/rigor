import { describe, expect, it } from "vitest";
import { clockMinutes, filePlans, parsePlan, PLAN_PER_CLOCK, readPlan, staticFaults, TARGET_MINUTES, testPlans, type FilePlan, type PlanOfMutant } from "./plan.ts";

/** This function gives a plan of Stryker for the mutant `id`. Stryker counts the lines of a plan from 0. */
const run = (id: string, fileName: string, line: number | undefined, netTime: number, isStatic = false, testFilter?: readonly string[]): PlanOfMutant => ({
  plan: "Run",
  mutant: { id, fileName, static: isStatic, ...(line === undefined ? {} : { location: { start: { line } } }) },
  netTime,
  runOptions: { timeout: 1000, ...(testFilter === undefined ? {} : { testFilter }) },
});
const file = (netMs: number, isStatic = 0): FilePlan => ({ mutants: 1, runs: 1, static: isStatic, netMs, limitMs: 0, lines: [] });

describe("filePlans", () => {
  it("adds the runs of each line of each file, in the order of the files and the lines", () => {
    const plans = [run("1", "/p/b.ts", 4, 10), run("2", "/p/a.ts", 9, 5, true), run("3", "/p/a.ts", 0, 7), run("4", "/p/a.ts", 9, 1), run("5", "/p/a.ts", undefined, 2), { plan: "EarlyResult", mutant: { id: "6", fileName: "/p/c.ts" } }];
    expect(filePlans(plans, (f) => f.slice(3))).toEqual({
      "a.ts": { mutants: 4, runs: 4, static: 1, netMs: 15, limitMs: 4000, lines: [[0, 1, 0, 2], [1, 1, 0, 7], [10, 2, 1, 6]] },
      "b.ts": { mutants: 1, runs: 1, static: 0, netMs: 10, limitMs: 1000, lines: [[5, 1, 0, 10]] },
      "c.ts": { mutants: 1, runs: 0, static: 0, netMs: 0, limitMs: 0, lines: [] },
    });
  });
});

describe("testPlans", () => {
  it("gives the tests of the largest cost first, and a run with no filter starts each test", () => {
    const plans = [run("1", "a.ts", 0, 1, false, ["t1"]), run("2", "a.ts", 0, 1, false, ["t1", "t2"]), run("3", "a.ts", 0, 1, true)];
    const tests = [
      { id: "t1", name: "one", fileName: "a.test.ts", timeSpentMs: 5 },
      { id: "t2", name: "two", fileName: "a.test.ts", timeSpentMs: 7.4 },
      { id: "t3", name: "three", timeSpentMs: 7 },
    ];
    expect(testPlans(plans, tests)).toEqual([
      ["one", "a.test.ts", 5, 3, 15],
      ["two", "a.test.ts", 7, 2, 15],
      ["three", "", 7, 1, 7],
    ]);
    expect(testPlans(plans, tests, (f) => f, 1)).toHaveLength(1);
  });
});

describe("readPlan", () => {
  it("gives the estimate of the clock at 9.8 planned minutes for each minute, against the target of 100", () => {
    expect(PLAN_PER_CLOCK).toBe(9.8);
    expect(TARGET_MINUTES).toBe(100);
    expect(clockMinutes(9.8 * 60_000)).toBeCloseTo(1);
    expect(clockMinutes(120_000, 2)).toBe(1);
    const read = readPlan("lib.core", { files: { "a.ts": file(5_880_000 * 50, 3) }, tests: [] });
    expect(read.minutes).toBeCloseTo(500);
    expect(read).toMatchObject({ runs: 1, static: 3, faults: ["lib.core: the estimate of 500 minutes is over the target of 100. Cut the selection into more parts."] });
    expect(read.line).toBe("lib.core: 1 runs, 3 of them static, with a planned net time of 81.7 h. The estimate is 500 minutes of the clock, and the target is 100.");
  });

  it("passes a plan in its target, and reads the target and the rate of the lane", () => {
    const plan = { files: { "a.ts": file(588_000), "b.ts": file(588_000) }, tests: [] };
    expect(readPlan("lib", plan).minutes).toBeCloseTo(2);
    expect(readPlan("lib", plan).faults).toEqual([]);
    expect(readPlan("lib", plan, { targetMinutes: 1 }).faults).toHaveLength(1);
    expect(readPlan("lib", plan, { planPerClock: 0.98 }).minutes).toBeCloseTo(20);
  });

  // LANE.STATIC of Vex: a static run starts each test, so the static runs of a file must not grow.
  it("fails a file over its limit of static runs, and the key * gives the limit of the other files", () => {
    const files = { "a.ts": file(0, 5), "b.ts": file(0, 2), "c.ts": file(0, 9) };
    expect(staticFaults(files)).toEqual([]);
    expect(staticFaults(files, { "a.ts": 5, "*": 1 })).toEqual([
      "b.ts: the plan has 2 static runs, and the limit is 1. Each static run starts each test. Move the code outside a function into a function.",
      "c.ts: the plan has 9 static runs, and the limit is 1. Each static run starts each test. Move the code outside a function into a function.",
    ]);
    expect(readPlan("lib", { files, tests: [] }, { staticLimits: { "c.ts": 8 } }).faults).toEqual([expect.stringMatching(/^c\.ts: the plan has 9 static runs, and the limit is 8\./)]);
  });
});

describe("parsePlan", () => {
  it("reads a plan, and refuses a plan with no files or no tests", () => {
    const plan = { files: {}, tests: [] };
    expect(parsePlan(plan)).toBe(plan);
    for (const bad of [null, [], { files: {} }, { tests: [] }, { files: null, tests: [] }]) expect(() => parsePlan(bad)).toThrow(/no object "files" or no list "tests"/);
  });
});
