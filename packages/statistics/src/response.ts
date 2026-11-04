/**
 * The format `response-records/1`: the measured points of a function of many dimensions, with a fitted model and the
 * held-out error of each measure. A record is plain JSON. A browser reads it with `parseResponseRecord`, and it
 * evaluates the models with `predictResponse`. A view shows one dimension with `sliceResponse`, or two dimensions
 * with `surfaceResponse`, and it holds the other dimensions.
 *
 * This file has the types and the pure functions that read a record. `response-parse.ts` has the validator, and
 * `response-fit.ts` has the fit. The three files use no Node import, no clock and no `Math.random`.
 *
 * A model calculates integer powers with multiplication, so its terms are equal in each JavaScript engine. A log
 * scale uses `Math.log10` and `10 ** x`. An engine can give a different last bit for these two operations.
 */
import { quantile } from "./describe.ts";

/** The value of the field `schema` of a record. */
export const RESPONSE_RECORDS_SCHEMA = "response-records/1";

/** The value of a dimension at a point: a number, or the text of a level. */
export type ResponseValue = number | string;

/** The fields of each kind of dimension. */
export interface ResponseDimensionBase {
  /** The key of the dimension in the values of a point. */
  readonly id: string;
  /** The name that a view shows. */
  readonly label: string;
  /** The unit. An empty string means that the dimension has no unit. */
  readonly unit: string;
}

/** A dimension with each number in a range. */
export interface ContinuousDimension extends ResponseDimensionBase {
  readonly kind: "continuous";
  /** The smallest and the largest value. The first is less than the second. */
  readonly range: readonly [number, number];
  /** When true, a model and an axis use the base-10 logarithm of the value. All of the range is above 0. */
  readonly log?: boolean;
}

/** A dimension with levels in order. Number levels ascend. A model reads a text level as its position. */
export interface OrdinalDimension extends ResponseDimensionBase {
  readonly kind: "ordinal";
  readonly levels: readonly number[] | readonly string[];
  /** When true, a model uses the base-10 logarithm of the level. The levels are numbers above 0. */
  readonly log?: boolean;
}

/** A dimension with levels that have no order, for example the arms of a benchmark. */
export interface CategoricalDimension extends ResponseDimensionBase {
  readonly kind: "categorical";
  readonly levels: readonly string[];
}

/** A dimension of a record. */
export type ResponseDimension = ContinuousDimension | OrdinalDimension | CategoricalDimension;

/** A measured value of each point. */
export interface ResponseMeasure {
  /** The key of the measure in the measures of a point. */
  readonly id: string;
  readonly label: string;
  /** The unit. An empty string means that the measure has no unit. */
  readonly unit: string;
  /** The better direction of the value. The value `none` means that no direction is better. */
  readonly direction: "higher" | "lower" | "none";
}

/** One measured point. */
export interface ResponsePoint {
  readonly id: string;
  /** The value of each dimension. */
  readonly values: Readonly<Record<string, ResponseValue>>;
  /** The value of each measure. The value `null` means that the run did not give the measure at this point. */
  readonly measures: Readonly<Record<string, number | null>>;
  /** The points of one group stay on one side of each split, for example the repeats of one seed. */
  readonly group?: string;
}

/** One factor of a term: a power of a number dimension, or 1 at a level and 0 at each other level. */
export type ResponseFactor = { readonly dimension: string; readonly power: number } | { readonly dimension: string; readonly level: string };

/** The coordinate of a number dimension: the value (or its logarithm), less `center`, divided by `spread`. */
export interface RidgeNumberInput {
  readonly kind: "number";
  readonly dimension: string;
  readonly center: number;
  readonly spread: number;
  readonly log?: boolean;
}

/** The coordinate of an ordinal dimension with text levels: the position of the level, as in `RidgeNumberInput`. */
export interface RidgeRankInput {
  readonly kind: "rank";
  readonly dimension: string;
  readonly levels: readonly string[];
  readonly center: number;
  readonly spread: number;
}

