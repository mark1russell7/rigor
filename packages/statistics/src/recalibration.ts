/**
 * The recalibration of the probabilities of a classifier with more than two classes. The map of vector scaling gives
 * each class a slope and a bias on the log of its probability (Guo and others, 2017). The form with one slope for all
 * classes is the bias-corrected temperature scaling (Alexandari and others, 2020). Both forms are the diagonal forms
 * of the Dirichlet calibration (Kull and others, 2019).
 *
 * The map keeps a probability of 0 at 0, so a class that a forecast excludes stays excluded. A full matrix of the
 * Dirichlet calibration mixes the logs of all classes, and the log of 0 has no value. Thus this module has no full form.
 */

import { factor, factorInverseDiagonal, factorSolve } from "./ridge.ts";

/** One forecast of a classifier: the probability of each class, and the index of the true class. */
export interface ClassForecast {
  /** The probability of each class, in the order of the indexes. Each is from 0 to 1, and their sum is 1. */
  readonly probabilities: readonly number[];
  /** The index of the true class, from 0 to the number of classes minus 1. */
  readonly label: number;
}

/** The form of the map: one slope for all classes (`"scalar"`), or one slope for each class (`"diagonal"`). */
export type ScalingForm = "scalar" | "diagonal";

/** The map of vector scaling. The lists have one value for each class, in the order of the indexes. */
export interface VectorScaling {
  /** The slope of the log of the probability of each class. With the form `"scalar"`, each slope is the same. */
  readonly slopes: readonly number[];
  /** The bias of each class, as a natural logarithm. */
  readonly biases: readonly number[];
}

/** The options of `vectorScaling`. */
export interface VectorScalingOptions {
  /** The form of the map. The default is `"diagonal"`. */
  readonly form?: ScalingForm;
  /**
   * The standard deviation of the normal prior of each parameter. The prior of a slope has the mean 1, and the prior of
   * a bias has the mean 0. The default is 10. The prior is weak. It keeps a parameter finite when a class has no data.
   */
  readonly priorSd?: number;
  /** The largest number of Newton steps. The default is 100. */
  readonly maxIterations?: number;
  /** The fit stops when the full Newton step moves no parameter more than this value. The default is 1e-10. */
  readonly tolerance?: number;
}

/** The result of `vectorScaling`: the map, with a standard error for each parameter. */
export interface VectorScalingFit extends VectorScaling {
  /** The standard error of each slope. With the form `"scalar"`, each value is the standard error of the one slope. */
  readonly slopeSe: number[];
  /** The standard error of each bias. */
  readonly biasSe: number[];
  /** The log-likelihood of the forecasts that the fit uses, at the fit, with no prior term. */
  readonly logLikelihood: number;
  /** The number of Newton steps. */
  readonly iterations: number;
  /** True when the last full Newton step moved no parameter more than the tolerance. */
  readonly converged: boolean;
  /**
   * The number of forecasts that give the probability 0 to the true class. No map changes that probability, so the fit
   * does not use these forecasts. Their log-likelihood has no finite value.
   */
  readonly skipped: number;
}

const ARMIJO = 1e-4;
const HALVINGS = 60;
const ROUNDING = 64 * Number.EPSILON;
/** The largest distance of the sum of the probabilities of a forecast from 1. */
const SUM_TOLERANCE = 1e-6;

/** One forecast that the fit uses: the classes with a probability over 0, the log of each, and the place of the true class. */
interface Row {
  readonly classes: Int32Array;
  readonly logs: Float64Array;
  readonly label: number;
}

/** The shape of the parameters: the index of the slope and of the bias of each class. */
interface Layout {
  readonly classes: number;
  readonly form: ScalingForm;
  readonly size: number;
  readonly precision: number;
}

const slopeIndex = (layout: Layout, c: number): number => (layout.form === "scalar" ? 0 : c);
const biasIndex = (layout: Layout, c: number): number => (layout.form === "scalar" ? 1 + c : layout.classes + c);

