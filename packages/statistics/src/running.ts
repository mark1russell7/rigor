/**
 * The running summary: the count, the sum, the extremes and the spread of a stream of values, one value at a time.
 * A collector, a reducer or a parallel job adds each value, or merges two summaries. The summary agrees with the
 * functions of a list: `runningMean` gives exactly `mean` of the values, and `runningSd` gives `sd` to a tolerance.
 */

/**
 * A running summary of the values that were added. The record is immutable, so a fold can keep each step. The empty
 * summary is `EMPTY_RUNNING`.
 */
export interface RunningSummary {
  /** The count of the values. */
  readonly n: number;
  /** The sum of the values, added in their order. */
  readonly sum: number;
  /** The smallest value, or `Infinity` for no value. */
  readonly min: number;
  /** The largest value, or `-Infinity` for no value. */
  readonly max: number;
  /** The sum of the squares of the differences from the mean (Welford). `runningSd` reads it. */
  readonly m2: number;
}

/** The summary of no value. It is the unit of `mergeRunning`. */
export const EMPTY_RUNNING: RunningSummary = Object.freeze({ n: 0, sum: 0, min: Infinity, max: -Infinity, m2: 0 });

/**
 * This function gives the summary with one more value. It throws a RangeError for NaN, as the functions of a list do.
 * The mean of each step is `sum / n`, so the mean of the fold is the mean of the list.
 */
export function addToRunning(s: RunningSummary, value: number): RunningSummary {
  if (Number.isNaN(value)) throw new RangeError("addToRunning: the value is NaN.");
  // The sum starts at 0, as the sum of `mean` does. Thus a first value of -0 gives the sum 0 there too.
  const sum = s.sum + value;
  if (s.n === 0) return { n: 1, sum, min: value, max: value, m2: 0 };
  const n = s.n + 1;
  const m2 = s.m2 + (value - s.sum / s.n) * (value - sum / n);
  return { n, sum, min: Math.min(s.min, value), max: Math.max(s.max, value), m2 };
}

/** This function gives the summary of the values of a list or another iterable, in their order. */
export function runningOf(values: Iterable<number>): RunningSummary {
  let s = EMPTY_RUNNING;
  for (const v of values) s = addToRunning(s, v);
  return s;
}

/**
 * This function gives the summary of the values of two summaries (Chan, Golub and LeVeque, 1979). Thus parallel jobs
 * can each summarize a part. The sum of the merge adds the two sums, so it can differ from the fold in the last bits.
 */
export function mergeRunning(a: RunningSummary, b: RunningSummary): RunningSummary {
  if (a.n === 0) return b;
  if (b.n === 0) return a;
  const n = a.n + b.n;
  const delta = b.sum / b.n - a.sum / a.n;
  return {
    n,
    sum: a.sum + b.sum,
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
    m2: a.m2 + b.m2 + ((delta * delta * a.n) / n) * b.n,
  };
}

/** This function gives the mean of the values: `sum / n`. It throws a RangeError for the empty summary. */
export function runningMean(s: RunningSummary): number {
  if (s.n === 0) throw new RangeError("runningMean: the summary is empty.");
  return s.sum / s.n;
}

/**
 * This function gives the sample standard deviation of the values (the divisor is n - 1). It needs 2 values or more.
 * Equal values give exactly 0, as `sd` gives. A rounding error cannot make the result NaN.
 */
export function runningSd(s: RunningSummary): number {
  if (s.n < 2) throw new RangeError("runningSd: the summary needs 2 values or more.");
  if (s.min === s.max) return 0;
  return Math.sqrt(Math.max(0, s.m2) / (s.n - 1));
}
