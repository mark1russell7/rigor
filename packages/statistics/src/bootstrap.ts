/**
 * The percentile bootstrap. Each run draws n items with replacement (`below(n)` of rigor-generators, which is
 * `floor(next() * n)`), and computes the statistic of the sample. The interval is two quantiles of the statistics.
 * With the same seed, the draws are equal to the draws of the copies in highways, packing and layout-contract.
 */
import { random } from "@mark1russell7/rigor-generators";
import { type QuantileMethod, median, quantileSorted, sorted } from "./describe.ts";

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
  const runs = options.runs ?? 10_000;
  if (!Number.isSafeInteger(runs) || runs < 1) throw new RangeError(`bootstrap: runs is a whole number of 1 or more, not ${runs}.`);
  const tail = (1 - (options.level ?? 0.95)) / 2;
  const [lowEnd, highEnd] = options.ends ?? [tail, 1 - tail];
  if (!(lowEnd >= 0 && lowEnd < highEnd && highEnd <= 1)) throw new RangeError(`bootstrap: the ends are 0 <= low < high <= 1, not ${lowEnd} and ${highEnd}.`);
  const level = options.ends ? highEnd - lowEnd : (options.level ?? 0.95);
  if (!(level > 0 && level < 1)) throw new RangeError(`bootstrap: level is more than 0 and less than 1, not ${level}.`);
  const r = random(options.seed ?? 1);
  const n = data.length;
  const sample = new Array<T>(n);
  const values: number[] = [];
  for (let run = 0; run < runs; run++) {
    for (let i = 0; i < n; i++) sample[i] = data[r.below(n)] as T;
    const v = statistic(sample);
    if (Number.isFinite(v)) values.push(v);
  }
  const estimate = statistic(data);
  if (values.length === 0) return { estimate, low: estimate, high: estimate, level, runs, finite: 0, seed: r.seed };
  const s = sorted(values);
  const method = options.method ?? "linear";
  return { estimate, low: quantileSorted(s, lowEnd, method), high: quantileSorted(s, highEnd, method), level, runs, finite: s.length, seed: r.seed };
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
