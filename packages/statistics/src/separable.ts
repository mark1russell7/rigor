/**
 * The fit of a separable model: a sum of terms, each a linear coefficient times a basis. The basis reads the point and
 * some shape values. Examples are the knee of a hinge, the exponent of a power and the capacity of a queue. With fixed
 * shape values, the fit of the coefficients is linear least squares. Thus the fit searches only the shape values.
 *
 * `fitSeparable` does a grid search over the candidates of the shapes. Then it refines the best combination with a
 * golden-section search of each shape in turn. `bootstrapSeparable` gives the replicates and the percentile intervals of
 * the coefficients and the shapes. `heldOutSeparable` gives the held-out residual of each point, and `rankSeparable`
 * ranks models by their held-out error.
 */
import { random } from "@mark1russell7/rigor-generators";
import { type BootstrapOptions, type Interval, ends, settings } from "./bootstrap.ts";
import { fitRows } from "./regression.ts";

/** The start candidates of one shape value, and the optional bounds of the refine. */
export interface ShapeParameter {
  /** The name of the shape value. The fit does not read it. It is for the caller. */
  readonly id: string;
  /** The start values of the grid search. Each candidate is finite, and it is in the bounds. */
  readonly candidates: readonly number[];
  /** The smallest value of the refine. The default is no bound. */
  readonly min?: number;
  /** The largest value of the refine. The default is no bound. */
  readonly max?: number;
}

/**
 * A separable model of a measured value. Its value at a point is the sum of its terms: each coefficient times its
 * column of the design. The design reads the shape values and the points.
 */
export interface SeparableModel<X> {
  /** The names of the linear coefficients, in the order of the columns of the design. */
  readonly terms: readonly string[];
  /** The shape values, in the order of the argument `shapes` of `design`. */
  readonly shapes: readonly ShapeParameter[];
  /**
   * This function gives one row for each point, and one value for each term. It gives null when the model has no
   * value at a point, for example at a pole. A row with a value that is not finite counts as null.
   */
  design(shapes: readonly number[], xs: readonly X[]): readonly (readonly number[])[] | null;
}

/** The best fit of a separable model. */
export interface SeparableFit {
  /** The linear coefficients, in the order of the terms. */
  readonly coefficients: number[];
  /** The shape values, in the order of the shapes. */
  readonly shapes: number[];
  /** The sum of the squared residuals. With weights, each squared residual gets the weight of its point. */
  readonly rss: number;
  /** The value of the fit at each point, in the order of the points. */
  readonly fitted: number[];
  /** The number of calls of `design`. Each call is one least-squares fit. */
  readonly evaluations: number;
}

/** The options of a fit of a separable model. */
export interface SeparableOptions {
  /**
   * The weight of each point, in the order of the points. Each weight is finite and more than 0. The default is 1 for
   * each point. The weights `1 / y^2` fit the relative residuals.
   */
  readonly weights?: readonly number[];
}

/** The key of the group of a point. The points of one key are replicates of one load. */
export type SeparableGroup = string | number;

/** The options of `bootstrapSeparable`. */
export interface SeparableBootstrapOptions extends SeparableOptions, Pick<BootstrapOptions, "runs" | "level" | "seed"> {
  /**
   * The group of each point, in the order of the points. Each run draws whole groups with replacement, as many as the
   * data has. The default is a group for each point.
   */
  readonly groups?: readonly SeparableGroup[];
}

/** The coefficients and the shapes of each run of a bootstrap of a separable fit. */
export interface SeparableReplicates {
  /** The fit of all the points. */
  readonly estimate: SeparableFit;
  /** One row for each run with a fit: the coefficients, then the shapes. A run with no fit is not a row. */
  readonly replicates: number[][];
  /** The percentile interval of each column of the replicates, in the same order. */
  readonly intervals: Interval[];
  /** The number of runs, with the runs that have no fit. */
  readonly runs: number;
  /** The seed of the draws, as a number. */
  readonly seed: number;
}

/** The kind of a held-out residual. `"absolute"` is `y - prediction`, and `"relative"` is `y / prediction - 1`. */
export type SeparableResidual = "absolute" | "relative";

