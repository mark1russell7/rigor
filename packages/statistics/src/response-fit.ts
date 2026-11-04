/**
 * The fit of `response-records/1`. The function `fitResponse` splits the groups into folds. For each fold, it fits a
 * model on the other folds and scores the model on the fold. Then it fits the model of the record on all the points.
 *
 * The coordinates of a ridge model come from the declared ranges, not from the points. Thus each fold has the same
 * design, and no fact of a held-out point goes into a fit. The penalty of a fold comes from the other folds only.
 */
import { random } from "@mark1russell7/rigor-generators";
import { mean } from "./describe.ts";
import { RESPONSE_MAX_POWER, factorFaults, responseDataFaults } from "./response-parse.ts";
import {
  RESPONSE_RECORDS_SCHEMA,
  type ResponseData,
  type ResponseDimension,
  type ResponseFactor,
  type ResponseFold,
  type ResponseFoldError,
  type ResponseMeasure,
  type ResponseModel,
  type ResponsePoint,
  type ResponseRecord,
  type ResponseTableCell,
  type ResponseValue,
  type RidgeInput,
  axisEnds,
  coordinates,
  groupKey,
  isNumberDimension,
  product,
} from "./response.ts";
import { ridgeSolve } from "./ridge.ts";

/** The options of `fitResponse`. */
export interface ResponseFitOptions {
  /** The number of folds, 3 or more. With fewer groups, each group is one fold. The default is 5. */
  readonly folds?: number;
  /** The seed of the split. The default is 1. */
  readonly seed?: number | string;
  /** The kind of model. The default `auto` gives a table when each dimension is categorical, and a ridge fit otherwise. */
  readonly model?: "auto" | "ridge" | "table";
  /** The largest total power of a term of a ridge fit, from 1 to 8. The default is 2. */
  readonly degree?: number;
  /** When true, a ridge fit also has the products of two dimensions, up to `degree`. The default is true. */
  readonly interactions?: boolean;
  /** The stated terms of a ridge fit, in place of `degree` and `interactions`. */
  readonly terms?: readonly (readonly ResponseFactor[])[];
  /** The penalties that a ridge fit chooses from, each above 0. The default is `RESPONSE_LAMBDAS`. */
  readonly lambdas?: readonly number[];
  /** The ids of the measures to fit on a log scale. */
  readonly log?: readonly string[];
  /** On a log scale, each smaller value takes this value. With no floor, a value of 0 or less is an error. */
  readonly logFloor?: number;
}

/** The default penalties of a ridge fit. The coordinates are from -1 to 1, so one list suits each record. */
export const RESPONSE_LAMBDAS: readonly number[] = [1e-6, 1e-4, 1e-3, 1e-2, 1e-1, 1, 10, 100];

/** The largest number of coefficients of a ridge fit. The memory of each fold grows as the square of this number. */
export const RESPONSE_MAX_TERMS = 1024;

/** One value of a measure, on the scale of the model. */
interface Row {
  readonly point: ResponsePoint;
  readonly y: number;
  readonly fold: number;
}

/** A fit that leaves out one fold. Its result gives the prediction of a row, by the index of the row. */
type Learner = (fold: number) => (row: number) => number;

/** The terms and the other choices that apply to each measure. */
interface Plan {
  readonly ids: readonly string[];
  readonly kind: "ridge" | "table";
  readonly folds: number;
  readonly lambdas: readonly number[];
  readonly terms: readonly (readonly ResponseFactor[])[];
  readonly inputs: readonly RidgeInput[];
}

