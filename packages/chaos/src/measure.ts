import { quantile } from "@mark1russell7/rigor-statistics";
import type { Schedule } from "./schedule.ts";

/**
 * A closed-loop driver waits for a reply before its next request, thus a stall hides the requests
 * of its interval. This is coordinated omission. This module counts each latency from
 * the planned time, thus a stall counts in each arrival that it delayed.
 *
 * An arrival with no reply at the end of a run does not leave the measure. Its age at the end is a
 * lower bound of its latency, and a quantile reads it.
 */

/** A completion is what a driver saw of one arrival. Its times are in ms from the start of the schedule. */
export interface Completion {
  /** This number is the position of the arrival in the schedule. */
  readonly index: number;
  readonly sent: number;
  /** This time is null for an arrival with no reply. */
  readonly done: number | null;
}

/**
 * A second sample is what a driver process read of itself over one second of a run. It tells if a late
 * send came from a full processor or from a held event loop. Each reading is optional.
 */
export interface SecondSample {
  /** This time is the start of the second, in ms from the start of the schedule. */
  readonly at: number;
  /** This share is the processor time of the process over the time of the sample. One full core reads 1. */
  readonly cpu?: number;
  /** This time is the p99 of the delay of the event loop in this second, in ms. */
  readonly loopP99?: number;
  /** This time is the largest delay of the event loop in this second, in ms. */
  readonly loopMax?: number;
}

/** This is the measure of one run of a schedule. Each list is in the order of the schedule. */
export interface LoadMeasure {
  readonly planned: number;
  /** This count is the number of arrivals that the driver did not send. */
  readonly unsent: number;
  /** This count is the number of arrivals that had no reply at the end of the run. */
  readonly unfinished: number;
  /** These times are the reply less the planned time: what a user waited. */
  readonly latency: readonly number[];
  /** These times are the reply less the send: the measure of a closed-loop driver. */
  readonly service: readonly number[];
  /** These times are the send less the planned time, for each arrival that the driver sent. */
  readonly lag: readonly number[];
  /** These times are the age at the end of each arrival with no reply. Each one is a lower bound of a latency. */
  readonly censored: readonly number[];
  /** These samples are the seconds that the driver read, in order of time. A run with no list of samples has no such field. */
  readonly seconds?: readonly SecondSample[];
}

/** This function throws a `RangeError` for a sample that a measure of this run cannot hold. */
function checkSeconds(seconds: readonly SecondSample[], end: number): void {
  let last = Number.NEGATIVE_INFINITY;
  for (const { at, cpu, loopP99, loopMax } of seconds) {
    if (!(at >= 0 && at <= end && at > last)) throw new RangeError(`measureLoad: the sample at ${at} is not in order, in a run that stops at ${end}.`);
    last = at;
    for (const value of [cpu, loopP99, loopMax])
      if (value !== undefined && !(value >= 0 && Number.isFinite(value))) throw new RangeError(`measureLoad: the sample at ${at} has the reading ${value}.`);
    if (loopP99 !== undefined && loopMax !== undefined && loopMax < loopP99)
      throw new RangeError(`measureLoad: the sample at ${at} has a largest delay of ${loopMax} under its p99 of ${loopP99}.`);
  }
}

/**
 * This function gives the measure of a run. `end` is the end of the run, in ms from the start of the
 * schedule. It throws a `RangeError` for an index outside the schedule and for two completions of
 * one index. It throws the same error for a reply before its send and for a time past `end`.
 *
 * `seconds` is optional, and the measure holds it as given. A sample must be in order and inside the
 * run, and each reading must be finite and not negative. Otherwise the function throws the same error.
 */
export function measureLoad(plan: Schedule, completions: readonly Completion[], end: number, seconds?: readonly SecondSample[]): LoadMeasure {
  if (seconds !== undefined) checkSeconds(seconds, end);
  const byIndex = new Map<number, Completion>();
  for (const completion of completions) {
    if (!Number.isInteger(completion.index) || completion.index < 0 || completion.index >= plan.times.length)
      throw new RangeError(`measureLoad: the index ${completion.index} is not in the schedule of ${plan.times.length} arrivals.`);
    if (byIndex.has(completion.index)) throw new RangeError(`measureLoad: the index ${completion.index} has two completions.`);
    const last = completion.done ?? completion.sent;
    if (!(completion.sent <= last && last <= end))
      throw new RangeError(`measureLoad: the index ${completion.index} has a send at ${completion.sent} and a reply at ${completion.done}, in a run that stops at ${end}.`);
    byIndex.set(completion.index, completion);
  }
  const latency: number[] = [];
  const service: number[] = [];
  const lag: number[] = [];
  const censored: number[] = [];
  let unfinished = 0;
  plan.times.forEach((planned, index) => {
    const completion = byIndex.get(index);
    if (completion !== undefined) lag.push(completion.sent - planned);
    if (completion === undefined || completion.done === null) {
      if (completion !== undefined) unfinished += 1;
      censored.push(Math.max(0, end - planned));
      return;
    }
    latency.push(completion.done - planned);
    service.push(completion.done - completion.sent);
  });
  return { planned: plan.times.length, unsent: plan.times.length - byIndex.size, unfinished, latency, service, lag, censored, ...(seconds === undefined ? {} : { seconds }) };
}

/**
 * This function gives a quantile of the latency, with each arrival with no reply at its lower bound.
 * With a censored value, the result is a lower bound of the true quantile. It uses the nearest rank,
 * thus the result is a measured value. It throws a `RangeError` for a run with no arrivals.
 */
export function latencyQuantile(measure: LoadMeasure, p: number): number {
  return quantile([...measure.latency, ...measure.censored], p, "nearest-rank");
}

/** This is the check of a driver: the schedule held, or the reason that it did not. */
export interface ScheduleCheck {
  readonly held: boolean;
  /** This time is the largest size of a lag, or null with no send. */
  readonly worst: number | null;
  /** This count is the number of sends past the limit. */
  readonly late: number;
  readonly reason: string;
}

/**
 * This function tells if a driver kept the schedule: it sent each arrival, each within `limit` ms of
 * its planned time. A run that fails this check measures its driver, not the target, thus an A/A run
 * with no fault reads it first.
 */
export function scheduleHeld(measure: LoadMeasure, limit: number): ScheduleCheck {
  const worst = measure.lag.reduce<number | null>((most, lag) => Math.max(most ?? 0, Math.abs(lag)), null);
  const late = measure.lag.filter((lag) => Math.abs(lag) > limit).length;
  const held = measure.unsent === 0 && late === 0;
  const facts = `${measure.planned} planned, ${measure.unsent} not sent, ${late} past ${limit} ms, the worst ${worst ?? "none"} ms`;
  return { held, worst, late, reason: `The driver ${held ? "kept" : "did not keep"} the schedule (${facts}).` };
}
