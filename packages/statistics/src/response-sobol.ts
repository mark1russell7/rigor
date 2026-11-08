/**
 * The Sobol indices of a fitted model of a record of the format `response-records/1`. The first-order index of a
 * dimension is the share of the variance of the prediction that the dimension causes alone. The total index also
 * includes each interaction of the dimension with the other dimensions.
 *
 * The method is Monte Carlo with two independent matrices A and B of N rows, and one matrix `AB_i` for each dimension `i`.
 * `AB_i` is A with the column `i` of B (Saltelli and others, 2010). The first-order index uses the estimator of Saltelli
 * (2010), and the total index uses the estimator of Jansen (1999). The model gets N * (d + 2) evaluations for d dimensions.
 *
 * This file uses no Node import, no clock and no `Math.random`, the same as `response.ts`.
 */
import { random, type Random } from "@mark1russell7/rigor-generators";
import { type BootstrapOptions, type Interval, percentiles } from "./bootstrap.ts";
import { type ResponseDimension, type ResponseInputValue, type ResponseRecord, predictScaled, predictResponse, whenHolds } from "./response.ts";

/** The options of `sobolIndices`. */
export interface SobolOptions {
  /** The number N of rows of each base matrix. The default is 4096. */
  readonly n?: number;
  /** The seed of the draws. The default is 1. */
  readonly seed?: number | string;
  /**
   * The scale of the output. The value `measure` uses `predictResponse`. The value `model` uses the scale of the
   * model, so a model with a log scale gives the indices of the logarithm. The default is `measure`.
   */
  readonly scale?: "measure" | "model";
  /**
   * With this option, each index also gets a percentile bootstrap interval over the N rows. Each run draws N rows
   * with replacement, and it calculates all the indices from these rows. The default is no interval.
   */
  readonly interval?: BootstrapOptions;
}

/** The two Sobol indices of one dimension. */
export interface SobolIndex {
  /** The id of the dimension. */
  readonly dimension: string;
  /** The first-order index S_i: the estimator of Saltelli (2010). */
  readonly first: number;
  /** The total index ST_i: the estimator of Jansen (1999). */
  readonly total: number;
  /** The bootstrap interval of `first`. Only the option `interval` writes this field. */
  readonly firstInterval?: Interval;
  /** The bootstrap interval of `total`. Only the option `interval` writes this field. */
  readonly totalInterval?: Interval;
}

/** The result of `sobolIndices`. */
export interface SobolIndices {
  /** The id of the measure. */
  readonly measure: string;
  /** The scale of the output. */
  readonly scale: "measure" | "model";
  /** The number N of rows of each base matrix. */
  readonly n: number;
  /** The number of model evaluations: N * (d + 2). */
  readonly evaluations: number;
  /** The seed as a 32-bit number. */
  readonly seed: number;
  /** The mean of the outputs of A and B. */
  readonly mean: number;
  /** The variance of the outputs of A and B, with the divisor 2N. */
  readonly variance: number;
  /** The indices of each dimension of the record, in the order of the record. */
  readonly indices: readonly SobolIndex[];
}

/** This function draws one value of a dimension. Each dimension uses the same number of draws: one. */
function drawValue(dimension: ResponseDimension, r: Random): number | string {
  if (dimension.kind !== "continuous") return dimension.levels[r.below(dimension.levels.length)] as number | string;
  const [low, high] = dimension.range;
  if (dimension.log !== true) return r.range(low, high);
  const value = 10 ** r.range(Math.log10(low), Math.log10(high));
  return Math.min(high, Math.max(low, value));
}

/** This function draws a matrix of `n` rows, row by row, with one draw for each dimension in the order of the record. */
function drawMatrix(dimensions: readonly ResponseDimension[], n: number, r: Random): (number | string)[][] {
  return Array.from({ length: n }, () => dimensions.map((d) => drawValue(d, r)));
}

/** This function gives the inputs of a row. A conditional dimension gets `null` where its condition fails. */
function inputsOf(dimensions: readonly ResponseDimension[], row: readonly (number | string)[]): Record<string, ResponseInputValue> {
  const drawn: Record<string, ResponseInputValue> = {};
  dimensions.forEach((d, i) => {
    drawn[d.id] = row[i] as number | string;
  });
  const inputs: Record<string, ResponseInputValue> = {};
  for (const d of dimensions) inputs[d.id] = whenHolds(d, drawn) ? (drawn[d.id] as ResponseInputValue) : null;
  return inputs;
}

/** The outputs of the matrices, as the model gives them. The estimators subtract the mean where they use it. */
interface Outputs {
  readonly a: Float64Array;
  readonly b: Float64Array;
  /** The outputs of `AB_i` for each dimension `i`. */
  readonly ab: readonly Float64Array[];
}

/**
 * This function gives the variance and the indices from the rows `rows`. A variance of 0 gives each index as 0.
 * The value `constant` is true when each output is equal to the first output.
 */
