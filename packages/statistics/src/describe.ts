/**
 * The descriptive statistics: the mean, the standard deviation, the median, the quantiles and a summary of a list.
 * Each function throws a RangeError for an empty list or for a value that is NaN. Thus a missing value cannot make a
 * quiet NaN in a record.
 */

/** The two definitions of a quantile that the engines use (Hyndman and Fan, 1996). */
export type QuantileMethod =
  /** Type 7: a linear step between the two nearest ranks. The default of R and NumPy. */
  | "linear"
  /** Type 1: the smallest value with at least the share `p` of the values at or below it. */
  | "nearest-rank";

function checked(name: string, values: readonly number[]): void {
  if (values.length === 0) throw new RangeError(`${name}: the list is empty.`);
  for (const v of values) if (Number.isNaN(v)) throw new RangeError(`${name}: the list has a NaN.`);
}

/** A new list with the values from the smallest to the largest. */
export function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function mean(values: readonly number[]): number {
  checked("mean", values);
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** The sample standard deviation (the divisor is n - 1). It needs 2 values or more. */
export function sd(values: readonly number[]): number {
  checked("sd", values);
  if (values.length < 2) throw new RangeError("sd: the list needs 2 values or more.");
  const m = mean(values);
  let sum = 0;
  for (const v of values) sum += (v - m) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

/**
 * The `p` quantile of a list that is already sorted. Use it when you take several quantiles of one list.
 * The linear method gives the same numbers as the copies in highways, packing and layout-contract. The
 * nearest-rank method gives the same numbers as the copies in lag, lag-hud and the backtest of highways.
 */
export function quantileSorted(sortedValues: readonly number[], p: number, method: QuantileMethod = "linear"): number {
  checked("quantile", sortedValues);
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantile: p is from 0 to 1, not ${p}.`);
  const n = sortedValues.length;
  if (method === "nearest-rank") return sortedValues[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))] as number;
  const at = (n - 1) * p;
  const low = Math.floor(at);
  const part = at - low;
  const a = sortedValues[low] as number;
  if (part === 0) return a;
  const b = sortedValues[low + 1] as number;
  if (a === b) return a;
  return a + part * (b - a);
}

/** The `p` quantile of a list. */
export function quantile(values: readonly number[], p: number, method: QuantileMethod = "linear"): number {
  checked("quantile", values);
  return quantileSorted(sorted(values), p, method);
}

/**
 * The median: the middle value, or the midpoint `(a + b) / 2` of the two middle values. The midpoint is correctly
 * rounded. `quantile(values, 0.5)` computes `a + 0.5 * (b - a)`, which can differ from it in the last bit.
 */
export function median(values: readonly number[]): number {
  checked("median", values);
  const s = sorted(values);
  const middle = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[middle] as number) : ((s[middle - 1] as number) + (s[middle] as number)) / 2;
}

/** The summary of a list. The quartiles use the linear method. */
export interface Summary {
  readonly n: number;
  readonly mean: number;
  /** The sample standard deviation, or NaN for one value. */
  readonly sd: number;
  readonly min: number;
  /** The 0.25 quantile. */
  readonly q1: number;
  readonly median: number;
  /** The 0.75 quantile. */
  readonly q3: number;
  readonly max: number;
  /** The interquartile range: q3 - q1. */
  readonly iqr: number;
}

export function summarize(values: readonly number[]): Summary {
  checked("summarize", values);
  const s = sorted(values);
  const q1 = quantileSorted(s, 0.25);
  const q3 = quantileSorted(s, 0.75);
  return {
    n: s.length,
    // The mean and sd of the list in its own order, so that they are equal to mean(values) and sd(values).
    mean: mean(values),
    sd: s.length < 2 ? Number.NaN : sd(values),
    min: s[0] as number,
    q1,
    median: median(s),
    q3,
    max: s[s.length - 1] as number,
    iqr: q3 - q1,
  };
}
