/**
 * The moving-block bootstrap of a series in time order (R18). A row bootstrap treats each reading as independent, so
 * the interval of a series with autocorrelation is too narrow. Each run of this bootstrap draws blocks of `block`
 * readings that follow each other, with replacement, and joins them to the length of the series. Thus a sample keeps
 * the autocorrelation inside each block.
 *
 * The blocks overlap: a block can start at each reading. With `circular`, a block can wrap from the end of the series to
 * its start, so each reading is in `block` blocks (Politis and Romano, 1992). `blockLength` gives a block length from
 * the data, by the rule of Politis and White (2004) with the correction of Patton, Politis and White (2009).
 */
import type { Random } from "@mark1russell7/rigor-generators";
import { type BootstrapOptions, type Interval, percentile, percentiles } from "./bootstrap.ts";
import { type LeastSquaresOptions, checkedShape, fitRows } from "./regression.ts";

/** The options of a moving-block bootstrap. */
export interface BlockBootstrapOptions extends BootstrapOptions {
  /** The length of each block, a whole number from 1 to the length of the series. The default is from `blockLength`. */
  readonly block?: number;
  /** With `true`, a block can wrap from the end of the series to its start. The default is `false`. */
  readonly circular?: boolean;
}

/** The interval of a moving-block bootstrap, with its block length. */
export interface BlockInterval extends Interval {
  /** The length of each block. */
  readonly block: number;
  /** The value `true` tells that the blocks can wrap from the end of the series to its start. */
  readonly circular: boolean;
}

/** This function gives the autocovariances of the values from the lag 0 to the lag `lags`, each with the divisor `n`. */
function autocovariances(values: readonly number[], lags: number): number[] {
  const n = values.length;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;
  const centered = values.map((v) => v - mean);
  return Array.from({ length: lags + 1 }, (_, k) => {
    let s = 0;
    for (let t = 0; t + k < n; t++) s += (centered[t] as number) * (centered[t + k] as number);
    return s / n;
  });
}

/**
 * This function gives a block length for a moving-block or a circular bootstrap of the mean of a series. The rule is the
 * rule of Politis and White (2004), with the correction of Patton, Politis and White (2009).
 * - The lag window `M` is 2 times the first lag after which `K` autocorrelations are below `2 * sqrt(log10(n) / n)`.
 *   `K` is `max(5, ceil(sqrt(log10(n))))`, and `M` is at most `ceil(sqrt(n)) + K`.
 * - The flat-top window of `M` gives `G`, the sum of `|k| R(k)`, and `g`, the sum of `R(k)`. The length is
 *   `(3 G^2 / (2 g^2))^(1/3) n^(1/3)`, rounded up.
 * - The length is from 1 to `ceil(min(3 sqrt(n), n / 3))`. A series with no spread, `G = 0` or `g = 0` gives 1.
 *
 * The series has 2 values or more, and each value is finite.
 */
export function blockLength(series: readonly number[]): number {
  const n = series.length;
  if (n < 2) throw new RangeError(`blockLength: the series has 2 values or more, not ${n}.`);
  for (const v of series) if (!Number.isFinite(v)) throw new RangeError(`blockLength: each value is a finite number, not ${v}.`);
  const most = Math.max(1, Math.ceil(Math.min(3 * Math.sqrt(n), n / 3)));
  const k = Math.max(5, Math.ceil(Math.sqrt(Math.log10(n))));
  const windowMost = Math.ceil(Math.sqrt(n)) + k;
  const lags = Math.min(n - 1, windowMost + k);
  const r = autocovariances(series, lags);
  const r0 = r[0] as number;
  if (!(r0 > 0)) return 1;
  // The first lag `m` after which `k` autocorrelations are below the cut. Without one, the window is the largest window.
  const cut = 2 * Math.sqrt(Math.log10(n) / n);
  let first: number | undefined;
  for (let m = 0; m + k <= lags && first === undefined; m++) {
    let small = true;
    for (let j = 1; j <= k && small; j++) small = Math.abs((r[m + j] as number) / r0) < cut;
    if (small) first = m;
  }
  const window = Math.min(first === undefined ? windowMost : 2 * Math.max(first, 1), windowMost, lags);
  let g = 0;
  let longRun = r0;
  for (let lag = 1; lag <= window; lag++) {
    const weight = lag / window <= 0.5 ? 1 : 2 * (1 - lag / window);
    g += 2 * weight * lag * (r[lag] as number);
    longRun += 2 * weight * (r[lag] as number);
  }
  if (g === 0 || longRun === 0) return 1;
  const length = Math.cbrt((3 * g * g) / (2 * longRun * longRun)) * Math.cbrt(n);
  return Math.max(1, Math.min(most, Math.ceil(length)));
}

