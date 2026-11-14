/**
 * The Bradley-Terry fit of pairwise comparisons among `n` items. Each item has a log-strength. The fit is the
 * maximum a posteriori estimate with a normal (ridge) prior on each log-strength. Thus an item with only wins has a
 * finite strength, and the strengths have one solution.
 *
 * Ties use the Davidson (1970) model, or count as half a win and half a loss. The fit uses Newton steps with a line search on the negative log posterior. This function is
 * convex, so the steps go to its one minimum.
 */
import { factor } from "./ridge.ts";
import { pairOutcomes } from "./rating.ts";

/** The result of a comparison: the first item wins, the second item wins, or a tie. */
export type PairOutcome = "a" | "b" | "tie";

/** One comparison of two items, by their indexes from 0. */
export interface PairComparison {
  readonly a: number;
  readonly b: number;
  readonly outcome: PairOutcome;
  /** The weight of the comparison. The default is 1. A weight of 2 counts as two equal comparisons. */
  readonly weight?: number;
}

/** The model of a tie. */
export type TieModel = "davidson" | "half";

/** The options of `bradleyTerry`. */
export interface BradleyTerryOptions {
  /** The mean of the prior of each log-strength. The default is 0. */
  readonly priorMean?: number;
  /** The standard deviation of the prior of each log-strength. The default is 1. A smaller value pulls the strengths together. */
  readonly priorSd?: number;
  /**
   * The model of a tie. With `"davidson"` (the default), the fit also gives a tie parameter. With `"half"`, a tie
   * counts as half a win and half a loss of each item, and the tie parameter is 0.
   */
  readonly ties?: TieModel;
  /**
   * The standard deviation of the normal prior of the log of the tie parameter, with mean 0. The default is 10. The
   * prior is weak. It keeps the parameter finite when each comparison is a tie.
   */
  readonly tiePriorSd?: number;
  /** The largest number of Newton steps. The default is 100. */
  readonly maxIterations?: number;
  /** The fit stops when the full Newton step moves no parameter more than this value. The default is 1e-10. */
  readonly tolerance?: number;
  /**
   * The point where the fit starts. The default is the prior mean for each log-strength, and 1 for the tie parameter.
   * A start near the optimum saves steps. An example is the fit of the log before its last comparisons. The optimum
   * does not change.
   */
  readonly start?: BradleyTerryStart;
}

/** The start of a Bradley-Terry fit: a log-strength for each item, and the Davidson tie parameter. */
export interface BradleyTerryStart {
  /** The log-strength of each item, in the order of the indexes. Each value is a finite number. */
  readonly strengths: readonly number[];
  /** The Davidson tie parameter, a finite number above 0. The default is 1. A fit with no Davidson tie does not use it. */
  readonly tie?: number;
}

/**
 * This function gives the start of a fit: the log-strengths, and the log of the tie parameter. It throws a RangeError
 * for a start with the wrong number of items, a log-strength that is not finite, and a tie parameter that is not above 0.
 */
export function startOf(name: string, items: number, priorMean: number, start: BradleyTerryStart | undefined): { strengths: Float64Array; logTie: number } {
  if (start === undefined) return { strengths: new Float64Array(items).fill(priorMean), logTie: 0 };
  if (start.strengths.length !== items) throw new RangeError(`${name}: the start has ${start.strengths.length} log-strengths, and the fit has ${items} items.`);
  const strengths = Float64Array.from(start.strengths);
  for (const [i, value] of strengths.entries()) {
    if (!Number.isFinite(value)) throw new RangeError(`${name}: the start log-strength of item ${i} is a finite number, not ${start.strengths[i]}.`);
  }
  const tie = start.tie ?? 1;
  if (!(tie > 0 && Number.isFinite(tie))) throw new RangeError(`${name}: the start tie parameter is a finite number above 0, not ${tie}.`);
  return { strengths, logTie: Math.log(tie) };
}