/** A categorical dimension: the factors of its levels are the one-hot columns. */
export interface RidgeLevelInput {
  readonly kind: "level";
  readonly dimension: string;
  readonly levels: readonly string[];
}

/** An input of a ridge model. The model holds it, so `predictResponse` needs no record. */
export type RidgeInput = RidgeNumberInput | RidgeRankInput | RidgeLevelInput;

/** A term of a ridge model: the product of its factors, times the weight. */
export interface RidgeTerm {
  readonly factors: readonly ResponseFactor[];
  readonly weight: number;
}

/** The fields of each kind of model. */
export interface ResponseModelBase {
  /** The id of the measure of the model. */
  readonly measure: string;
  /** With `log`, the model and the held-out errors use the base-10 logarithm of the measure. */
  readonly scale: "linear" | "log";
  /** With the scale `log`, the fit gave this value to each smaller measured value. */
  readonly floor?: number;
}

/** A ridge fit over a stated expansion: the intercept, plus the sum of the terms. */
export interface RidgeResponseModel extends ResponseModelBase {
  readonly kind: "ridge";
  /** The penalty of the fit. */
  readonly lambda: number;
  readonly inputs: readonly RidgeInput[];
  readonly intercept: number;
  readonly terms: readonly RidgeTerm[];
}

/** One cell of a table model. */
export interface ResponseTableCell {
  /** The value of each dimension of the table, in the order of its `dimensions`. */
  readonly at: readonly ResponseValue[];
  /** The mean of the measured values of the cell, on the scale of the model. */
  readonly value: number;
  /** The number of points of the cell. */
  readonly n: number;
}

/** The mean of each measured combination of levels. */
export interface TableResponseModel extends ResponseModelBase {
  readonly kind: "table";
  readonly dimensions: readonly string[];
  readonly cells: readonly ResponseTableCell[];
  /** The value of a combination with no cell: the mean of all the fitted points, on the scale of the model. */
  readonly fallback: number;
}

/** A model that a browser evaluates from plain JSON. */
export type ResponseModel = RidgeResponseModel | TableResponseModel;

/** The held-out error of one measure in one fold, on the scale of the model. */
export interface ResponseFoldError {
  /** The number of held-out points with a value of the measure. */
  readonly n: number;
  /** The mean absolute error. */
  readonly mae: number;
  /** The root mean square error. */
  readonly rmse: number;
  /** The mean absolute error of the mean of the training points, used as the prediction. */
  readonly baselineMae: number;
}

/** One split of the points. The fold held out `heldOut`, and it fit a model on the other points. */
export interface ResponseFold {
  /** The ids of the held-out points. */
  readonly heldOut: readonly string[];
  /** The error of each measure. A measure with no held-out point or no training point has no entry. */
  readonly errors: Readonly<Record<string, ResponseFoldError>>;
}

/** The data of a record, before a fit. */
export interface ResponseData {
  readonly schema: typeof RESPONSE_RECORDS_SCHEMA;
  readonly name: string;
  readonly dimensions: readonly ResponseDimension[];
  readonly measures: readonly ResponseMeasure[];
  readonly points: readonly ResponsePoint[];
}

/** A record: the data, one model for each measure, and the folds. */
export interface ResponseRecord extends ResponseData {
  readonly models: readonly ResponseModel[];
  readonly folds: readonly ResponseFold[];
}

/** The held-out error of one measure over all the folds, on the scale of the model. */
export interface ResponseHeldOutError {
  /** The number of held-out points. */
  readonly n: number;
  /** The number of folds with this measure. */
  readonly folds: number;
  /** The mean absolute error of all the held-out points. */
  readonly mae: number;
  /** The root mean square error of all the held-out points. */
  readonly rmse: number;
  /** The mean absolute error of the baseline. */
  readonly baselineMae: number;
  /** The value `1 - mae / baselineMae`. The value 0 is no better than the mean. A baseline of 0 gives `null`. */
  readonly skill: number | null;
}

