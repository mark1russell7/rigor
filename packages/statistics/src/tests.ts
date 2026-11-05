/**
 * The tests of a difference: the sign test, the paired permutation test, the Wilson interval of a proportion and
 * the Holm correction for several tests.
 */
import { random } from "@mark1russell7/rigor-generators";
import { mean } from "./describe.ts";

function whole(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name}: ${value} is not a whole number of 0 or more.`);
}

/** The log of each binomial term C(n, k) / 2^n, for each k from 0 to n. */
function halfBinomialLogs(n: number): number[] {
  const logs: number[] = [];
  let logChoose = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) logChoose += Math.log((n - i + 1) / i);
    logs.push(logChoose - n * Math.LN2);
  }
  return logs;
}

/** P(X >= k) for X ~ Binomial(n, 1/2), summed from the largest term so that a small tail keeps its digits. */
function upperTail(k: number, n: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  const logs = halfBinomialLogs(n).slice(k);
  const top = Math.max(...logs);
  const sum = logs.reduce((s, l) => s + Math.exp(l - top), 0);
  return Math.min(1, Math.exp(top) * sum);
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
  for (let k = Math.ceil(n / 2); k <= n; k++) if (signTest(k, n - k, sides) < level) return k;
  return undefined;
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
