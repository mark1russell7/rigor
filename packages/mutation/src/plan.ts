/**
 * The cost plan of a selection. Stryker makes a plan of the mutants after the run of the tests without mutants. The
 * reporter `rigor-partial` writes the plan of each file and each line into `plan.json`. `plan-check` reads the file,
 * gives the estimate of the clock of the selection, and fails a selection over its target or a file over its limit of
 * static runs. The cut of the parts can then follow the cost of the lines, and not the size of the files.
 */

/** The name of the file of the plan, in the folder of the JSON report. */
export const PLAN_FILE = "plan.json";

/**
 * The default planned net time of one minute of the clock. In a nightly run of Vex (GitHub Actions, 2 test processes),
 * the mutants that ended had 9.8 to 11.7 times the planned time of their clock. The lower value gives the longer estimate.
 */
export const PLAN_PER_CLOCK = 9.8;

/** The default target of the estimate of a selection, in minutes. A slow runner then ends a job of 150 minutes. */
export const TARGET_MINUTES = 100;

/** The count of the tests of the largest cost that the plan keeps. */
export const TOP_TESTS = 40;

/** The parts of a plan of Stryker for one mutant that the reporter reads. */
export interface PlanOfMutant {
  readonly plan: string;
  readonly mutant: {
    readonly id: string;
    readonly fileName: string;
    readonly static?: boolean;
    /** The start of the mutant. In a plan, Stryker counts the lines from 0. */
    readonly location?: { readonly start: { readonly line: number } };
  };
  readonly netTime?: number;
  /** The tests that Stryker starts for the mutant. With no filter, Stryker starts all tests, as for a static mutant. */
  readonly runOptions?: { readonly timeout?: number; readonly testFilter?: readonly string[] };
}

/** The parts of a test of the run without mutants that the reporter reads. */
export interface TestOfDryRun {
  readonly id: string;
  readonly name: string;
  readonly fileName?: string;
  readonly timeSpentMs: number;
}

/** The planned times of one mutant that Stryker starts. */
export interface PlannedRun {
  readonly file: string;
  /** The line of the start of the mutant, counted from 1. The value 0 is a mutant with no location. */
  readonly line: number;
  readonly static: boolean;
  readonly netMs: number;
  readonly limitMs: number;
}

/** The plan of one line: the line from 1, the runs that start on it, the static runs of them, and their planned net time. */
export type LinePlan = readonly [line: number, runs: number, staticRuns: number, netMs: number];

/** The plan of one file of a selection. */
export interface FilePlan {
  /** The mutants of the file, with the mutants that have an early result. */
  readonly mutants: number;
  readonly runs: number;
  readonly static: number;
  readonly netMs: number;
  readonly limitMs: number;
  /** The plan of each line with a run, in the order of the lines. */
  readonly lines: readonly LinePlan[];
}

/** The plan of one test: its name, its file, its time without mutants, the runs that start it, and their product. */
export type TestPlan = readonly [name: string, file: string, ms: number, runs: number, costMs: number];

/** The content of `plan.json`. The paths of the files are from the folder where Stryker starts. */
export interface SelectionPlan {
  readonly files: Readonly<Record<string, FilePlan>>;
  readonly tests: readonly TestPlan[];
}

/** This function gives the planned times of each mutant that Stryker starts, by the id of the mutant. */
export function plannedRuns(plans: readonly PlanOfMutant[], path: (fileName: string) => string = (f) => f): Map<string, PlannedRun> {
  const runs = new Map<string, PlannedRun>();
  for (const { plan, mutant, netTime, runOptions } of plans) {
    if (plan !== "Run") continue;
    const line = mutant.location === undefined ? 0 : mutant.location.start.line + 1;
    runs.set(mutant.id, { file: path(mutant.fileName), line, static: mutant.static === true, netMs: Math.round(netTime ?? 0), limitMs: Math.round(runOptions?.timeout ?? 0) });
  }
  return runs;
}

/** This function gives the plan of each file: its mutants, the mutants that Stryker starts, and their planned times. */
export function filePlans(plans: readonly PlanOfMutant[], path: (fileName: string) => string = (f) => f): Record<string, FilePlan> {
  const runs = plannedRuns(plans, path);
  type Row = { mutants: number; runs: number; static: number; netMs: number; limitMs: number; byLine: Map<number, [number, number, number, number]> };
  const files = new Map<string, Row>();
  for (const { mutant } of plans) {
    const file = path(mutant.fileName);
    const row = files.get(file) ?? { mutants: 0, runs: 0, static: 0, netMs: 0, limitMs: 0, byLine: new Map() };
    files.set(file, row);
    row.mutants += 1;
    const run = runs.get(mutant.id);
    if (run === undefined) continue;
    row.runs += 1;
    row.static += run.static ? 1 : 0;
    row.netMs += run.netMs;
    row.limitMs += run.limitMs;
    const line = row.byLine.get(run.line) ?? [run.line, 0, 0, 0];
    line[1] += 1;
    line[2] += run.static ? 1 : 0;
    line[3] += run.netMs;
    row.byLine.set(run.line, line);
  }
  const plan = ({ byLine, ...row }: Row): FilePlan => ({ ...row, lines: [...byLine.values()].toSorted((a, b) => a[0] - b[0]) });
  return Object.fromEntries([...files].toSorted(([a], [b]) => a.localeCompare(b)).map(([file, row]) => [file, plan(row)]));
}

