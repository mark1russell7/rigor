/**
 * The tests of a difference: the sign test, the paired permutation test, the Wilson interval of a proportion and
 * the Holm correction for several tests.
 */
import { random } from "@mark1russell7/rigor-generators";
import { mean, median } from "./describe.ts";

function whole(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name}: ${value} is not a whole number of 0 or more.`);
}

const TWO_512 = 2 ** 512;

/** C(n, k) / 2^n, as one product of min(k, n - k) ratios, with the powers of 2 kept apart so that no step overflows. */
function halfBinomial(k: number, n: number): number {
  const m = Math.min(k, n - k);
  let value = 1;
  let exponent = -n;
  for (let i = 1; i <= m; i++) {
    value *= (n - m + i) / i;
    if (value > TWO_512) {
      value /= TWO_512;
      exponent += 512;
    }
  }
  for (; exponent < -512; exponent += 512) value /= TWO_512;
  return value * 2 ** exponent;
}

/** The largest n for which the tail is an exact sum of whole numbers. Above it, the sum is in floating point. */
const SIGN_TEST_EXACT_LIMIT = 4096;

/** num / 2^n as the nearest double: one rounding, also when num has more than 1024 bits. */
function overPowerOfTwo(num: bigint, n: number): number {
  const shift = Math.max(0, num.toString(2).length - 1000);
  let value = Number(num >> BigInt(shift));
  let exponent = shift - n;
  for (; exponent < -512; exponent += 512) value /= TWO_512;
  return value * 2 ** exponent;
}

/**
 * P(X >= k) for X ~ Binomial(n, 1/2). For n up to SIGN_TEST_EXACT_LIMIT it adds C(n, i) as whole numbers (BigInt),
 * so the only error is the last rounding to a double. Above the limit and above the middle, it adds the terms as
 * ratios of term k in linear space. At or below the middle, it gives 1 - P(X >= n - k + 1), by symmetry. (An earlier form added
 * logs and called Math.exp, and its error grew with n: up to 2.5e-14 for n <= 80, rigor#158. The floating-point
 * form above the limit was at most 1.1e-14 relative at n = 4097 and 5000, above 2^-1000.)
 */
function upperTail(k: number, n: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (n <= SIGN_TEST_EXACT_LIMIT) {
    const big = BigInt(n);
    let term = 1n;
    for (let i = 1n; i <= BigInt(k); i++) term = (term * (big - i + 1n)) / i;
    let sum = 0n;
    for (let i = BigInt(k); i <= big; i++) {
      sum += term;
      term = (term * (big - i)) / (i + 1n);
    }
    return Math.min(1, overPowerOfTwo(sum, n));
  }
  if (2 * k <= n) return 1 - upperTail(n - k + 1, n);
  let ratio = 1;
  let sum = 1;
  for (let i = k; i < n && ratio > 0; i++) {
    ratio *= (n - i) / (i + 1);
    sum += ratio;
  }
  return Math.min(1, halfBinomial(k, n) * sum);
}

/**
 * The sign test of paired results: `better` inputs where the candidate wins and `worse` where it loses. The ties
 * do not count. One-sided (the default), it is the p of `better` wins or more if the two are equal. Two-sided, it is
 * two times the tail of the larger count, at most 1. The one-sided p is equal to `signTestP` of packing.
 */
export function signTest(better: number, worse: number, sides: 1 | 2 = 1): number {
  whole("signTest", better);
  whole("signTest", worse);
  const n = better + worse;
  if (n === 0) return 1;
  if (sides === 1) return upperTail(better, n);
  return Math.min(1, 2 * upperTail(Math.max(better, worse), n));
}

/**
 * The smallest number of wins out of `n` that the sign test calls significant at `level`. It is undefined when even
 * n wins out of n are not enough. Use it before a run, to know how many inputs a claim needs.
 */
export function signTestPower(n: number, level = 0.05, sides: 1 | 2 = 2): number | undefined {
  whole("signTestPower", n);
  // The p falls as k grows above the middle, so a binary search finds the first k under the level.
  if (n === 0 || signTest(n, 0, sides) >= level) return undefined;
  let low = Math.ceil(n / 2);
  let high = n;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (signTest(middle, n - middle, sides) < level) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The z of a two-sided 95% interval. */
export const Z95 = 1.959963984540054;

/** An interval of a proportion. */
export interface Proportion {
  readonly low: number;
  readonly high: number;
}

/**
 * The Wilson score interval of `k` successes in `n` trials (Wilson, 1927). It keeps its level for a small n and for
 * a proportion near 0 or 1, where the normal interval does not. For n = 0 the interval is 0 to 1.
 */
export function wilson(k: number, n: number, z: number = Z95): Proportion {
  whole("wilson", k);
  whole("wilson", n);
  if (k > n) throw new RangeError(`wilson: k ${k} is more than n ${n}.`);
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** One test after the Holm correction. */
export interface Corrected {
  /** The p of the test. */
  readonly p: number;
  /** The p after the correction: compare it with the level of the whole family. */
  readonly adjusted: number;
  /** The adjusted p is less than the level. */
  readonly reject: boolean;
}

/**
 * The Holm step-down correction of a family of tests (Holm, 1979). It keeps the chance of one false claim or more
 * in the family at most `level`. It has no condition on how the tests depend on each other. The result is in the
 * order of the input.
 */
export function holm(pValues: readonly number[], level = 0.05): Corrected[] {
  for (const p of pValues) if (!(p >= 0 && p <= 1)) throw new RangeError(`holm: each p is from 0 to 1, not ${p}.`);
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  const adjusted = new Array<number>(m);
  let running = 0;
  order.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    adjusted[i] = running;
  });
  return pValues.map((p, i) => ({ p, adjusted: adjusted[i] as number, reject: (adjusted[i] as number) < level }));
}

/**
 * The p of the claim "at least `need` of these tests have a real effect" (Benjamini and Heller, 2008). The value is
 * `(m - need + 1)` times the `need`-th smallest p, at most 1. It has no condition on how the tests depend on each other.
 * With 2 tests and `need` 2, the value is the larger p.
 */
export function partialConjunction(pValues: readonly number[], need: number): number {
  for (const p of pValues) if (!(p >= 0 && p <= 1)) throw new RangeError(`partialConjunction: each p is from 0 to 1, not ${p}.`);
  whole("partialConjunction", need);
  const m = pValues.length;
  if (need < 1 || need > m) throw new RangeError(`partialConjunction: need is from 1 to the count of tests ${m}, not ${need}.`);
  const sorted = [...pValues].sort((a, b) => a - b);
  return Math.min(1, (m - need + 1) * (sorted[need - 1] as number));
}

export interface PermutationOptions {
  /** The number of random sign flips. The default is 10 000. */
  readonly runs?: number;
  /** The default is 1. */
  readonly seed?: number | string;
  /** The statistic of the differences. The default is the mean. */
  readonly statistic?: (differences: readonly number[]) => number;
}

export interface PermutationResult {
  /** The statistic of the observed differences `candidate[i] - baseline[i]`. */
  readonly observed: number;
  /** The two-sided p: (1 + the flips with a statistic as far from 0 or farther) / (1 + runs). */
  readonly p: number;
  readonly runs: number;
}

/**
 * The paired permutation test (a random sign flip of each difference). It needs no normal distribution and uses
 * the size of each difference, which the sign test does not. A pair with a difference of 0 adds nothing.
 */
export function pairedPermutation(candidate: readonly number[], baseline: readonly number[], options: PermutationOptions = {}): PermutationResult {
  if (candidate.length !== baseline.length) throw new RangeError(`pairedPermutation: the lists have ${candidate.length} and ${baseline.length} values.`);
  const differences = candidate.map((c, i) => c - (baseline[i] as number));
  const statistic = options.statistic ?? mean;
  const runs = options.runs ?? 10_000;
  if (!Number.isSafeInteger(runs) || runs < 1) throw new RangeError(`pairedPermutation: runs is a whole number of 1 or more, not ${runs}.`);
  const observed = statistic(differences);
  const r = random(options.seed ?? 1);
  const flipped = new Array<number>(differences.length);
  let extreme = 0;
  for (let run = 0; run < runs; run++) {
    for (let i = 0; i < differences.length; i++) flipped[i] = r.next() < 0.5 ? -(differences[i] as number) : (differences[i] as number);
    // A small tolerance, so that a flip with the same statistic up to rounding counts as extreme.
    if (Math.abs(statistic(flipped)) >= Math.abs(observed) * (1 - 1e-12)) extreme++;
  }
  return { observed, p: (1 + extreme) / (1 + runs), runs };
}

/** The default of the option `exactMax` of `signFlipTest`. */
export const SIGN_FLIP_EXACT_MAX = 16;

/** The largest value of the option `exactMax` of `signFlipTest`: 2^24 sign sets. */
export const SIGN_FLIP_EXACT_LIMIT = 24;

/** The options of `signFlipTest`. */
export interface SignFlipOptions {
  /** The largest count of terms for which the test reads each of the `2^n` sign sets. The default is 16. The most is 24. */
  readonly exactMax?: number;
  /** The count of random sign sets above `exactMax`. The default is 10 000. */
  readonly runs?: number;
  /** The default is 1. */
  readonly seed?: number | string;
}

/** The result of `signFlipTest`. */
export interface SignFlipResult {
  /** The absolute value of the sum of the terms. */
  readonly observed: number;
  /** The two-sided p. */
  readonly p: number;
  /** This field is true when the test read each sign set, so the p has no noise from the draws. */
  readonly exact: boolean;
  /** The count of the sign sets that the test read: `2^n` when it is exact, otherwise the count of the draws. */
  readonly runs: number;
}

/**
 * The sign-flip test of a sum of terms. Under the null, each term has the sign + or - with equal chance. The statistic
 * is the absolute value of the sum. A weighted mean of paired differences is such a sum: give the terms `w[i] * d[i]`.
 *
 * Up to `exactMax` terms, the test reads each sign set. The p is the share of the sets that are as far from 0 or
 * farther. The observed set is one of them. Above `exactMax`, the test draws `runs` sets, and the p is (1 + the extreme
 * draws) / (1 + runs). A sum within `1e-12` of the sum of the absolute terms counts as extreme, so rounding does not
 * hide a tie.
 */
export function signFlipTest(terms: readonly number[], options: SignFlipOptions = {}): SignFlipResult {
  const exactMax = options.exactMax ?? SIGN_FLIP_EXACT_MAX;
  if (!Number.isInteger(exactMax) || exactMax < 0 || exactMax > SIGN_FLIP_EXACT_LIMIT) {
    throw new RangeError(`signFlipTest: exactMax is a whole number from 0 to ${SIGN_FLIP_EXACT_LIMIT}, not ${exactMax}.`);
  }
  for (const [i, t] of terms.entries()) if (!Number.isFinite(t)) throw new RangeError(`signFlipTest: the term ${i} is ${t}, not a finite number.`);
  const n = terms.length;
  const observed = Math.abs(terms.reduce((sum, t) => sum + t, 0));
  const slack = 1e-12 * terms.reduce((sum, t) => sum + Math.abs(t), 0);
  if (n <= exactMax) {
    const total = 2 ** n;
    let hits = 0;
    for (let mask = 0; mask < total; mask++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += mask & (1 << i) ? -(terms[i] as number) : (terms[i] as number);
      if (Math.abs(sum) >= observed - slack) hits++;
    }
    return { observed, p: hits / total, exact: true, runs: total };
  }
  const runs = options.runs ?? 10_000;
  if (!Number.isSafeInteger(runs) || runs < 1) throw new RangeError(`signFlipTest: runs is a whole number of 1 or more, not ${runs}.`);
  const r = random(options.seed ?? 1);
  let hits = 0;
  for (let run = 0; run < runs; run++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += r.next() < 0.5 ? -(terms[i] as number) : (terms[i] as number);
    if (Math.abs(sum) >= observed - slack) hits++;
  }
  return { observed, p: (1 + hits) / (1 + runs), exact: false, runs };
}

/** The options of `twoSamplePermutation`. */
export interface TwoSamplePermutationOptions {
  /** The largest number of splits that the test reads. The default is 10 000. */
  readonly runs?: number;
  /** The default is 1. */
  readonly seed?: number | string;
  /** The statistic of the two groups. The default is the median of `a` minus the median of `b`. */
  readonly statistic?: (a: readonly number[], b: readonly number[]) => number;
}

/** The result of `twoSamplePermutation`. */
export interface TwoSamplePermutationResult extends PermutationResult {
  /** This field is true when the test read each split, so the p has no noise from the draws. */
  readonly exact: boolean;
}

/** This function gives the count of the ways to choose `k` of `n`, or Infinity when the count is over `limit`. */
function choices(n: number, k: number, limit: number): number {
  const small = Math.min(k, n - k);
  let count = 1;
  for (let i = 1; i <= small; i++) {
    // The product of i consecutive whole numbers divides by i!, so each step gives a whole number.
    count = (count * (n - small + i)) / i;
    if (count > limit) return Number.POSITIVE_INFINITY;
  }
  return count;
}

/** This function counts the splits of `pool` into a first group of `size` values that pass the test `extreme`, over each split. */
function countEachSplit(pool: readonly number[], size: number, extreme: (a: readonly number[], b: readonly number[]) => boolean): number {
  const chosen = Array.from({ length: size }, (_, i) => i);
  let count = 0;
  for (;;) {
    const a: number[] = [];
    const b: number[] = [];
    for (const [i, value] of pool.entries()) (chosen[a.length] === i ? a : b).push(value);
    if (extreme(a, b)) count++;
    let place = size - 1;
    while (place >= 0 && chosen[place] === pool.length - size + place) place--;
    if (place < 0) return count;
    let index = (chosen[place] as number) + 1;
    for (let j = place; j < size; j++) chosen[j] = index++;
  }
}

/**
 * The two-sample permutation test (a split of the pooled values). It needs no normal distribution and no pairs, so it
 * compares groups of different sizes. The p holds only if the values of the two groups can change places under the null.
 *
 * When the count of the splits is `runs` or less, the test reads each split, and the p is exact. Otherwise it draws `runs`
 * random splits. A drawn p has noise: a level of 0.001 is 10 counts at 10 000 runs. So give enough runs for a small level.
 */
export function twoSamplePermutation(a: readonly number[], b: readonly number[], options: TwoSamplePermutationOptions = {}): TwoSamplePermutationResult {
  if (a.length === 0 || b.length === 0) throw new RangeError(`twoSamplePermutation: the groups have ${a.length} and ${b.length} values, and each group needs one or more.`);
  const statistic = options.statistic ?? ((x: readonly number[], y: readonly number[]): number => median(x) - median(y));
  const runs = options.runs ?? 10_000;
  if (!Number.isSafeInteger(runs) || runs < 1) throw new RangeError(`twoSamplePermutation: runs is a whole number of 1 or more, not ${runs}.`);
  const observed = statistic(a, b);
  const pool = [...a, ...b];
  // The same tolerance as `pairedPermutation`: a split with the same statistic up to rounding counts as extreme.
  const isExtreme = (x: readonly number[], y: readonly number[]): boolean => Math.abs(statistic(x, y)) >= Math.abs(observed) * (1 - 1e-12);
  const splits = choices(pool.length, a.length, runs);
  if (Number.isFinite(splits)) return { observed, p: countEachSplit(pool, a.length, isExtreme) / splits, runs: splits, exact: true };
  const r = random(options.seed ?? 1);
  let extreme = 0;
  for (let run = 0; run < runs; run++) {
    // The first a.length places of a partial Fisher-Yates shuffle are a uniform choice of the first group.
    for (let i = 0; i < a.length; i++) {
      const j = i + Math.floor(r.next() * (pool.length - i));
      const held = pool[i] as number;
      pool[i] = pool[j] as number;
      pool[j] = held;
    }
    if (isExtreme(pool.slice(0, a.length), pool.slice(a.length))) extreme++;
  }
  return { observed, p: (1 + extreme) / (1 + runs), runs, exact: false };
}

/**
 * The smallest number of trials `n` at which the Wilson lower end reaches `target`, when the true proportion is
 * `expected`. Each `n` takes `round(expected × n)` successes. The function gives `undefined` when `expected` is not
 * above `target`, or when no `n` up to `max` reaches it. An audit of an agreement uses it to fix its size.
 */
export function wilsonSampleSize(target: number, expected: number, z: number = Z95, max = 1_000_000): number | undefined {
  if (!(target >= 0 && target <= 1 && expected >= 0 && expected <= 1)) throw new RangeError(`wilsonSampleSize: target ${target} and expected ${expected} must be from 0 to 1.`);
  whole("wilsonSampleSize", max);
  if (expected <= target) return undefined;
  for (let n = 1; n <= max; n++) if (wilson(Math.round(expected * n), n, z).low >= target) return n;
  return undefined;
}
