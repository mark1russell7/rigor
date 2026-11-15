/**
 * The timed samples of one arm in one process: the child side of a fresh-process bench. The runner `freshRun` starts a
 * child for each arm, and each child times only its own arm with `timeArm`. Then the child prints one JSON line with
 * the time `ms`.
 */
import { median } from "@mark1russell7/rigor-statistics";

/** The options of the timed samples of one arm. */
export interface ArmOptions {
  /** The count of the counted samples, a whole number of 1 or more. */
  readonly samples: number;
  /**
   * The calls of one sample from an earlier process. With this value, the function does not calibrate, thus each
   * process does the same work. Without it, the function calibrates the calls to the target time.
   */
  readonly calls?: number;
  /** The least time in milliseconds of one sample at the calibration. The default is 10. */
  readonly targetMs?: number;
  /** The time in milliseconds of the warm-up before the calibration. The default is 300. */
  readonly warmMs?: number;
  /** The count of the samples after the calibration that the function does not count. The default is 1. */
  readonly warmSamples?: number;
  /** The clock in milliseconds. The default is `performance.now` of the global `performance` of Node and of each browser. */
  readonly now?: () => number;
  /**
   * This function gets the bounds of the halves of the counted samples, outside the timed part. Its samples are 0,
   * `half`, `samples - half` and `samples`, with `half` the floor of `samples / 2`. `eventProbe` of `/fresh` uses it.
   */
  readonly mark?: (sample: number) => void;
  /**
   * The slowdown factor of a flip test, 1 or more. The default is 1. Above 1, each sample waits in the timed part until
   * its time is `slow` times the time of its calls. Thus the timer reads a real slowdown of this factor.
   */
  readonly slow?: number;
}

/** The timed samples of one arm. */
export interface ArmTime {
  /** The median time of one call over the counted samples, in milliseconds. */
  readonly ms: number;
  /** The count of calls in one sample. Give it to the next process as `calls`. */
  readonly calls: number;
  /** The time of one call in each counted sample, in milliseconds, in the order of the samples. */
  readonly samples: readonly number[];
  /**
   * The warm check: the median of the last half of the counted samples over the median of the first half. A value
   * near 1 tells that the time did not go down in the counted samples. Only 2 samples or more give it.
   */
  readonly warm?: number;
}

/** The calibration stops at this count of calls, also when a sample is shorter than the target time. */
const MOST_CALLS = 2 ** 30;

/** The last value of a call. The engine cannot remove the work of a call, because this module keeps its value. */
let kept: unknown;

/**
 * This function times one arm in this process. First the arm operates for the warm-up time. Then the count of calls of one
 * sample grows until a sample takes the target time. The function gives the median time of one call over the counted
 * samples. Start it in a fresh process for each arm, each case and each round.
 */
export function timeArm(run: () => unknown, options: ArmOptions): ArmTime {
  const targetMs = options.targetMs ?? 10;
  const warmMs = options.warmMs ?? 300;
  const warmSamples = options.warmSamples ?? 1;
  const now = options.now ?? (() => performance.now());
  const slow = options.slow ?? 1;
  if (!Number.isSafeInteger(options.samples) || options.samples < 1) throw new RangeError(`timeArm: the samples are a whole number of 1 or more, not ${options.samples}.`);
  if (options.calls !== undefined && (!Number.isSafeInteger(options.calls) || options.calls < 1)) {
    throw new RangeError(`timeArm: the calls are a whole number of 1 or more, not ${options.calls}.`);
  }
  if (!(targetMs > 0 && Number.isFinite(targetMs)) || !(warmMs >= 0 && Number.isFinite(warmMs))) {
    throw new RangeError("timeArm: the target time is a finite time above 0, and the warm-up time is a finite time of 0 or more.");
  }
  if (!(slow >= 1 && Number.isFinite(slow))) throw new RangeError(`timeArm: the slowdown factor is a finite number of 1 or more, not ${slow}.`);
  if (!Number.isSafeInteger(warmSamples) || warmSamples < 0) throw new RangeError(`timeArm: the warm samples are a whole number of 0 or more, not ${warmSamples}.`);

  const sample = (count: number): number => {
    const start = now();
    for (let i = 0; i < count; i++) kept = run();
    if (slow > 1) {
      const until = start + (now() - start) * slow;
      while (now() < until);
    }
    return now() - start;
  };
  const fixed = options.calls !== undefined;
  let calls = options.calls ?? 1;
  const warmUntil = now() + warmMs;
  while (now() < warmUntil) {
    if (sample(calls) < targetMs / 4 && !fixed && calls < MOST_CALLS) calls *= 2;
  }
  if (!fixed) while (calls < MOST_CALLS && sample(calls) < targetMs) calls *= 2;
  for (let i = 0; i < warmSamples; i++) sample(calls);
  const samples: number[] = [];
  const half = Math.floor(options.samples / 2);
  const bounds = new Set([0, half, options.samples - half]);
  for (let i = 0; i < options.samples; i++) {
    if (bounds.has(i)) options.mark?.(i);
    samples.push(sample(calls) / calls);
  }
  options.mark?.(options.samples);
  if (kept === Symbol.for("rigor-bench.never")) throw new Error("timeArm: the arm gave a value that no arm gives.");
  const early = half > 0 ? median(samples.slice(0, half)) : 0;
  const warm = early > 0 ? median(samples.slice(options.samples - half)) / early : undefined;
  return { ms: median(samples), calls, samples, ...(warm === undefined ? {} : { warm }) };
}
