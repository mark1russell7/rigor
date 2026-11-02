/**
 * The percentile bootstrap. Each run draws n items with replacement (`below(n)` of rigor-generators, which is
 * `floor(next() * n)`), and computes the statistic of the sample. The interval is two quantiles of the statistics.
 * With the same seed, the draws are equal to the draws of the copies in highways, packing and layout-contract.
 * `bootstrapTwo` draws two independent samples in each run: first the items of `a`, then the items of `b`.
 * `bootstrapLeastSquares` draws whole rows, and gives one interval for each coefficient from the same draws.
 */
import { type Random, random } from "@mark1russell7/rigor-generators";
import { type QuantileMethod, median, quantileSorted, sorted } from "./describe.ts";
import { type LeastSquaresOptions, checkedShape, fitRows } from "./regression.ts";

export interface BootstrapOptions {
  /** The number of samples. The default is 10 000. */
  readonly runs?: number;
  /** The level of the interval. The default is 0.95. */
  readonly level?: number;
  /** The seed of the draws. The default is 1. */
  readonly seed?: number | string;
  /** The quantile method of the two ends of the interval. The default is linear. */
  readonly method?: QuantileMethod;
  /**
   * The quantiles of the two ends, in place of `level`, for example [0.025, 0.975] or an interval with one side.
   * The default is from the level: (1 - level) / 2 and 1 - (1 - level) / 2. In floating point, (1 - 0.95) / 2 is
   * not 0.025, so a copy that writes 0.025 needs this option to give the same numbers.
   */
  readonly ends?: readonly [number, number];
}

export interface Interval {
  /** The statistic of all the data. */
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly level: number;
  readonly runs: number;
  /** The number of runs whose statistic is a finite number. Only these runs make the interval. */
  readonly finite: number;
  /** The seed as a 32-bit number. */
  readonly seed: number;
}

/**
 * A percentile bootstrap interval of `statistic` over `data`. A run whose statistic is not finite (NaN or an
 * infinity) does not count. When no run is finite, low and high are equal to the estimate.
 */
export function bootstrap<T>(data: readonly T[], statistic: (sample: readonly T[]) => number, options: BootstrapOptions = {}): Interval {
  if (data.length === 0) throw new RangeError("bootstrap: the data is empty.");
  const n = data.length;
  const sample = new Array<T>(n);
  return percentile(
    "bootstrap",
    options,
    (r) => {
      for (let i = 0; i < n; i++) sample[i] = data[r.below(n)] as T;
      return statistic(sample);
    },
    () => statistic(data),
  );
}

/**
 * A percentile bootstrap interval of `statistic` over two independent samples `a` and `b`. Use it when the two
 * samples are not paired, for example two arms of a benchmark. Each run draws `a.length` items of `a` with
 * replacement, and then `b.length` items of `b` with replacement. All the draws come from one stream of
 * `random(seed)`. The statistic reads the two drawn samples. The estimate is the statistic of all of `a` and `b`. A
 * run whose statistic is not finite does not count. When no run is finite, low and high are equal to the estimate.
 */
export function bootstrapTwo<A, B>(
  a: readonly A[],
  b: readonly B[],
  statistic: (a: readonly A[], b: readonly B[]) => number,
  options: BootstrapOptions = {},
): Interval {
  if (a.length === 0) throw new RangeError("bootstrapTwo: the first sample is empty.");
  if (b.length === 0) throw new RangeError("bootstrapTwo: the second sample is empty.");
  const na = a.length;
  const nb = b.length;
  const sampleA = new Array<A>(na);
  const sampleB = new Array<B>(nb);
  return percentile(
    "bootstrapTwo",
    options,
    (r) => {
      for (let i = 0; i < na; i++) sampleA[i] = a[r.below(na)] as A;
      for (let i = 0; i < nb; i++) sampleB[i] = b[r.below(nb)] as B;
      return statistic(sampleA, sampleB);
    },
    () => statistic(a, b),
  );
}

/**
 * A bootstrap interval of the ratio `median(numerator) / median(denominator)` of two independent samples. The
 * interval is the uncertainty of the ratio of the two medians. It is not the spread of the samples. A run whose
 * denominator median is 0 is not finite, so it does not count.
 */
export function bootstrapMedianRatio(numerator: readonly number[], denominator: readonly number[], options: BootstrapOptions = {}): Interval {
  return bootstrapTwo(numerator, denominator, (a, b) => median(a) / median(b), options);
}

/**
 * A percentile bootstrap interval of each coefficient of the least-squares fit of `y` on the rows of `x`. Each run
 * draws `n` row indexes with replacement, and fits the drawn rows and their `y` values. All the intervals come from
 * the same draws. The estimate of each interval is the coefficient of the fit of all the data. A run with a singular
 * design gives NaN coefficients, so it does not count. The shape errors are the errors of `leastSquares`.
 */