/** The options of `sliceResponse` and `surfaceResponse`. */
export interface ResponseViewOptions {
  /** The value of each held dimension. Each other dimension takes its usual value, as `sliceResponse` tells. */
  readonly hold?: Readonly<Record<string, ResponseValue>>;
  /** The number of values on a continuous axis, 2 or more. The default is 33. */
  readonly steps?: number;
  /**
   * The share of the range of a held number dimension in which a point matches. A log dimension uses the log scale.
   * The default is 0: only an equal value matches.
   */
  readonly tolerance?: number;
  /** The half width of the band, as a multiple of the held-out root mean square error. The default is 1. */
  readonly width?: number;
}

/** The options of `sliceResponse`. */
export interface ResponseSliceOptions extends ResponseViewOptions {
  /** The id of the dimension of the curve. */
  readonly vary: string;
}

/** The options of `surfaceResponse`. */
export interface ResponseSurfaceOptions extends ResponseViewOptions {
  /** The ids of the two dimensions of the surface: first the x axis, then the y axis. */
  readonly vary: readonly [string, string];
}

/** The fitted value at one place, with its band. */
export interface ResponseBand {
  readonly value: number;
  readonly low: number;
  readonly high: number;
}

/** One place of a curve. */
export interface ResponseCurvePoint extends ResponseBand {
  /** The value of the varied dimension. */
  readonly at: ResponseValue;
}

/** A measured point of a slice. */
export interface ResponseSlicePoint {
  readonly id: string;
  /** The value of the varied dimension. */
  readonly at: ResponseValue;
  readonly value: number;
  readonly group?: string;
}

/** The fitted curve over one dimension, and the measured points that match the held values. */
export interface ResponseSlice {
  readonly measure: string;
  readonly vary: string;
  /** The value of each other dimension. */
  readonly held: Readonly<Record<string, ResponseValue>>;
  readonly curve: readonly ResponseCurvePoint[];
  readonly points: readonly ResponseSlicePoint[];
  readonly error: ResponseHeldOutError;
}

/** A measured point of a surface. */
export interface ResponseSurfacePoint {
  readonly id: string;
  /** The values of the two varied dimensions. */
  readonly at: readonly [ResponseValue, ResponseValue];
  readonly value: number;
  readonly group?: string;
}

/** The fitted surface over two dimensions, and the measured points that match the held values. */
export interface ResponseSurface {
  readonly measure: string;
  readonly vary: readonly [string, string];
  /** The value of each other dimension. */
  readonly held: Readonly<Record<string, ResponseValue>>;
  readonly x: readonly ResponseValue[];
  readonly y: readonly ResponseValue[];
  /** One row for each value of `y`. Each row has one cell for each value of `x`. */
  readonly cells: readonly (readonly ResponseBand[])[];
  readonly points: readonly ResponseSurfacePoint[];
  readonly error: ResponseHeldOutError;
}

/** This function gives the key of the group of a point. A point without a group is a group of its own. */
export function groupKey(point: ResponsePoint): string {
  return point.group === undefined ? `point ${JSON.stringify(point.id)}` : `group ${JSON.stringify(point.group)}`;
}

/** This function gives true for a dimension whose value is a number. */
export function isNumberDimension(dimension: ResponseDimension): dimension is ContinuousDimension | (OrdinalDimension & { readonly levels: readonly number[] }) {
  return dimension.kind === "continuous" || (dimension.kind === "ordinal" && typeof dimension.levels[0] === "number");
}

/** This function gives the low and the high end of a dimension on the numeric axis of a model. */
export function axisEnds(dimension: ResponseDimension): readonly [number, number] {
  if (!isNumberDimension(dimension)) return [0, dimension.levels.length - 1];
  const values = dimension.kind === "continuous" ? dimension.range : dimension.levels;
  const low = values[0] as number;
  const high = values[values.length - 1] as number;
  return dimension.log === true ? [Math.log10(low), Math.log10(high)] : [low, high];
}