function estimate(outputs: Outputs, rows: readonly number[] | null, n: number, constant: boolean): { mean: number; variance: number; first: number[]; total: number[] } {
  const d = outputs.ab.length;
  const at = (j: number): number => (rows === null ? j : (rows[j] as number));
  let sum = 0;
  for (let j = 0; j < n; j++) sum += (outputs.a[at(j)] as number) + (outputs.b[at(j)] as number);
  const mean = sum / (2 * n);
  let square = 0;
  for (let j = 0; j < n; j++) {
    const ea = (outputs.a[at(j)] as number) - mean;
    const eb = (outputs.b[at(j)] as number) - mean;
    square += ea * ea + eb * eb;
  }
  const variance = constant ? 0 : square / (2 * n);
  const first: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < d; i++) {
    const abi = outputs.ab[i] as Float64Array;
    let s = 0;
    let t = 0;
    for (let j = 0; j < n; j++) {
      const fa = outputs.a[at(j)] as number;
      const fb = outputs.b[at(j)] as number;
      const fab = abi[at(j)] as number;
      s += (fb - mean) * (fab - fa);
      t += (fa - fab) * (fa - fab);
    }
    first.push(variance > 0 ? s / n / variance : 0);
    total.push(variance > 0 ? t / (2 * n) / variance : 0);
  }
  return { mean, variance, first, total };
}

/**
 * This function gives the first-order and the total Sobol index of each dimension of a record, for the model of
 * `measure`. The indices are of the prediction of the model, not of the measured points.
 *
 * The input distribution:
 * - Each dimension is independent of the other dimensions.
 * - A continuous dimension is uniform over its range. With `log`, the logarithm of the value is uniform.
 * - An ordinal or a categorical dimension is uniform over its levels.
 * - A conditional dimension gets an independent draw. The model gets `null` for it where `whenHolds` fails for the drawn parent.
 *
 * Thus the inputs stay independent, and the indices have their usual meaning. A parent gets the effect of the absence of its child.
 *
 * The estimators:
 * - The first-order index is `mean(f(B) * (f(AB_i) - f(A))) / V` (Saltelli, 2010).
 * - The total index is `mean((f(A) - f(AB_i)) ** 2) / 2 / V` (Jansen, 1999).
 * - V is the variance of the outputs of A and B together.
 * - The variance uses the outputs of A and B less their mean. The first-order sum uses `f(B)` less that mean.
 * - The total sum uses differences of outputs, so it uses no mean.
 * - This step keeps the estimators unbiased, and it decreases their error when the mean is large.
 *
 * A model with a constant output has the variance 0. Then each index is 0, not NaN. An estimate can be a little
 * below 0 or above 1, from the Monte Carlo error. The function does not clip it.
 *
 * The draws fill A row by row, then B row by row. Each row has one draw for each dimension, in the order of the
 * record. Thus the same seed gives the same indices. The model can ignore a dimension. Then that dimension gets 0 for both
 * indices exactly, unless it is the parent of a dimension that the model reads.
 *
 * The function throws a RangeError when the record has no model of `measure`, and when N is not a whole number of 2 or more.
 * `predictResponse` throws for a value that the model refuses, for example a level that the model does not know.
 */
export function sobolIndices(record: Pick<ResponseRecord, "dimensions" | "models">, measure: string, options: SobolOptions = {}): SobolIndices {
  const model = record.models.find((m) => m.measure === measure);
  if (model === undefined) throw new RangeError(`sobolIndices: the record has no model of the measure "${measure}".`);
  const n = options.n ?? 4096;
  if (!Number.isSafeInteger(n) || n < 2) throw new RangeError(`sobolIndices: n is a whole number of 2 or more, not ${n}.`);
  const scale = options.scale ?? "measure";
  const dimensions = record.dimensions;
  const d = dimensions.length;
  const r = random(options.seed ?? 1);
  const a = drawMatrix(dimensions, n, r);
  const b = drawMatrix(dimensions, n, r);
  const f = (row: readonly (number | string)[]): number => {
    const inputs = inputsOf(dimensions, row);
    return scale === "model" ? predictScaled(model, inputs) : predictResponse(model, inputs);
  };
  const fa = Float64Array.from(a, f);
  const fb = Float64Array.from(b, f);
  const ab = dimensions.map((_, i) => Float64Array.from(a, (row, j) => f(row.map((v, k) => (k === i ? ((b[j] as (number | string)[])[i] as number | string) : v)))));
  const outputs: Outputs = { a: fa, b: fb, ab };
  const first = fa[0] as number;
  const constant = fa.every((v) => v === first) && fb.every((v) => v === first);
  const all = estimate(outputs, null, n, constant);
  let intervals: Interval[] | undefined;
  if (options.interval !== undefined) {
    const rows = new Array<number>(n);
    const flat = (e: { first: number[]; total: number[] }): number[] => [...e.first, ...e.total];
    intervals = percentiles(
      "sobolIndices",
      options.interval,
      2 * d,
      (rr) => {
        for (let j = 0; j < n; j++) rows[j] = rr.below(n);
        return flat(estimate(outputs, rows, n, constant));
      },
      () => flat(all),
    );
  }
  const indices = dimensions.map((dimension, i): SobolIndex => {
    const index = { dimension: dimension.id, first: all.first[i] as number, total: all.total[i] as number };
    if (intervals === undefined) return index;
    return { ...index, firstInterval: intervals[i] as Interval, totalInterval: intervals[d + i] as Interval };
  });
  return { measure, scale, n, evaluations: n * (d + 2), seed: r.seed, mean: constant ? first : all.mean, variance: all.variance, indices };
}