export function bootstrapLeastSquares(
  x: readonly (readonly number[])[],
  y: readonly number[],
  options: BootstrapOptions & LeastSquaresOptions = {},
): Interval[] {
  const intercept = options.intercept ?? true;
  const k = checkedShape("bootstrapLeastSquares", x, y, intercept);
  const n = x.length;
  const sampleX = new Array<readonly number[]>(n);
  const sampleY = new Array<number>(n);
  return percentiles(
    "bootstrapLeastSquares",
    options,
    k,
    (r) => {
      for (let i = 0; i < n; i++) {
        const row = r.below(n);
        sampleX[i] = x[row] as readonly number[];
        sampleY[i] = y[row] as number;
      }
      return fitRows(sampleX, sampleY, intercept, k).coefficients;
    },
    () => fitRows(x, y, intercept, k).coefficients,
  );
}

interface Settings {
  readonly runs: number;
  readonly lowEnd: number;
  readonly highEnd: number;
  readonly level: number;
  readonly method: QuantileMethod;
}

/** This function examines the options of a bootstrap, and gives the defaults. It throws a RangeError for each fault. */
function settings(name: string, options: BootstrapOptions): Settings {
  const runs = options.runs ?? 10_000;
  if (!Number.isSafeInteger(runs) || runs < 1) throw new RangeError(`${name}: runs is a whole number of 1 or more, not ${runs}.`);
  const tail = (1 - (options.level ?? 0.95)) / 2;
  const [lowEnd, highEnd] = options.ends ?? [tail, 1 - tail];
  if (!(lowEnd >= 0 && lowEnd < highEnd && highEnd <= 1)) throw new RangeError(`${name}: the ends are 0 <= low < high <= 1, not ${lowEnd} and ${highEnd}.`);
  const level = options.ends ? highEnd - lowEnd : (options.level ?? 0.95);
  if (!(level > 0 && level < 1)) throw new RangeError(`${name}: level is more than 0 and less than 1, not ${level}.`);
  return { runs, lowEnd, highEnd, level, method: options.method ?? "linear" };
}

/** The interval of the finite statistics of the runs. When no run is finite, low and high are equal to the estimate. */
function ends(values: number[], estimate: number, s: Settings, seed: number): Interval {
  const { runs, level } = s;
  if (values.length === 0) return { estimate, low: estimate, high: estimate, level, runs, finite: 0, seed };
  const v = sorted(values);
  return { estimate, low: quantileSorted(v, s.lowEnd, s.method), high: quantileSorted(v, s.highEnd, s.method), level, runs, finite: v.length, seed };
}

/**
 * The shared part of each percentile bootstrap. It examines the options, and starts one stream of `random(seed)`.
 * Each run gives the stream to `run`, which draws the samples and returns their statistic. Then `all` gives the
 * estimate. The order of the draws is the order in `run`.
 */
function percentile(name: string, options: BootstrapOptions, run: (r: Random) => number, all: () => number): Interval {
  const s = settings(name, options);
  const r = random(options.seed ?? 1);
  const values: number[] = [];
  for (let i = 0; i < s.runs; i++) {
    const v = run(r);
    if (Number.isFinite(v)) values.push(v);
  }
  return ends(values, all(), s, r.seed);
}

/**
 * The percentile bootstrap of `k` statistics from the same draws. Each run gives `k` statistics. Each statistic
 * has its own count of finite runs.
 */
function percentiles(name: string, options: BootstrapOptions, k: number, run: (r: Random) => readonly number[], all: () => readonly number[]): Interval[] {
  const s = settings(name, options);
  const r = random(options.seed ?? 1);
  const values = Array.from({ length: k }, (): number[] => []);
  for (let i = 0; i < s.runs; i++) {
    const v = run(r);
    for (let j = 0; j < k; j++) if (Number.isFinite(v[j])) (values[j] as number[]).push(v[j] as number);
  }
  const estimate = all();
  return values.map((list, j) => ends(list, estimate[j] as number, s, r.seed));
}

/** A bootstrap interval of the median. */
export function bootstrapMedian(values: readonly number[], options: BootstrapOptions = {}): Interval {
  return bootstrap(values, median, options);
}

/**
 * A cluster bootstrap: each run draws whole clusters with replacement, and the statistic reads the rows of the drawn
 * clusters. Use it when the rows of one cluster (one board, one seed, one site) are not independent. The clusters
 * are in the order of their first row.
 */
export function bootstrapClusters<T>(
  rows: readonly T[],
  cluster: (row: T) => string,
  statistic: (rows: readonly T[]) => number,
  options: BootstrapOptions = {},
): Interval {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = cluster(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const clusters = [...groups.values()];
  const result = bootstrap(clusters, (drawn) => statistic(drawn.flat()), options);
  // The estimate of all the rows in their own order, not in the order of the clusters.
  const estimate = statistic(rows);
  return result.finite === 0 ? { ...result, estimate, low: estimate, high: estimate } : { ...result, estimate };
}