/** This function gives the reason that `value` is not a value of `dimension`. It gives `undefined` for a good value. */
export function valueFault(dimension: ResponseDimension, value: unknown): string | undefined {
  if (dimension.kind === "continuous") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `the value ${JSON.stringify(value)} is not a finite number`;
    const [low, high] = dimension.range;
    return value < low || value > high ? `the value ${value} is outside the range ${low} to ${high}` : undefined;
  }
  return (dimension.levels as readonly unknown[]).includes(value) ? undefined : `the value ${JSON.stringify(value)} is not a level of the dimension`;
}

/** This function gives the input of a dimension. It reads only a field of the object, not of its prototype. */
function inputValue(inputs: Readonly<Record<string, ResponseValue>>, dimension: string): ResponseValue {
  if (!Object.hasOwn(inputs, dimension)) throw new RangeError(`predictResponse: the inputs have no value of the dimension "${dimension}".`);
  return inputs[dimension] as ResponseValue;
}

/** This function gives the coordinate of one input of a ridge model. */
function coordinate(input: RidgeInput, value: ResponseValue): number | string {
  const bad = (reason: string): RangeError => new RangeError(`predictResponse: the value ${JSON.stringify(value)} of the dimension "${input.dimension}" ${reason}.`);
  if (input.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw bad("is not a finite number");
    if (input.log === true && value <= 0) throw bad("is not above 0, and the dimension has a log scale");
    return ((input.log === true ? Math.log10(value) : value) - input.center) / input.spread;
  }
  const position = input.levels.indexOf(value as string);
  if (position < 0) throw bad("is not a level of the model");
  return input.kind === "rank" ? (position - input.center) / input.spread : (value as string);
}

/** This function gives the coordinate of each input of a ridge model. */
export function coordinates(inputs: readonly RidgeInput[], values: Readonly<Record<string, ResponseValue>>): Map<string, number | string> {
  return new Map(inputs.map((input) => [input.dimension, coordinate(input, inputValue(values, input.dimension))]));
}

/** This function gives the product of the factors of a term at `at`. A power is a loop of multiplications. */
export function product(factors: readonly ResponseFactor[], at: ReadonlyMap<string, number | string>): number {
  let value = 1;
  for (const factor of factors) {
    const c = at.get(factor.dimension);
    if ("level" in factor) {
      if (c !== factor.level) return 0;
    } else for (let i = 0; i < factor.power; i++) value *= c as number;
  }
  return value;
}

/** This function gives the prediction on the scale of the model. The sum with 0 removes a negative zero. */
function predictScaled(model: ResponseModel, inputs: Readonly<Record<string, ResponseValue>>): number {
  if (model.kind === "table") {
    const at = model.dimensions.map((d) => inputValue(inputs, d));
    return model.cells.find((cell) => cell.at.every((v, i) => v === at[i]))?.value ?? model.fallback;
  }
  const at = coordinates(model.inputs, inputs);
  let sum = model.intercept;
  for (const term of model.terms) sum += term.weight * product(term.factors, at);
  return sum + 0;
}

/** This function changes a value from the scale of the model to the scale of the measure. */
function unscale(model: ResponseModel, value: number): number {
  return model.scale === "log" ? 10 ** value : value;
}

/**
 * This function gives the value of a model at `inputs`, on the scale of the measure. The inputs have a value for each
 * dimension that the model reads. A table model gives its `fallback` for a combination with no cell.
 *
 * The function throws a RangeError for a missing input and for a value that is not a number or a level of the model.
 * It also throws for a value at or below 0 on a log scale. A number outside the range of the record is good, so the
 * function extrapolates.
 */
export function predictResponse(model: ResponseModel, inputs: Readonly<Record<string, ResponseValue>>): number {
  return unscale(model, predictScaled(model, inputs));
}

/**
 * This function gives the held-out error of a measure over all the folds. Each point has the same weight, so a small
 * fold has a small effect. The function throws a RangeError when no fold has the measure.
 */
