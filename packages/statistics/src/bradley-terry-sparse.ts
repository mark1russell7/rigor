/**
 * The sparse Bradley-Terry fit. It has the model, the prior and the tie model of `bradleyTerry`, so the two fits have
 * one optimum. This fit keeps one record for each distinct pair of items, not a matrix of all the items. Thus its
 * memory is in proportion to the items and the pairs. The dense fit of 10,000 items keeps a Hessian of 800 MB.
 *
 * The fit uses Newton steps on the negative log posterior, as `bradleyTerry` does. It does not factor the Hessian.
 * Preconditioned conjugate gradients solve each Newton system, and the diagonal of the Hessian is the preconditioner.
 * One product of the Hessian and a vector reads each pair one time.
 *
 * The prior makes the objective strongly convex, so the Hessian is positive definite. Thus each step of the solve
 * gives a direction that goes down. The solve is loose far from the minimum and tight near it (an inexact Newton
 * method). A line search with the Armijo rule makes the objective smaller at each step. The steps go to the one
 * minimum, and the fit stops when the gradient puts each parameter inside the tolerance of that minimum.
 */
import { type BradleyTerryFit, type BradleyTerryOptions, type PairComparison, type TieModel, startOf } from "./bradley-terry.ts";

/** The options of `bradleyTerrySparse`. The prior and the tie model are the same as in `bradleyTerry`. */
export interface BradleyTerrySparseOptions extends BradleyTerryOptions {
  /** The largest number of Newton steps. The default is 100. */
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
  /** The number of Newton steps. */
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
/** The Armijo constant of the line search: a step gives at least this part of the decrease that the slope forecasts. */
const ARMIJO = 1e-4;
/** The largest number of halvings of a step in the line search. */
const HALVINGS = 60;
/** The largest number of conjugate-gradient steps for one Newton system. */
const SOLVE_LIMIT = 500;

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

/** The log and the prior of a fit: the data that each evaluation of the objective reads. */
interface Problem {
  readonly items: number;
  readonly pairs: Pairs;
  /** True when a comparison is a Davidson tie. Else the tie parameter is 0, and the model is plain Bradley-Terry. */
  readonly fitTie: boolean;
  readonly priorMean: number;
  /** The prior precision of each log-strength. */
  readonly p: number;
  /** The prior precision of the log of the tie parameter. */
  readonly tau: number;
  /** The total weight of the Davidson ties. */
  readonly tieWeight: number;
}

/**
 * A point of the fit, with the objective and its derivatives at the point. The parameters are the log-strengths and
 * the log of the tie parameter. The loop keeps two points and swaps them, so a step makes no new arrays.
 */
interface Point {
  readonly s: Float64Array;
  lambda: number;
  /** The negative log posterior. */
  value: number;
  /** The log-likelihood of the comparisons, with no prior term. */
  logLikelihood: number;
  readonly gradient: Float64Array;
  tieGradient: number;
  /** The Euclidean norm of the gradient, over the log-strengths and the log of the tie parameter. */
  norm: number;
  /** The second derivative of the objective of each pair in the difference of its two log-strengths. */
  readonly curvature: Float64Array;
  /** The diagonal of the Hessian at each log-strength. */
  readonly diagonal: Float64Array;
  /** The mixed second derivative of the objective in each log-strength and the log of the tie parameter. */
  readonly cross: Float64Array;
  /** The second derivative of the objective in the log of the tie parameter. */
  tieCurvature: number;
}

/** This function makes an empty point for `items` items and `count` pairs. */
function pointOf(items: number, count: number): Point {
  return {
    s: new Float64Array(items),
    lambda: 0,
    value: 0,
    logLikelihood: 0,
    gradient: new Float64Array(items),
    tieGradient: 0,
    norm: 0,
    curvature: new Float64Array(count),
    diagonal: new Float64Array(items),
    cross: new Float64Array(items),
    tieCurvature: 0,
  };
}

/** This function writes the objective, the gradient and the Hessian at the parameters of `point` into `point`. */
function evaluate(problem: Problem, point: Point, out: Float64Array): void {
  const { items, pairs, fitTie, priorMean, p, tau, tieWeight } = problem;
  const { s, gradient, curvature, diagonal, cross, lambda } = point;
  const logNu = fitTie ? lambda : Number.NEGATIVE_INFINITY;
  let prior = 0;
  for (let i = 0; i < items; i++) {
    const offset = (s[i] as number) - priorMean;
    prior += offset * offset;
    gradient[i] = p * offset;
    diagonal[i] = p;
    cross[i] = 0;
  }
  let logLikelihood = fitTie ? tieWeight * lambda : 0;
  let tieGradient = fitTie ? tau * lambda - tieWeight : 0;
  let tieCurvature = fitTie ? tau : 0;
  for (let q = 0; q < pairs.count; q++) {
    const lo = pairs.low[q] as number;
    const hi = pairs.high[q] as number;
    const total = pairs.total[q] as number;
    const net = pairs.net[q] as number;
    const d = (s[lo] as number) - (s[hi] as number);
    outcomes(d, logNu, out);
    const pa = out[0] as number;
    const pb = out[1] as number;
    const pt = out[2] as number;
    const half = (pa - pb) / 2;
    logLikelihood += (net / 2) * d - total * (out[3] as number);
    const g = total * half - net / 2;
    gradient[lo] = (gradient[lo] as number) + g;
    gradient[hi] = (gradient[hi] as number) - g;
    // The curvature is (pa + pb) / 4 - half ^ 2. This form of it has no cancellation, and it is never below 0.
    const c = total * (pa * pb + (pt * (1 - pt)) / 4);
    curvature[q] = c;
    diagonal[lo] = (diagonal[lo] as number) + c;
    diagonal[hi] = (diagonal[hi] as number) + c;
    if (fitTie) {
      tieGradient += total * pt;
      tieCurvature += total * pt * (1 - pt);
      const b = -total * pt * half;
      cross[lo] = (cross[lo] as number) + b;
      cross[hi] = (cross[hi] as number) - b;
    }
  }
  let norm = tieGradient * tieGradient;
  for (let i = 0; i < items; i++) norm += (gradient[i] as number) ** 2;
  point.value = (p * prior) / 2 + (fitTie ? (tau * lambda * lambda) / 2 : 0) - logLikelihood;
  point.logLikelihood = logLikelihood;
  point.tieGradient = tieGradient;
  point.tieCurvature = tieCurvature;
  point.norm = Math.sqrt(norm);
}

/**
 * This function writes the product of the Hessian at `point` and the vector (`v`, `vTie`) into `out`. It gives the
 * tie part of the product. The product reads each pair one time, and it makes no arrays.
 */
function multiply(problem: Problem, point: Point, v: Float64Array, vTie: number, out: Float64Array): number {
  const { items, pairs, fitTie, p } = problem;
  const { curvature, cross } = point;
  for (let i = 0; i < items; i++) out[i] = p * (v[i] as number) + (cross[i] as number) * vTie;
  for (let q = 0; q < pairs.count; q++) {
    const lo = pairs.low[q] as number;
    const hi = pairs.high[q] as number;
    const t = (curvature[q] as number) * ((v[lo] as number) - (v[hi] as number));
    out[lo] = (out[lo] as number) + t;
    out[hi] = (out[hi] as number) - t;
  }
  if (!fitTie) return 0;
  let tie = point.tieCurvature * vTie;
  for (let i = 0; i < items; i++) tie += (cross[i] as number) * (v[i] as number);
  return tie;
}

/** The work arrays of the conjugate-gradient solve. The fit makes them one time. */
interface Work {
  readonly residual: Float64Array;
  readonly scaled: Float64Array;
  readonly direction: Float64Array;
  readonly product: Float64Array;
}

/**
 * This function solves the Newton system `H x = -g` at `point` with preconditioned conjugate gradients. It writes the
 * log-strength part of `x` into `step`, and it gives the tie part. The solve stops when the norm of the residual is
 * `forcing` times the norm of the gradient or less. The solve starts at 0, so each step of it gives a descent direction.
 */
function newtonStep(problem: Problem, point: Point, forcing: number, step: Float64Array, work: Work): number {
  const { items, fitTie } = problem;
  const { residual: r, scaled: z, direction: d, product: ad } = work;
  const { gradient, diagonal } = point;
  let rz = 0;
  for (let i = 0; i < items; i++) {
    const ri = -(gradient[i] as number);
    const zi = ri / (diagonal[i] as number);
    r[i] = ri;
    z[i] = zi;
    d[i] = zi;
    rz += ri * zi;
  }
  let rTie = fitTie ? -point.tieGradient : 0;
  let dTie = fitTie ? rTie / point.tieCurvature : 0;
  rz += rTie * dTie;
  step.fill(0);
  let stepTie = 0;
  const target = forcing * point.norm;
  const limit = Math.min(SOLVE_LIMIT, items + 1);
  for (let k = 0; k < limit; k++) {
    const adTie = multiply(problem, point, d, dTie, ad);
    let dad = dTie * adTie;
    for (let i = 0; i < items; i++) dad += (d[i] as number) * (ad[i] as number);
    // Rounding can make the curvature of a very small direction 0. The step so far is then the result.
    if (!(dad > 0)) break;
    const alpha = rz / dad;
    let residual = 0;
    for (let i = 0; i < items; i++) {
      step[i] = (step[i] as number) + alpha * (d[i] as number);
      const ri = (r[i] as number) - alpha * (ad[i] as number);
      r[i] = ri;
      residual += ri * ri;
    }
    stepTie += alpha * dTie;
    rTie -= alpha * adTie;
    residual += rTie * rTie;
    if (Math.sqrt(residual) <= target) break;
    let next = 0;
    for (let i = 0; i < items; i++) {
      const zi = (r[i] as number) / (diagonal[i] as number);
      z[i] = zi;
      next += (r[i] as number) * zi;
    }
    const zTie = fitTie ? rTie / point.tieCurvature : 0;
    next += rTie * zTie;
    const beta = next / rz;
    rz = next;
    for (let i = 0; i < items; i++) d[i] = (z[i] as number) + beta * (d[i] as number);
    dTie = zTie + beta * dTie;
  }
  return stepTie;
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
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 1e-8;
  if (!Number.isFinite(priorMean)) throw new RangeError(`${NAME}: the prior mean is a finite number, not ${priorMean}.`);
  positiveOption("the prior SD", priorSd);
  positiveOption("the tie prior SD", tiePriorSd);
  positiveOption("the tolerance", tolerance);
  if (ties !== "davidson" && ties !== "half") throw new RangeError(`${NAME}: the tie model is "davidson" or "half", not ${String(ties)}.`);
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new RangeError(`${NAME}: maxIterations is a whole number of 1 or more, not ${maxIterations}.`);
  }
  const begin = startOf(NAME, items, priorMean, options.start);