/** This function compares two texts by their code units, so the order does not depend on a locale. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** This function gives the input of a ridge model for a dimension. The coordinates run from -1 to 1 over the dimension. */
function inputOf(dimension: ResponseDimension): RidgeInput {
  if (dimension.kind === "categorical") return { kind: "level", dimension: dimension.id, levels: dimension.levels };
  const [low, high] = axisEnds(dimension);
  const center = (low + high) / 2;
  const spread = high > low ? (high - low) / 2 : 1;
  if (!isNumberDimension(dimension)) return { kind: "rank", dimension: dimension.id, levels: dimension.levels as readonly string[], center, spread };
  return { kind: "number", dimension: dimension.id, center, spread, ...(dimension.log === true ? { log: true } : {}) };
}

/** This function gives the factors of one dimension, each with its power. */
function factorsOf(dimension: ResponseDimension, degree: number): readonly (readonly [ResponseFactor, number])[] {
  if (dimension.kind === "categorical") return dimension.levels.map((level) => [{ dimension: dimension.id, level }, 1] as const);
  return Array.from({ length: degree }, (_, i) => [{ dimension: dimension.id, power: i + 1 }, i + 1] as const);
}

/** This function gives the terms of the expansion: each factor, and each product of two dimensions up to `degree`. */
function expansion(dimensions: readonly ResponseDimension[], degree: number, interactions: boolean): readonly (readonly ResponseFactor[])[] {
  const each = dimensions.map((d) => factorsOf(d, degree));
  const terms: (readonly ResponseFactor[])[] = each.flatMap((factors) => factors.map(([factor]) => [factor]));
  if (!interactions) return terms;
  each.forEach((first, a) => {
    for (const second of each.slice(a + 1)) {
      for (const [f, p] of first) for (const [g, q] of second) if (p + q <= degree) terms.push([f, g]);
    }
  });
  return terms;
}

/** This function gives the inputs of a ridge fit: one for each dimension of a term. It throws for a bad term. */
function checkedInputs(dimensions: readonly ResponseDimension[], terms: readonly (readonly ResponseFactor[])[]): readonly RidgeInput[] {
  const used = new Set(terms.flatMap((t) => t.map((f) => f.dimension)));
  const inputs = dimensions.filter((d) => used.has(d.id)).map(inputOf);
  const known = new Map(inputs.map((input) => [input.dimension, input]));
  terms.forEach((term, i) => {
    const [fault] = factorFaults(term, `terms[${i}]`, known);
    if (fault !== undefined) throw new RangeError(`fitResponse: ${fault.path}: ${fault.message}`);
  });
  return inputs;
}

/**
 * This function gives the ridge fits of the rows of one measure. It keeps `X'X` and `X'y` of each fold, so a fit adds
 * the sums of its training folds. The first coefficient is the intercept, and it has no penalty.
 */
