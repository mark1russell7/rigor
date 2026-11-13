/**
 * The sparse Bradley-Terry fit. It has the model, the prior and the tie model of `bradleyTerry`, so the two fits have
 * one optimum. This fit keeps one record for each distinct pair of items, not a matrix of all the items. Thus its
 * memory is in proportion to the items and the pairs. The dense fit of 10,000 items keeps a Hessian of 800 MB.
 *
 * The fit is a majorization-minimization (MM) iteration on the negative log posterior. This is the MM method of a
 * minimum, the same as the minorization-maximization of the log posterior. Each step has three parts:
 *
 * 1. Each log-strength moves to the minimum of a separable quadratic bound. The bound uses the curvature 1/4 of the
 *    log-likelihood of a pair (Böhning and Lindsay, 1988).
 * 2. Each connected group of items moves together, so that its mean is the prior mean. A comparison does not change
 *    when its two strengths move together, so this move is exact.
 * 3. The log of the Davidson tie parameter moves to the minimum of the bound of Hunter (2004), with its prior.
 *
 * Each part makes the objective smaller or keeps it. The objective is strongly convex, so the steps go to its one
 * minimum. The fit stops when the gradient puts each parameter inside the tolerance of that minimum.
 */
import type { BradleyTerryFit, BradleyTerryOptions, PairComparison, TieModel } from "./bradley-terry.ts";

/** The options of `bradleyTerrySparse`. The prior and the tie model are the same as in `bradleyTerry`. */
export interface BradleyTerrySparseOptions extends BradleyTerryOptions {
  /** The largest number of MM steps. The default is 10000. */
  readonly maxIterations?: number;
  /**
   * The largest distance of the parameters from the exact optimum at the stop. The default is 1e-8. The distance is the
   * Euclidean norm over the log-strengths and the log of the tie parameter.
   */
  readonly tolerance?: number;
}

/** The result of `bradleyTerrySparse`. The lists have one value for each item, in the order of the indexes. */
export interface BradleyTerrySparseFit extends BradleyTerryFit {
  /**
   * The approximate standard error of each log-strength. For an item in a connected group of `n` items, the variance
   * is `1 / (n * p) + (1 - 1 / n) / h`. Here `p` is the prior precision, and `h` is the diagonal entry of the Hessian.
   * The first term is the variance of the mean of the group, which only the prior sets. An item with no comparison
   * has the prior SD, as in `bradleyTerry`.
   */
  readonly se: number[];
  /** The number of MM steps. */
  readonly iterations: number;
  /**
   * True when `bound` is the tolerance or less, or when the gradient is at the rounding level of floating point. At the
   * rounding level, a step gains nothing, but a weak prior can keep `bound` above the tolerance.
   */
  readonly converged: boolean;
  /**
   * An upper bound of the distance of the parameters from the exact optimum: the norm of the gradient over the
   * smallest prior precision. The objective is strongly convex, so this bound holds.
   */
  readonly bound: number;
  /** The number of distinct pairs of items with a comparison. The memory of the fit is in proportion to it. */
  readonly pairs: number;
}

/** The largest number of items. The key of a pair is `low * items + high`, and it must be a safe integer. */
const MAX_ITEMS = Math.floor(Math.sqrt(Number.MAX_SAFE_INTEGER));
const ROUNDING = 64 * Number.EPSILON;
const NAME = "bradleyTerrySparse";

/** The comparisons of each distinct pair, summed over the comparisons of the pair. */
interface Pairs {
  readonly count: number;
  /** The lower index of each pair. */
  readonly low: Int32Array;
  /** The higher index of each pair. */
  readonly high: Int32Array;
  /** The total weight of the comparisons of each pair. */
  readonly total: Float64Array;
  /** The weight of the wins of the lower item, minus the weight of the wins of the higher item. */
  readonly net: Float64Array;
  /** The weight of the Davidson ties of each pair. It is 0 with the tie model `"half"`. */
  readonly ties: Float64Array;
}

