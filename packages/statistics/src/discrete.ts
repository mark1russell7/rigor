/**
 * The intervals that come from a discrete distribution. The interval of a median or of a quantile comes from the order
 * statistics. The central interval of a count comes from a binomial or a negative binomial distribution. The exact
 * interval of a proportion comes from the two tails of a binomial distribution. The exact interval of a rate comes from
 * the two tails of a Poisson distribution.
 */
import { sorted } from "./describe.ts";
import type { Proportion } from "./tests.ts";

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

/** The side of `binomialTest`: `"less"` gives `P(X <= k)`, and `"greater"` gives `P(X >= k)`. */
export type BinomialSide = "less" | "greater";

/**
 * This function gives the p of the exact one-sided binomial test of `k` successes in `n` trials, with
 * X ~ Binomial(n, p). The side `"less"` gives `P(X <= k)`. A small value rejects the claim "the chance is `p` or
 * more". The side `"greater"` gives `P(X >= k)`. A small value rejects the claim "the chance is `p` or less".
 *
 * The sum starts at the largest term of the tail, so a small tail keeps its digits. At `p = 1/2`, the side
 * `"greater"` is equal to the one-sided `signTest(k, n - k)`.
 *
 * @param k - The count of successes, a whole number from 0 to `n`.
 * @param n - The count of trials, a whole number of 0 or more.
 * @param p - The chance of a success under the claim, from 0 to 1.
 * @param side - The side of the tail.
 * @returns The p of the test, from 0 to 1.
 */
export function binomialTest(k: number, n: number, p: number, side: BinomialSide): number {
  whole("binomialTest", k);
  whole("binomialTest", n);
  if (k > n) throw new RangeError(`binomialTest: k ${k} is more than n ${n}.`);
  if (!(p >= 0 && p <= 1)) throw new RangeError(`binomialTest: p is from 0 to 1, not ${p}.`);
  if (side !== "less" && side !== "greater") throw new RangeError(`binomialTest: side is "less" or "greater", not ${String(side)}.`);
  const [from, to] = side === "less" ? [0, k] : [k, n];
  if (from === 0 && to === n) return 1;
  if (p === 0) return from === 0 ? 1 : 0;
  if (p === 1) return to === n ? 1 : 0;
  const [logP, logQ] = [Math.log(p), Math.log1p(-p)];
  const logs: number[] = [];
  let logChoose = 0;
  for (let i = 0; i <= to; i++) {
    if (i > 0) logChoose += Math.log((n - i + 1) / i);
    if (i >= from) logs.push(logChoose + i * logP + (n - i) * logQ);
  }
  // A spread of the logs into Math.max overflows the stack above about 120 000 terms.
  const top = logs.reduce((max, l) => Math.max(max, l), Number.NEGATIVE_INFINITY);
  const sum = logs.reduce((s, l) => s + Math.exp(l - top), 0);
  return Math.min(1, Math.exp(top) * sum);
}

/** The smallest normal double, 2^-1022. The Poisson binomial law counts a smaller chance as 0. */
const SMALLEST_NORMAL = 2 ** -1022;

/** This function gives the Poisson binomial law of `ps`, after it examines each chance. */
export function poissonBinomialOf(name: string, ps: readonly number[]): Float64Array {
  for (const p of ps) if (!(p >= 0 && p <= 1)) throw new RangeError(`${name}: each p is from 0 to 1, not ${p}.`);
  const chances = new Float64Array(ps.length + 1);
  chances[0] = 1;
  // Each count from lo to hi has a chance of 2^-1022 or more. Each other count has the chance 0.
  let [lo, hi] = [0, 0];
  for (const p of ps) {
    const q = 1 - p;
    // The loop goes down, so chances[k - 1] is the value from before this trial.
    for (let k = hi + 1; k > lo; k--) chances[k] = q * (chances[k] ?? 0) + p * (chances[k - 1] ?? 0);
    chances[lo] = q * (chances[lo] ?? 0);
    hi++;
    // A chance under 2^-1022 has fewer digits, and its arithmetic is slow. The sum of the law keeps at least one count.
    while (lo < hi && (chances[lo] ?? 0) < SMALLEST_NORMAL) chances[lo++] = 0;
    while (hi > lo && (chances[hi] ?? 0) < SMALLEST_NORMAL) chances[hi--] = 0;
  }
  return chances;
}

/** This function gives `P(X <= k)` and `P(X >= k)` of a law. Each sum starts at the far end of its tail. */
export function tailsOf(chances: ArrayLike<number>, k: number): readonly [number, number] {
  let [less, greater] = [0, 0];
  for (let i = 0; i <= k; i++) less += chances[i] ?? 0;
  for (let i = chances.length - 1; i >= k; i--) greater += chances[i] ?? 0;
  return [k === chances.length - 1 ? 1 : Math.min(1, less), k === 0 ? 1 : Math.min(1, greater)];
}