  const pairs = pairsOf(items, comparisons, ties);
  let tieWeight = 0;
  let totalWeight = 0;
  for (let q = 0; q < pairs.count; q++) {
    tieWeight += pairs.ties[q] as number;
    totalWeight += pairs.total[q] as number;
  }
  const p = 1 / (priorSd * priorSd);
  const tau = 1 / (tiePriorSd * tiePriorSd);
  const problem: Problem = { items, pairs, fitTie: tieWeight > 0, priorMean, p, tau, tieWeight };
  const smallest = problem.fitTie ? Math.min(p, tau) : p;
  // The gradient has a rounding error in proportion to the sum of its terms. Below this size, a step gains nothing.
  const floor = 4 * Number.EPSILON * (totalWeight + 1);

  let current = pointOf(items, pairs.count);
  let trial = pointOf(items, pairs.count);
  current.s.set(begin.strengths);
  current.lambda = problem.fitTie ? begin.logTie : 0;
  const out = new Float64Array(4);
  const step = new Float64Array(items);
  const work: Work = { residual: new Float64Array(items), scaled: new Float64Array(items), direction: new Float64Array(items), product: new Float64Array(items) };
  evaluate(problem, current, out);
  let iterations = 0;
  let bound = current.norm / smallest;
  let rounded = current.norm <= floor;

