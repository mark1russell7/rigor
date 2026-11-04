/**
 * The intervals that come from a discrete distribution. The interval of a median or of a quantile comes from the order
 * statistics. The central interval of a count comes from a binomial or a negative binomial distribution.
 */
import { sorted } from "./describe.ts";

function whole(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name}: ${value} is not a whole number of 0 or more.`);
}

function levelOf(name: string, level: number): number {
  if (!(level > 0 && level < 1)) throw new RangeError(`${name}: the level is more than 0 and less than 1, not ${level}.`);
  return (1 - level) / 2;
}

/** The chance of each count k from 0 to n of X ~ Binomial(n, p), from the logs of the terms. */
function binomialTerms(n: number, p: number): number[] {
  if (p === 0) return Array.from({ length: n + 1 }, (_, k) => (k === 0 ? 1 : 0));
  if (p === 1) return Array.from({ length: n + 1 }, (_, k) => (k === n ? 1 : 0));
  const [logP, logQ] = [Math.log(p), Math.log1p(-p)];
  const terms: number[] = [];
  let logChoose = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) logChoose += Math.log((n - k + 1) / k);
    terms.push(Math.exp(logChoose + k * logP + (n - k) * logQ));
  }
  return terms;
}

/** The distribution-free interval of a median, from two order statistics of the sample. */
export interface MedianInterval {
  readonly low: number;
  readonly high: number;
  /** The rank k of `low`, from 1. The interval is from x_(k) to x_(n + 1 - k) of the sorted values. */
  readonly rank: number;
  /** The chance that the interval holds the median of the population: 1 - 2 P(X <= k - 1), for X ~ Binomial(n, 1/2). */
  readonly coverage: number;
}

/**
 * The distribution-free interval of the median of a sample. It needs no assumption about the shape of the
 * distribution. It is x_(k) to x_(n + 1 - k), for the largest k whose two tails each hold (1 - level) / 2 or less.
 * For 11 values at the level 0.95, it is x_(2) to x_(10), with the coverage 0.988.
 *
 * A sample of 5 values or fewer has no rank with that coverage. Then the interval is the full range, and `coverage`
 * is less than `level`.
 */
export function medianInterval(values: readonly number[], level = 0.95): MedianInterval {
  if (values.length === 0) throw new RangeError("medianInterval: the list is empty.");
  for (const v of values) if (Number.isNaN(v)) throw new RangeError("medianInterval: the list has a NaN.");
  const tail = levelOf("medianInterval", level);
  const s = sorted(values);
  const n = s.length;
  const terms = binomialTerms(n, 0.5);
  // The rank k + 1 is possible if P(X <= k), the tail that it leaves out on each side, is the tail or less.
  let k = 0;
  let below = terms[0] as number;
  while (k + 1 <= n / 2 && below <= tail) {
    k += 1;
    below += terms[k] as number;
  }
  const rank = Math.max(1, k);
  let left = 0;
  for (let i = 0; i < rank; i++) left += terms[i] as number;
  return { low: s[rank - 1] as number, high: s[n - rank] as number, rank, coverage: Math.max(0, 1 - 2 * left) };
}

/** The distribution-free interval of a quantile, from two order statistics of the sample. */
export interface QuantileInterval {
  /** The value x_(lowRank), or `-Infinity` when the sample has no rank for a lower bound. */
  readonly low: number;
  /** The value x_(highRank), or `Infinity` when the sample has no rank for an upper bound. */
  readonly high: number;
  /** The rank of `low`, from 1, or 0 when `low` is `-Infinity`. */
  readonly lowRank: number;
  /** The rank of `high`, from 1, or n + 1 when `high` is `Infinity`. */
  readonly highRank: number;
  /** The chance that the interval holds the quantile of the population. */
  readonly coverage: number;
}

/**
 * This function gives the distribution-free interval of the quantile `p` of a sample. Each tail outside the interval holds
 * (1 - level) / 2 or less. Let X ~ Binomial(n, p). The lower rank is the largest l with P(X <= l - 1) in the tail. The upper
 * rank is the smallest u with P(X >= u) in the tail. The values must be independent draws, or the coverage is false.
 *
 * A side with no such rank is infinite. Thus a small sample gives no upper bound: refer to `quantileSamples`.
 */
export function quantileInterval(values: readonly number[], p: number, level = 0.95): QuantileInterval {
  if (values.length === 0) throw new RangeError("quantileInterval: the list is empty.");
  for (const v of values) if (Number.isNaN(v)) throw new RangeError("quantileInterval: the list has a NaN.");
  if (!(p > 0 && p < 1)) throw new RangeError(`quantileInterval: p is more than 0 and less than 1, not ${p}.`);
  const tail = levelOf("quantileInterval", level);
  const s = sorted(values);
  const n = s.length;
  const terms = binomialTerms(n, p);
  let lowRank = 0;
  let left = 0;
  let below = terms[0] as number;
  while (lowRank < n && below <= tail) {
    lowRank += 1;
    left = below;
    below += terms[lowRank] as number;
  }
  let highRank = n + 1;
  let right = 0;
  let above = terms[n] as number;
  while (highRank > 1 && above <= tail) {
    highRank -= 1;
    right = above;
    above += terms[highRank - 1] as number;
  }
  return {
    low: lowRank === 0 ? -Infinity : (s[lowRank - 1] as number),
    high: highRank === n + 1 ? Infinity : (s[highRank - 1] as number),
    lowRank,
    highRank,
    coverage: Math.max(0, 1 - left - right),
  };
}

/**
 * This function gives the fewest independent values that give the quantile `p` an upper bound at `level`: the smallest n with
 * p^n <= (1 - level) / 2. With that n, the upper bound is the largest value. At the level 0.95, p95 needs 72 values, p99 needs
 * 368 values and p99.9 needs 3,688 values.
 */
export function quantileSamples(p: number, level = 0.95): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`quantileSamples: p is more than 0 and less than 1, not ${p}.`);
  const tail = levelOf("quantileSamples", level);
  const [logTail, logP] = [Math.log(tail), Math.log(p)];
  let n = Math.max(1, Math.ceil(logTail / logP));
  // A float error in the ratio can give one value too many.
  while (n > 1 && (n - 1) * logP <= logTail) n -= 1;
  return n;
}

/** A central interval of a count, from `low` to `high`, both included. */
export interface CountInterval {
  readonly low: number;
  readonly high: number;
  /** The chance of a count from `low` to `high`. It is `level` or more. */
  readonly coverage: number;
}

/**
 * The central interval of a count X ~ Binomial(n, p). `low` is the smallest k with P(X <= k) > (1 - level) / 2.
 * `high` is the largest k with P(X >= k) > (1 - level) / 2. Each tail outside the interval holds (1 - level) / 2
 * or less. The two tails are separate sums, so that a small upper tail keeps its digits.
 */
export function binomialInterval(n: number, p: number, level = 0.95): CountInterval {
  whole("binomialInterval", n);
  if (!(p >= 0 && p <= 1)) throw new RangeError(`binomialInterval: p is from 0 to 1, not ${p}.`);
  const tail = levelOf("binomialInterval", level);
  const terms = binomialTerms(n, p);
  let low = 0;
  let below = terms[0] as number;
  while (low < n && below <= tail) {
    low += 1;
    below += terms[low] as number;
  }
  let high = n;
  let above = terms[n] as number;
  while (high > 0 && above <= tail) {
    high -= 1;
    above += terms[high] as number;
  }
  let coverage = 0;
  for (let k = low; k <= high; k++) coverage += terms[k] as number;
  return { low, high, coverage: Math.min(1, coverage) };
}

/**
 * The central interval of a negative binomial count. X is the count of failures before `successes` successes, and
 * `p` is the chance of a success at each try. `low` is the smallest k with P(X <= k) > (1 - level) / 2.
 * `high` is the smallest k with P(X <= k) >= 1 - (1 - level) / 2.
 */
export function negativeBinomialInterval(successes: number, p: number, level = 0.95): CountInterval {
  whole("negativeBinomialInterval", successes);
  if (!(p > 0 && p <= 1)) throw new RangeError(`negativeBinomialInterval: p is more than 0 and 1 or less, not ${p}.`);
  const tail = levelOf("negativeBinomialInterval", level);
  const logQ = Math.log1p(-p);
  let logChance = successes * Math.log(p);
  let below = 0;
  let low = 0;
  for (let k = 0; ; k += 1) {
    const chance = Math.exp(logChance);
    if (below <= tail) low = k;
    if (below + chance >= 1 - tail) {
      let coverage = 0;
      let at = successes * Math.log(p);
      for (let i = 0; i <= k; i++) {
        if (i >= low) coverage += Math.exp(at);
        at += Math.log((i + successes) / (i + 1)) + logQ;
      }
      return { low, high: k, coverage: Math.min(1, coverage) };
    }
    below += chance;
    logChance += Math.log((k + successes) / (k + 1)) + logQ;
  }
}