/** The options of `heldOutSeparable`. */
export interface HeldOutSeparableOptions extends SeparableOptions {
  /** The group of each point. The fit holds out the points of one key together. The default is a group for each point. */
  readonly groups?: readonly SeparableGroup[];
  /** The kind of the residuals. The default is `"absolute"`. */
  readonly residual?: SeparableResidual;
}

/** The held-out predictions and residuals of a separable model. */
export interface HeldOutSeparable {
  /** The residual of each point, in the order of the points. A point with no prediction has NaN. */
  readonly residuals: number[];
  /** The prediction of each point from the fit of the other groups. A point with no prediction has NaN. */
  readonly predictions: number[];
}

/** The error of a list of residuals. */
export interface FitError {
  /** The mean of the absolute residuals. With no finite residual, it is NaN. */
  readonly mae: number;
  /** The square root of the mean of the squared residuals. With no finite residual, it is NaN. */
  readonly rmse: number;
  /** The number of finite residuals. */
  readonly n: number;
  /** The number of residuals that are not finite. */
  readonly missing: number;
}

/** The options of `rankSeparable`. */
export interface RankSeparableOptions extends HeldOutSeparableOptions {
  /** The error that ranks the models. The default is `"rmse"`. */
  readonly by?: "mae" | "rmse";
}

/** One model in the list of `rankSeparable`. */
export interface SeparableRank {
  /** The key of the model in the record. */
  readonly id: string;
  /** The fit of all the points, or null when the model has no fit. */
  readonly fit: SeparableFit | null;
  /** The error of the held-out residuals. */
  readonly error: FitError;
}

/** The largest number of combinations of the candidates. A larger grid throws a RangeError. */
export const SEPARABLE_MAX_COMBINATIONS = 10_000;

/**
 * The golden-section search of one shape stops when its bracket is this share of its start width or less. Thus each
 * search does approximately 48 steps.
 */
export const SEPARABLE_SEARCH_TOLERANCE = 1e-10;

/** The refine stops when one cycle over the shapes decreases the sum of the squared residuals by this share or less. */
export const SEPARABLE_RSS_TOLERANCE = 1e-12;

/** The largest number of cycles of the refine over the shapes. */
export const SEPARABLE_MAX_CYCLES = 200;

/** The default number of runs of `bootstrapSeparable`. Each run is a full fit, thus the default is less than the 10 000 of `bootstrap`. */
export const SEPARABLE_BOOTSTRAP_RUNS = 1000;

/** The share of a golden section: `(sqrt(5) - 1) / 2`. */
const INVERSE_GOLDEN = (Math.sqrt(5) - 1) / 2;

/** The model and the data of a fit, after the checks. */
interface Problem<X> {
  readonly name: string;
  readonly model: SeparableModel<X>;
  /** The sorted distinct candidates of each shape. */
  readonly lists: readonly (readonly number[])[];
  /** The number of terms. */
  readonly k: number;
}

/** The points of one fit. `roots` is the square root of the weight of each point, or null for no weights. */
interface Sample<X> {
  readonly xs: readonly X[];
  readonly y: readonly number[];
  readonly roots: readonly number[] | null;
}

/** The linear fit at one set of shape values. */
interface Linear {
  readonly shapes: number[];
  readonly coefficients: number[];
  readonly rss: number;
  readonly rows: readonly (readonly number[])[];
}

/**
 * This function fits a separable model to the points `xs` and their values `y`. First, it fits the coefficients at
 * each combination of the candidates. Then, it refines the best combination with a golden-section search of each shape.
 *
 * The bracket of a shape is from the candidate below its best candidate to the candidate above. At the end of the
 * list, the bracket is symmetric about the best candidate. The bounds of the shape clip the bracket.
 *
 * This function gives null when no combination has a finite fit. It throws a RangeError for a fault of the input.
 */
export function fitSeparable<X>(model: SeparableModel<X>, xs: readonly X[], y: readonly number[], options: SeparableOptions = {}): SeparableFit | null {
  const name = "fitSeparable";
  const problem = checkedProblem(name, model, xs, y);
  return search(problem, { xs, y, roots: checkedRoots(name, options.weights, xs.length) });
}