  while (!(bound <= tolerance || rounded) && iterations < maxIterations) {
    iterations++;
    // The forcing term of the inexact Newton method (Eisenstat and Walker, 1996): it goes to 0 with the gradient.
    const forcing = Math.min(0.5, Math.sqrt(current.norm));
    const stepTie = newtonStep(problem, current, forcing, step, work);
    let slope = stepTie * current.tieGradient;
    for (let i = 0; i < items; i++) slope += (step[i] as number) * (current.gradient[i] as number);
    // Near the minimum, a full step changes the objective by less than its rounding. The slack accepts that step.
    const slack = ROUNDING * (Math.abs(current.value) + 1);
    let t = 1;
    let accepted = false;
    for (let h = 0; h <= HALVINGS && !accepted; h++) {
      for (let i = 0; i < items; i++) trial.s[i] = (current.s[i] as number) + t * (step[i] as number);
      trial.lambda = current.lambda + t * stepTie;
      evaluate(problem, trial, out);
      accepted = trial.value <= current.value + ARMIJO * t * slope + slack;
      if (!accepted) t /= 2;
    }
    // A step that no halving accepts gains nothing above the rounding. The fit then stops at the current point.
    if (!accepted) break;
    [current, trial] = [trial, current];
    bound = current.norm / smallest;
    rounded = current.norm <= floor;
  }

  const { group, size } = groupsOf(items, pairs);
  const se = Array.from(current.s, (_, i) => {
    const n = size[group[i] as number] as number;
    return Math.sqrt(1 / (n * p) + (1 - 1 / n) / (current.diagonal[i] as number));
  });
  return {
    strengths: Array.from(current.s),
    se,
    tie: problem.fitTie ? Math.exp(current.lambda) : 0,
    logLikelihood: current.logLikelihood,
    iterations,
    converged: bound <= tolerance || rounded,
    bound,
    pairs: pairs.count,
  };
}
