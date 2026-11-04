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
import { mean, quantile } from "./describe.ts";

/** The value of the field `schema` of a record. */
export const RESPONSE_RECORDS_SCHEMA = "response-records/1";

/** The value of a dimension at a point: a number, or the text of a level. */
export type ResponseValue = number | string;

/** The value of a dimension at a place. The value `null` means that a conditional dimension is absent there. */
export type ResponseInputValue = ResponseValue | null;

/** The condition of a dimension: the dimension has a value only at these levels of its parent. */
export interface ResponseWhen {
  /** The id of the parent: a categorical or ordinal dimension with no condition. */
  readonly dimension: string;
  readonly levels: readonly ResponseValue[];
}

/** The fields of each kind of dimension. */
export interface ResponseDimensionBase {
  /** The key of the dimension in the values of a point. */
  readonly id: string;
  /** The name that a view shows. */
  readonly label: string;
  /** The unit. An empty string means that the dimension has no unit. */
  readonly unit: string;
  /** With this field, a point has a value only at the stated levels of the parent. Each other point has `null`. */
  readonly when?: ResponseWhen;
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
  /**
   * The low and the high end of the possible values, for example `[0, 1]` for a share. Each measured value is in this
   * range. A view clips its fitted values to it, and a fit does not use it.
   */
  readonly range?: readonly [number, number];
}

/** A declared reason that a measure is absent, for example infeasible, unsupported or out of budget. */
export interface ResponseReason {
  /** The key of the reason in the field `absent` of a point. */
  readonly id: string;
  /** The name that a view shows. */
  readonly label: string;
}

/** One measured point. */
export interface ResponsePoint {
  readonly id: string;
  /** The value of each dimension. */
  readonly values: Readonly<Record<string, ResponseInputValue>>;
  /** The value of each measure. The value `null` means that the run did not give the measure at this point. */
  readonly measures: Readonly<Record<string, number | null>>;
  /** The points of one group stay on one side of each split, for example the repeats of one seed. */
  readonly group?: string;
  /** The reason of a measure with `null`: a map from the id of the measure to the id of a declared reason. */
  readonly absent?: Readonly<Record<string, string>>;
}

/** One factor of a term: a power of a number dimension, or 1 at a level and 0 at each other level. */
export type ResponseFactor = { readonly dimension: string; readonly power: number } | { readonly dimension: string; readonly level: ResponseValue };

/** The fields of each kind of input of a ridge model. */
export interface RidgeInputBase {
  readonly dimension: string;
  /** When true, the dimension is conditional, so `null` is a good value. Each term of an absent dimension is 0. */
  readonly conditional?: boolean;
}

/** The coordinate of a number dimension: the value (or its logarithm), less `center`, divided by `spread`. */
export interface RidgeNumberInput extends RidgeInputBase {
  readonly kind: "number";
  readonly center: number;
  readonly spread: number;
  readonly log?: boolean;
}

/** The coordinate of an ordinal dimension with text levels: the position of the level, as in `RidgeNumberInput`. */
export interface RidgeRankInput extends RidgeInputBase {
  readonly kind: "rank";
  readonly levels: readonly string[];
  readonly center: number;
  readonly spread: number;
}

/** A categorical dimension: the factors of its levels are the one-hot columns. */
export interface RidgeLevelInput extends RidgeInputBase {
  readonly kind: "level";
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
  /** The value of each dimension of the table, in the order of its `dimensions`. An absent dimension has `null`. */
  readonly at: readonly ResponseInputValue[];
  /** The mean of the measured values of the cell, on the scale of the model. */
  readonly value: number;
  /** The number of points of the cell. */
  readonly n: number;
}