/**
 * This function fits the map of vector scaling to `forecasts` of `classes` classes, by the maximum of the posterior.
 *
 * - The map gives class `k` the weight `p[k] ** slope[k] * exp(bias[k])`. The probability of the class is its weight over the sum of the weights.
 * - The fit uses Newton steps with a line search on the negative log posterior. The objective is convex, so the fit has one optimum.
 * - A class with no forecast over 0 keeps the mean of its prior.
 * - An empty list of forecasts gives the means of the prior.
 *
 * The function does not change its inputs. It throws a RangeError for a bad number of classes, a bad forecast and a bad option.
 */
export function vectorScaling(classes: number, forecasts: readonly ClassForecast[], options: VectorScalingOptions = {}): VectorScalingFit {
  if (!Number.isSafeInteger(classes) || classes < 1) throw new RangeError(`vectorScaling: the number of classes is a whole number of 1 or more, not ${classes}.`);
  const form = options.form ?? "diagonal";
  const priorSd = options.priorSd ?? 10;
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 1e-10;
  if (form !== "scalar" && form !== "diagonal") throw new RangeError(`vectorScaling: the form is "scalar" or "diagonal", not ${String(form)}.`);
  if (!(priorSd > 0 && Number.isFinite(priorSd))) throw new RangeError(`vectorScaling: the prior SD is a finite number above 0, not ${priorSd}.`);
  if (!(tolerance > 0 && Number.isFinite(tolerance))) throw new RangeError(`vectorScaling: the tolerance is a finite number above 0, not ${tolerance}.`);
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new RangeError(`vectorScaling: maxIterations is a whole number of 1 or more, not ${maxIterations}.`);
  }
  const layout: Layout = { classes, form, size: form === "scalar" ? 1 + classes : 2 * classes, precision: 1 / (priorSd * priorSd) };
  const rows: Row[] = [];
  let skipped = 0;
  forecasts.forEach((forecast, index) => {
    const row = checkedRow("vectorScaling", classes, forecast, index);
    if (row === undefined) skipped++;
    else rows.push(row);
  });

  const k = layout.size;
  const x = new Float64Array(k);
  for (let c = 0; c < classes; c++) x[slopeIndex(layout, c)] = 1;
  let iterations = 0;
  let converged = false;
  let value = objective(layout, rows, x);
  while (iterations < maxIterations) {
    iterations++;
    const { gradient, hessian } = derivatives(layout, rows, x);
    const step = factorSolve(factored(hessian, k), gradient.map((g) => -g), k);
    let slope = 0;
    for (let i = 0; i < k; i++) slope += (gradient[i] as number) * (step[i] as number);
    let t = 1;
    let next = moved(x, step, t);
    let nextValue = objective(layout, rows, next);
    // Near the minimum, a full step changes the objective by less than its rounding. The slack accepts that step.
    const slack = ROUNDING * (Math.abs(value) + 1);
    for (let h = 0; h < HALVINGS && !(nextValue <= value + ARMIJO * t * slope + slack); h++) {
      t /= 2;
      next = moved(x, step, t);
      nextValue = objective(layout, rows, next);
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

  const variance = factorInverseDiagonal(factored(derivatives(layout, rows, x).hessian, k), k);
  let logLikelihood = 0;
  for (const row of rows) logLikelihood -= rowLoss(layout, row, x);
  const each = (index: (c: number) => number, values: Float64Array): number[] => Array.from({ length: classes }, (_, c) => values[index(c)] as number);
  return {
    slopes: each((c) => slopeIndex(layout, c), x),
    biases: each((c) => biasIndex(layout, c), x),
    slopeSe: each((c) => slopeIndex(layout, c), variance).map(Math.sqrt),
    biasSe: each((c) => biasIndex(layout, c), variance).map(Math.sqrt),
    logLikelihood,
    iterations,
    converged,
    skipped,
  };
}

/**
 * This function gives the probabilities of a forecast after the map `scaling`. A probability of 0 stays 0. The function
 * throws a RangeError when the lists do not have the same length, and when no probability is over 0. It also throws
 * for a bad probability and for a parameter that is not finite.
 */
export function scaledProbabilities(probabilities: readonly number[], scaling: VectorScaling): number[] {
  const n = probabilities.length;
  if (scaling.slopes.length !== n || scaling.biases.length !== n) {
    throw new RangeError(`scaledProbabilities: the map has ${scaling.slopes.length} slopes and ${scaling.biases.length} biases for ${n} probabilities.`);
  }
  const logits = new Float64Array(n);
  let top = Number.NEGATIVE_INFINITY;
  for (let c = 0; c < n; c++) {
    const p = probabilities[c] as number;
    const [s, b] = [scaling.slopes[c] as number, scaling.biases[c] as number];
    if (!(p >= 0 && p <= 1)) throw new RangeError(`scaledProbabilities: each probability is from 0 to 1, not ${p}.`);
    if (!Number.isFinite(s) || !Number.isFinite(b)) throw new RangeError(`scaledProbabilities: the slope and the bias of class ${c} are finite numbers.`);
    logits[c] = p > 0 ? s * Math.log(p) + b : Number.NEGATIVE_INFINITY;
    top = Math.max(top, logits[c] as number);
  }
  if (top === Number.NEGATIVE_INFINITY) throw new RangeError("scaledProbabilities: no probability is over 0.");
  let sum = 0;
  const out = new Array<number>(n);
  for (let c = 0; c < n; c++) {
    out[c] = Math.exp((logits[c] as number) - top);
    sum += out[c] as number;
  }
  for (let c = 0; c < n; c++) out[c] = (out[c] as number) / sum;
  return out;
}

/** This function checks one forecast and gives its row. It gives undefined when the true class has the probability 0. */
function checkedRow(name: string, classes: number, forecast: ClassForecast, index: number): Row | undefined {
  const { probabilities, label } = forecast;
  if (probabilities.length !== classes) throw new RangeError(`${name}: forecast ${index} has ${probabilities.length} probabilities, not ${classes}.`);
  if (!Number.isSafeInteger(label) || label < 0 || label >= classes) {
    throw new RangeError(`${name}: the label of forecast ${index} is a whole number from 0 to ${classes - 1}, not ${label}.`);
  }
  let sum = 0;
  let present = 0;
  for (const p of probabilities) {
    if (!(p >= 0 && p <= 1)) throw new RangeError(`${name}: each probability of forecast ${index} is from 0 to 1, not ${p}.`);
    sum += p;
    if (p > 0) present++;
  }
  if (!(Math.abs(sum - 1) <= SUM_TOLERANCE)) throw new RangeError(`${name}: the probabilities of forecast ${index} have the sum ${sum}, not 1.`);
  if (!((probabilities[label] as number) > 0)) return undefined;
  const row = { classes: new Int32Array(present), logs: new Float64Array(present), label: -1 };
  let j = 0;
  probabilities.forEach((p, c) => {
    if (p <= 0) return;
    if (c === label) row.label = j;
    row.classes[j] = c;
    row.logs[j] = Math.log(p);
    j++;
  });
  return row;
}

/** This function gives the probability of each present class of a row, at the parameters `x`. */
function rowProbabilities(layout: Layout, row: Row, x: Float64Array): Float64Array {
  const m = row.classes.length;
  const q = new Float64Array(m);
  let top = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < m; j++) {
    const c = row.classes[j] as number;
    q[j] = (x[slopeIndex(layout, c)] as number) * (row.logs[j] as number) + (x[biasIndex(layout, c)] as number);
    top = Math.max(top, q[j] as number);
  }
  let sum = 0;
  for (let j = 0; j < m; j++) {
    q[j] = Math.exp((q[j] as number) - top);
    sum += q[j] as number;
  }
  for (let j = 0; j < m; j++) q[j] = (q[j] as number) / sum;
  return q;
}

