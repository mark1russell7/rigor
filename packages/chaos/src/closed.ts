import type { Completion } from "./measure.ts";
import { SCHEDULE_FORMAT, constant, type Schedule } from "./schedule.ts";

/**
 * A closed-loop driver sends its next request only after the reply, thus a stall hides the sends of
 * its interval. This module puts those hidden sends back, by the rule of `recordValueWithExpectedInterval`
 * of HdrHistogram. A request with a reply later than one interval hides the planned sends at
 * `sent + j × interval` before that reply. Each hidden send gets the reply that ended the stall.
 *
 * A pause of the driver itself also hides sends. The driver expects its next send at the later of
 * `sent + interval` and the reply plus `pause`. A send past that time and the tolerance is a driver gap. Each
 * planned send in the gap is hidden too, and it gets the reply of the real send that ended the gap.
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

/** These options give the plan of the driver and the end of the run, in ms. */
export interface ClosedLoopOptions {
  /** This time is the planned gap between two sends. */
  readonly interval: number;
  /** This time is the end of the run, from the start of the run. */
  readonly end: number;
  /** A send later than its expected time by more than this tolerance is a driver gap. */
  readonly tolerance: number;
  /**
   * This time is the wait of the driver after each reply, before its next send. The default is 0. A
   * driver with a think time sends at `done + pause`, thus that send is not a driver gap. Such a driver
   * gives `interval` and `pause` the same value: a stall then hides the sends at `sent + j × interval`.
   */
  readonly pause?: number;
}

/** This is a closed-loop run in the terms of `measureLoad`. */
export interface ClosedLoopRun {
  /** This plan has each real send and each hidden send, in order. Its profile is the rate of the interval. */
  readonly plan: Schedule;
  /**
   * These completions are those of the real sends and of the hidden sends that a reply ended. A hidden
   * send of a stall has the reply of the stall as its send. Thus its lag is its wait, and its service is 0.
   * A hidden send of a driver gap has the real send that ended the gap as its send.
   * A hidden send before a request with no reply, or after it, has no completion: `measureLoad` gives it as not sent.
   */
  readonly completions: readonly Completion[];
  /** This count is the number of hidden sends that the function put back, for stalls and driver gaps. */
  readonly hidden: number;
  /** This count is the number of sends later than their expected time by more than the tolerance. */
  readonly driverGaps: number;
  /** This time is the sum of those delays past the expected time, in ms. */
  readonly driverGapTotal: number;
}

/** This function throws a `RangeError` for options or a request list that one closed loop cannot give. */
function check(requests: readonly LoopRequest[], { interval, end, tolerance, pause = 0 }: ClosedLoopOptions): void {
  if (!(interval > 0 && Number.isFinite(interval))) throw new RangeError(`closedLoopPlan: the interval is more than 0, not ${interval}.`);
  if (!(end > 0 && Number.isFinite(end))) throw new RangeError(`closedLoopPlan: the end is more than 0, not ${end}.`);
  if (!(tolerance >= 0 && Number.isFinite(tolerance))) throw new RangeError(`closedLoopPlan: the tolerance is 0 or more, not ${tolerance}.`);
  if (!(pause >= 0 && Number.isFinite(pause))) throw new RangeError(`closedLoopPlan: the pause is 0 or more, not ${pause}.`);
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
 * This function gives the plan and the completions of a closed-loop run, for `measureLoad`. The requests
 * are in the order of their sends. The function throws a `RangeError` for a send before the reply of the
 * request before it. It throws the same error for a missing reply before the last request. A time past
 * the end and a bad option also give this error.
 */
export function closedLoopPlan(requests: readonly LoopRequest[], options: ClosedLoopOptions): ClosedLoopRun {
  check(requests, options);
  const { interval, end, tolerance, pause = 0 } = options;
  const times: number[] = [];
  const completions: Completion[] = [];
  let hidden = 0;
  let driverGaps = 0;
  let driverGapTotal = 0;
  /** This function adds a hidden send planned at `at`. It has a completion only when `done` is a reply. */
  const hide = (at: number, send: number, done: number | null): void => {
    if (done !== null) completions.push({ index: times.length, sent: send, done });
    times.push(at);
    hidden += 1;
  };
  let expected: number | null = null;
  for (const { sent, done } of requests) {
    if (expected !== null && sent - expected > tolerance) {
      driverGaps += 1;
      driverGapTotal += sent - expected;
      for (let step = 0; expected + step * interval < sent; step += 1) hide(expected + step * interval, sent, done);
    }
    completions.push({ index: times.length, sent, done });
    times.push(sent);
    const stop = done ?? end;
    for (let step = 1; sent + step * interval < stop; step += 1) hide(sent + step * interval, done ?? sent, done);
    expected = done === null ? null : Math.max(sent + interval, done + pause);
  }
  const plan: Schedule = { format: SCHEDULE_FORMAT, arrivals: "uniform", seed: null, profile: constant(1000 / interval, end), times };
  return { plan, completions, hidden, driverGaps, driverGapTotal };
}