export function heldOutError(record: Pick<ResponseRecord, "folds">, measure: string): ResponseHeldOutError {
  let n = 0;
  let folds = 0;
  let absolute = 0;
  let square = 0;
  let baseline = 0;
  for (const fold of record.folds) {
    if (!Object.hasOwn(fold.errors, measure)) continue;
    const error = fold.errors[measure] as ResponseFoldError;
    n += error.n;
    folds += 1;
    absolute += error.n * error.mae;
    square += error.n * error.rmse * error.rmse;
    baseline += error.n * error.baselineMae;
  }
  if (n === 0) throw new RangeError(`heldOutError: no fold has an error of the measure "${measure}".`);
  const mae = absolute / n;
  const baselineMae = baseline / n;
  return { n, folds, mae, rmse: Math.sqrt(square / n), baselineMae, skill: baselineMae > 0 ? 1 - mae / baselineMae : null };
}

/** The parts of a slice or a surface that do not depend on the number of varied dimensions. */
interface Frame {
  readonly held: Readonly<Record<string, ResponseValue>>;
  readonly axes: readonly (readonly ResponseValue[])[];
  readonly matched: readonly ResponsePoint[];
  readonly error: ResponseHeldOutError;
  readonly band: (inputs: Readonly<Record<string, ResponseValue>>) => ResponseBand;
}

/** This function gives the usual value of a dimension: a measured median, or the most common level. */
function usualValue(dimension: ResponseDimension, points: readonly ResponsePoint[]): ResponseValue {
  const values = points.map((p) => p.values[dimension.id] as ResponseValue);
  if (dimension.kind === "continuous") return quantile(values as number[], 0.5, "nearest-rank");
  let best = dimension.levels[0] as ResponseValue;
  let most = 0;
  for (const level of dimension.levels) {
    const count = values.filter((v) => v === level).length;
    if (count > most) [best, most] = [level, count];
  }
  return best;
}

/** This function gives the values of an axis: each level, or `steps` equal distances on the scale of the dimension. */
function axisValues(dimension: ResponseDimension, steps: number): readonly ResponseValue[] {
  if (dimension.kind !== "continuous") return dimension.levels;
  const [low, high] = dimension.range;
  const [a, b] = axisEnds(dimension);
  return Array.from({ length: steps }, (_, i) => {
    if (i === 0) return low;
    if (i === steps - 1) return high;
    const x = a + ((b - a) * i) / (steps - 1);
    return dimension.log === true ? 10 ** x : x;
  });
}

/** This function gives true when the value of a point matches a held value of a dimension. */
function matches(dimension: ResponseDimension, value: ResponseValue, held: ResponseValue, tolerance: number): boolean {
  if (typeof value !== "number" || typeof held !== "number") return value === held;
  const [low, high] = axisEnds(dimension);
  const log = dimension.kind !== "categorical" && dimension.log === true;
  return Math.abs(log ? Math.log10(value) - Math.log10(held) : value - held) <= tolerance * (high - low);
}

/** This function examines the request of a view, and it gives the parts that the two views share. */
function frameOf(name: string, record: ResponseRecord, measure: string, vary: readonly string[], options: ResponseViewOptions): Frame {
  const { hold = {}, steps = 33, tolerance = 0, width = 1 } = options;
  if (!Number.isSafeInteger(steps) || steps < 2) throw new RangeError(`${name}: steps is a whole number of 2 or more, not ${steps}.`);
  if (!(Number.isFinite(tolerance) && tolerance >= 0)) throw new RangeError(`${name}: tolerance is a finite number of 0 or more, not ${tolerance}.`);
  if (!(Number.isFinite(width) && width >= 0)) throw new RangeError(`${name}: width is a finite number of 0 or more, not ${width}.`);
  const model = record.models.find((m) => m.measure === measure);
  if (model === undefined) throw new RangeError(`${name}: the record has no model of the measure "${measure}".`);
  const known = (id: string): ResponseDimension => {
    const dimension = record.dimensions.find((d) => d.id === id);
    if (dimension === undefined) throw new RangeError(`${name}: the record has no dimension "${id}".`);
    return dimension;
  };
  const varied = vary.map(known);
  if (new Set(vary).size !== vary.length) throw new RangeError(`${name}: the two varied dimensions are one dimension, "${vary[0]}".`);
  for (const id of Object.keys(hold)) {
    if (vary.includes(id)) throw new RangeError(`${name}: the dimension "${id}" is both varied and held.`);
    const fault = valueFault(known(id), hold[id]);
    if (fault !== undefined) throw new RangeError(`${name}: the held dimension "${id}": ${fault}.`);
  }
  const others = record.dimensions.filter((d) => !vary.includes(d.id));
  const held = Object.fromEntries(others.map((d) => [d.id, Object.hasOwn(hold, d.id) ? (hold[d.id] as ResponseValue) : usualValue(d, record.points)]));
  const matched = record.points.filter((p) => typeof p.measures[measure] === "number" && others.every((d) => matches(d, p.values[d.id] as ResponseValue, held[d.id] as ResponseValue, tolerance)));
  const error = heldOutError(record, measure);
  const band = (inputs: Readonly<Record<string, ResponseValue>>): ResponseBand => {
    const value = predictScaled(model, inputs);
    return { value: unscale(model, value), low: unscale(model, value - width * error.rmse), high: unscale(model, value + width * error.rmse) };
  };
  return { held, axes: varied.map((d) => axisValues(d, steps)), matched, error, band };
}

