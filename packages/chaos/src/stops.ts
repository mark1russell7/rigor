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

/** This function gives each problem of a stop. An empty list means that the stop is valid. */
export function checkStop(stop: Stop): readonly string[] {
  if (typeof stop !== "object" || stop === null) return ["A stop is an object."];
  const out: string[] = [];
  if (stopTriggerOf(stop.at) === undefined) {
    out.push(`The point has one key: step with a whole number of 0 or more, or ms with a number of 0 or more, not ${JSON.stringify(stop.at)}.`);
  }
  if (!(STOP_SIGNALS as readonly unknown[]).includes(stop.signal)) out.push(`The signal is one of ${STOP_SIGNALS.join(", ")}, not ${String(stop.signal)}.`);
  return out;
}

/** This function gives each problem of a plan. An empty list means that the plan is valid. */
export function checkStopPlan(plan: StopPlan): readonly string[] {
  const out: string[] = [];
  if (plan.format !== STOP_PLAN_FORMAT) out.push(`The format is ${STOP_PLAN_FORMAT}, not ${String(plan.format)}.`);
  const seed: unknown = plan.seed;
  if (!(seed === null || typeof seed === "string" || (typeof seed === "number" && Number.isFinite(seed)))) {
    out.push(`The seed is a finite number, a string or null, not ${typeof seed === "number" ? String(seed) : (JSON.stringify(seed) ?? String(seed))}.`);
  }
  if (!Array.isArray(plan.stops)) return [...out, "The stops are a list."];
  plan.stops.forEach((stop, index) => {
    for (const problem of checkStop(stop)) out.push(`The stop ${index}: ${problem}`);
  });
  return out;
}

/** This function gives each problem of a spec. An empty list means that the spec is valid. */
export function checkStopSpec(spec: StopSpec): readonly string[] {
  const out: string[] = [];
  const within = stopTriggerOf(spec.within);
  if (within === undefined || !Number.isSafeInteger(within.value) || within.value < 1) {
    out.push(`The limit of the points has one key of step or ms, with a whole value of 1 or more, not ${JSON.stringify(spec.within)}.`);
  }
  if (!isWhole(spec.draws, 0)) out.push(`The draws are a whole number of 0 or more, not ${String(spec.draws)}.`);
  const signals: unknown = spec.signals ?? ["SIGKILL"];
  if (!Array.isArray(signals) || signals.length === 0 || signals.some((signal) => !(STOP_SIGNALS as readonly unknown[]).includes(signal))) {
    out.push(`The signals are a list of one or more of ${STOP_SIGNALS.join(", ")}, not ${JSON.stringify(spec.signals)}.`);
  } else if (new Set(signals).size !== signals.length) out.push(`Each signal occurs one time in the list, not ${JSON.stringify(spec.signals)}.`);
  return out;
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
  const within = stopTriggerOf(spec.within) as { readonly measure: "step" | "ms"; readonly value: number };
  const signals = spec.signals ?? (["SIGKILL"] as const);
  const points = within.value < spec.draws + 3 ? Array.from({ length: within.value }, (_, point) => point) : sweepPoints(within.value, spec.draws, seed);
  const stops: Stop[] = [];
  for (const point of points) {
    for (const signal of signals) stops.push({ at: within.measure === "step" ? { step: point } : { ms: point }, signal });
  }
  return { format: STOP_PLAN_FORMAT, seed, stops };
}