/**
 * This function gives the tests of the largest planned cost, the largest first. The cost of a test is its time without
 * mutants, times the runs that start it. A test with a large cost is the first place to make the selection faster.
 */
export function testPlans(plans: readonly PlanOfMutant[], tests: readonly TestOfDryRun[], path: (fileName: string) => string = (f) => f, top: number = TOP_TESTS): TestPlan[] {
  const runs = new Map<string, number>(tests.map((test) => [test.id, 0]));
  let all = 0;
  for (const { plan, runOptions } of plans) {
    if (plan !== "Run") continue;
    if (runOptions?.testFilter === undefined) all += 1;
    else for (const id of runOptions.testFilter) runs.set(id, (runs.get(id) ?? 0) + 1);
  }
  const rows = tests.map((test): TestPlan => {
    const count = (runs.get(test.id) ?? 0) + all;
    return [test.name, test.fileName === undefined ? "" : path(test.fileName), Math.round(test.timeSpentMs), count, Math.round(count * test.timeSpentMs)];
  });
  return rows.toSorted((a, b) => b[4] - a[4] || a[0].localeCompare(b[0])).slice(0, top);
}

/** This function gives the estimate of the minutes of the clock of a planned net time. */
export function clockMinutes(netMs: number, planPerClock: number = PLAN_PER_CLOCK): number {
  return netMs / planPerClock / 60_000;
}

/** The read of the plan of a selection. */
export interface PlanRead {
  readonly runs: number;
  readonly static: number;
  readonly netMs: number;
  /** The estimate of the clock of the selection, in minutes. */
  readonly minutes: number;
  /** One line for the selection, and one for each file over its limit of static runs. */
  readonly faults: readonly string[];
  /** The line of the plan of the selection, with its estimate. */
  readonly line: string;
}

/** The limits of the read of a plan. */
export interface PlanLimits {
  readonly planPerClock?: number;
  readonly targetMinutes?: number;
  /** The most static runs of each file. The key `*` gives the limit of each file that the field does not name. */
  readonly staticLimits?: Readonly<Record<string, number>>;
}

/**
 * This function gives the faults of the static runs of a plan. A static run starts each test, so it costs the time of
 * all tests. Code outside a function gives a static mutant.
 */
export function staticFaults(files: Readonly<Record<string, FilePlan>>, limits: Readonly<Record<string, number>> = {}): string[] {
  return Object.entries(files).flatMap(([file, plan]) => {
    const limit = limits[file] ?? limits["*"];
    if (limit === undefined || plan.static <= limit) return [];
    return [`${file}: the plan has ${String(plan.static)} static runs, and the limit is ${String(limit)}. Each static run starts each test. Move the code outside a function into a function.`];
  });
}

/** This function reads the plan of a selection: its estimate of the clock, against the target, and its static runs. */
export function readPlan(name: string, plan: SelectionPlan, limits: PlanLimits = {}): PlanRead {
  const rows = Object.values(plan.files);
  const sum = (key: "runs" | "static" | "netMs"): number => rows.reduce((n, row) => n + row[key], 0);
  const minutes = clockMinutes(sum("netMs"), limits.planPerClock);
  const target = limits.targetMinutes ?? TARGET_MINUTES;
  const head = `${name}: ${String(sum("runs"))} runs, ${String(sum("static"))} of them static, with a planned net time of ${(sum("netMs") / 3_600_000).toFixed(1)} h.`;
  const line = `${head} The estimate is ${minutes.toFixed(0)} minutes of the clock, and the target is ${String(target)}.`;
  const over = minutes > target ? [`${name}: the estimate of ${minutes.toFixed(0)} minutes is over the target of ${String(target)}. Cut the selection into more parts.`] : [];
  return { runs: sum("runs"), static: sum("static"), netMs: sum("netMs"), minutes, faults: [...over, ...staticFaults(plan.files, limits.staticLimits)], line };
}

/**
 * This function reads the JSON of `plan.json`.
 *
 * @throws Error when the JSON has no object `files` or no list `tests`
 */
export function parsePlan(json: unknown): SelectionPlan {
  const plan = json as Partial<SelectionPlan> | null;
  if (typeof plan !== "object" || plan === null || typeof plan.files !== "object" || plan.files === null || !Array.isArray(plan.tests)) {
    throw new Error(`the plan has no object "files" or no list "tests"`);
  }
  return plan as SelectionPlan;
}