/** The result of `bradleyTerry`. The lists have one value for each item, in the order of the indexes. */
export interface BradleyTerryFit {
  /** The log-strength of each item. An item with no comparison has the prior mean. */
  readonly strengths: number[];
  /**
   * The standard error of each log-strength: the square root of the diagonal of the inverse of the Hessian of the
   * negative log posterior. An item with no comparison has the prior SD.
   */
  readonly se: number[];
  /** The Davidson tie parameter. It is 0 with the model `"half"`, and when no comparison is a tie. */
  readonly tie: number;
  /** The log-likelihood of the comparisons at the fit, with no prior term. */
  readonly logLikelihood: number;
  /** The number of Newton steps. */
  readonly iterations: number;
  /** True when the last full Newton step moved no parameter more than the tolerance. */
  readonly converged: boolean;
}

/** A comparison as numbers: the indexes, the weight, the coefficient of the difference, and 1 for a Davidson tie. */
interface Term {
  readonly a: number;
  readonly b: number;
  readonly w: number;
  readonly c: number;
  readonly tie: number;
}

const ARMIJO = 1e-4;
const HALVINGS = 60;
const ROUNDING = 64 * Number.EPSILON;

function checkedTerms(n: number, comparisons: readonly PairComparison[], ties: TieModel): Term[] {
  const terms: Term[] = [];
  for (const [i, comparison] of comparisons.entries()) {
    const { a, b, outcome } = comparison;
    const w = comparison.weight ?? 1;
    for (const index of [a, b]) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= n) {
        throw new RangeError(`bradleyTerry: comparison ${i} has the index ${index}, and the indexes are whole numbers from 0 to ${n - 1}.`);
      }
    }
    if (a === b) throw new RangeError(`bradleyTerry: comparison ${i} compares the item ${a} with itself.`);
    if (outcome !== "a" && outcome !== "b" && outcome !== "tie") throw new RangeError(`bradleyTerry: comparison ${i} has the outcome ${String(outcome)}.`);
    if (!(w >= 0 && Number.isFinite(w))) throw new RangeError(`bradleyTerry: comparison ${i} has the weight ${w}, and a weight is a finite number of 0 or more.`);
    if (w === 0) continue;
    const c = outcome === "a" ? 0.5 : outcome === "b" ? -0.5 : 0;
    terms.push({ a, b, w, c, tie: outcome === "tie" && ties === "davidson" ? 1 : 0 });
  }
  return terms;
}

function positiveOption(label: string, value: number): void {
  if (!(value > 0 && Number.isFinite(value))) throw new RangeError(`bradleyTerry: ${label} is a finite number above 0, not ${value}.`);
}

/**
 * The Bradley-Terry fit of `comparisons` among `items` items. The function does not sort or change its inputs. An
 * empty list of comparisons gives the prior for each item. The function throws a RangeError for a bad index, a bad
 * outcome, a bad weight and a bad option.
 */
