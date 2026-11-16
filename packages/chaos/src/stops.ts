import { sweepPoints } from "./faults.ts";

/**
 * A stop plan tells a test harness where to stop a process of a test. The harness stops the process with a signal at a
 * step of the program or at a time after the start. Then the test examines the state that the stopped process left, for
 * example a database file after a stop in a transaction.
 *
 * The plan is data, and this module has no I/O. The harness that applies a plan is the entry `/stop` of
 * `@mark1russell7/rigor-testkit`. A seed fixes the points of a plan before the run, thus a record keeps the plan, and a
 * later run applies the same stops.
 */

/** This value is the format of a stop plan. */
export const STOP_PLAN_FORMAT = "rigor-stops/1";

/** The signals of a stop. `SIGKILL` ends the process at once. A program can catch `SIGTERM` and close first. */
export const STOP_SIGNALS = ["SIGKILL", "SIGTERM"] as const;

/** A signal of a stop. */
export type StopSignal = (typeof STOP_SIGNALS)[number];

/**
 * The point of a stop. A step counts the calls of the stop point in the program from 0. A time counts the ms from the
 * start of the process.
 */
export type StopTrigger = { readonly step: number } | { readonly ms: number };

/** One stop: the process gets the signal at the point. */
export interface Stop {
  readonly at: StopTrigger;
  readonly signal: StopSignal;
}

/** A stop plan is data, thus a record can keep the stops that a harness applied. Each stop is one run of the process. */
export interface StopPlan {
  readonly format: typeof STOP_PLAN_FORMAT;
  /** The seed of a plan from a spec, or `null` for a plan that a person wrote. */
  readonly seed: number | string | null;
  /** The stops, one for each run. In a plan from a spec, the stops are in the order of their points, then of their signals. */
  readonly stops: readonly Stop[];
}

/** A spec tells `stopPlan` the measure of the points, the number of the drawn points and the signals. */
export interface StopSpec {
  /**
   * Each point is a whole number from 0 to less than this limit, in the measure of the limit. For steps, the limit is the
   * number of the stop points of a complete run, for example from `countStops` of `@mark1russell7/rigor-testkit`.
   */
  readonly within: StopTrigger;
  /** The number of the seeded points between the edges. */
  readonly draws: number;
  /** The signals of each point. The default is `["SIGKILL"]`. */
  readonly signals?: readonly StopSignal[];
}

const isWhole = (value: unknown, least: number): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= least;
const isTime = (value: unknown, least: number): boolean => typeof value === "number" && Number.isFinite(value) && value >= least;

/** This function gives the measure and the value of a point of a stop, or `undefined` when the point is not valid. */
export function stopTriggerOf(at: StopTrigger): { readonly measure: "step" | "ms"; readonly value: number } | undefined {
  if (typeof at !== "object" || at === null) return undefined;
  const keys = Object.keys(at);
  if (keys.length !== 1) return undefined;
  const measure = keys[0];
  const value = (at as Record<string, unknown>)[measure as string];
  if (measure === "step" && isWhole(value, 0)) return { measure, value: value as number };
  if (measure === "ms" && isTime(value, 0)) return { measure, value: value as number };
  return undefined;
}

/**
 * The parts below are for each plan of a process: the stop plan of this module and the disk plan of the module `disk`.
 * The index of the package does not export them.
 */

/** This function gives the problem of the point of a fault of a process, or `undefined` for a valid point. */
export function pointProblem(at: StopTrigger): string | undefined {
  if (stopTriggerOf(at) !== undefined) return undefined;
  return `The point has one key: step with a whole number of 0 or more, or ms with a number of 0 or more, not ${JSON.stringify(at)}.`;
}

/** This function gives the problem of the seed of a plan of a process, or `undefined` for a valid seed. */
export function seedProblem(seed: unknown): string | undefined {
  if (seed === null || typeof seed === "string" || (typeof seed === "number" && Number.isFinite(seed))) return undefined;
  return `The seed is a finite number, a string or null, not ${typeof seed === "number" ? String(seed) : (JSON.stringify(seed) ?? String(seed))}.`;
}

/** This function gives each problem of the limit and the draws of the spec of a plan of a process. */
export function pointSpecProblems(within: StopTrigger, draws: number): string[] {
  const out: string[] = [];
  const limit = stopTriggerOf(within);
  if (limit === undefined || !Number.isSafeInteger(limit.value) || limit.value < 1) {
    out.push(`The limit of the points has one key of step or ms, with a whole value of 1 or more, not ${JSON.stringify(within)}.`);
  }
  if (!isWhole(draws, 0)) out.push(`The draws are a whole number of 0 or more, not ${String(draws)}.`);
  return out;
}