/** The mean of each measured combination of levels. */
export interface TableResponseModel extends ResponseModelBase {
  readonly kind: "table";
  readonly dimensions: readonly string[];
  /** The ids of the dimensions of the table with a condition. Only these dimensions take `null`. */
  readonly conditional?: readonly string[];
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
  /**
   * The prediction of each held-out point with a value, on the scale of the model. The keys are the id of the measure,
   * then the id of the point. The model of this fold gave them. Only the option `outOfFold` of `fitResponse` writes this field.
   */
  readonly predictions?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** The data of a record, before a fit. */
export interface ResponseData {
  readonly schema: typeof RESPONSE_RECORDS_SCHEMA;
  readonly name: string;
  readonly dimensions: readonly ResponseDimension[];
  readonly measures: readonly ResponseMeasure[];
  /** The reasons that a measure of a point can be absent. Each id in the field `absent` of a point is in this list. */
  readonly reasons?: readonly ResponseReason[];
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
  readonly hold?: Readonly<Record<string, ResponseInputValue>>;
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

/**
 * The fitted value at one place, with its band. The band is the mean error of the model, and `nearest` tells how far
 * the place is from a measurement.
 */
export interface ResponseBand {
  readonly value: number;
  readonly low: number;
  readonly high: number;
  /**
   * The distance from this place to the nearest measured point with a value of the measure, from 0 to 1. The value 0
   * means that a point was measured here. A number or rank dimension counts as its share of the axis. A different
   * categorical level counts 1, and an absent value against a present value counts 1. The distance is the largest
   * count over the dimensions.
   */
  readonly nearest: number;
  /** This field is true when the measure has a `range` and the view moved `value`, `low` or `high` into it. */
  readonly clipped?: true;
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

/** A point of a slice that matches the held values and has no value of the measure. */
export interface ResponseAbsentPoint {
  readonly id: string;
  /** The value of the varied dimension. */
  readonly at: ResponseValue;
  /** The id of the declared reason. The value `null` means that the point states no reason. */
  readonly reason: string | null;
  readonly group?: string;
}

/** The fitted curve over one dimension, and the measured points that match the held values. */
export interface ResponseSlice {
  readonly measure: string;
  readonly vary: string;
  /** The value of each other dimension. */
  readonly held: Readonly<Record<string, ResponseInputValue>>;
  readonly curve: readonly ResponseCurvePoint[];
  readonly points: readonly ResponseSlicePoint[];
  /** The points that match the held values and have no value of the measure, each with its reason. */
  readonly absent: readonly ResponseAbsentPoint[];
  readonly error: ResponseHeldOutError;
  /** The number of places of `curve` with the field `clipped`. */
  readonly clipped: number;
}

/** A measured point of a surface. */
export interface ResponseSurfacePoint {
  readonly id: string;
  /** The values of the two varied dimensions. */
  readonly at: readonly [ResponseValue, ResponseValue];
  readonly value: number;
  readonly group?: string;
}

/** A point of a surface that matches the held values and has no value of the measure. */
export interface ResponseSurfaceAbsentPoint {
  readonly id: string;
  /** The values of the two varied dimensions. */
  readonly at: readonly [ResponseValue, ResponseValue];
  /** The id of the declared reason. The value `null` means that the point states no reason. */
  readonly reason: string | null;
  readonly group?: string;
}

/** The fitted surface over two dimensions, and the measured points that match the held values. */
export interface ResponseSurface {
  readonly measure: string;
  readonly vary: readonly [string, string];
  /** The value of each other dimension. */
  readonly held: Readonly<Record<string, ResponseInputValue>>;
  readonly x: readonly ResponseValue[];
  readonly y: readonly ResponseValue[];
  /** One row for each value of `y`. Each row has one cell for each value of `x`. */
  readonly cells: readonly (readonly ResponseBand[])[];
  readonly points: readonly ResponseSurfacePoint[];
  /** The points that match the held values and have no value of the measure, each with its reason. */
  readonly absent: readonly ResponseSurfaceAbsentPoint[];
  readonly error: ResponseHeldOutError;
  /** The number of places of `cells` with the field `clipped`. */
  readonly clipped: number;
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

/** This function gives true when a place has the condition of a dimension. A dimension with no condition is present. */
export function whenHolds(dimension: ResponseDimension, values: Readonly<Record<string, unknown>>): boolean {
  return dimension.when === undefined || dimension.when.levels.includes(values[dimension.when.dimension] as ResponseValue);
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

/**
 * This function gives the input of a dimension, for each kind of model. It reads only a field of the object, not of
 * its prototype. It refuses `null` at a dimension with no condition, so a mistake of a caller cannot give a quiet value.
 */
function inputValue(inputs: Readonly<Record<string, ResponseInputValue>>, dimension: string, conditional: boolean): ResponseInputValue {
  if (!Object.hasOwn(inputs, dimension)) throw new RangeError(`predictResponse: the inputs have no value of the dimension "${dimension}".`);
  const value = inputs[dimension] as ResponseInputValue;
  if (value === null && !conditional) throw new RangeError(`predictResponse: the dimension "${dimension}" has no condition, so it needs a value, not null.`);
  return value;
}

/** This function gives the coordinate of one input of a ridge model. An absent input has `null`, and a level has 0. */
function coordinate(input: RidgeInput, value: ResponseInputValue): number | null {
  if (value === null) return null;
  const bad = (reason: string): RangeError => new RangeError(`predictResponse: the value ${JSON.stringify(value)} of the dimension "${input.dimension}" ${reason}.`);
  if (input.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw bad("is not a finite number");
    if (input.log === true && value <= 0) throw bad("is not above 0, and the dimension has a log scale");
    return ((input.log === true ? Math.log10(value) : value) - input.center) / input.spread;
  }
  const position = input.levels.indexOf(value as string);
  if (position < 0) throw bad("is not a level of the model");
  return input.kind === "rank" ? (position - input.center) / input.spread : 0;
}

/** This function gives the coordinate of each input of a ridge model. */
export function coordinates(inputs: readonly RidgeInput[], values: Readonly<Record<string, ResponseInputValue>>): Map<string, number | null> {
  return new Map(inputs.map((input) => [input.dimension, coordinate(input, inputValue(values, input.dimension, input.conditional === true))]));
}

/**
 * This function gives the product of the factors of a term at a place. A power is a loop of multiplications. A term
 * with an absent dimension is 0, so the columns of the levels of the parent carry the mean of that place.
 */
export function product(factors: readonly ResponseFactor[], at: ReadonlyMap<string, number | null>, values: Readonly<Record<string, ResponseInputValue>>): number {
  let value = 1;
  for (const factor of factors) {
    const c = at.get(factor.dimension) as number | null;
    if (c === null) return 0;
    if ("level" in factor) {
      if (values[factor.dimension] !== factor.level) return 0;
    } else for (let i = 0; i < factor.power; i++) value *= c;
  }
  return value;
}

/** This function gives the prediction on the scale of the model. The sum with 0 removes a negative zero. */
function predictScaled(model: ResponseModel, inputs: Readonly<Record<string, ResponseInputValue>>): number {
  if (model.kind === "table") {
    const at = model.dimensions.map((d) => inputValue(inputs, d, model.conditional?.includes(d) === true));
    return model.cells.find((cell) => cell.at.every((v, i) => v === at[i]))?.value ?? model.fallback;
  }
  const at = coordinates(model.inputs, inputs);
  let sum = model.intercept;
  for (const term of model.terms) sum += term.weight * product(term.factors, at, inputs);
  return sum + 0;
}

/** This function changes a measured value to the scale of a model. A log scale with a floor lifts each smaller value. */
export function toModelScale(value: number, log: boolean, floor: number | undefined): number {
  return log ? Math.log10(Math.max(value, floor ?? value)) : value;
}

/** This function changes a value from the scale of the model to the scale of the measure. */
function unscale(model: ResponseModel, value: number): number {
  return model.scale === "log" ? 10 ** value : value;
}

/**
 * This function gives the value of a model at `inputs`, on the scale of the measure. The inputs have a value for each
 * dimension that the model reads. An absent conditional dimension has `null`. A table model gives its `fallback` for a
 * combination with no cell.
 *
 * The function throws a RangeError for a missing input and for a value that is not a number or a level of the model.
 * It throws for `null` at a dimension with no condition, for each kind of model. It also throws for a value at or below
 * 0 on a log scale. A number outside the range of the record is good, so the
 * function extrapolates.
 */
export function predictResponse(model: ResponseModel, inputs: Readonly<Record<string, ResponseInputValue>>): number {
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

/** This function gives the stored predictions of a measure in a fold. A fold with no predictions gives `undefined`. */
function predictionsOf(fold: ResponseFold, measure: string): Readonly<Record<string, number>> | undefined {
  return fold.predictions !== undefined && Object.hasOwn(fold.predictions, measure) ? fold.predictions[measure] : undefined;
}

/**
 * This function gives the held-out error of a chosen set of points, on the scale of the model. It uses the stored
 * predictions of the option `outOfFold`. Thus a reader can get the error of one cell. The result has the fields of
 * `heldOutError`, and the set of all the points gives the same values to the rounding of the sums.
 *
 * Each point counts at most once. A point with no value of the measure, or with no prediction, adds nothing to `n`.
 * The baseline of a point is the mean of the training points of its fold.
 *
 * The function throws a RangeError for an unknown measure and for a record with no predictions of the measure. It
 * also throws for an unknown id, for a repeated id, and for a set with no point to score.
 */
export function heldOutErrorAt(record: ResponseRecord, measure: string, ids: readonly string[]): ResponseHeldOutError {
  const model = record.models.find((m) => m.measure === measure);
  if (model === undefined) throw new RangeError(`heldOutErrorAt: the record has no model of the measure "${measure}".`);
  if (!record.folds.some((fold) => predictionsOf(fold, measure) !== undefined)) throw new RangeError(`heldOutErrorAt: the record has no predictions of the measure "${measure}". Fit it with the option outOfFold.`);
  const chosen = new Set(ids);
  if (chosen.size !== ids.length) throw new RangeError("heldOutErrorAt: the list of ids has a repeated id.");
  const points = new Map(record.points.map((p) => [p.id, p]));
  for (const id of ids) if (!points.has(id)) throw new RangeError(`heldOutErrorAt: the record has no point "${id}".`);
  const scaled = (point: ResponsePoint): number | undefined => {
    const value = point.measures[measure];
    return typeof value === "number" ? toModelScale(value, model.scale === "log", model.floor) : undefined;
  };
  let n = 0;
  let folds = 0;
  let absolute = 0;
  let square = 0;
  let baselineSum = 0;
  for (const fold of record.folds) {
    const predicted = predictionsOf(fold, measure);
    if (predicted === undefined) continue;
    const scored = fold.heldOut.filter((id) => chosen.has(id) && Object.hasOwn(predicted, id));
    if (scored.length === 0) continue;
    const held = new Set(fold.heldOut);
    const baseline = mean(record.points.flatMap((p) => (held.has(p.id) || scaled(p) === undefined ? [] : [scaled(p) as number])));
    folds += 1;
    for (const id of scored) {
      const y = scaled(points.get(id) as ResponsePoint) as number;
      const error = y - (predicted[id] as number);
      n += 1;
      absolute += Math.abs(error);
      square += error * error;
      baselineSum += Math.abs(y - baseline);
    }
  }
  if (n === 0) throw new RangeError(`heldOutErrorAt: no chosen point has a prediction of the measure "${measure}".`);
  const mae = absolute / n;
  const baselineMae = baselineSum / n;
  return { n, folds, mae, rmse: Math.sqrt(square / n), baselineMae, skill: baselineMae > 0 ? 1 - mae / baselineMae : null };
}

/** The parts of a slice or a surface that do not depend on the number of varied dimensions. */
interface Frame {
  readonly held: Readonly<Record<string, ResponseInputValue>>;
  readonly axes: readonly (readonly ResponseValue[])[];
  readonly matched: readonly ResponsePoint[];
  /** The points that match the held values and have no value of the measure. */
  readonly missing: readonly ResponsePoint[];
  readonly error: ResponseHeldOutError;
  readonly band: (inputs: Readonly<Record<string, ResponseInputValue>>) => ResponseBand;
}

/**
 * This function gives the usual value of a dimension: a measured median, or the most common level among `among`. A
 * tie gives the first level. A dimension with no measured value gives its low end or its first level.
 */
function usualValue(dimension: ResponseDimension, points: readonly ResponsePoint[], among?: readonly ResponseValue[]): ResponseValue {
  const values = points.flatMap((p) => (p.values[dimension.id] === null ? [] : [p.values[dimension.id] as ResponseValue]));
  if (dimension.kind === "continuous") return values.length === 0 ? dimension.range[0] : quantile(values as number[], 0.5, "nearest-rank");
  const levels = (dimension.levels as readonly ResponseValue[]).filter((level) => among === undefined || among.includes(level));
  let best = levels[0] as ResponseValue;
  let most = 0;
  for (const level of levels) {
    const count = values.filter((v) => v === level).length;
    if (count > most) [best, most] = [level, count];
  }
  return best;
}

/** The place of a value on the axis of its dimension: a share of the axis, a categorical level, or `null`. */
type AxisPlace = number | string | null;

/** This function gives the place of a value on its axis. A number or a rank is a share of the axis, from 0 to 1. */
function axisPlace(dimension: ResponseDimension, value: ResponseInputValue): AxisPlace {
  if (value === null || dimension.kind === "categorical") return value;
  const [low, high] = axisEnds(dimension);
  if (high === low) return 0;
  if (!isNumberDimension(dimension)) return (dimension.levels as readonly ResponseValue[]).indexOf(value) / high;
  return ((dimension.log === true ? Math.log10(value as number) : (value as number)) - low) / (high - low);
}

/** This function gives the count of one dimension between two places: their distance, or 1 when they do not compare. */
const axisGap = (a: AxisPlace, b: AxisPlace): number => (a === b ? 0 : typeof a === "number" && typeof b === "number" ? Math.abs(a - b) : 1);

/**
 * This function gives a function of the field `nearest` of a band. A place compares with each point that has a value
 * of the measure. A point stops at the first count that is not less than the best distance so far.
 */
function nearestOf(dimensions: readonly ResponseDimension[], points: readonly ResponsePoint[], measure: string): (place: Readonly<Record<string, ResponseInputValue>>) => number {
  const rows = points.filter((p) => typeof p.measures[measure] === "number").map((p) => dimensions.map((d) => axisPlace(d, p.values[d.id] as ResponseInputValue)));
  return (place) => {
    const here = dimensions.map((d) => axisPlace(d, place[d.id] as ResponseInputValue));
    let best = 1;
    for (const row of rows) {
      let far = 0;
      for (let i = 0; i < here.length && far < best; i++) far = Math.max(far, axisGap(row[i] as AxisPlace, here[i] as AxisPlace));
      if (far < best) best = far;
    }
    return best;
  };
}

/** This function gives the levels that the parent of each varied conditional dimension needs. */
function neededLevels(name: string, varied: readonly ResponseDimension[], vary: readonly string[]): ReadonlyMap<string, readonly ResponseValue[]> {
  const needed = new Map<string, readonly ResponseValue[]>();
  for (const { id, when } of varied) {
    if (when === undefined) continue;
    if (vary.includes(when.dimension)) throw new RangeError(`${name}: the dimension "${id}" has a value only at some levels of "${when.dimension}", so hold "${when.dimension}".`);
    const earlier = needed.get(when.dimension);
    needed.set(when.dimension, earlier === undefined ? when.levels : earlier.filter((level) => when.levels.includes(level)));
  }
  return needed;
}

/** This function gives the value of each dimension that does not vary. `sliceResponse` tells the rules. */
function heldValues(name: string, record: ResponseRecord, vary: readonly string[], hold: Readonly<Record<string, ResponseInputValue>>, needed: ReadonlyMap<string, readonly ResponseValue[]>): Readonly<Record<string, ResponseInputValue>> {
  const others = record.dimensions.filter((d) => !vary.includes(d.id));
  const plain = new Map(others.filter((d) => d.when === undefined).map((d) => [d.id, (Object.hasOwn(hold, d.id) ? hold[d.id] : usualValue(d, record.points, needed.get(d.id))) as ResponseValue]));
  for (const [parent, levels] of needed) {
    const value = plain.get(parent) as ResponseValue;
    if (!levels.includes(value)) throw new RangeError(`${name}: a varied dimension needs "${parent}" at one of ${JSON.stringify(levels)}, not ${JSON.stringify(value)}.`);
  }
  const valueOf = ({ id, when }: ResponseDimension): ResponseInputValue => {
    if (when === undefined) return plain.get(id) as ResponseValue;
    if (!vary.includes(when.dimension) && !when.levels.includes(plain.get(when.dimension) as ResponseValue)) return null;
    const value = Object.hasOwn(hold, id) ? (hold[id] as ResponseInputValue) : usualValue(record.dimensions.find((d) => d.id === id) as ResponseDimension, record.points);
    if (value === null) throw new RangeError(`${name}: the held dimension "${id}" is null, and a level of "${when.dimension}" in this view needs a value.`);
    return value;
  };
  return Object.fromEntries(others.map((d) => [d.id, valueOf(d)]));
}

/** This function refuses a bad option `steps`. */
function checkSteps(name: string, steps: number): void {
  if (!Number.isSafeInteger(steps) || steps < 2) throw new RangeError(`${name}: steps is a whole number of 2 or more, not ${steps}.`);
}

/** This function gives a value inside a range. */
const clip = (value: number, [low, high]: readonly [number, number]): number => Math.min(high, Math.max(low, value));

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
function matches(dimension: ResponseDimension, value: ResponseInputValue, held: ResponseInputValue, tolerance: number): boolean {
  if (typeof value !== "number" || typeof held !== "number") return value === held;
  const [low, high] = axisEnds(dimension);
  const log = dimension.kind !== "categorical" && dimension.log === true;
  return Math.abs(log ? Math.log10(value) - Math.log10(held) : value - held) <= tolerance * (high - low);
}

/** This function examines the request of a view, and it gives the parts that the two views share. */
function frameOf(name: string, record: ResponseRecord, measure: string, vary: readonly string[], options: ResponseViewOptions): Frame {
  const { hold = {}, steps = 33, tolerance = 0, width = 1 } = options;
  checkSteps(name, steps);
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
    const dimension = known(id);
    if (hold[id] === null && dimension.when !== undefined) continue;
    const fault = valueFault(dimension, hold[id]);
    if (fault !== undefined) throw new RangeError(`${name}: the held dimension "${id}": ${fault}.`);
  }
  const others = record.dimensions.filter((d) => !vary.includes(d.id));
  const held = heldValues(name, record, vary, hold, neededLevels(name, varied, vary));
  const placed = record.points.filter(
    (p) => vary.every((id) => p.values[id] !== null) && others.every((d) => matches(d, p.values[d.id] as ResponseInputValue, whenHolds(d, p.values) ? (held[d.id] as ResponseInputValue) : null, tolerance)),
  );
  const matched = placed.filter((p) => typeof p.measures[measure] === "number");
  const missing = placed.filter((p) => typeof p.measures[measure] !== "number");
  const error = heldOutError(record, measure);
  const nearest = nearestOf(record.dimensions, record.points, measure);
  const range = record.measures.find((m) => m.id === measure)?.range;
  const band = (inputs: Readonly<Record<string, ResponseInputValue>>): ResponseBand => {
    const place = Object.fromEntries(record.dimensions.map((d) => [d.id, whenHolds(d, inputs) ? (inputs[d.id] as ResponseInputValue) : null]));
    const value = predictScaled(model, place);
    const fitted = { value: unscale(model, value), low: unscale(model, value - width * error.rmse), high: unscale(model, value + width * error.rmse) };
    const inside = range === undefined ? fitted : { value: clip(fitted.value, range), low: clip(fitted.low, range), high: clip(fitted.high, range) };
    const moved = inside.value !== fitted.value || inside.low !== fitted.low || inside.high !== fitted.high;
    return { ...inside, nearest: nearest(place), ...(moved ? { clipped: true as const } : {}) };
  };
  return { held, axes: varied.map((d) => axisValues(d, steps)), matched, missing, error, band };
}

/** This function gives the group field of a measured point of a view. */
const groupOf = (point: ResponsePoint): { readonly group?: string } => (point.group === undefined ? {} : { group: point.group });

/** This function gives the declared reason of a point with no value of a measure, or `null` for no stated reason. */
const reasonOf = (point: ResponsePoint, measure: string): string | null => (point.absent !== undefined && Object.hasOwn(point.absent, measure) ? (point.absent[measure] as string) : null);

/**
 * This function gives a view of a measure over one dimension of a parsed record:
 * - `curve`: the fitted value at each level, or at `steps` values of a continuous dimension, with its band.
 * - `points`: the measured points that match the held values. This list is empty when no point matches them.
 * - `absent`: the points that match the held values and have no value of the measure, each with its reason. A chart
 *   can draw each reason apart.
 * - `held`: the value of each other dimension.
 * - `error`: the held-out error.
 *
 * Each dimension with no value in `hold` takes its usual value. For a continuous dimension, this value is the median
 * of its measured values. For the other kinds, it is the most common level, and a tie gives the first level.
 *
 * A conditional dimension follows its parent:
 * - To vary a conditional dimension, the parent needs a level inside `when`. With no held value, the parent takes the
 *   most common level inside `when`. A held level outside `when` is a RangeError.
 * - A held conditional dimension reads `null` in `held` when its parent is outside `when`, also with a value in `hold`.
 *   The points that match have `null` at this dimension.
 * - When the parent varies, a held conditional dimension keeps its value in `held`. Each place outside `when` reads
 *   `null` for the fit, and for the matching points.
 *
 * The band is the fitted value, plus and less `width` times the held-out root mean square error. On a log scale, this
 * distance is on the log scale of the model, so the band is a ratio. The band has one width along all the curve. The
 * band is the mean error of the model, and `nearest` tells how far the place is from a measurement.
 *
 * A measure with a `range` keeps each place inside it. The fields `value`, `low` and `high` move to the nearest end,
 * the place has the field `clipped`, and the field `clipped` of the view counts these places. The function
 * `predictResponse` gives the value that the model fitted.
 *
 * The function throws a RangeError for an unknown measure or dimension, and for a held value that is not good for its
 * dimension. It also throws for a dimension that is both varied and held, and for a bad option.
 */
export function sliceResponse(record: ResponseRecord, measure: string, options: ResponseSliceOptions): ResponseSlice {
  const { vary } = options;
  const { held, axes, matched, missing, error, band } = frameOf("sliceResponse", record, measure, [vary], options);
  const curve = (axes[0] as readonly ResponseValue[]).map((at) => ({ at, ...band({ ...held, [vary]: at }) }));
  return {
    measure,
    vary,
    held,
    curve,
    points: matched.map((p) => ({ id: p.id, at: p.values[vary] as ResponseValue, value: p.measures[measure] as number, ...groupOf(p) })),
    absent: missing.map((p) => ({ id: p.id, at: p.values[vary] as ResponseValue, reason: reasonOf(p, measure), ...groupOf(p) })),
    error,
    clipped: curve.filter((place) => place.clipped === true).length,
  };
}

/**
 * This function gives the view of `sliceResponse` over two dimensions. The fields `x` and `y` are the two axes, and
 * `cells` has one row for each value of `y`. The rules of the held values, of the matching points and of the band are
 * the rules of `sliceResponse`. The function also throws a RangeError when the two varied dimensions are one dimension.
 * It throws when a conditional dimension varies with its parent, and when two varied dimensions need no common level.
 */
export function surfaceResponse(record: ResponseRecord, measure: string, options: ResponseSurfaceOptions): ResponseSurface {
  const { vary } = options;
  const [xId, yId] = vary;
  const { held, axes, matched, missing, error, band } = frameOf("surfaceResponse", record, measure, vary, options);
  const x = axes[0] as readonly ResponseValue[];
  const y = axes[1] as readonly ResponseValue[];
  const cells = y.map((b) => x.map((a) => band({ ...held, [xId]: a, [yId]: b })));
  return {
    measure,
    vary,
    held,
    x,
    y,
    cells,
    points: matched.map((p) => ({ id: p.id, at: [p.values[xId] as ResponseValue, p.values[yId] as ResponseValue], value: p.measures[measure] as number, ...groupOf(p) })),
    absent: missing.map((p) => ({ id: p.id, at: [p.values[xId] as ResponseValue, p.values[yId] as ResponseValue], reason: reasonOf(p, measure), ...groupOf(p) })),
    error,
    clipped: cells.flat().filter((place) => place.clipped === true).length,
  };
}

/**
 * This function gives the number of fitted places of a view before the view starts: the product of the lengths of its
 * axes. A level axis counts its levels, and a continuous axis counts `steps`. The field `nearest` reads each point at
 * each place, so the reads of a view are this count times the number of points. The default of `steps` is the default
 * of a view. The function throws a RangeError for an unknown dimension, for one dimension named two times, and for a
 * bad `steps`.
 */
export function responseCells(record: Pick<ResponseRecord, "dimensions">, vary: string | readonly [string, string], steps = 33): number {
  checkSteps("responseCells", steps);
  const ids = typeof vary === "string" ? [vary] : vary;
  if (new Set(ids).size !== ids.length) throw new RangeError(`responseCells: the two varied dimensions are one dimension, "${ids[0]}".`);
  return ids.reduce((count, id) => {
    const dimension = record.dimensions.find((d) => d.id === id);
    if (dimension === undefined) throw new RangeError(`responseCells: the record has no dimension "${id}".`);
    return count * (dimension.kind === "continuous" ? steps : dimension.levels.length);
  }, 1);
}