function positiveOption(label: string, value: number): void {
  if (!(value > 0 && Number.isFinite(value))) throw new RangeError(`${NAME}: ${label} is a finite number above 0, not ${value}.`);
}

/** This function checks the comparisons, and sums them for each distinct pair. A comparison with the weight 0 adds nothing. */
function pairsOf(items: number, comparisons: readonly PairComparison[], ties: TieModel): Pairs {
  const index = new Map<number, number>();
  const low: number[] = [];
  const high: number[] = [];
  const total: number[] = [];
  const net: number[] = [];
  const tie: number[] = [];
  for (const [i, comparison] of comparisons.entries()) {
    const { a, b, outcome } = comparison;
    const w = comparison.weight ?? 1;
    for (const item of [a, b]) {
      if (!Number.isSafeInteger(item) || item < 0 || item >= items) {
        throw new RangeError(`${NAME}: comparison ${i} has the index ${item}, and the indexes are whole numbers from 0 to ${items - 1}.`);
      }
    }
    if (a === b) throw new RangeError(`${NAME}: comparison ${i} compares the item ${a} with itself.`);
    if (outcome !== "a" && outcome !== "b" && outcome !== "tie") throw new RangeError(`${NAME}: comparison ${i} has the outcome ${String(outcome)}.`);
    if (!(w >= 0 && Number.isFinite(w))) throw new RangeError(`${NAME}: comparison ${i} has the weight ${w}, and a weight is a finite number of 0 or more.`);
    if (w === 0) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * items + hi;
    let p = index.get(key);
    if (p === undefined) {
      p = low.length;
      index.set(key, p);
      low.push(lo);
      high.push(hi);
      total.push(0);
      net.push(0);
      tie.push(0);
    }
    total[p] = (total[p] as number) + w;
    if (outcome === "tie") {
      if (ties === "davidson") tie[p] = (tie[p] as number) + w;
    } else {
      const winner = outcome === "a" ? a : b;
      net[p] = (net[p] as number) + (winner === lo ? w : -w);
    }
  }
  return {
    count: low.length,
    low: Int32Array.from(low),
    high: Int32Array.from(high),
    total: Float64Array.from(total),
    net: Float64Array.from(net),
    ties: Float64Array.from(tie),
  };
}

/** The connected groups of the items: the group of each item, and the size of each group. */
function groupsOf(items: number, pairs: Pairs): { group: Int32Array; size: Float64Array; count: number } {
  const parent = new Int32Array(items);
  for (let i = 0; i < items; i++) parent[i] = i;
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    // Path compression: each item on the path points to the root.
    for (let j = i; parent[j] !== r; ) {
      const next = parent[j] as number;
      parent[j] = r;
      j = next;
    }
    return r;
  };
  for (let p = 0; p < pairs.count; p++) {
    const x = root(pairs.low[p] as number);
    const y = root(pairs.high[p] as number);
    if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
  }
  const group = new Int32Array(items).fill(-1);
  const ids = new Int32Array(items).fill(-1);
  let count = 0;
  for (let i = 0; i < items; i++) {
    const r = root(i);
    if (ids[r] === -1) ids[r] = count++;
    group[i] = ids[r] as number;
  }
  const size = new Float64Array(count);
  for (let i = 0; i < items; i++) size[group[i] as number] = (size[group[i] as number] as number) + 1;
  return { group, size, count };
}

/**
 * The probabilities of the three outcomes of a pair with the difference `d` of the log-strengths, and the log of the
 * denominator `exp(d / 2) + exp(-d / 2) + nu`. The function writes them into `out`, so the loops make no objects.
 */
function outcomes(d: number, logNu: number, out: Float64Array): void {
  const half = d / 2;
  const top = Math.max(Math.abs(half), logNu);
  const ea = Math.exp(half - top);
  const eb = Math.exp(-half - top);
  const et = Math.exp(logNu - top);
  const sum = ea + eb + et;
  out[0] = ea / sum;
  out[1] = eb / sum;
  out[2] = et / sum;
  out[3] = top + Math.log(sum);
}

