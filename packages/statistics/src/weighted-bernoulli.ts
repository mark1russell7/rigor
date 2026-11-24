/**
 * The tail of a weighted sum of independent trials. The trial `i` has the chance `ps[i]` of a success and the weight
 * `weights[i]`. The sum S is the sum of the weights of the successes. When each weight is 1, S has the Poisson binomial
 * law (`poissonBinomial`).
 *
 * The weights are real numbers, so the law of S has up to 2^n values. This module rounds each weight onto a grid, down
 * for one bound and up for the other. Thus each result is a pair of bounds of the exact chance, not an estimate.
 */
import { poissonBinomialTest } from "./discrete.ts";

/** The bounds of the chance `P(S >= threshold)` of a weighted sum. The exact chance is from `low` to `high`. */
export interface WeightedTail {
  /** The lower bound, from 0 to 1. */
  readonly low: number;
  /** The upper bound, from `low` to 1. A test that rejects only when `high` is small keeps its level. */
  readonly high: number;
}

/** The options of `weightedBernoulliTest`. */
export interface WeightedTailOptions {
  /** The count of grid steps up to the largest weight, a whole number from 1 to 1 000 000. The default is 1024. */
  readonly cells?: number;
}

/** The default count of grid steps up to the largest weight. */
export const WEIGHTED_TAIL_CELLS = 1024;

/** The smallest normal double, 2^-1022. The law counts a smaller chance as 0, as `poissonBinomial` does. */
const SMALLEST_NORMAL = 2 ** -1022;

/**
 * The relative tolerance of the threshold. A sum within this part of the threshold counts as the threshold. Thus the
 * rounding of a threshold that is a sum of the same weights does not remove the outcome of the threshold.
 */
export const WEIGHTED_TAIL_TOLERANCE = 1e-12;

/**
 * This function gives the chance that a sum of whole steps is `k` or more. The trial `i` adds `steps[i]` on a success.
 * The recursion adds one trial at each step, as `poissonBinomial` does.
 */
function stepTail(ps: readonly number[], steps: readonly number[], k: number): number {
  if (k <= 0) return 1;
  const total = steps.reduce((sum, step) => sum + step, 0);
  if (k > total) return 0;
  const chances = new Float64Array(total + 1);
  chances[0] = 1;
  let hi = 0;
  ps.forEach((p, i) => {
    const step = steps[i] ?? 0;
    if (step === 0 || p === 0) return;
    const q = 1 - p;
    // The loop goes down, so chances[s - step] is the value from before this trial.
    for (let s = hi + step; s >= step; s--) chances[s] = q * (chances[s] ?? 0) + p * (chances[s - step] ?? 0);
    for (let s = Math.min(step, hi + 1) - 1; s >= 0; s--) chances[s] = q * (chances[s] ?? 0);
    hi += step;
    for (let s = 0; s <= hi; s++) if ((chances[s] ?? 0) < SMALLEST_NORMAL) chances[s] = 0;
  });
  let tail = 0;
  for (let s = hi; s >= k; s--) tail += chances[s] ?? 0;
  return Math.min(1, tail);
}

/**
 * This function gives the bounds of `P(S >= threshold)`, with S the sum of the weights of the successes of independent
 * trials. The trial `i` has the chance `ps[i]` of a success and the weight `weights[i]`.
 *
 * - The grid step is the largest weight over `cells`. Each weight goes down onto the grid for `low` and up for `high`.
 *   Thus `low <= P(S >= threshold) <= high`, and more cells give closer bounds.
 * - A weight equal to the largest weight is on the grid. Thus, when each weight is equal, `low` and `high` are equal to
 *   `poissonBinomialTest(k, ps, "greater")`, with k the count of weights that reach the threshold.
 * - The time grows as n times n times `cells`, and the memory as n times `cells`.
 * - A sum within the relative `WEIGHTED_TAIL_TOLERANCE` of the threshold counts as the threshold.
 * - The order of the trials does not change the result.
 *
 * @param threshold - The value of the sum, a finite number. A threshold of 0 or less gives 1.
 * @param ps - The chance of a success of each trial, from 0 to 1.
 * @param weights - The weight of each trial, a finite number of 0 or more. The list has the length of `ps`.
 * @param options - The count of grid steps.
 * @returns The two bounds of the chance.
 */
export function weightedBernoulliTest(threshold: number, ps: readonly number[], weights: readonly number[], options: WeightedTailOptions = {}): WeightedTail {
  const cells = options.cells ?? WEIGHTED_TAIL_CELLS;
  if (!Number.isSafeInteger(cells) || cells < 1 || cells > 1_000_000) throw new RangeError(`weightedBernoulliTest: cells is a whole number from 1 to 1000000, not ${cells}.`);
  if (!Number.isFinite(threshold)) throw new RangeError(`weightedBernoulliTest: the threshold is a finite number, not ${threshold}.`);
  if (ps.length !== weights.length) throw new RangeError(`weightedBernoulliTest: ${ps.length} chances and ${weights.length} weights.`);
  for (const p of ps) if (!(p >= 0 && p <= 1)) throw new RangeError(`weightedBernoulliTest: each p is from 0 to 1, not ${p}.`);
  for (const w of weights) if (!(w >= 0 && Number.isFinite(w))) throw new RangeError(`weightedBernoulliTest: each weight is a finite number of 0 or more, not ${w}.`);
  if (threshold <= 0) return { low: 1, high: 1 };
  const top = weights.reduce((max, w) => Math.max(max, w), 0);
  if (top === 0) return { low: 0, high: 0 };
  // Equal weights: the count of successes has the Poisson binomial law.
  if (weights.every((w) => w === top)) {
    const k = Math.ceil((threshold / top) * (1 - WEIGHTED_TAIL_TOLERANCE));
    const p = k > ps.length ? 0 : poissonBinomialTest(Math.max(0, k), ps, "greater");
    return { low: p, high: p };
  }
  const step = top / cells;
  const down = weights.map((w) => (w === top ? cells : Math.floor(w / step)));
  const up = weights.map((w) => (w === top ? cells : Math.ceil(w / step)));
  const k = Math.ceil((threshold / step) * (1 - WEIGHTED_TAIL_TOLERANCE));
  const low = stepTail(ps, down, k);
  const high = stepTail(ps, up, k);
  return { low: Math.min(low, high), high };
}