function ridgeLearner(rows: readonly Row[], plan: Plan): { readonly learner: Learner; readonly final: () => { readonly lambda: number; readonly beta: readonly number[] } } {
  const { terms, inputs, folds, lambdas } = plan;
  const k = terms.length + 1;
  const design = new Float64Array(rows.length * k);
  const grams = Array.from({ length: folds }, () => new Float64Array(k * k));
  const moments = Array.from({ length: folds }, () => new Float64Array(k));
  rows.forEach((row, r) => {
    const at = coordinates(inputs, row.point.values);
    const offset = r * k;
    design[offset] = 1;
    terms.forEach((term, j) => {
      design[offset + j + 1] = product(term, at);
    });
    const gram = grams[row.fold] as Float64Array;
    const moment = moments[row.fold] as Float64Array;
    for (let a = 0; a < k; a++) {
      const value = design[offset + a] as number;
      moment[a] = (moment[a] as number) + value * row.y;
      for (let b = 0; b <= a; b++) gram[a * k + b] = (gram[a * k + b] as number) + value * (design[offset + b] as number);
    }
  });
  const predict = (beta: readonly number[], r: number): number => {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += (beta[j] as number) * (design[r * k + j] as number);
    return sum;
  };
  const solve = (left: readonly (number | undefined)[], lambda: number): number[] => {
    const gram = new Float64Array(k * k);
    const moment = new Float64Array(k);
    for (let f = 0; f < folds; f++) {
      if (left.includes(f)) continue;
      const g = grams[f] as Float64Array;
      const m = moments[f] as Float64Array;
      for (let i = 0; i < k * k; i++) gram[i] = (gram[i] as number) + (g[i] as number);
      for (let i = 0; i < k; i++) moment[i] = (moment[i] as number) + (m[i] as number);
    }
    return ridgeSolve(gram, moment, lambda, { free: [0] });
  };
  // Each other fold scores a penalty on the rows outside `outer`. A tie or a singular fit keeps the larger penalty.
  const choose = (outer: number | undefined): number => {
    const descending = [...lambdas].sort((a, b) => b - a);
    let best = descending[0] as number;
    let bestError = Number.POSITIVE_INFINITY;
    for (const lambda of descending) {
      let error = 0;
      for (let f = 0; f < folds; f++) {
        if (f === outer) continue;
        const beta = solve([outer, f], lambda);
        rows.forEach((row, r) => {
          if (row.fold === f) error += (row.y - predict(beta, r)) ** 2;
        });
      }
      if (error < bestError) [best, bestError] = [lambda, error];
    }
    return best;
  };
  return {
    learner: (fold) => {
      const beta = solve([fold], choose(fold));
      return (r) => predict(beta, r);
    },
    final: () => {
      const lambda = choose(undefined);
      return { lambda, beta: solve([], lambda) };
    },
  };
}

/** This function gives the mean of the rows of each combination of levels, as cells in the order of their text. */
function tableCells(rows: readonly Row[], dimensions: readonly string[]): readonly ResponseTableCell[] {
  const cells = new Map<string, { readonly at: readonly ResponseValue[]; readonly ys: number[] }>();
  for (const row of rows) {
    const at = dimensions.map((d) => row.point.values[d] as ResponseValue);
    const key = JSON.stringify(at);
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, { at, ys: [row.y] });
    else cell.ys.push(row.y);
  }
  return [...cells.keys()].sort(byText).map((key) => {
    const { at, ys } = cells.get(key) as { readonly at: readonly ResponseValue[]; readonly ys: number[] };
    return { at, value: mean(ys), n: ys.length };
  });
}

/** This function gives the fits of a table: the mean of each cell, or the mean of the rows for a cell with no row. */
function tableLearner(rows: readonly Row[], dimensions: readonly string[]): Learner {
  const keys = rows.map((row) => JSON.stringify(dimensions.map((d) => row.point.values[d])));
  return (fold) => {
    const train = rows.filter((row) => row.fold !== fold);
    const cells = new Map(tableCells(train, dimensions).map((c) => [JSON.stringify(c.at), c.value]));
    const fallback = mean(train.map((row) => row.y));
    return (r) => cells.get(keys[r] as string) ?? fallback;
  };
}

/** This function gives the error of a fold. A fold with no held-out row or no training row has no error. */
function foldError(rows: readonly Row[], fold: number, learner: Learner): ResponseFoldError | undefined {
  const train = rows.filter((row) => row.fold !== fold).map((row) => row.y);
  const held = rows.flatMap((row, r) => (row.fold === fold ? [r] : []));
  if (held.length === 0 || train.length === 0) return undefined;
  const predict = learner(fold);
  const baseline = mean(train);
  const errors = held.map((r) => (rows[r] as Row).y - predict(r));
  return {
    n: held.length,
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((e) => e * e))),
    baselineMae: mean(held.map((r) => Math.abs((rows[r] as Row).y - baseline))),
  };
}