/**
 * This function gives a bootstrap of a separable fit. Each run draws the points, or whole groups, with replacement. Then
 * it fits the drawn points with the full grid and refine. A run with no fit does not count.
 *
 * The intervals are the percentiles of the columns of the replicates. This function gives null when `fitSeparable` of
 * all the points gives null. It throws a RangeError for a fault of the input or of the options.
 */
export function bootstrapSeparable<X>(
  model: SeparableModel<X>,
  xs: readonly X[],
  y: readonly number[],
  options: SeparableBootstrapOptions = {},
): SeparableReplicates | null {
  const name = "bootstrapSeparable";
  const problem = checkedProblem(name, model, xs, y);
  const roots = checkedRoots(name, options.weights, xs.length);
  const groups = checkedGroups(name, options.groups, xs.length);
  const s = settings(name, { ...options, runs: options.runs ?? SEPARABLE_BOOTSTRAP_RUNS });
  const estimate = search(problem, { xs, y, roots });
  if (estimate === null) return null;
  const r = random(options.seed ?? 1);
  const count = groups.length;
  const replicates: number[][] = [];
  for (let run = 0; run < s.runs; run++) {
    const drawn: number[] = [];
    for (let g = 0; g < count; g++) drawn.push(...(groups[r.below(count)] as number[]));
    const fit = search(problem, pick(xs, y, roots, drawn));
    if (fit !== null) replicates.push([...fit.coefficients, ...fit.shapes]);
  }
  const point = [...estimate.coefficients, ...estimate.shapes];
  const intervals = point.map((value, j) => ends(replicates.map((row) => row[j] as number), value, s, r.seed));
  return { estimate, replicates, intervals, runs: s.runs, seed: r.seed };
}

/**
 * This function gives the held-out prediction and residual of each point. For each group, it fits the points of the
 * other groups, and predicts the points of the group. A point whose fit or prediction has no value gives NaN.
 *
 * It throws a RangeError for a fault of the input or of the options.
 */
export function heldOutSeparable<X>(
  model: SeparableModel<X>,
  xs: readonly X[],
  y: readonly number[],
  options: HeldOutSeparableOptions = {},
): HeldOutSeparable {
  const name = "heldOutSeparable";
  const problem = checkedProblem(name, model, xs, y);
  return heldOut(problem, xs, y, checkedRoots(name, options.weights, xs.length), checkedGroups(name, options.groups, xs.length), checkedResidual(name, options.residual));
}

/**
 * This function gives the mean absolute residual and the root mean square residual. A residual that is not finite, for
 * example NaN, counts as missing. It does not count in the means. This function throws a RangeError for an empty list.
 */
export function fitError(residuals: readonly number[]): FitError {
  if (residuals.length === 0) throw new RangeError("fitError: the list of residuals is empty.");
  let n = 0;
  let absolute = 0;
  let square = 0;
  for (const e of residuals) {
    if (!Number.isFinite(e)) continue;
    n++;
    absolute += Math.abs(e);
    square += e * e;
  }
  return { mae: n === 0 ? Number.NaN : absolute / n, rmse: n === 0 ? Number.NaN : Math.sqrt(square / n), n, missing: residuals.length - n };
}

/**
 * This function ranks models by the error of their held-out residuals, best first. A model with a missing residual
 * ranks after each model with none. A NaN error ranks last. Equal errors keep the order of the record.
 *
 * Each entry also gives the fit of all the points. This function throws a RangeError for a fault of the input or of the options.
 */
export function rankSeparable<X>(
  models: Readonly<Record<string, SeparableModel<X>>>,
  xs: readonly X[],
  y: readonly number[],
  options: RankSeparableOptions = {},
): SeparableRank[] {
  const name = "rankSeparable";
  const by = options.by ?? "rmse";
  if (by !== "mae" && by !== "rmse") throw new RangeError(`${name}: by is "mae" or "rmse", not ${String(by)}.`);
  checkedPoints(name, xs, y);
  const roots = checkedRoots(name, options.weights, xs.length);
  const groups = checkedGroups(name, options.groups, xs.length);
  const residual = checkedResidual(name, options.residual);
  const list = Object.entries(models).map(([id, model]): SeparableRank => {
    const problem = checkedProblem(name, model, xs, y);
    const fit = search(problem, { xs, y, roots });
    return { id, fit, error: fitError(heldOut(problem, xs, y, roots, groups, residual).residuals) };
  });
  return list.sort((a, b) => Number(a.error.missing > 0) - Number(b.error.missing > 0) || ascending(a.error[by], b.error[by]));
}

