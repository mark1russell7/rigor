import type { FaultWindow } from "./faults.ts";

/**
 * These measures tell how a system responds to the faults of a window. The first measure is the time until the system
 * sees the fault. The second measure is the time until it comes back after the end of the window. The input is a
 * series of samples of a health signal, for example the health of a source at each pass of a service. Each time is on
 * the axis of the window.
 */

/** One sample of a health signal: its time, and `true` when the system sees the target as up. */
export interface HealthSample {
  readonly at: number;
  readonly up: boolean;
}

/** The limits of the gates of a window. */
export interface WindowLimits {
  /** The signal goes down in this time after the start of the window. */
  readonly detectMs: number;
  /** The signal comes up in this time after the end of the window, or after the detection when it comes later. */
  readonly recoverMs: number;
}

/** The verdict of one gate. A gate with no read does not pass. */
export type WindowVerdict = "pass" | "fail" | "no read";

/** The response of a health signal to a window. */
export interface WindowResponse {
  /** The time from the start of the window to the first sample down at or after it. It is absent when no sample is down. */
  readonly detectMs?: number;
  /**
   * The time from the end of the window to the first sample up at or after it. When the detection comes after the end
   * of the window, the time counts from the detection. It is absent when no such sample is up.
   */
  readonly recoverMs?: number;
  readonly detected: WindowVerdict;
  readonly recovered: WindowVerdict;
  /** The reasons of each verdict that is not a pass. */
  readonly problems: readonly string[];
}

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** This function gives the verdict of one gate from its time, its limit and the time of the last sample. */
function verdictOf(ms: number | undefined, limit: number, base: number, last: number): WindowVerdict {
  if (ms !== undefined && ms <= limit) return "pass";
  // A sample at the limit or after it decides: the signal did not change in time.
  return last >= base + limit ? "fail" : "no read";
}

/**
 * This function gives the response of a health signal to a window, and the verdicts of the gates `detected` and
 * `recovered`. A gate has no read in these cases:
 *
 * - No sample before the window is up.
 * - A sample before the window is down after the first sample up.
 * - The samples end before the limit of the gate.
 * - For `recovered` only: no sample is down at or after the start of the window.
 *
 * This function throws a `RangeError` for a window, limits or sample times that are not valid. It also throws when the
 * times are not in order.
 */
export function windowResponse(window: FaultWindow, samples: readonly HealthSample[], limits: WindowLimits): WindowResponse {
  if (!isTime(window.from) || !isTime(window.to) || window.to <= window.from) {
    throw new RangeError(`windowResponse: the window has two finite times, from before to, not ${JSON.stringify(window)}.`);
  }
  if (!isTime(limits.detectMs) || !isTime(limits.recoverMs) || limits.detectMs < 0 || limits.recoverMs < 0) {
    throw new RangeError(`windowResponse: the limits are finite times of 0 or more, not ${JSON.stringify(limits)}.`);
  }
  samples.forEach((sample, index) => {
    if (!isTime(sample.at)) throw new RangeError(`windowResponse: the time of sample ${index} is not a finite number.`);
    if (index > 0 && sample.at < (samples[index - 1] as HealthSample).at) throw new RangeError(`windowResponse: sample ${index} comes before the sample before it.`);
  });

  const before = samples.filter((sample) => sample.at < window.from);
  const firstUp = before.findIndex((sample) => sample.up);
  const steady = firstUp !== -1 && before.slice(firstUp).every((sample) => sample.up);
  const down = samples.find((sample) => sample.at >= window.from && !sample.up);
  const detectMs = down === undefined ? undefined : down.at - window.from;
  const base = Math.max(window.to, down?.at ?? window.to);
  const up = samples.find((sample) => sample.at >= base && sample.up);
  const recoverMs = up === undefined ? undefined : up.at - base;
  const last = samples.at(-1)?.at ?? Number.NEGATIVE_INFINITY;

  const problems: string[] = [];
  if (!steady) {
    problems.push(firstUp === -1 ? "No sample before the window is up." : "A sample before the window is down after the first sample up.");
    return { ...(detectMs === undefined ? {} : { detectMs }), ...(recoverMs === undefined ? {} : { recoverMs }), detected: "no read", recovered: "no read", problems };
  }
  const detected = verdictOf(detectMs, limits.detectMs, window.from, last);
  // With no detection, the signal has nothing to recover from. Thus the recovery has no read, not a pass.
  const recovered = down === undefined ? "no read" : verdictOf(recoverMs, limits.recoverMs, base, last);
  const since = base === window.to ? "the end of the window" : "the detection";
  if (detected === "fail") {
    problems.push(`The signal ${detectMs === undefined ? "did not go down" : `went down after ${String(detectMs)} ms, not`} in ${String(limits.detectMs)} ms of the start of the window.`);
  }
  if (detected === "no read") problems.push(`The samples end before ${String(limits.detectMs)} ms after the start of the window.`);
  if (recovered === "fail") {
    problems.push(`The signal ${recoverMs === undefined ? "did not come up" : `came up after ${String(recoverMs)} ms, not`} in ${String(limits.recoverMs)} ms of ${since}.`);
  }
  if (recovered === "no read") {
    problems.push(down === undefined ? "The signal did not go down, thus the recovery has no read." : `The samples end before ${String(limits.recoverMs)} ms after ${since}.`);
  }
  return { ...(detectMs === undefined ? {} : { detectMs }), ...(recoverMs === undefined ? {} : { recoverMs }), detected, recovered, problems };
}
