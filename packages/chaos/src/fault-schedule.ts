import { type Direction, type FaultAction, type Trigger, type WindowFault, checkWindowFault } from "./faults.ts";
import { type Profile, checkProfile, schedule } from "./schedule.ts";

/**
 * A schedule of faults turns a profile into faults of windows, so the size or the rate of a fault changes over the run.
 *
 * - `latencyWindows` reads a profile of delays in ms. A server thus gets slow step by step, or fast again.
 * - `failureWindows` reads a profile of failures each second. The failures start at the Poisson times of `schedule`.
 *
 * The result is a list of window faults for `faultPlanOf`. The proxy applies it with no change.
 */

/** The longest list of steps that `latencyWindows` makes. A longer list is an error of the units, not a plan. */
const MAX_STEPS = 1_000_000;

/** The options of `latencyWindows`. */
export interface LatencyOptions {
  /** The length of each step, in ms. Each step gets the mean delay of the profile over the step. */
  readonly stepMs: number;
  /** The direction of the delay. The default is `down`, the replies of the server. */
  readonly direction?: Direction;
}

/** The options of `failureWindows`. */
export interface FailureOptions {
  /** The fault of each failure. A `reset` or a `cut` makes an outage, a `stall` makes a hang, and an `answer` makes an error reply. */
  readonly action: FaultAction;
  /** The length of each failure, in ms. Two failures that overlap make one window. */
  readonly widthMs: number;
  /** The seed of the Poisson times of the failures. */
  readonly seed: number | string;
  /** The direction of the fault. The default is `up`. */
  readonly direction?: Direction;
  /** The point of the fault in each connection. The default `{ ms: 0 }` stops each connection of a failure at once. */
  readonly at?: Trigger;
}

/** This function gives the area under a profile from `a` to `b`: the value of the profile times ms. */
function areaBetween(profile: Profile, a: number, b: number): number {
  let area = 0;
  let start = 0;
  for (const phase of profile) {
    const end = start + phase.ms;
    const x1 = Math.max(a, start);
    const x2 = Math.min(b, end);
    if (x2 > x1) {
      const at = (x: number): number => phase.from + ((phase.to - phase.from) * (x - start)) / phase.ms;
      area += ((at(x1) + at(x2)) / 2) * (x2 - x1);
    }
    start = end;
  }
  return area;
}

/** This function throws a `RangeError` for a direction that is not `up` or `down`. */
function checkDirection(name: string, direction: unknown): void {
  if (direction !== "up" && direction !== "down") throw new RangeError(`${name}: the direction is up or down, not ${String(direction)}.`);
}

/**
 * This function gives the delay windows of a profile. Here the value of each phase is a delay in ms, not a rate.
 * Each step of `stepMs` gets one `delay` window with the mean delay of the profile over the step.
 * A step with no delay gets no window. Each step has its own window, also when two steps have one delay.
 * A merged window has a longer `forMs`, thus a connection that opens late in it keeps the delay too long after its end.
 *
 * The proxy keeps the larger of two delays that overlap. A connection that opens in a step thus keeps the delay of the step
 * for up to one step. With a delay that falls, the fall comes up to one step late for that connection.
 * This function throws a `RangeError` for a bad profile, a bad step or a bad direction.
 */
export function latencyWindows(profile: Profile, options: LatencyOptions): WindowFault[] {
  const problems = checkProfile(profile);
  if (problems.length > 0) throw new RangeError(`latencyWindows: ${problems.join(" ")}`);
  const { stepMs } = options;
  if (!(typeof stepMs === "number" && Number.isFinite(stepMs) && stepMs > 0)) throw new RangeError(`latencyWindows: the step is a finite time above 0 ms, not ${String(stepMs)}.`);
  const direction = options.direction ?? "down";
  checkDirection("latencyWindows", direction);
  const total = profile.reduce((sum, phase) => sum + phase.ms, 0);
  const count = Math.ceil(total / stepMs);
  if (count > MAX_STEPS) throw new RangeError(`latencyWindows: ${count} steps of ${stepMs} ms are more than ${MAX_STEPS}. Make the step longer.`);
  const out: WindowFault[] = [];
  for (let k = 0; k < count; k++) {
    const from = k * stepMs;
    const to = Math.min(from + stepMs, total);
    const ms = areaBetween(profile, from, to) / (to - from);
    if (ms > 0) out.push({ window: { from, to }, direction, at: { ms: 0 }, kind: "delay", ms, forMs: to - from });
  }
  return out;
}

/**
 * This function gives the failure windows of a profile. Here the value of each phase is a rate of failures each second.
 * The failures start at the times of `schedule` with Poisson arrivals and the seed. Each failure lasts `widthMs`.
 * Two failures that overlap or touch make one window. The same profile and the same seed give the same windows on one platform.
 * This function throws a `RangeError` for a bad profile, a bad width or a bad fault.
 */
export function failureWindows(profile: Profile, options: FailureOptions): WindowFault[] {
  const problems = checkProfile(profile);
  if (problems.length > 0) throw new RangeError(`failureWindows: ${problems.join(" ")}`);
  const { widthMs } = options;
  if (!(typeof widthMs === "number" && Number.isFinite(widthMs) && widthMs > 0)) throw new RangeError(`failureWindows: the width is a finite time above 0 ms, not ${String(widthMs)}.`);
  const direction = options.direction ?? "up";
  checkDirection("failureWindows", direction);
  const fault = (window: { readonly from: number; readonly to: number }): WindowFault => ({ ...options.action, window, direction, at: options.at ?? { ms: 0 } }) as WindowFault;
  const faultProblems = checkWindowFault(fault({ from: 0, to: widthMs }));
  if (faultProblems.length > 0) throw new RangeError(`failureWindows: ${faultProblems.join(" ")}`);
  const windows: { from: number; to: number }[] = [];
  for (const time of schedule(profile, { arrivals: "poisson", seed: options.seed }).times) {
    const last = windows.at(-1);
    if (last !== undefined && time <= last.to) last.to = time + widthMs;
    else windows.push({ from: time, to: time + widthMs });
  }
  return windows.map(fault);
}