/** This function gives the rows of a measure. It throws a RangeError for a value that a log scale cannot read. */
function rowsOf(points: readonly ResponsePoint[], measure: string, log: boolean, floor: number | undefined, foldOf: ReadonlyMap<string, number>): readonly Row[] {
  return points.flatMap((point) => {
    const value = point.measures[measure];
    if (typeof value !== "number") return [];
    if (log && floor === undefined && value <= 0) throw new RangeError(`fitResponse: the point "${point.id}" has the value ${value} of the log measure "${measure}". Give logFloor.`);
    const y = log ? Math.log10(Math.max(value, floor ?? value)) : value;
    return [{ point, y, fold: foldOf.get(groupKey(point)) as number }];
  });
}

/** This function gives the model of one measure on all its rows, and the error of each fold. */
function fitMeasure(rows: readonly Row[], measure: ResponseMeasure, log: boolean, floor: number | undefined, plan: Plan): { readonly model: ResponseModel; readonly errors: readonly (ResponseFoldError | undefined)[] } {
  if (rows.length === 0) throw new RangeError(`fitResponse: no point has a value of the measure "${measure.id}".`);
  const base = { measure: measure.id, scale: log ? ("log" as const) : ("linear" as const), ...(log && floor !== undefined ? { floor } : {}) };
  const ridge = plan.kind === "ridge" ? ridgeLearner(rows, plan) : undefined;
  const learner = ridge?.learner ?? tableLearner(rows, plan.ids);
  const errors = Array.from({ length: plan.folds }, (_, f) => foldError(rows, f, learner));
  if (errors.every((e) => e === undefined)) throw new RangeError(`fitResponse: all the values of the measure "${measure.id}" are in one fold. Give more groups.`);
  if (ridge === undefined) return { model: { kind: "table", ...base, dimensions: plan.ids, cells: tableCells(rows, plan.ids), fallback: mean(rows.map((r) => r.y)) }, errors };
  const { lambda, beta } = ridge.final();
  if (!beta.every(Number.isFinite)) throw new RangeError(`fitResponse: the fit of the measure "${measure.id}" with lambda ${lambda} is singular. Give a larger lambda.`);
  const terms = plan.terms.map((factors, j) => ({ factors, weight: beta[j + 1] as number }));
  return { model: { kind: "ridge", ...base, lambda, inputs: plan.inputs, intercept: beta[0] as number, terms }, errors };
}

/** This function examines the options that do not depend on the data, and it gives the number of folds and the penalties. */
function checkedOptions(options: ResponseFitOptions): { readonly folds: number; readonly degree: number; readonly lambdas: readonly number[] } {
  const { folds = 5, degree = 2, lambdas = RESPONSE_LAMBDAS, logFloor } = options;
  if (!Number.isSafeInteger(folds) || folds < 3) throw new RangeError(`fitResponse: folds is a whole number of 3 or more, not ${folds}.`);
  if (!Number.isSafeInteger(degree) || degree < 1 || degree > RESPONSE_MAX_POWER) throw new RangeError(`fitResponse: degree is a whole number from 1 to ${RESPONSE_MAX_POWER}, not ${degree}.`);
  if (lambdas.length === 0 || !lambdas.every((l) => Number.isFinite(l) && l > 0)) throw new RangeError("fitResponse: lambdas is a list of finite numbers above 0, with one item or more.");
  if (logFloor !== undefined && !(Number.isFinite(logFloor) && logFloor > 0)) throw new RangeError(`fitResponse: logFloor is a finite number above 0, not ${logFloor}.`);
  return { folds, degree, lambdas };
}

/** This function gives the kind of model. It throws a RangeError when a table cannot read a dimension. */
function kindOf(dimensions: readonly ResponseDimension[], model: "auto" | "ridge" | "table"): "ridge" | "table" {
  const continuous = dimensions.find((d) => d.kind === "continuous");
  if (model === "table" && continuous !== undefined) throw new RangeError(`fitResponse: a table cannot read the continuous dimension "${continuous.id}".`);
  if (model !== "auto") return model;
  return dimensions.every((d) => d.kind === "categorical") ? "table" : "ridge";
}