/** This function orders two errors from small to large, with NaN last. */
function ascending(a: number, b: number): number {
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
  if (Number.isNaN(b)) return -1;
  return a - b;
}

/** This function gives the held-out predictions and residuals, after the checks. */
function heldOut<X>(
  problem: Problem<X>,
  xs: readonly X[],
  y: readonly number[],
  roots: readonly number[] | null,
  groups: readonly (readonly number[])[],
  residual: SeparableResidual,
): HeldOutSeparable {
  const n = xs.length;
  const predictions = new Array<number>(n).fill(Number.NaN);
  const held = new Array<boolean>(n).fill(false);
  for (const members of groups) {
    for (const i of members) held[i] = true;
    const kept: number[] = [];
    for (let i = 0; i < n; i++) if (!held[i]) kept.push(i);
    for (const i of members) held[i] = false;
    const fit = search(problem, pick(xs, y, roots, kept));
    if (fit === null) continue;
    const rows = checkedRows(problem, problem.model.design(fit.shapes, members.map((i) => xs[i] as X)), members.length);
    if (rows === null) continue;
    members.forEach((i, q) => {
      const value = dot(rows[q] as readonly number[], fit.coefficients);
      if (Number.isFinite(value)) predictions[i] = value;
    });
  }
  const residuals = y.map((value, i) => {
    const p = predictions[i] as number;
    const e = residual === "absolute" ? value - p : value / p - 1;
    return Number.isFinite(e) ? e : Number.NaN;
  });
  return { residuals, predictions };
}

/** This function gives the points of the indexes `at`, in that order. */
function pick<X>(xs: readonly X[], y: readonly number[], roots: readonly number[] | null, at: readonly number[]): Sample<X> {
  return {
    xs: at.map((i) => xs[i] as X),
    y: at.map((i) => y[i] as number),
    roots: roots === null ? null : at.map((i) => roots[i] as number),
  };
}

/** This function gives the grid search and the refine of a fit, after the checks. */
function search<X>(problem: Problem<X>, sample: Sample<X>): SeparableFit | null {
  const { lists, k } = problem;
  // The least-squares fit needs more points than terms.
  if (sample.xs.length <= k) return null;
  let evaluations = 0;
  const evaluate = (shapes: number[]): Linear | null => {
    evaluations++;
    return linear(problem, sample, shapes);
  };
  // Step 1: each combination of the candidates. The last shape changes fastest.
  const index = new Array<number>(lists.length).fill(0);
  let best: Linear | null = null;
  let bestIndex: number[] = [];
  for (;;) {
    const fit = evaluate(index.map((j, s) => (lists[s] as readonly number[])[j] as number));
    if (fit !== null && (best === null || fit.rss < best.rss)) {
      best = fit;
      bestIndex = [...index];
    }
    let s = lists.length - 1;
    for (; s >= 0; s--) {
      const next = (index[s] as number) + 1;
      if (next < (lists[s] as readonly number[]).length) {
        index[s] = next;
        break;
      }
      index[s] = 0;
    }
    if (s < 0) break;
  }
  if (best === null) return null;
  // Step 2: a golden-section search of each shape in turn, in the bracket of its best candidate.
  const brackets = lists.map((list, s) => bracket(list, bestIndex[s] as number, problem.model.shapes[s] as ShapeParameter));
  for (let cycle = 0; cycle < SEPARABLE_MAX_CYCLES && lists.length > 0; cycle++) {
    const start: number = best.rss;
    for (const [s, [low, high]] of brackets.entries()) {
      if (!(high > low)) continue;
      const base: readonly number[] = best.shapes;
      const found = golden(low, high, (value) => {
        const shapes = [...base];
        shapes[s] = value;
        return evaluate(shapes);
      });
      if (found !== null && found.rss < best.rss) best = found;
    }
    if (!(start - best.rss > SEPARABLE_RSS_TOLERANCE * start)) break;
  }
  const { coefficients } = best;
  return { coefficients, shapes: best.shapes, rss: best.rss, fitted: best.rows.map((row) => dot(row, coefficients)), evaluations };
}

