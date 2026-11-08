import { describe, expect, it } from "vitest";
import { clockMinutes, dryRunOf, filePlans, parsePlan, PLAN_PER_CLOCK, readPlan, speedFactors, staticFaults, STOP_MINUTES, TARGET_MINUTES, testPlans, type FilePlan, type PlanOfMutant, type RunnerPlan, type TestPlan } from "./plan.ts";

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
  it("gives the estimate of the clock at 9.8 planned minutes for each minute, and fails it over the stop of 140", () => {
    expect(PLAN_PER_CLOCK).toBe(9.8);
    expect(TARGET_MINUTES).toBe(100);
    expect(STOP_MINUTES).toBe(140);
    expect(clockMinutes(9.8 * 60_000)).toBeCloseTo(1);
    expect(clockMinutes(120_000, 2)).toBe(1);
    const read = readPlan("lib.core", { files: { "a.ts": file(5_880_000 * 50, 3) }, tests: [] });
    expect(read.minutes).toBeCloseTo(500);
    expect(read).toMatchObject({
      runs: 1,
      static: 3,
      faults: ["lib.core: the estimate of 500 minutes is over the stop of 140. The run cannot end before the stop, so it cannot give a full score. Cut the selection into more parts."],
      warnings: [],
    });
    expect(read.line).toBe("lib.core: 1 runs, 3 of them static, with a planned net time of 81.7 h. The estimate is 500 minutes of the clock, the target is 100 and the stop is 140.");
  });

  // The review of vex: the estimate has an error of 28 minutes in the mean, so the target warns and only the stop fails.
  it("passes a plan in its target, warns of a plan over its target, and reads the limits and the rate of the lane", () => {
    const plan = { files: { "a.ts": file(588_000), "b.ts": file(588_000) }, tests: [] };
    expect(readPlan("lib", plan).minutes).toBeCloseTo(2);
    expect(readPlan("lib", plan)).toMatchObject({ faults: [], warnings: [] });
    expect(readPlan("lib", plan, { targetMinutes: 1 })).toMatchObject({ faults: [], warnings: ["lib: the estimate of 2 minutes is over the target of 1. Cut the selection into more parts."] });
    expect(readPlan("lib", plan, { targetMinutes: 1, stopMinutes: 1.5 })).toMatchObject({ faults: [expect.stringMatching(/^lib: the estimate of 2 minutes is over the stop of 1\.5\./)], warnings: [] });
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

describe("speedFactors", () => {
  /** This function gives the plan of a selection with its tests and, if it is given, its dry run. */
  const runner = (name: string, group: string, tests: readonly TestPlan[], dryRun?: { tests: number; netMs: number }): RunnerPlan => ({
    name,
    group,
    plan: dryRun === undefined ? { files: {}, tests } : { files: {}, tests, dryRun },
  });
  const test = (name: string, ms: number): TestPlan => [name, "src/a.test.ts", ms, 1, ms];

  it("gives the net time of the dry run over the median of its group, when the counts of the tests agree", () => {
    // The parts of the group compiler.module of Vex: 149 s, 107 s and 83 s for the same 1191 tests.
    const factors = speedFactors([
      runner("m.1", "m", [], { tests: 1191, netMs: 149_000 }),
      runner("m.2", "m", [], { tests: 1191, netMs: 107_000 }),
      runner("m.3", "m", [], { tests: 1191, netMs: 83_000 }),
    ]);
    expect(factors.get("m.1")).toBeCloseTo(1.3925, 4);
    expect(factors.get("m.2")).toBe(1);
    expect(factors.get("m.3")).toBeCloseTo(0.7757, 4);
  });

  it("uses the shared tests when the counts of the dry runs differ or a plan has no dry run", () => {
    const tests = (k: number): TestPlan[] => [test("a", 400 * k), test("b", 1000 * k), test("short", 100 * k * k)];
    const differ = speedFactors([runner("g.1", "g", tests(2), { tests: 9, netMs: 1 }), runner("g.2", "g", tests(1), { tests: 8, netMs: 1 })]);
    expect([differ.get("g.1"), differ.get("g.2")]).toEqual([4 / 3, 2 / 3]);
    const old = speedFactors([runner("g.1", "g", tests(2)), runner("g.2", "g", tests(1), { tests: 3, netMs: 600 })]);
    expect([old.get("g.1"), old.get("g.2")]).toEqual([4 / 3, 2 / 3]);
  });

  it("counts a test only from 200 ms, and only when half of the group and 2 parts name it", () => {
    const factors = speedFactors([
      runner("g.1", "g", [test("a", 600), test("only", 5000), test("short", 199)]),
      runner("g.2", "g", [test("a", 300), test("short", 1)]),
      runner("g.3", "g", [test("a", 300)]),
      runner("g.4", "g", [test("b", 900)]),
    ]);
    expect([...factors]).toEqual([["g.1", 2], ["g.2", 1], ["g.3", 1], ["g.4", 1]]);
  });

  it("gives 1 to a selection alone in its group, and to a group with no shared test", () => {
    const factors = speedFactors([
      runner("lib", "lib", [test("a", 900)], { tests: 1, netMs: 900 }),
      runner("g.1", "g", [test("a", 900)]),
      runner("g.2", "g", [test("b", 900)]),
    ]);
    expect([...factors]).toEqual([["lib", 1], ["g.1", 1], ["g.2", 1]]);
  });

  it("gives the same factors when each time of the group is scaled by one constant", () => {
    const plans = (k: number): RunnerPlan[] => [
      runner("g.1", "g", [test("a", 700 * k), test("b", 1300 * k)]),
      runner("g.2", "g", [test("a", 500 * k), test("b", 900 * k)]),
      runner("g.3", "g", [test("a", 600 * k), test("b", 1700 * k)]),
      runner("h.1", "h", [], { tests: 5, netMs: 3000 * k }),
      runner("h.2", "h", [], { tests: 5, netMs: 4100 * k }),
    ];
    const base = speedFactors(plans(1));
    for (const k of [0.5, 3, 17]) {
      for (const [name, factor] of speedFactors(plans(k))) expect(factor).toBeCloseTo(base.get(name) ?? Number.NaN, 12);
    }
  });

  it("gives the dry run of the tests: their count and the rounded sum of their times", () => {
    expect(dryRunOf([{ id: "1", name: "a", timeSpentMs: 1.4 }, { id: "2", name: "b", timeSpentMs: 2.4 }])).toEqual({ tests: 2, netMs: 4 });
    expect(dryRunOf([])).toEqual({ tests: 0, netMs: 0 });
  });
});

describe("parsePlan", () => {
  it("reads a plan, and refuses a plan with no files or no tests", () => {
    const plan = { files: {}, tests: [] };
    expect(parsePlan(plan)).toBe(plan);
    for (const bad of [null, [], { files: {} }, { tests: [] }, { files: null, tests: [] }]) expect(() => parsePlan(bad)).toThrow(/no object "files" or no list "tests"/);
  });
});