/** This function gives the group field of a measured point of a view. */
const groupOf = (point: ResponsePoint): { readonly group?: string } => (point.group === undefined ? {} : { group: point.group });

/**
 * This function gives a view of a measure over one dimension of a parsed record:
 * - `curve`: the fitted value at each level, or at `steps` values of a continuous dimension, with its band.
 * - `points`: the measured points that match the held values. This list is empty when no point matches them.
 * - `held`: the value of each other dimension.
 * - `error`: the held-out error.
 *
 * Each dimension with no value in `hold` takes its usual value. For a continuous dimension, this value is the median
 * of its measured values. For the other kinds, it is the most common level, and a tie gives the first level.
 *
 * The band is the fitted value, plus and less `width` times the held-out root mean square error. On a log scale, this
 * distance is on the log scale of the model, so the band is a ratio. The band has one width along all the curve. It
 * tells the mean error of the model, and it does not widen where the record has few points.
 *
 * The function throws a RangeError for an unknown measure or dimension, and for a held value that is not good for its
 * dimension. It also throws for a dimension that is both varied and held, and for a bad option.
 */
export function sliceResponse(record: ResponseRecord, measure: string, options: ResponseSliceOptions): ResponseSlice {
  const { vary } = options;
  const { held, axes, matched, error, band } = frameOf("sliceResponse", record, measure, [vary], options);
  return {
    measure,
    vary,
    held,
    curve: (axes[0] as readonly ResponseValue[]).map((at) => ({ at, ...band({ ...held, [vary]: at }) })),
    points: matched.map((p) => ({ id: p.id, at: p.values[vary] as ResponseValue, value: p.measures[measure] as number, ...groupOf(p) })),
    error,
  };
}

/**
 * This function gives the view of `sliceResponse` over two dimensions. The fields `x` and `y` are the two axes, and
 * `cells` has one row for each value of `y`. The rules of the held values, of the matching points and of the band are
 * the rules of `sliceResponse`. The function also throws a RangeError when the two varied dimensions are one dimension.
 */
export function surfaceResponse(record: ResponseRecord, measure: string, options: ResponseSurfaceOptions): ResponseSurface {
  const { vary } = options;
  const [xId, yId] = vary;
  const { held, axes, matched, error, band } = frameOf("surfaceResponse", record, measure, vary, options);
  const x = axes[0] as readonly ResponseValue[];
  const y = axes[1] as readonly ResponseValue[];
  return {
    measure,
    vary,
    held,
    x,
    y,
    cells: y.map((b) => x.map((a) => band({ ...held, [xId]: a, [yId]: b }))),
    points: matched.map((p) => ({ id: p.id, at: [p.values[xId] as ResponseValue, p.values[yId] as ResponseValue], value: p.measures[measure] as number, ...groupOf(p) })),
    error,
  };
}