/**
 * This function gives the bracket of the refine of one shape: from the candidate below the best candidate to the
 * candidate above. At an end of the list, the bracket is symmetric about the best candidate. The bounds clip it.
 */
function bracket(list: readonly number[], i: number, shape: ShapeParameter): readonly [number, number] {
  const value = list[i] as number;
  if (list.length === 1) return [value, value];
  const below = i > 0 ? (list[i - 1] as number) : 2 * value - (list[i + 1] as number);
  const above = i < list.length - 1 ? (list[i + 1] as number) : 2 * value - (list[i - 1] as number);
  return [Math.max(below, shape.min ?? Number.NEGATIVE_INFINITY), Math.min(above, shape.max ?? Number.POSITIVE_INFINITY)];
}

/**
 * This function gives the best fit of a golden-section search over `[low, high]`, or null when no step has a fit.
 * A step with no fit has an infinite sum of squares. On equal sums, the search keeps the upper part.
 */
function golden(low: number, high: number, at: (value: number) => Linear | null): Linear | null {
  const kept: { best: Linear | null } = { best: null };
  const rss = (value: number): number => {
    const fit = at(value);
    if (fit === null) return Number.POSITIVE_INFINITY;
    if (kept.best === null || fit.rss < kept.best.rss) kept.best = fit;
    return fit.rss;
  };
  let a = low;
  let b = high;
  let c = b - INVERSE_GOLDEN * (b - a);
  let d = a + INVERSE_GOLDEN * (b - a);
  let fc = rss(c);
  let fd = rss(d);
  const stop = SEPARABLE_SEARCH_TOLERANCE * (high - low);
  while (b - a > stop) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - INVERSE_GOLDEN * (b - a);
      fc = rss(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + INVERSE_GOLDEN * (b - a);
      fd = rss(d);
    }
  }
  return kept.best;
}

/** This function gives the least-squares fit of the coefficients at one set of shape values, or null with no finite fit. */
function linear<X>(problem: Problem<X>, sample: Sample<X>, shapes: number[]): Linear | null {
  const { k } = problem;
  const { xs, y, roots } = sample;
  const rows = checkedRows(problem, problem.model.design(shapes, xs), xs.length);
  if (rows === null) return null;
  const n = xs.length;
  const a = roots === null ? rows : rows.map((row, i) => row.map((v) => v * (roots[i] as number)));
  const b = roots === null ? y : y.map((v, i) => v * (roots[i] as number));
  const coefficients = fitRows(a, b, false, k).coefficients;
  if (!coefficients.every(Number.isFinite)) return null;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += ((b[i] as number) - dot(a[i] as readonly number[], coefficients)) ** 2;
  return Number.isFinite(rss) ? { shapes, coefficients, rss, rows } : null;
}

/**
 * This function examines the rows of a design. It gives null for a null design and for a value that is not finite. It
 * throws a RangeError for a design with the wrong shape.
 */
function checkedRows<X>(problem: Problem<X>, rows: readonly (readonly number[])[] | null, n: number): readonly (readonly number[])[] | null {
  if (rows === null) return null;
  const { name, k } = problem;
  if (rows.length !== n) throw new RangeError(`${name}: the design gives ${rows.length} rows for ${n} points. It gives one row for each point.`);
  for (const [i, row] of rows.entries()) {
    if (row.length !== k) throw new RangeError(`${name}: row ${i} of the design has ${row.length} values, and the model has ${k} terms.`);
    for (const v of row) if (!Number.isFinite(v)) return null;
  }
  return rows;
}