export function bradleyTerry(items: number, comparisons: readonly PairComparison[], options: BradleyTerryOptions = {}): BradleyTerryFit {
  if (!Number.isSafeInteger(items) || items < 1) throw new RangeError(`bradleyTerry: the number of items is a whole number of 1 or more, not ${items}.`);
  const priorMean = options.priorMean ?? 0;
  const priorSd = options.priorSd ?? 1;
  const ties = options.ties ?? "davidson";
  const tiePriorSd = options.tiePriorSd ?? 10;
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 1e-10;
  if (!Number.isFinite(priorMean)) throw new RangeError(`bradleyTerry: the prior mean is a finite number, not ${priorMean}.`);
  positiveOption("the prior SD", priorSd);
  positiveOption("the tie prior SD", tiePriorSd);
  positiveOption("the tolerance", tolerance);
  if (ties !== "davidson" && ties !== "half") throw new RangeError(`bradleyTerry: the tie model is "davidson" or "half", not ${String(ties)}.`);
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new RangeError(`bradleyTerry: maxIterations is a whole number of 1 or more, not ${maxIterations}.`);
  }
  const begin = startOf("bradleyTerry", items, priorMean, options.start);
  const terms = checkedTerms(items, comparisons, ties);
  // The tie parameter is free only when a comparison is a Davidson tie. Else it is 0, and the model is plain Bradley-Terry.
  const fitTie = terms.some((t) => t.tie === 1);
  const k = fitTie ? items + 1 : items;
  const model: Model = { items, terms, fitTie, priorMean, priorPrecision: 1 / (priorSd * priorSd), tiePrecision: 1 / (tiePriorSd * tiePriorSd) };

  const x = new Float64Array(k);
  x.set(begin.strengths);
  if (fitTie) x[items] = begin.logTie;
  let iterations = 0;
  let converged = false;
  let value = objective(model, x);
  while (iterations < maxIterations) {
    iterations++;
    const { gradient, hessian } = derivatives(model, x);
    const step = solve(hessian, gradient, k);
    let slope = 0;
    for (let i = 0; i < k; i++) slope += (gradient[i] as number) * (step[i] as number);
    let t = 1;
    let next = moved(x, step, t);
    let nextValue = objective(model, next);
    // Near the minimum, a full step changes the objective by less than its rounding. The slack accepts that step.
    const slack = ROUNDING * (Math.abs(value) + 1);
    for (let h = 0; h < HALVINGS && !(nextValue <= value + ARMIJO * t * slope + slack); h++) {
      t /= 2;
      next = moved(x, step, t);
      nextValue = objective(model, next);
    }
    // The full Newton step decides the convergence, so a stalled line search far from the minimum does not count.
    let largest = 0;
    for (let i = 0; i < k; i++) largest = Math.max(largest, Math.abs(step[i] as number));
    if (nextValue <= value + slack) {
      x.set(next);
      value = nextValue;
    }
    if (largest <= tolerance) {
      converged = true;
      break;
    }
  }

  const { hessian } = derivatives(model, x);
  const variance = inverseDiagonal(hessian, k);
  const nu = fitTie ? Math.exp(x[items] as number) : 0;
  let logLikelihood = 0;
  for (const term of terms) logLikelihood += term.w * termLogLikelihood(term, x[term.a] as number, x[term.b] as number, nu);
  return {
    strengths: Array.from(x.subarray(0, items)),
    se: Array.from(variance.subarray(0, items), (v) => Math.sqrt(v)),
    tie: nu,
    logLikelihood,
    iterations,
    converged,
  };
}

interface Model {
  readonly items: number;
  readonly terms: readonly Term[];
  readonly fitTie: boolean;
  readonly priorMean: number;
  readonly priorPrecision: number;
  readonly tiePrecision: number;
}

function moved(x: Float64Array, step: Float64Array, t: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] as number) + t * (step[i] as number);
  return out;
}

/** The log of the denominator `exp(d / 2) + exp(-d / 2) + nu`, with no overflow. */
function logDenominator(d: number, logNu: number): number {
  const half = Math.abs(d) / 2;
  const top = Math.max(half, logNu);
  return top + Math.log(Math.exp(half - top) + Math.exp(-half - top) + Math.exp(logNu - top));
}

/** The log-likelihood of one comparison with weight 1. A `"half"` tie has the coefficient 0: the mean of the two log-probabilities of a win. */
function termLogLikelihood(term: Term, sa: number, sb: number, nu: number): number {
  const d = sa - sb;
  const logNu = nu > 0 ? Math.log(nu) : Number.NEGATIVE_INFINITY;
  const logD = logDenominator(d, logNu);
  return term.tie === 1 ? logNu - logD : term.c * d - logD;
}

/** The negative log posterior at `x`. */
function objective(model: Model, x: Float64Array): number {
  const logNu = model.fitTie ? (x[model.items] as number) : Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const term of model.terms) {
    const d = (x[term.a] as number) - (x[term.b] as number);
    sum += term.w * (logDenominator(d, logNu) - term.c * d - (term.tie === 1 ? logNu : 0));
  }
  for (let i = 0; i < model.items; i++) sum += (model.priorPrecision * ((x[i] as number) - model.priorMean) ** 2) / 2;
  if (model.fitTie) sum += (model.tiePrecision * logNu * logNu) / 2;
  return sum;
}