/**
 * This function gives the chance of each count of successes of independent trials. The trial `i` has the chance
 * `ps[i]` of a success. This law is the Poisson binomial law. When each chance is `p`, it is the law Binomial(n, p).
 *
 * The recursion adds one trial at each step. The new chance of k is `(1 - p)` times the old chance of k, plus `p` times
 * the old chance of k - 1. Each step adds two positive numbers, so the chances keep their digits. A chance under
 * 2^-1022, the smallest normal double, is 0 in the result. The time grows as n times the count of the other counts.
 *
 * @param ps - The chance of a success of each trial, from 0 to 1.
 * @returns The chance of each count k from 0 to n, with n the length of `ps`. The list has n + 1 numbers.
 */
export function poissonBinomial(ps: readonly number[]): number[] {
  return Array.from(poissonBinomialOf("poissonBinomial", ps));
}

/**
 * This function gives the p of the exact one-sided test of `k` successes of independent trials. The trial `i` has the
 * chance `ps[i]` of a success. The side `"less"` gives `P(X <= k)`, and the side `"greater"` gives `P(X >= k)`. When
 * each chance is `p`, the result is equal to `binomialTest(k, ps.length, p, side)`. The law comes from `poissonBinomial`.
 *
 * @param k - The count of successes, a whole number from 0 to the length of `ps`.
 * @param ps - The chance of a success of each trial, from 0 to 1.
 * @param side - The side of the tail.
 * @returns The p of the test, from 0 to 1.
 */
export function poissonBinomialTest(k: number, ps: readonly number[], side: BinomialSide): number {
  whole("poissonBinomialTest", k);
  if (k > ps.length) throw new RangeError(`poissonBinomialTest: k ${k} is more than the count of trials ${ps.length}.`);
  if (side !== "less" && side !== "greater") throw new RangeError(`poissonBinomialTest: side is "less" or "greater", not ${String(side)}.`);
  const [less, greater] = tailsOf(poissonBinomialOf("poissonBinomialTest", ps), k);
  return side === "less" ? less : greater;
}

/**
 * This function halves the range from 0 to `top` until its ends are two adjacent doubles, and it gives the two ends. The
 * test `rootAbove(x)` is true when the root is above x. The test must be monotone in x.
 */
function bisect(rootAbove: (x: number) => boolean, top = 1): readonly [number, number] {
  let [lo, hi] = [0, top];
  for (;;) {
    const middle = lo + (hi - lo) / 2;
    if (middle <= lo || middle >= hi) return [lo, hi];
    if (rootAbove(middle)) lo = middle;
    else hi = middle;
  }
}

/**
 * This function gives the Clopper-Pearson interval of `k` successes in `n` trials (Clopper and Pearson, 1934). It is the
 * exact two-sided interval of a proportion. Let X ~ Binomial(n, p). `high` is the p with P(X <= k) = (1 - level) / 2.
 * `low` is the p with P(X >= k) = (1 - level) / 2.
 *
 * The coverage of the interval is `level` or more at each p, so it is wider than `wilson`. For k = 0, `low` is 0 and
 * `high` is 1 - ((1 - level) / 2)^(1 / n). For k = n, `high` is 1 and `low` is ((1 - level) / 2)^(1 / n). For n = 0, the
 * interval is 0 to 1.
 *
 * For a different k, a bisection on `binomialTest` finds each end to two adjacent doubles. The function gives the outer
 * double of each pair, so the bisection does not make the interval narrower. Each end uses `binomialTest` approximately
 * 53 + log2(1 / end) times, and each use reads up to n + 1 terms.
 *
 * @param k - The count of successes, a whole number from 0 to `n`.
 * @param n - The count of trials, a whole number of 0 or more.
 * @param level - The level of the interval, more than 0 and less than 1.
 * @returns The interval, from `low` to `high`.
 */
export function clopperPearson(k: number, n: number, level = 0.95): Proportion {
  whole("clopperPearson", k);
  whole("clopperPearson", n);
  if (k > n) throw new RangeError(`clopperPearson: k ${k} is more than n ${n}.`);
  const tail = levelOf("clopperPearson", level);
  if (n === 0) return { low: 0, high: 1 };
  // P(X >= k) grows with p, and P(X <= k) falls with p. The expm1 keeps the digits of a high end near 0.
  const low = k === 0 ? 0 : k === n ? Math.exp(Math.log(tail) / n) : bisect((p) => binomialTest(k, n, p, "greater") < tail)[0];
  const high = k === n ? 1 : k === 0 ? -Math.expm1(Math.log(tail) / n) : bisect((p) => binomialTest(k, n, p, "less") > tail)[1];
  return { low, high };
}

/** The prior of the proportion mean: Jeffreys is Beta(1/2, 1/2), and Laplace is Beta(1, 1), the uniform prior. */
export type ProportionPrior = "jeffreys" | "laplace";

