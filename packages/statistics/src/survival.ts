/**
 * The survival curves of the times to an event. This module gives the Kaplan-Meier estimate with right censoring and its
 * Greenwood standard error. It also gives the chance at a time and the quantiles of a curve.
 * Each function throws a RangeError for an empty list or for a time that is not a finite number of 0 or more.
 * It also throws a RangeError for a count that is not a whole number of 1 or more.
 */

import { Z95 } from "./tests.ts";

/** One observed time, or a group of equal observed times. */
export interface TimeToEvent {
  /** The time from the start to the event, or to the end of the observation. */
  readonly time: number;
  /** When `censored` is true, the observation stopped at `time` before the event. The default is false. */
  readonly censored?: boolean | undefined;
  /** The count of equal observations. The default is 1. A count lets a caller give grouped times. */
  readonly count?: number | undefined;
}

/** One step of a Kaplan-Meier curve, at a time with one event or more. */
export interface SurvivalStep {
  readonly time: number;
  /** The count of the observations at risk at `time`, before its events leave. A censored time at `time` is at risk. */
  readonly atRisk: number;
  /** The count of the events at `time`. */
  readonly events: number;
  /** The estimate of the chance that the time to the event is more than `time`. */
  readonly chance: number;
  /** The Greenwood standard error of `chance`. It is 0 when `chance` is 0. */
  readonly se: number;
}

/** A Kaplan-Meier curve. It is a step function: the chance is 1 before the first step, and it changes only at a step. */
export interface SurvivalCurve {
  /** One step for each time with an event, from the earliest time to the latest time. */
  readonly steps: readonly SurvivalStep[];
  /** The count of the observations. */
  readonly count: number;
  /** The count of the events. */
  readonly events: number;
  /** The count of the censored observations. */
  readonly censored: number;
  /** The largest observed time, of an event or of a censored observation. */
  readonly last: number;
}

function checkedCount(observation: TimeToEvent): number {
  const { time, count = 1 } = observation;
  if (!(Number.isFinite(time) && time >= 0)) throw new RangeError("kaplanMeier: a time is not a finite number of 0 or more.");
  if (!(Number.isInteger(count) && count >= 1)) throw new RangeError("kaplanMeier: a count is not a whole number of 1 or more.");
  return count;
}

/**
 * This function gives the Kaplan-Meier estimate of the survival curve of the observations.
 *
 * - At a time with events and censored observations, the events come first. Thus each censored observation at that time is at risk.
 * - The standard error is the formula of Greenwood: `chance * sqrt(sum(events / (atRisk * (atRisk - events))))`.
 * - When the latest observation is censored, the curve does not get to 0. After `last`, the chance has no read.
 *
 * @param observations - The observed times. The order is free
 * @returns The steps and the counts of the curve
 */
export function kaplanMeier(observations: readonly TimeToEvent[]): SurvivalCurve {
  if (observations.length === 0) throw new RangeError("kaplanMeier: the list is empty.");
  const byTime = new Map<number, { events: number; censored: number }>();
  let count = 0;
  let censored = 0;
  for (const observation of observations) {
    const n = checkedCount(observation);
    const group = byTime.get(observation.time) ?? { events: 0, censored: 0 };
    if (observation.censored === true) {
      group.censored += n;
      censored += n;
    } else group.events += n;
    byTime.set(observation.time, group);
    count += n;
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const steps: SurvivalStep[] = [];
  let atRisk = count;
  let chance = 1;
  let greenwood = 0;
  for (const time of times) {
    const group = byTime.get(time) ?? { events: 0, censored: 0 };
    if (group.events > 0) {
      chance *= (atRisk - group.events) / atRisk;
      if (atRisk > group.events) greenwood += group.events / (atRisk * (atRisk - group.events));
      steps.push({ time, atRisk, events: group.events, chance, se: chance === 0 ? 0 : chance * Math.sqrt(greenwood) });
    }
    atRisk -= group.events + group.censored;
  }
  return { steps, count, events: count - censored, censored, last: times[times.length - 1] ?? 0 };
}

/**
 * This function gives the chance that the time to the event is more than `time`.
 * After the last observed time, the chance is 0 if the curve got to 0. Else the function gives `undefined`: no read.
 */
export function survivalAt(curve: SurvivalCurve, time: number): number | undefined {
  if (!(Number.isFinite(time) && time >= 0)) throw new RangeError("survivalAt: the time is not a finite number of 0 or more.");
  let chance = 1;
  for (const step of curve.steps) {
    if (step.time > time) break;
    chance = step.chance;
  }
  return time > curve.last && chance > 0 ? undefined : chance;
}

/**
 * This function gives the `p` quantile of a curve: the earliest time at which the chance is `p` or less.
 * The comparison has a tolerance of `1e-12`, so that a float error of a product does not move the quantile.
 * The median is the quantile 0.5. When the curve does not get to `p`, the function gives `undefined`: no read.
 */
export function survivalQuantile(curve: SurvivalCurve, p: number): number | undefined {
  if (!(p > 0 && p < 1)) throw new RangeError("survivalQuantile: p is not more than 0 and less than 1.");
  return curve.steps.find((step) => step.chance - p <= 1e-12)?.time;
}

/** A pointwise interval of the chance of a survival curve at one time. */
export interface SurvivalBand {
  readonly low: number;
  readonly chance: number;
  readonly high: number;
}

/**
 * This function gives the pointwise interval of the chance of a curve at `time`, from the Greenwood standard error.
 *
 * - The interval is on the scale `log(-log(chance))` (Kalbfleisch and Prentice), so its ends are in the range 0 to 1.
 * - At this scale, the standard error is `sqrt(g) / |log(chance)|`, with `g = (se / chance)^2` the Greenwood sum of the step.
 * - Thus `low = chance^exp(w)` and `high = chance^exp(-w)`, with `w = z * sqrt(g) / |log(chance)|`.
 * - Before the first step, the chance is 1 and the interval is 1 to 1. A chance of 0 gives 0 to 0.
 * - After the last observed time, the chance has no read when it is more than 0 (`survivalAt`), so the function gives `undefined`.
 * - The interval is for one time. A band of each time with the same `z` holds each time only pointwise, not all times together.
 *
 * @param curve - The curve, for example of `kaplanMeier`
 * @param time - The time, a finite number of 0 or more
 * @param z - The normal quantile of the level. The default `Z95` gives a 95% interval
 * @returns The interval, or `undefined` for no read
 */
export function survivalBand(curve: SurvivalCurve, time: number, z: number = Z95): SurvivalBand | undefined {
  if (!(Number.isFinite(z) && z >= 0)) throw new RangeError("survivalBand: z is not a finite number of 0 or more.");
  const chance = survivalAt(curve, time);
  if (chance === undefined) return undefined;
  if (chance === 0 || chance === 1) return { low: chance, chance, high: chance };
  let se = 0;
  for (const step of curve.steps) {
    if (step.time > time) break;
    se = step.se;
  }
  const width = (z * (se / chance)) / Math.abs(Math.log(chance));
  return { low: chance ** Math.exp(width), chance, high: chance ** Math.exp(-width) };
}