/** The gradient and the Hessian (in row order) of the negative log posterior at `x`. */
function derivatives(model: Model, x: Float64Array): { gradient: Float64Array; hessian: Float64Array } {
  const k = x.length;
  const n = model.items;
  const gradient = new Float64Array(k);
  const hessian = new Float64Array(k * k);
  const nu = model.fitTie ? Math.exp(x[n] as number) : 0;
  for (const term of model.terms) {
    const { a, b, w } = term;
    const p = pairOutcomes(x[a] as number, x[b] as number, nu);
    const q = (p.a - p.b) / 2;
    const gd = w * (q - term.c);
    const hdd = w * ((p.a + p.b) / 4 - q * q);
    gradient[a] = (gradient[a] as number) + gd;
    gradient[b] = (gradient[b] as number) - gd;
    hessian[a * k + a] = (hessian[a * k + a] as number) + hdd;
    hessian[b * k + b] = (hessian[b * k + b] as number) + hdd;
    hessian[a * k + b] = (hessian[a * k + b] as number) - hdd;
    hessian[b * k + a] = (hessian[b * k + a] as number) - hdd;
    if (model.fitTie) {
      const hdl = -w * q * p.tie;
      gradient[n] = (gradient[n] as number) + w * (p.tie - term.tie);
      hessian[n * k + n] = (hessian[n * k + n] as number) + w * p.tie * (1 - p.tie);
      hessian[a * k + n] = (hessian[a * k + n] as number) + hdl;
      hessian[n * k + a] = (hessian[n * k + a] as number) + hdl;
      hessian[b * k + n] = (hessian[b * k + n] as number) - hdl;
      hessian[n * k + b] = (hessian[n * k + b] as number) - hdl;
    }
  }
  for (let i = 0; i < n; i++) {
    gradient[i] = (gradient[i] as number) + model.priorPrecision * ((x[i] as number) - model.priorMean);
    hessian[i * k + i] = (hessian[i * k + i] as number) + model.priorPrecision;
  }
  if (model.fitTie) {
    gradient[n] = (gradient[n] as number) + model.tiePrecision * (x[n] as number);
    hessian[n * k + n] = (hessian[n * k + n] as number) + model.tiePrecision;
  }
  return { gradient, hessian };
}

/** The Cholesky factor of a copy of the Hessian. The priors make the Hessian positive definite. */
function factored(hessian: Float64Array, k: number): Float64Array {
  const l = Float64Array.from(hessian);
  if (!factor(l, k)) throw new RangeError("bradleyTerry: the Hessian is not positive definite. Make the prior SD smaller.");
  return l;
}

/** The Newton step: the solution of `hessian * step = -gradient`. */
function solve(hessian: Float64Array, gradient: Float64Array, k: number): Float64Array {
  const l = factored(hessian, k);
  const y = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    let s = -(gradient[i] as number);
    for (let j = 0; j < i; j++) s -= (l[i * k + j] as number) * (y[j] as number);
    y[i] = s / (l[i * k + i] as number);
  }
  for (let i = k - 1; i >= 0; i--) {
    let s = y[i] as number;
    for (let j = i + 1; j < k; j++) s -= (l[j * k + i] as number) * (y[j] as number);
    y[i] = s / (l[i * k + i] as number);
  }
  return y;
}

/** The diagonal of the inverse of the Hessian: the column sums of the squares of the inverse of its Cholesky factor. */
function inverseDiagonal(hessian: Float64Array, k: number): Float64Array {
  const l = factored(hessian, k);
  const out = new Float64Array(k);
  const column = new Float64Array(k);
  for (let c = 0; c < k; c++) {
    // Column c of the inverse of L, by forward substitution. Its entries above row c are 0.
    column.fill(0);
    for (let i = c; i < k; i++) {
      let s = i === c ? 1 : 0;
      for (let j = c; j < i; j++) s -= (l[i * k + j] as number) * (column[j] as number);
      column[i] = s / (l[i * k + i] as number);
    }
    // The inverse of the Hessian is inv(L)' inv(L), so its diagonal entry c is the sum over the rows of column c squared.
    let sum = 0;
    for (let i = c; i < k; i++) sum += (column[i] as number) ** 2;
    out[c] = sum;
  }
  return out;
}
