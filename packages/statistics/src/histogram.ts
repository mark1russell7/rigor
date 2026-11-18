/**
 * The histogram: a summary of a stream of values that gives each quantile with a bounded relative error (DDSketch,
 * Masson, Rim and Lee, 2019). A collector adds each value, or merges two histograms of parts of the stream.
 *
 * - A bucket holds the values in `(γ^(k - 1), γ^k]`, with `γ = (1 + α) / (1 - α)` and `α` the relative error.
 * - A quantile is the representative value of its bucket, `2 γ^k / (γ + 1)`. It is within `α` of the true value,
 *   relative to the true value.
 * - The quantile follows the nearest-rank rule of `quantile`. The rank is the smallest with at least the share `p` of the
 *   values at or below it. The rank 0 gives the exact smallest value, and the rank `n - 1` the exact largest value.
 * - The count of buckets grows with the logarithm of the range of the values, not with the count of values. With
 *   `α = 0.01`, values from 1 to 10,000 use at most 462 buckets.
 * - The record is immutable, as the running summary is, so a fold can keep each step. `addAllToHistogram` adds a batch
 *   with one copy of the buckets.
 */

/** The relative error of a histogram when the caller gives none. */
export const HISTOGRAM_RELATIVE_ERROR = 0.01;

/** A bucket of a histogram: its index `k` and the count of its values. */
export interface HistogramBucket {
  readonly index: number;
  readonly count: number;
}

/** A histogram of the values that were added. The empty histogram comes from `emptyHistogram`. */
export interface Histogram {
  /** The largest relative error of a quantile, from 0 to 1, with 0 and 1 not included. */
  readonly relativeError: number;
  /** The count of the values. */
  readonly n: number;
  /** The sum of the values, added in their order. */
  readonly sum: number;
  /** The smallest value, or `Infinity` for no value. */
  readonly min: number;
  /** The largest value, or `-Infinity` for no value. */
  readonly max: number;
  /** The count of the values that are 0. */
  readonly zeros: number;
  /** The buckets of the values above 0, by index in increasing order. Each count is 1 or more. */
  readonly positive: readonly HistogramBucket[];
  /** The buckets of the values below 0, by the index of the magnitude in increasing order. Each count is 1 or more. */
  readonly negative: readonly HistogramBucket[];
}

/** This function gives `γ` of a relative error. */
function gammaOf(relativeError: number): number {
  return (1 + relativeError) / (1 - relativeError);
}

/** This function gives the index of the bucket of a magnitude above 0. */
function indexOf(magnitude: number, logGamma: number): number {
  return Math.ceil(Math.log(magnitude) / logGamma);
}

/**
 * This function gives the empty histogram with a relative error. It throws a RangeError for a relative error that is not
 * above 0 and below 1.
 */
export function emptyHistogram(relativeError: number = HISTOGRAM_RELATIVE_ERROR): Histogram {
  if (!(relativeError > 0 && relativeError < 1)) {
    throw new RangeError(`emptyHistogram: the relative error is above 0 and below 1, not ${relativeError}.`);
  }
  return { relativeError, n: 0, sum: 0, min: Infinity, max: -Infinity, zeros: 0, positive: [], negative: [] };
}