/**
 * The minimum over `z` of `s * exp(z) + tau * (lambda + z) ^ 2 / 2 - t * z`: the root of
 * `s * exp(z) + tau * z = t - tau * lambda`. The left side increases and is convex. Newton steps from a point right of
 * the root thus go down to the root, and they do not go past it.
 */
function tieStep(s: number, t: number, tau: number, lambda: number): number {
  const c = t - tau * lambda;
  if (s === 0) return c / tau;
  let z = c > 0 ? Math.max(0, Math.log(c / s)) : 0;
  for (let step = 0; step < 200; step++) {
    const ez = s * Math.exp(z);
    const move = (ez + tau * z - c) / (ez + tau);
    z -= move;
    if (!(Math.abs(move) > ROUNDING * (1 + Math.abs(z)))) break;
  }
  return z;
}

/**
 * The sparse Bradley-Terry fit of `comparisons` among `items` items. It has the model, the options and the checks of
 * `bradleyTerry`, and its memory is in proportion to `items` plus the distinct pairs. The function does not sort or
 * change its inputs. It throws a RangeError for a bad index, a bad outcome, a bad weight and a bad option.
 */
export function bradleyTerrySparse(items: number, comparisons: readonly PairComparison[], options: BradleyTerrySparseOptions = {}): BradleyTerrySparseFit {
  if (!Number.isSafeInteger(items) || items < 1 || items > MAX_ITEMS) {
    throw new RangeError(`${NAME}: the number of items is a whole number from 1 to ${MAX_ITEMS}, not ${items}.`);
  }
  const priorMean = options.priorMean ?? 0;
  const priorSd = options.priorSd ?? 1;
  const ties = options.ties ?? "davidson";
  const tiePriorSd = options.tiePriorSd ?? 10;
  const maxIterations = options.maxIterations ?? 10_000;
  const tolerance = options.tolerance ?? 1e-8;
  if (!Number.isFinite(priorMean)) throw new RangeError(`${NAME}: the prior mean is a finite number, not ${priorMean}.`);
  positiveOption("the prior SD", priorSd);
  positiveOption("the tie prior SD", tiePriorSd);
  positiveOption("the tolerance", tolerance);
  if (ties !== "davidson" && ties !== "half") throw new RangeError(`${NAME}: the tie model is "davidson" or "half", not ${String(ties)}.`);
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new RangeError(`${NAME}: maxIterations is a whole number of 1 or more, not ${maxIterations}.`);
  }

  const pairs = pairsOf(items, comparisons, ties);
  const { group, size, count: groupCount } = groupsOf(items, pairs);
  const p = 1 / (priorSd * priorSd);
  const tau = 1 / (tiePriorSd * tiePriorSd);
  let tieWeight = 0;
  let totalWeight = 0;
  const weight = new Float64Array(items);
  for (let q = 0; q < pairs.count; q++) {
    tieWeight += pairs.ties[q] as number;
    totalWeight += pairs.total[q] as number;
    weight[pairs.low[q] as number] = (weight[pairs.low[q] as number] as number) + (pairs.total[q] as number);
    weight[pairs.high[q] as number] = (weight[pairs.high[q] as number] as number) + (pairs.total[q] as number);
  }
  // The tie parameter is free only when a comparison is a Davidson tie. Else it is 0, and the model is plain Bradley-Terry.
  const fitTie = tieWeight > 0;
  const smallest = fitTie ? Math.min(p, tau) : p;
  // The gradient has a rounding error in proportion to the sum of its terms. Below this size, a step gains nothing.
  const floor = 4 * Number.EPSILON * (totalWeight + 1);

  const s = new Float64Array(items).fill(priorMean);
  const gradient = new Float64Array(items);
  const sums = new Float64Array(groupCount);
  const out = new Float64Array(4);
  let lambda = 0;
  let iterations = 0;
  let bound = Number.POSITIVE_INFINITY;
  let rounded = false;

  for (;;) {
    // The gradient of the negative log posterior at the current point.
    const logNu = fitTie ? lambda : Number.NEGATIVE_INFINITY;
    for (let i = 0; i < items; i++) gradient[i] = p * ((s[i] as number) - priorMean);
    let tieGradient = fitTie ? tau * lambda - tieWeight : 0;
    for (let q = 0; q < pairs.count; q++) {
      const lo = pairs.low[q] as number;
      const hi = pairs.high[q] as number;
      const total = pairs.total[q] as number;
      outcomes((s[lo] as number) - (s[hi] as number), logNu, out);
      const g = total * (((out[0] as number) - (out[1] as number)) / 2) - (pairs.net[q] as number) / 2;
      gradient[lo] = (gradient[lo] as number) + g;
      gradient[hi] = (gradient[hi] as number) - g;
      if (fitTie) tieGradient += total * (out[2] as number);
    }
    let norm = tieGradient * tieGradient;
    for (let i = 0; i < items; i++) norm += (gradient[i] as number) ** 2;
    norm = Math.sqrt(norm);
    bound = norm / smallest;
    rounded = norm <= floor;
    if (bound <= tolerance || rounded || iterations >= maxIterations) break;
    iterations++;

    // Part 1: the minimum of the separable quadratic bound. A pair adds total / 2 to the curvature of each of its items.
    for (let i = 0; i < items; i++) s[i] = (s[i] as number) - (gradient[i] as number) / ((weight[i] as number) / 2 + p);
    // Part 2: each connected group moves to the prior mean.
    sums.fill(0);
    for (let i = 0; i < items; i++) sums[group[i] as number] = (sums[group[i] as number] as number) + (s[i] as number);
    for (let i = 0; i < items; i++) s[i] = (s[i] as number) + priorMean - (sums[group[i] as number] as number) / (size[group[i] as number] as number);
    // Part 3: the log of the tie parameter, with the new strengths.
    if (fitTie) {
      let expected = 0;
      for (let q = 0; q < pairs.count; q++) {
        outcomes((s[pairs.low[q] as number] as number) - (s[pairs.high[q] as number] as number), lambda, out);
        expected += (pairs.total[q] as number) * (out[2] as number);
      }
      lambda += tieStep(expected, tieWeight, tau, lambda);
    }
  }

  // The log-likelihood and the diagonal of the Hessian at the fit.
  const logNu = fitTie ? lambda : Number.NEGATIVE_INFINITY;
  const diagonal = new Float64Array(items).fill(p);
  let logLikelihood = 0;
  for (let q = 0; q < pairs.count; q++) {
    const lo = pairs.low[q] as number;
    const hi = pairs.high[q] as number;
    const total = pairs.total[q] as number;
    const d = (s[lo] as number) - (s[hi] as number);
    outcomes(d, logNu, out);
    const half = ((out[0] as number) - (out[1] as number)) / 2;
    const curvature = total * (((out[0] as number) + (out[1] as number)) / 4 - half * half);
    diagonal[lo] = (diagonal[lo] as number) + curvature;
    diagonal[hi] = (diagonal[hi] as number) + curvature;
    logLikelihood += ((pairs.net[q] as number) / 2) * d - total * (out[3] as number) + (fitTie ? (pairs.ties[q] as number) * lambda : 0);
  }
  const se = Array.from(s, (_, i) => {
    const n = size[group[i] as number] as number;
    return Math.sqrt(1 / (n * p) + (1 - 1 / n) / (diagonal[i] as number));
  });
  return {
    strengths: Array.from(s),
    se,
    tie: fitTie ? Math.exp(lambda) : 0,
    logLikelihood,
    iterations,
    converged: bound <= tolerance || rounded,
    bound,
    pairs: pairs.count,
  };
}