/**
 * This function gives each problem of a list of choices of a spec, for example the signals of a stop spec. The list has
 * one or more items of `all`, and each item occurs one time.
 */
export function choiceProblems(choices: unknown, all: readonly string[], names: { readonly one: string; readonly many: string }): string[] {
  if (!Array.isArray(choices) || choices.length === 0 || choices.some((choice) => !all.includes(choice as string))) {
    return [`The ${names.many} are a list of one or more of ${all.join(", ")}, not ${JSON.stringify(choices)}.`];
  }
  if (new Set(choices).size !== choices.length) return [`Each ${names.one} occurs one time in the list, not ${JSON.stringify(choices)}.`];
  return [];
}

/**
 * This function gives the points of a plan of a process from a valid limit. The points are those of `sweepPoints`. When
 * the limit has fewer points than `draws + 3`, the plan has each point from 0 to the limit less 1.
 */
export function planPoints(within: StopTrigger, draws: number, seed: number | string): StopTrigger[] {
  const limit = stopTriggerOf(within) as { readonly measure: "step" | "ms"; readonly value: number };
  const points = limit.value < draws + 3 ? Array.from({ length: limit.value }, (_, point) => point) : sweepPoints(limit.value, draws, seed);
  return points.map((point) => (limit.measure === "step" ? { step: point } : { ms: point }));
}

/** This function gives each problem of a stop. An empty list means that the stop is valid. */
export function checkStop(stop: Stop): readonly string[] {
  if (typeof stop !== "object" || stop === null) return ["A stop is an object."];
  const out: string[] = [];
  const point = pointProblem(stop.at);
  if (point !== undefined) out.push(point);
  if (!(STOP_SIGNALS as readonly unknown[]).includes(stop.signal)) out.push(`The signal is one of ${STOP_SIGNALS.join(", ")}, not ${String(stop.signal)}.`);
  return out;
}

/** This function gives each problem of a plan. An empty list means that the plan is valid. */
export function checkStopPlan(plan: StopPlan): readonly string[] {
  if (typeof plan !== "object" || plan === null) return ["A stop plan is an object."];
  const out: string[] = [];
  if (plan.format !== STOP_PLAN_FORMAT) out.push(`The format is ${STOP_PLAN_FORMAT}, not ${String(plan.format)}.`);
  const seed = seedProblem(plan.seed);
  if (seed !== undefined) out.push(seed);
  if (!Array.isArray(plan.stops)) return [...out, "The stops are a list."];
  plan.stops.forEach((stop, index) => {
    for (const problem of checkStop(stop)) out.push(`The stop ${index}: ${problem}`);
  });
  return out;
}

/** This function gives each problem of a spec. An empty list means that the spec is valid. */
export function checkStopSpec(spec: StopSpec): readonly string[] {
  return [...pointSpecProblems(spec.within, spec.draws), ...choiceProblems(spec.signals ?? ["SIGKILL"], STOP_SIGNALS, { one: "signal", many: "signals" })];
}

/**
 * This function makes a plan from stops that a person wrote. The stops keep their order. This function throws a
 * `RangeError` for a stop with problems.
 */
export function stopPlanOf(stops: readonly Stop[]): StopPlan {
  const plan: StopPlan = { format: STOP_PLAN_FORMAT, seed: null, stops: [...stops] };
  const problems = checkStopPlan(plan);
  if (problems.length > 0) throw new RangeError(`stopPlanOf: ${problems.join(" ")}`);
  return plan;
}

/**
 * This function draws a stop plan from a spec and a seed. The points are those of `sweepPoints`: the edges 0, 1 and the
 * limit less 1, and `draws` distinct seeded points between them. When the limit has fewer points than `draws + 3`, the
 * plan has each point from 0 to the limit less 1. Each point has one stop for each signal of the spec. This function
 * throws a `RangeError` for a spec with problems.
 */
export function stopPlan(spec: StopSpec, seed: number | string): StopPlan {
  const problems = checkStopSpec(spec);
  if (problems.length > 0) throw new RangeError(`stopPlan: ${problems.join(" ")}`);
  const signals = spec.signals ?? (["SIGKILL"] as const);
  const stops = planPoints(spec.within, spec.draws, seed).flatMap((at) => signals.map((signal): Stop => ({ at, signal })));
  return { format: STOP_PLAN_FORMAT, seed, stops };
}
