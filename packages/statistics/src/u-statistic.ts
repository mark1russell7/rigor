/**
 * The interval of a U-statistic from a uniform sample of `m` of `n` units, drawn without replacement. A kernel `h`
 * gives a value to each set of `r` units. The total of the population is the sum of `h` over all its sets of `r`.
 */
import { tQuantile } from "./power.ts";

/** The two methods of `uStatisticInterval`. */
export type UStatisticMethod = "conservative" | "tight";

/** The options of `uStatisticInterval`. */
export interface UStatisticOptions {
  /** The order `r` of the kernel: the number of units in each set. It is a whole number of 1 or more. */
  readonly order: number;
  /** The number of units in the whole population, `n`. It is a whole number, and it is not less than the sample. */
  readonly population: number;
  /** The method of the interval. The method `"conservative"` needs `range`. */
  readonly method: UStatisticMethod;
  /** The level of the interval. The default is 0.95. */
  readonly level?: number;
  /** The smallest and the largest value of the kernel. With it, the interval stays in this range. */
  readonly range?: readonly [low: number, high: number];
}

/** The mean of the kernel over all the sets of `r` units of the population, with its interval. */
export interface UStatisticMean {
  /** The U-statistic: the mean of the kernel over the sets of `r` units of the sample. */
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
}

/** The result of `uStatisticInterval`. The total is the mean of the kernel times `subsets`. */
export interface UStatisticInterval {
  /** The estimate of the total of the population: `S * C(n, r) / C(m, r)`, with `S` the total of the sample. */
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly level: number;
  readonly method: UStatisticMethod;
  /** The mean of the kernel, with its interval. */
  readonly mean: UStatisticMean;
  /** The number of sets of `r` units in the population, `C(n, r)`. */
  readonly subsets: number;
  /** The standard error of the total. Only the method `"tight"` gives it. */
  readonly standardError?: number;
  /** The degrees of freedom of the t quantile, `m - 1`. Only the method `"tight"` gives it. */
  readonly df?: number;
}

/**
 * This function gives the interval of a total over all the sets of `r` units of a population. The data is a uniform
 * sample of `m` of the `n` units, without replacement. An example is the count of crossings between all pairs of
 * routes. The input is the total of each sampled unit: the sum of the kernel over the sets of `r` sampled units
 * that hold the unit. Thus the sum of the totals is `r * S`, with `S` the total of the sample. The kernel is
 * symmetric.
 *
 * The estimate is `S * C(n, r) / C(m, r)`. It is the U-statistic `U = S / C(m, r)` times `C(n, r)`. At `r = 1`,
 * the estimate is `n / m` times the sum of the sample. When `m` is `n`, the interval is the estimate.
 *
 * The method `"conservative"` uses the inequality of Hoeffding (1963) for U-statistics, with `k = floor(m / r)`. The
 * half width of the mean is `(b - a) * sqrt(ln(2 / (1 - level)) / (2 k))`, with `[a, b]` the range of the kernel.
 * The bound is also true for a sample without replacement (Ai, Kuželka and Wang 2022, Blanc 2023 Theorem 6).
 * Thus the interval holds at each `m`. It is wide at a small `m`.
 *
 * The method `"tight"` uses the jackknife variance of `U`, from the totals only, times the finite population
 * correction `1 - m / n`. The interval is `U` plus or minus the t quantile with `m - 1` degrees of freedom, times
 * the standard error.
 *
 * The correction comes from the inclusion probabilities of a sample without replacement. The variance of the linear
 * part of `U` (its Hájek projection) gets exactly the factor `1 - m / n`. The variance of the remainder gets a
 * smaller factor, near `(1 - m / n)^2`, relative to an independent sample. For `r = 2` this factor is
 * `(n - m)(n - m - 1) / ((n - 2)(n - 3))`. Thus this estimate of the variance is exact for a linear kernel, and
 * larger than the variance for other kernels. The tests read the two facts over all samples of small populations.
 *
 * The method `"tight"` has no proof of its coverage. The tests use 200 samples of made-up populations of `n = 40` to
 * `120`, at the level 0.95. At `m = 8`, a crossing kernel and a skewed kernel give a coverage of 0.885 to 0.94. A
 * sparse kernel (2% to 3% of the pairs) gives 0.38 to 0.565. Many of its samples hold no crossing, so the interval
 * is the point 0. Use the method `"conservative"` for a sparse kernel or a small `m`.
 *
 * With `range`, the interval of the mean stays in `[a, b]`, and each total is in the range of a sum of
 * `C(m - 1, r - 1)` kernel values.
 *
 * @param totals - The total of each unit of the sample. The sample has more units than `r`.
 * @param options - The order, the population, the method, the level and the range of the kernel.
 * @returns The estimate and the interval of the total, and of the mean of the kernel.
 */
