import type { Completion } from "./measure.ts";
import { SCHEDULE_FORMAT, constant, type Schedule } from "./schedule.ts";

/**
 * A closed-loop driver sends its next request only after the reply, thus a stall hides the sends of
 * its interval. This module puts those hidden sends back, by the rule of `recordValueWithExpectedInterval`
 * of HdrHistogram. A request with a reply later than one interval hides the planned sends at
 * `sent + j × interval` before that reply. Each hidden send gets the reply that ended the stall.
 *
 * The plan starts again at each real send. A global plan of `first + n × interval` is not correct for
 * such a driver. The driver does not send faster after a stall, thus one stall makes each later send late.
 */

/** A request is what a closed-loop driver sent and saw. Its times are in ms from the start of the run. */
export interface LoopRequest {
  readonly sent: number;
  /** This time is null for a request with no reply at the end of the run. Only the last request has it. */
  readonly done: number | null;
}

/** This is a closed-loop run in the terms of `measureLoad`. */
export interface ClosedLoopRun {
  /** This plan has each real send and each hidden send, in order. Its profile is the rate of the interval. */
  readonly plan: Schedule;
  /**
   * These completions are those of the real sends and of the hidden sends that a reply ended. The
   * earliest send of a hidden arrival is the reply of the stall, thus its lag is its wait and its service is 0.
   * A hidden arrival after a request with no reply has no completion: `measureLoad` gives it as not sent.
   */
  readonly completions: readonly Completion[];
  /** This count is the number of hidden sends that the function put back. */
  readonly hidden: number;
}

/** This function throws a `RangeError` for a request list that one closed loop cannot give. */
function checkRequests(requests: readonly LoopRequest[], interval: number, end: number): void {
  if (!(interval > 0 && Number.isFinite(interval))) throw new RangeError(`closedLoopPlan: the interval is more than 0, not ${interval}.`);
  if (!(end > 0 && Number.isFinite(end))) throw new RangeError(`closedLoopPlan: the end is more than 0, not ${end}.`);
  let free = 0;
  requests.forEach(({ sent, done }, index) => {
    if (!(sent >= free && Number.isFinite(sent))) throw new RangeError(`closedLoopPlan: the request ${index} has a send at ${sent}, before the reply at ${free}.`);
    if (done === null && index !== requests.length - 1) throw new RangeError(`closedLoopPlan: the request ${index} has no reply, and it is not the last request.`);
    const last = done ?? sent;
    if (!(last >= sent && last <= end)) throw new RangeError(`closedLoopPlan: the request ${index} has a send at ${sent} and a reply at ${done}, in a run that stops at ${end}.`);
    free = last;
  });
}

/**
 * This function gives the plan and the completions of a closed-loop run, for `measureLoad`. `interval`
 * is the planned gap between two sends, and `end` is the end of the run. The requests are in the order
 * of their sends. The function throws a `RangeError` for a send before the reply of the request before
 * it. It throws the same error for a request with no reply that is not the last, and for a time past `end`.
 */
export function closedLoopPlan(requests: readonly LoopRequest[], interval: number, end: number): ClosedLoopRun {
  checkRequests(requests, interval, end);
  const times: number[] = [];
  const completions: Completion[] = [];
  let hidden = 0;
  for (const { sent, done } of requests) {
    completions.push({ index: times.length, sent, done });
    times.push(sent);
    const stop = done ?? end;
    for (let step = 1; sent + step * interval < stop; step += 1) {
      if (done !== null) completions.push({ index: times.length, sent: done, done });
      times.push(sent + step * interval);
      hidden += 1;
    }
  }
  const plan: Schedule = { format: SCHEDULE_FORMAT, arrivals: "uniform", seed: null, profile: constant(1000 / interval, end), times };
  return { plan, completions, hidden };
}