/** This function examines a block length. A length that is not a whole number from 1 to `n` is a `RangeError`. */
function checkBlock(name: string, block: number, n: number): void {
  if (!Number.isSafeInteger(block) || block < 1 || block > n) throw new RangeError(`${name}: block is a whole number from 1 to ${n}, the length of the series, not ${block}.`);
}

/**
 * This function fills `index` with the indexes of one sample. It draws `ceil(n / block)` starts with `r.below`, and joins
 * their blocks to the length `n`. Without `circular`, a start is from 0 to `n - block`. With `block` 1, the draws are
 * equal to the draws of `bootstrap`.
 */
function drawBlocks(r: Random, n: number, block: number, circular: boolean, index: number[]): void {
  const starts = circular ? n : n - block + 1;
  for (let i = 0; i < n; ) {
    const start = r.below(starts);
    for (let j = 0; j < block && i < n; j++, i++) index[i] = circular ? (start + j) % n : start + j;
  }
}

/**
 * A moving-block bootstrap interval of `statistic` over a series in time order. Each run draws blocks of `block` items
 * that follow each other, with replacement, and the statistic reads the joined sample. The estimate is the statistic of
 * the series.
 * - Without `block`, each item is a number, and the length comes from `blockLength`. Else the default is a `RangeError`.
 * - With `block` 1, the interval is equal to the interval of `bootstrap` with the same seed.
 * - A run whose statistic is not finite does not count, as in `bootstrap`.
 */
export function bootstrapMovingBlock<T>(series: readonly T[], statistic: (sample: readonly T[]) => number, options: BlockBootstrapOptions = {}): BlockInterval {
  const name = "bootstrapMovingBlock";
  const n = series.length;
  if (n === 0) throw new RangeError(`${name}: the series is empty.`);
  const circular = options.circular ?? false;
  let block = options.block;
  if (block === undefined) {
    if (!series.every((item) => typeof item === "number")) throw new RangeError(`${name}: give block, or a series of numbers for blockLength.`);
    block = n === 1 ? 1 : blockLength(series as readonly number[]);
  }
  checkBlock(name, block, n);
  const length = block;
  const index = new Array<number>(n);
  const sample = new Array<T>(n);
  const interval = percentile(
    name,
    options,
    (r) => {
      drawBlocks(r, n, length, circular, index);
      for (let i = 0; i < n; i++) sample[i] = series[index[i] as number] as T;
      return statistic(sample);
    },
    () => statistic(series),
  );
  return { ...interval, block: length, circular };
}

/**
 * A moving-block bootstrap interval of each coefficient of the least-squares fit of `y` on the rows of `x`. The rows are
 * in time order, for example a column of the time and other columns. Each run draws blocks of whole rows, as
 * `bootstrapMovingBlock` does, and fits the drawn rows. All the intervals come from the same draws.
 * - Without `block`, the length is `blockLength` of the residuals of the fit of all the rows. For a singular fit, it is
 *   `blockLength` of `y`.
 * - A run with a singular design gives NaN coefficients, so it does not count. The shape errors are the errors of `leastSquares`.
 */
export function bootstrapMovingBlockLeastSquares(
  x: readonly (readonly number[])[],
  y: readonly number[],
  options: BlockBootstrapOptions & LeastSquaresOptions = {},
): BlockInterval[] {
  const name = "bootstrapMovingBlockLeastSquares";
  const intercept = options.intercept ?? true;
  const k = checkedShape(name, x, y, intercept);
  const n = x.length;
  const circular = options.circular ?? false;
  const all = fitRows(x, y, intercept, k);
  const block = options.block ?? (n === 1 ? 1 : blockLength(residuals(x, y, intercept, all.coefficients) ?? y));
  checkBlock(name, block, n);
  const index = new Array<number>(n);
  const sampleX = new Array<readonly number[]>(n);
  const sampleY = new Array<number>(n);
  return percentiles(
    name,
    options,
    k,
    (r) => {
      drawBlocks(r, n, block, circular, index);
      for (let i = 0; i < n; i++) {
        const row = index[i] as number;
        sampleX[i] = x[row] as readonly number[];
        sampleY[i] = y[row] as number;
      }
      return fitRows(sampleX, sampleY, intercept, k).coefficients;
    },
    () => all.coefficients,
  ).map((interval) => ({ ...interval, block, circular }));
}

/** This function gives the residuals of a fit, or `undefined` when a coefficient is not finite. */
function residuals(x: readonly (readonly number[])[], y: readonly number[], intercept: boolean, coefficients: readonly number[]): number[] | undefined {
  if (!coefficients.every(Number.isFinite)) return undefined;
  const offset = intercept ? 1 : 0;
  return y.map((value, i) => {
    let fitted = intercept ? (coefficients[0] as number) : 0;
    const row = x[i] as readonly number[];
    for (let j = 0; j < row.length; j++) fitted += (coefficients[j + offset] as number) * (row[j] as number);
    return value - fitted;
  });
}