export function uStatisticInterval(totals: readonly number[], options: UStatisticOptions): UStatisticInterval {
  const name = "uStatisticInterval";
  const { order: r, population: n, method } = options;
  const m = totals.length;
  const level = options.level ?? 0.95;
  if (!Number.isSafeInteger(r) || r < 1) throw new RangeError(`${name}: order is a whole number of 1 or more, not ${r}.`);
  if (m <= r) throw new RangeError(`${name}: the sample has more units than the order ${r}, not ${m}.`);
  if (!Number.isSafeInteger(n) || n < m) throw new RangeError(`${name}: population is a whole number of ${m} (the sample) or more, not ${n}.`);
  if (method !== "conservative" && method !== "tight") throw new RangeError(`${name}: method is "conservative" or "tight", not ${String(method)}.`);
  if (!(level > 0 && level < 1)) throw new RangeError(`${name}: level is more than 0 and less than 1, not ${level}.`);
  for (const t of totals) if (!Number.isFinite(t)) throw new RangeError(`${name}: each total is a finite number, not ${t}.`);
  const range = options.range;
  if (range !== undefined) {
    const [a, b] = range;
    if (!(Number.isFinite(a) && Number.isFinite(b) && a < b)) throw new RangeError(`${name}: range is two finite numbers a < b, not ${a} and ${b}.`);
    const sets = choose(m - 1, r - 1);
    const slack = 1e-9 * Math.max(Math.abs(a), Math.abs(b)) * sets;
    for (const t of totals) {
      if (t < a * sets - slack || t > b * sets + slack) throw new RangeError(`${name}: each total is from ${a * sets} to ${b * sets} for this range, not ${t}.`);
    }
  } else if (method === "conservative") {
    throw new RangeError(`${name}: the method "conservative" needs the range of the kernel.`);
  }

  let sum = 0;
  for (const t of totals) sum += t;
  const s = sum / r;
  const subsets = choose(n, r);
  const sampleSets = choose(m, r);
  const estimate = (s * subsets) / sampleSets;
  const u = s / sampleSets;
  const point = (extra: Partial<UStatisticInterval>): UStatisticInterval => ({
    estimate,
    low: estimate,
    high: estimate,
    level,
    method,
    mean: { estimate: u, low: u, high: u },
    subsets,
    ...extra,
  });

  if (method === "conservative") {
    const [a, b] = range as readonly [number, number];
    if (m === n) return point({});
    const k = Math.floor(m / r);
    const half = (b - a) * Math.sqrt(Math.log(2 / (1 - level)) / (2 * k));
    return ends(estimate, u, u - half, u + half, range, subsets, level, method, {});
  }

  const df = m - 1;
  if (m === n) return point({ standardError: 0, df });
  const centre = sum / m;
  let squares = 0;
  for (const t of totals) squares += (t - centre) ** 2;
  const variance = ((1 - m / n) * ((m - 1) / m) * squares) / choose(m - 1, r) ** 2;
  const se = Math.sqrt(variance);
  const half = tQuantile(1 - (1 - level) / 2, df) * se;
  return ends(estimate, u, u - half, u + half, range, subsets, level, method, { standardError: se * subsets, df });
}

/** This function gives the interval of the mean in the range, if there is a range, and scales it to the total. */
function ends(
  estimate: number,
  u: number,
  lowMean: number,
  highMean: number,
  range: readonly [number, number] | undefined,
  subsets: number,
  level: number,
  method: UStatisticMethod,
  extra: Partial<UStatisticInterval>,
): UStatisticInterval {
  const low = range ? Math.max(range[0], lowMean) : lowMean;
  const high = range ? Math.min(range[1], highMean) : highMean;
  return { estimate, low: low * subsets, high: high * subsets, level, method, mean: { estimate: u, low, high }, subsets, ...extra };
}

/** The binomial coefficient `C(n, k)`, as a product. Each step is a whole number, so it is exact below 2^53. */
function choose(n: number, k: number): number {
  let c = 1;
  for (let j = 0; j < k; j++) c = (c * (n - j)) / (j + 1);
  return c;
}
