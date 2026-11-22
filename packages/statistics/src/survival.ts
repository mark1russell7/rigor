/**
 * The survival curves of the times to an event. This module gives the Kaplan-Meier estimate with right censoring and its
 * Greenwood standard error. It also gives the chance at a time and the quantiles of a curve.
 * Each function throws a RangeError for an empty list or for a time that is not a finite number of 0 or more.
 * It also throws a RangeError for a count that is not a whole number of 1 or more.
 */

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