/**
 * The posterior mean of a proportion after `k` successes in `n` trials, under a Beta prior. Jeffreys gives
 * (k + 1/2) / (n + 1), and Laplace (the rule of succession) gives (k + 1) / (n + 2). Unlike k / n, it is not 0 or 1 at
 * k = 0 or k = n. Unlike the low end of an interval, it does not fall when a record is short. Use it for a point
 * value, and an interval for a bound. For n = 0 it is 1/2.
 *
 * @param k - The count of successes, a whole number from 0 to `n`.
 * @param n - The count of trials, a whole number of 0 or more.
 * @param prior - The prior, `jeffreys` (the default) or `laplace`.
 * @returns The posterior mean, from 0 to 1.
 */
export function proportionMean(k: number, n: number, prior: ProportionPrior = "jeffreys"): number {
  whole("proportionMean", k);
  whole("proportionMean", n);
  if (k > n) throw new RangeError(`proportionMean: k ${k} is more than n ${n}.`);
  if (prior !== "jeffreys" && prior !== "laplace") throw new RangeError(`proportionMean: the prior ${String(prior)} is not jeffreys or laplace.`);
  const a = prior === "jeffreys" ? 0.5 : 1;
  return (k + a) / (n + 2 * a);
}

/** An interval of a rate: a count of events in an exposure, for example a count of events in 10 years. */
export interface RateInterval {
  readonly low: number;
  readonly high: number;
}

/** The sum of the exponentials of the logs. The sum starts from the largest term, so a small sum keeps its digits. */
function sumOfLogs(logs: readonly number[]): number {
  const top = logs.reduce((max, l) => Math.max(max, l), Number.NEGATIVE_INFINITY);
  if (top === Number.NEGATIVE_INFINITY) return 0;
  return Math.exp(top) * logs.reduce((s, l) => s + Math.exp(l - top), 0);
}

/**
 * This function gives a tail of X ~ Poisson(mean), for a mean more than 0. The side `"less"` gives `P(X <= k)`, and the side
 * `"greater"` gives `P(X >= k)`. The log of each factorial is a sum of logs, so the terms need no gamma function.
 */
function poissonTail(k: number, mean: number, side: BinomialSide): number {
  const logMean = Math.log(mean);
  if (side === "greater") {
    // Up to the mean, and at k = 0, the tail is large, so 1 - P(X <= k - 1) keeps its digits. P(X <= -1) is 0.
    if (k <= mean) return Math.max(0, 1 - poissonTail(k - 1, mean, "less"));
    // Above the mean, the terms fall from k. The sum stops when a term is below e^-45 of the first term.
    let logFactorial = 0;
    for (let i = 2; i <= k; i++) logFactorial += Math.log(i);
    const first = k * logMean - mean - logFactorial;
    const logs: number[] = [];
    for (let i = k, log = first; log > first - 45; i++) {
      logs.push(log);
      log += logMean - Math.log(i + 1);
    }
    return Math.min(1, sumOfLogs(logs));
  }
  const logs: number[] = [];
  let logFactorial = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logFactorial += Math.log(i);
    logs.push(i * logMean - mean - logFactorial);
  }
  return Math.min(1, sumOfLogs(logs));
}

/**
 * This function gives the exact interval of a Poisson rate (Garwood, 1936): `k` events in an exposure of `exposure` units.
 * Let X ~ Poisson(m). The high end of m is the m with P(X <= k) = (1 - level) / 2. The low end is the m with
 * P(X >= k) = (1 - level) / 2. The function divides each end by `exposure`.
 *
 * The coverage of the interval is `level` or more at each rate, so a small count gets a wide interval. For k = 0, `low` is 0
 * and `high` is -ln((1 - level) / 2) / exposure. The interval is the limit of n times `clopperPearson(k, n, level)` when n grows.
 *
 * For a different k, a bisection on the tails finds each end of m to two adjacent doubles. The function gives the outer
 * double of each pair, so the bisection does not make the interval narrower. The division by `exposure` rounds to the
 * nearest double. Each end sums a tail approximately 60 + log2(k) times, and each sum reads approximately k terms or fewer.
 *
 * @param k - The count of events, a whole number of 0 or more.
 * @param exposure - The exposure of the count, for example a count of years, a finite number more than 0.
 * @param level - The level of the interval, more than 0 and less than 1.
 * @returns The interval of the rate, from `low` to `high`.
 */
export function poissonInterval(k: number, exposure = 1, level = 0.95): RateInterval {
  whole("poissonInterval", k);
  if (!(exposure > 0 && Number.isFinite(exposure))) {
    throw new RangeError(`poissonInterval: the exposure is a finite number more than 0, not ${exposure}.`);
  }
  const tail = levelOf("poissonInterval", level);
  if (k === 0) return { low: 0, high: -Math.log(tail) / exposure };
  // P(X <= k) falls as m grows, so the doubling ends at a top above the high end. P(X >= k) at m = k is more than the
  // tail, so the low end is below k and below the top too.
  let top = k + 1;
  while (poissonTail(k, top, "less") > tail) top *= 2;
  const low = bisect((m) => poissonTail(k, m, "greater") < tail, top)[0];
  const high = bisect((m) => poissonTail(k, m, "less") > tail, top)[1];
  return { low: low / exposure, high: high / exposure };
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