/**
 * This function fits each measure of `data`, and it gives a record with the models and the folds.
 *
 * The split: the groups, sorted and then shuffled with `seed`, go to the folds in turn. A point with no group is a
 * group of its own. Thus the repeats of one group are not on both sides of a split. The same split applies to each
 * measure. A record needs 3 groups or more.
 *
 * The model: a ridge fit over a stated expansion, or the mean of each cell of a table. The default expansion has
 * each power of each number dimension up to `degree`. It has one column for each level of a categorical dimension.
 * It also has the products of two dimensions up to `degree`. Each coordinate goes from -1 to 1 over the declared
 * range. The intercept has no penalty.
 *
 * The penalty: each fold of a ridge fit chooses from `lambdas` with the other folds. Thus the held-out error of a
 * fold is not optimistic. The model of the record chooses with all the folds.
 *
 * The errors: a fold scores the model of the other folds on its held-out points, on the scale of the model.
 *
 * The result does not depend on the order of the points, except for the field `points`, which keeps the order of
 * the data. The same data and options give the same bytes in one JavaScript engine.
 *
 * The function throws a RangeError for data with a fault, for a bad option, and for fewer than 3 groups. It also
 * throws for a measure with no value, and for a measure with all its values in one fold. It throws for a value of 0
 * or less on a log scale with no `logFloor`. It throws for more than `RESPONSE_MAX_TERMS` terms.
 */
export function fitResponse(data: ResponseData, options: ResponseFitOptions = {}): ResponseRecord {
  const [fault] = responseDataFaults(data, [], ["models", "folds"]);
  if (fault !== undefined) throw new RangeError(`fitResponse: ${fault.path === "" ? "the data" : fault.path}: ${fault.message}`);
  const { degree, lambdas, folds: wanted } = checkedOptions(options);
  const { dimensions, measures } = data;
  const log = new Set(options.log ?? []);
  for (const id of log) if (!measures.some((m) => m.id === id)) throw new RangeError(`fitResponse: the option log names the unknown measure "${id}".`);
  const kind = kindOf(dimensions, options.model ?? "auto");
  const terms = kind === "table" ? [] : (options.terms ?? expansion(dimensions, degree, options.interactions ?? true));
  if (terms.length + 1 > RESPONSE_MAX_TERMS) throw new RangeError(`fitResponse: the expansion has ${terms.length} terms, and the limit is ${RESPONSE_MAX_TERMS - 1}. Set interactions to false, or give terms.`);
  const inputs = checkedInputs(dimensions, terms);
  const points = [...data.points].sort((a, b) => byText(a.id, b.id));
  const groups = [...new Set(points.map(groupKey))].sort(byText);
  if (groups.length < 3) throw new RangeError(`fitResponse: the points have ${groups.length} groups, and a held-out split needs 3 or more.`);
  const folds = Math.min(wanted, groups.length);
  const shuffled = random(options.seed ?? 1).shuffle(groups);
  const foldOf = new Map(shuffled.map((group, i) => [group, i % folds]));
  const plan: Plan = { ids: dimensions.map((d) => d.id), kind, folds, lambdas, terms, inputs };
  const fits = measures.map((m) => fitMeasure(rowsOf(points, m.id, log.has(m.id), options.logFloor, foldOf), m, log.has(m.id), options.logFloor, plan));
  const foldRecords: readonly ResponseFold[] = Array.from({ length: folds }, (_, f) => ({
    heldOut: points.filter((p) => foldOf.get(groupKey(p)) === f).map((p) => p.id),
    errors: Object.fromEntries(
      measures.flatMap((m, i) => {
        const error = fits[i]?.errors[f];
        return error === undefined ? [] : [[m.id, error]];
      }),
    ),
  }));
  return { schema: RESPONSE_RECORDS_SCHEMA, name: data.name, dimensions, measures, points: data.points, models: fits.map((fit) => fit.model), folds: foldRecords };
}