/** This function gives the sum of the products of a row and the coefficients. */
function dot(row: readonly number[], coefficients: readonly number[]): number {
  let sum = 0;
  for (let j = 0; j < coefficients.length; j++) sum += (row[j] as number) * (coefficients[j] as number);
  return sum;
}

/** This function examines the points and the model, and gives the problem of the fit. It throws a RangeError for each fault. */
function checkedProblem<X>(name: string, model: SeparableModel<X>, xs: readonly X[], y: readonly number[]): Problem<X> {
  checkedPoints(name, xs, y);
  const k = model.terms.length;
  if (k === 0) throw new RangeError(`${name}: the model has no term. Give one term or more.`);
  let combinations = 1;
  const lists = model.shapes.map((shape, s) => {
    const label = `shape ${s} ("${shape.id}")`;
    if (shape.candidates.length === 0) throw new RangeError(`${name}: ${label} has no candidate.`);
    const min = shape.min ?? Number.NEGATIVE_INFINITY;
    const max = shape.max ?? Number.POSITIVE_INFINITY;
    if (!(min <= max)) throw new RangeError(`${name}: ${label} has the min ${min} and the max ${max}. The min is not more than the max.`);
    for (const c of shape.candidates) {
      if (!Number.isFinite(c)) throw new RangeError(`${name}: ${label} has a candidate that is not finite: ${c}.`);
      if (c < min || c > max) throw new RangeError(`${name}: ${label} has the candidate ${c}, outside the min ${min} and the max ${max}.`);
    }
    const list = [...new Set(shape.candidates)].sort((p, q) => p - q);
    combinations *= list.length;
    return list;
  });
  if (combinations > SEPARABLE_MAX_COMBINATIONS) {
    throw new RangeError(`${name}: the candidates make ${combinations} combinations. The limit is ${SEPARABLE_MAX_COMBINATIONS}.`);
  }
  return { name, model, lists, k };
}

/** This function examines the points and their values. It throws a RangeError for each fault. */
function checkedPoints<X>(name: string, xs: readonly X[], y: readonly number[]): void {
  if (xs.length === 0) throw new RangeError(`${name}: xs is empty.`);
  if (xs.length !== y.length) throw new RangeError(`${name}: xs has ${xs.length} points and y has ${y.length} values. The two lengths must be equal.`);
  for (const [i, v] of y.entries()) if (!Number.isFinite(v)) throw new RangeError(`${name}: value ${i} of y is not finite.`);
}

/** This function examines the weights, and gives the square root of each weight, or null for no weights. */
function checkedRoots(name: string, weights: readonly number[] | undefined, n: number): number[] | null {
  if (weights === undefined) return null;
  if (weights.length !== n) throw new RangeError(`${name}: weights has ${weights.length} values for ${n} points. The two lengths must be equal.`);
  return weights.map((w, i) => {
    if (!(Number.isFinite(w) && w > 0)) throw new RangeError(`${name}: weight ${i} is a finite number more than 0, not ${w}.`);
    return Math.sqrt(w);
  });
}

/** This function examines the groups, and gives the indexes of the points of each group, in the order of their first point. */
function checkedGroups(name: string, groups: readonly SeparableGroup[] | undefined, n: number): number[][] {
  if (groups === undefined) return Array.from({ length: n }, (_, i) => [i]);
  if (groups.length !== n) throw new RangeError(`${name}: groups has ${groups.length} keys for ${n} points. The two lengths must be equal.`);
  const members = new Map<SeparableGroup, number[]>();
  for (const [i, key] of groups.entries()) {
    if (typeof key !== "string" && typeof key !== "number") throw new RangeError(`${name}: group ${i} is a string or a number, not ${typeof key}.`);
    const list = members.get(key);
    if (list) list.push(i);
    else members.set(key, [i]);
  }
  return [...members.values()];
}

/** This function examines the kind of the residuals, and gives the default. */
function checkedResidual(name: string, residual: SeparableResidual | undefined): SeparableResidual {
  const kind = residual ?? "absolute";
  if (kind !== "absolute" && kind !== "relative") throw new RangeError(`${name}: residual is "absolute" or "relative", not ${String(kind)}.`);
  return kind;
}