/** The negative log-likelihood of one row: minus the log of the probability of its true class after the map. */
function rowLoss(layout: Layout, row: Row, x: Float64Array): number {
  const m = row.classes.length;
  let top = Number.NEGATIVE_INFINITY;
  const logits = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const c = row.classes[j] as number;
    logits[j] = (x[slopeIndex(layout, c)] as number) * (row.logs[j] as number) + (x[biasIndex(layout, c)] as number);
    top = Math.max(top, logits[j] as number);
  }
  let sum = 0;
  for (let j = 0; j < m; j++) sum += Math.exp((logits[j] as number) - top);
  return top + Math.log(sum) - (logits[row.label] as number);
}

/** The prior mean of parameter `i`: 1 for a slope and 0 for a bias. */
const priorMean = (layout: Layout, i: number): number => (layout.form === "scalar" ? (i === 0 ? 1 : 0) : i < layout.classes ? 1 : 0);

/** The negative log posterior at `x`. */
function objective(layout: Layout, rows: readonly Row[], x: Float64Array): number {
  let sum = 0;
  for (const row of rows) sum += rowLoss(layout, row, x);
  for (let i = 0; i < layout.size; i++) sum += (layout.precision * ((x[i] as number) - priorMean(layout, i)) ** 2) / 2;
  return sum;
}

