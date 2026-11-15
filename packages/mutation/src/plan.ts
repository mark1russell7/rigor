/**
 * The cost plan of a selection. Stryker makes a plan of the mutants after the run of the tests without mutants. The
 * reporter `rigor-partial` writes the plan of each file and each line into `plan.json`. `plan-check` reads the file and
 * gives the estimate of the clock of the selection. It warns of a selection over its target. It fails a selection over
 * its stop, and a file over its limit of static runs. The cut of the parts can then follow the cost of the lines, and
 * not the size of the files.
 */
import { median } from "@mark1russell7/rigor-statistics";

/** The name of the file of the plan, in the folder of the JSON report. */
export const PLAN_FILE = "plan.json";

/**
 * The default planned net time of one minute of the clock. In a nightly run of Vex (GitHub Actions, 2 test processes),
 * the mutants that ended had 9.8 to 11.7 times the planned time of their clock. The lower value gives the longer estimate.
 */
export const PLAN_PER_CLOCK = 9.8;

/** The default target of the estimate of a selection, in minutes. A slow runner then ends a job of 150 minutes. */
export const TARGET_MINUTES = 100;

/**
 * The default stop of the estimate of a selection, in minutes. A selection over it does not end before the limit of the
 * job, so it cannot give a full score. The estimate has an error of 28 minutes in the mean, so the target only warns.
 */
export const STOP_MINUTES = 140;

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

/** The run of the tests without mutants: the count of its tests and the sum of their times in milliseconds. */
export interface DryRun {
  readonly tests: number;
  readonly netMs: number;
}

/** The content of `plan.json`. The paths of the files are from the folder where Stryker starts. */
export interface SelectionPlan {
  readonly files: Readonly<Record<string, FilePlan>>;
  readonly tests: readonly TestPlan[];
  /** The run of the tests without mutants. A plan of a version before 0.2.6 has no `dryRun`. */
  readonly dryRun?: DryRun;
}

/** This function gives the run of the tests without mutants: the count of the tests and the sum of their times. */
export function dryRunOf(tests: readonly TestOfDryRun[]): DryRun {
  return { tests: tests.length, netMs: Math.round(tests.reduce((sum, test) => sum + test.timeSpentMs, 0)) };
}

/** A test of a plan counts for the speed of a runner only from this time in milliseconds. A short time is mostly noise. */
export const SPEED_MIN_MS = 200;

/** The plan of one selection for the speed of its runner. */
export interface RunnerPlan {
  readonly name: string;
  /** The selections of one group run the same tests. A selection that is not a part of a group is a group of its own. */
  readonly group: string;
  readonly plan: SelectionPlan;
}

/**
 * This function gives the speed of the runner of each selection, relative to the other selections of its group. Each part
 * runs on its own runner, and in Vex the same tests took from 83 s to 149 s on the runners of one group.
 *
 * - When each plan of a group has a `dryRun` with the same count of tests, the factor uses the dry runs. It is the
 *   net time of the dry run over the median of the group.
 * - Otherwise the factor is the median of the ratios of the shared tests. The ratio of a test is its time over its
 *   median time in the group. A shared test takes `SPEED_MIN_MS` or more. At least half of the plans of the group
 *   name it, and at least 2 plans.
 * - A selection with no shared test, or alone in its group, has the factor 1. A factor over 1 is a slow runner.
 */
export function speedFactors(plans: readonly RunnerPlan[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const group of new Set(plans.map((p) => p.group))) {
    const members = plans.filter((p) => p.group === group);
    const runs = members.map((p) => p.plan.dryRun);
    const counts = new Set(runs.map((r) => r?.tests));
    if (members.length > 1 && counts.size === 1 && runs.every((r) => r !== undefined && r.tests > 0 && r.netMs > 0)) {
      const middle = median(runs.map((r) => r?.netMs ?? 0));
      for (const p of members) out.set(p.name, (p.plan.dryRun?.netMs ?? middle) / middle);
      continue;
    }
    const times = members.map((p) => new Map(p.plan.tests.filter((t) => t[2] >= SPEED_MIN_MS).map((t) => [`${t[1]}|${t[0]}`, t[2]])));
    const need = Math.max(2, Math.ceil(members.length / 2));
    const shared = [...new Set(times.flatMap((m) => [...m.keys()]))].filter((key) => times.filter((m) => m.has(key)).length >= need);
    const middles = new Map(shared.map((key) => [key, median(times.flatMap((m) => m.get(key) ?? []))]));
    members.forEach((p, i) => {
      const ratios = shared.flatMap((key) => {
        const ms = times[i]?.get(key);
        return ms === undefined ? [] : [ms / (middles.get(key) ?? ms)];
      });
      out.set(p.name, ratios.length === 0 ? 1 : median(ratios));
    });
  }
  return out;
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
  /** One line for a selection over its stop, and one for each file over its limit of static runs. */
  readonly faults: readonly string[];
  /** One line for a selection over its target and under its stop. */
  readonly warnings: readonly string[];
  /** The line of the plan of the selection, with its estimate. */
  readonly line: string;
}

/** The limits of the read of a plan. */
export interface PlanLimits {
  readonly planPerClock?: number;
  readonly targetMinutes?: number;
  readonly stopMinutes?: number;
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

/** This function reads the plan of a selection: its estimate of the clock, against the target and the stop, and its static runs. */
export function readPlan(name: string, plan: SelectionPlan, limits: PlanLimits = {}): PlanRead {
  const rows = Object.values(plan.files);
  const sum = (key: "runs" | "static" | "netMs"): number => rows.reduce((n, row) => n + row[key], 0);
  const minutes = clockMinutes(sum("netMs"), limits.planPerClock);
  const target = limits.targetMinutes ?? TARGET_MINUTES;
  const stop = limits.stopMinutes ?? STOP_MINUTES;
  const estimate = `${name}: the estimate of ${minutes.toFixed(0)} minutes`;
  const head = `${name}: ${String(sum("runs"))} runs, ${String(sum("static"))} of them static, with a planned net time of ${(sum("netMs") / 3_600_000).toFixed(1)} h.`;
  const line = `${head} The estimate is ${minutes.toFixed(0)} minutes of the clock, the target is ${String(target)} and the stop is ${String(stop)}.`;
  const overStop = minutes > stop ? [`${estimate} is over the stop of ${String(stop)}. The run cannot end before the stop, so it cannot give a full score. Cut the selection into more parts.`] : [];
  const warnings = minutes > target && minutes <= stop ? [`${estimate} is over the target of ${String(target)}. Cut the selection into more parts.`] : [];
  return { runs: sum("runs"), static: sum("static"), netMs: sum("netMs"), minutes, faults: [...overStop, ...staticFaults(plan.files, limits.staticLimits)], warnings, line };
}

/**
 * This function reads the JSON of `plan.json`.
 *
 * @throws Error when the JSON has no object `files` or no list `tests`, or a `dryRun` with no numbers
 */
export function parsePlan(json: unknown): SelectionPlan {
  const plan = json as Partial<SelectionPlan> | null;
  if (typeof plan !== "object" || plan === null || typeof plan.files !== "object" || plan.files === null || !Array.isArray(plan.tests)) {
    throw new Error(`the plan has no object "files" or no list "tests"`);
  }
  const run = plan.dryRun as Partial<DryRun> | null | undefined;
  if (run !== undefined && (typeof run !== "object" || run === null || !Number.isFinite(run.tests) || !Number.isFinite(run.netMs))) {
    throw new Error(`the field "dryRun" of the plan has no numbers "tests" and "netMs"`);
  }
  return plan as SelectionPlan;
}