/** This function checks a value. A histogram takes only finite numbers. */
function checkedValue(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name}: the value is a finite number, not ${value}.`);
  return value;
}

/** This function gives the buckets of a map of counts, by index in increasing order. */
function bucketsOf(counts: ReadonlyMap<number, number>): HistogramBucket[] {
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([index, count]) => ({ index, count }));
}

/** This function gives the counts of a list of buckets, by index. */
function countsOf(buckets: readonly HistogramBucket[]): Map<number, number> {
  return new Map(buckets.map((bucket) => [bucket.index, bucket.count]));
}

/**
 * This function gives the histogram with the values of a list or another iterable added, in their order. It copies the
 * buckets once. It throws a RangeError for a value that is not a finite number, and then adds no value.
 */
export function addAllToHistogram(h: Histogram, values: Iterable<number>): Histogram {
  const logGamma = Math.log(gammaOf(h.relativeError));
  const positive = countsOf(h.positive);
  const negative = countsOf(h.negative);
  let { n, sum, min, max, zeros } = h;
  // JSON writes Infinity as null. Thus an empty histogram from JSON starts from the extremes of no value, as here.
  if (n === 0) [min, max] = [Infinity, -Infinity];
  for (const raw of values) {
    const value = checkedValue("addAllToHistogram", raw);
    n++;
    sum += value;
    min = Math.min(min, value);
    max = Math.max(max, value);
    if (value === 0) zeros++;
    else {
      const counts = value > 0 ? positive : negative;
      const index = indexOf(Math.abs(value), logGamma);
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }
  }
  if (n === h.n) return h;
  return { relativeError: h.relativeError, n, sum, min, max, zeros, positive: bucketsOf(positive), negative: bucketsOf(negative) };
}

/** This function gives the histogram with one more value. It throws a RangeError for a value that is not a finite number. */
export function addToHistogram(h: Histogram, value: number): Histogram {
  return addAllToHistogram(h, [checkedValue("addToHistogram", value)]);
}

/** This function gives the histogram of the values of a list or another iterable. */
export function histogramOf(values: Iterable<number>, relativeError: number = HISTOGRAM_RELATIVE_ERROR): Histogram {
  return addAllToHistogram(emptyHistogram(relativeError), values);
}

/** This function adds two lists of buckets. */
function mergeBuckets(a: readonly HistogramBucket[], b: readonly HistogramBucket[]): HistogramBucket[] {
  const counts = countsOf(a);
  for (const bucket of b) counts.set(bucket.index, (counts.get(bucket.index) ?? 0) + bucket.count);
  return bucketsOf(counts);
}

/**
 * This function gives the histogram of the values of two histograms. Thus parallel jobs can each count a part. It throws
 * a RangeError when the relative errors differ, because their buckets do not align.
 */
export function mergeHistograms(a: Histogram, b: Histogram): Histogram {
  if (a.relativeError !== b.relativeError) {
    throw new RangeError(`mergeHistograms: the relative errors differ (${a.relativeError} and ${b.relativeError}).`);
  }
  if (b.n === 0) return a;
  if (a.n === 0) return b;
  return {
    relativeError: a.relativeError,
    n: a.n + b.n,
    sum: a.sum + b.sum,
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
    zeros: a.zeros + b.zeros,
    positive: mergeBuckets(a.positive, b.positive),
    negative: mergeBuckets(a.negative, b.negative),
  };
}

/**
 * This function gives the quantile `p` of the values, by the nearest-rank rule of `quantile`, within the relative error.
 * It throws a RangeError for the empty histogram, and for a `p` that is not from 0 to 1.
 */
export function histogramQuantile(h: Histogram, p: number): number {
  if (h.n === 0) throw new RangeError("histogramQuantile: the histogram is empty.");
  if (!(p >= 0 && p <= 1)) throw new RangeError(`histogramQuantile: p is from 0 to 1, not ${p}.`);
  const rank = Math.min(h.n - 1, Math.max(0, Math.ceil(p * h.n) - 1));
  if (rank === 0) return h.min;
  if (rank === h.n - 1) return h.max;
  const gamma = gammaOf(h.relativeError);
  const value = (index: number): number => (2 * gamma ** index) / (gamma + 1);
  let seen = 0;
  // The negative values come first, the largest magnitude first.
  for (let i = h.negative.length - 1; i >= 0; i--) {
    const bucket = h.negative[i] as HistogramBucket;
    seen += bucket.count;
    if (seen > rank) return Math.max(h.min, Math.min(h.max, -value(bucket.index)));
  }
  seen += h.zeros;
  if (seen > rank) return 0;
  for (const bucket of h.positive) {
    seen += bucket.count;
    if (seen > rank) return Math.max(h.min, Math.min(h.max, value(bucket.index)));
  }
  return h.max;
}