/**
 * The gradient and the Hessian (in row order) of the negative log posterior at `x`. A logit is linear in the parameters.
 * Thus the Hessian of a row is a sum over the pairs of present classes: `q[a] * ([a = b] - q[b])` times their features.
 * The feature of a slope is the log of the probability, and the feature of a bias is 1.
 */
function derivatives(layout: Layout, rows: readonly Row[], x: Float64Array): { gradient: Float64Array; hessian: Float64Array } {
  const k = layout.size;
  const gradient = new Float64Array(k);
  const hessian = new Float64Array(k * k);
  for (const row of rows) {
    const q = rowProbabilities(layout, row, x);
    const m = row.classes.length;
    for (let a = 0; a < m; a++) {
      const ca = row.classes[a] as number;
      const [sa, ba, za] = [slopeIndex(layout, ca), biasIndex(layout, ca), row.logs[a] as number];
      const residual = (q[a] as number) - (a === row.label ? 1 : 0);
      gradient[sa] = (gradient[sa] as number) + residual * za;
      gradient[ba] = (gradient[ba] as number) + residual;
      for (let b = 0; b < m; b++) {
        const cb = row.classes[b] as number;
        const [sb, bb, zb] = [slopeIndex(layout, cb), biasIndex(layout, cb), row.logs[b] as number];
        const w = (q[a] as number) * ((a === b ? 1 : 0) - (q[b] as number));
        hessian[sa * k + sb] = (hessian[sa * k + sb] as number) + w * za * zb;
        hessian[sa * k + bb] = (hessian[sa * k + bb] as number) + w * za;
        hessian[ba * k + sb] = (hessian[ba * k + sb] as number) + w * zb;
        hessian[ba * k + bb] = (hessian[ba * k + bb] as number) + w;
      }
    }
  }
  for (let i = 0; i < k; i++) {
    gradient[i] = (gradient[i] as number) + layout.precision * ((x[i] as number) - priorMean(layout, i));
    hessian[i * k + i] = (hessian[i * k + i] as number) + layout.precision;
  }
  return { gradient, hessian };
}

/** The Cholesky factor of a copy of the Hessian. The prior makes the Hessian positive definite. */
function factored(hessian: Float64Array, k: number): Float64Array {
  const l = Float64Array.from(hessian);
  if (!factor(l, k)) throw new RangeError("vectorScaling: the Hessian is not positive definite. Make the prior SD smaller.");
  return l;
}

function moved(x: Float64Array, step: Float64Array, t: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] as number) + t * (step[i] as number);
  return out;
}
