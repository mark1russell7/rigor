/**
 * The interval of a U-statistic from a uniform sample of `m` of `n` units, drawn without replacement. A kernel `h`
 * gives a value to each set of `r` units. The total of the population is the sum of `h` over all its sets of `r`.
 */
import { tQuantile } from "./power.ts";

/** The methods of `uStatisticInterval`. The method `"auto"` selects one of the other two for each sample. */
export type UStatisticMethod = "conservative" | "tight" | "auto";

/**
 * The smallest sample `m` at which the method `"auto"` uses the method `"tight"`. The calibration study
 * `u-statistic-interval` gives the value with `coverageMinSample`. The value is the smallest `m` of the grid such that
 * each `m` of the grid from this value up passes the bar. Until a run of the study gives a value, the value is
 * infinite. The TSDoc of `uStatisticInterval` gives the bar of the study.
 */
export const U_STATISTIC_TIGHT_MIN_SAMPLE: number = Number.POSITIVE_INFINITY;

/** The options of `uStatisticInterval`. */
export interface UStatisticOptions {
  /** The order `r` of the kernel: the number of units in each set. It is a whole number of 1 or more. */
  readonly order: number;
  /** The number of units in the whole population, `n`. It is a whole number, and it is not less than the sample. */
  readonly population: number;
  /** The method of the interval. The methods `"conservative"` and `"auto"` need `range`. */
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
  /** The method that made the interval. It is not `requested` after a fallback or a choice of the method `"auto"`. */
  readonly method: "conservative" | "tight";
  /** The method of the options. */
  readonly requested: UStatisticMethod;
  /** The mean of the kernel, with its interval. */
  readonly mean: UStatisticMean;
  /** The number of sets of `r` units in the population, `C(n, r)`. */
  readonly subsets: number;
  /** The standard error of the total. Only an interval of the method `"tight"` has it. */
  readonly standardError?: number;
  /** The degrees of freedom of the t quantile, `m - 1`. Only an interval of the method `"tight"` has it. */
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
 * The method `"tight"` does not give an interval of width 0 when `m` is less than `n`. When all the totals are
 * equal, the jackknife variance is 0. Then the function uses the method `"conservative"` for the sample, and the
 * result has `method: "conservative"`. Without `range`, the function throws a `RangeError` for this sample.
 *
 * The method `"tight"` has no proof of its coverage. The tests use 200 samples of made-up populations at the level
 * 0.95. The table gives the hits of 200 for each population `n` and sample `m`. Each count includes the fallback.
 *
 * | n / m | sparse | crossings | skewed |
 * | --- | --- | --- | --- |
 * | 40 / 8 | 200 | 200 | 183 |
 * | 40 / 10 | 200 | 200 | 187 |
 * | 40 / 12 | 200 | 183 | 189 |
 * | 40 / 20 | 180 | 183 | 188 |
 * | 40 / 36 | 192 | 189 | 193 |
 * | 60 / 8 | 200 | 200 | 181 |
 * | 60 / 10 | 200 | 200 | 180 |
 * | 60 / 12 | 200 | 195 | 186 |
 * | 60 / 20 | 184 | 190 | 183 |
 * | 60 / 40 | 186 | 193 | 180 |
 * | 120 / 8 | 200 | 200 | 177 |
 * | 120 / 10 | 200 | 192 | 175 |
 * | 120 / 12 | 200 | 189 | 178 |
 * | 120 / 20 | 191 | 193 | 182 |
 * | 120 / 40 | 194 | 192 | 185 |
 * | 120 / 60 | 195 | 189 | 185 |
 * | 120 / 108 | 187 | 185 | 190 |
 *
 * The sparse kernel holds 2% to 3% of the pairs. The skewed kernel has a few large values. At `m = 8`, the skewed
 * kernel gets 177 to 183 of 200, a coverage of 0.885 to 0.915. No row has 190 or more in each kernel.
 *
 * The method `"auto"` needs `range`. It uses the method `"tight"` when `m` is `U_STATISTIC_TIGHT_MIN_SAMPLE` or more
 * and the variance is more than 0. Otherwise, it uses the method `"conservative"`.
 *
 * The calibration study `u-statistic-interval` sets `U_STATISTIC_TIGHT_MIN_SAMPLE`. Its bar was fixed before its run.
 * The study draws 1000 samples in each cell of the 3 kernels and the 17 cells of the table. The method `"tight"`
 * qualifies at `m` when the cells with a sample of `m` or more pass two tests.
 *
 * First, no cell rejects the coverage 0.95 in a one-sided exact binomial test at alpha 0.05, with the Holm
 * correction over these cells. Second, the Wilson lower end of the pooled coverage of these cells is 0.94 or more.
 * `coverageMinSample` applies this bar.
 *
 * The set of sizes is closed upward. The constant is the smallest `m` of the grid such that each `m` of the grid from
 * this value up qualifies. A small `m` pools the good cells of the larger sizes, so it can pass while a larger `m`
 * fails alone. The upward rule keeps the method `"auto"` away from a size that failed.
 *
 * When the largest `m` fails, the constant is infinite. Until a run of the study gives a value, the constant is infinite. Thus the method `"auto"`
 * uses the method `"conservative"` at each `m` less than `n`.
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
  const { order: r, population: n, method: requested } = options;
  const m = totals.length;
  const level = options.level ?? 0.95;
  if (!Number.isSafeInteger(r) || r < 1) throw new RangeError(`${name}: order is a whole number of 1 or more, not ${r}.`);
  if (m <= r) throw new RangeError(`${name}: the sample has more units than the order ${r}, not ${m}.`);
  if (!Number.isSafeInteger(n) || n < m) throw new RangeError(`${name}: population is a whole number of ${m} (the sample) or more, not ${n}.`);
  if (requested !== "conservative" && requested !== "tight" && requested !== "auto") {
    throw new RangeError(`${name}: method is "conservative", "tight" or "auto", not ${String(requested)}.`);
  }
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
  } else if (requested !== "tight") {
    throw new RangeError(`${name}: the method "${requested}" needs the range of the kernel.`);
  }

  let sum = 0;
  for (const t of totals) sum += t;
  const s = sum / r;
  const subsets = choose(n, r);
  const sampleSets = choose(m, r);
  const estimate = (s * subsets) / sampleSets;
  const u = s / sampleSets;
  const base = { estimate, level, requested, subsets };

  // The jackknife variance of U. It is 0 when all the totals are equal.
  const centre = sum / m;
  let squares = 0;
  for (const t of totals) squares += (t - centre) ** 2;
  const equal = totals.every((t) => t === totals[0]);
  const variance = equal ? 0 : ((1 - m / n) * ((m - 1) / m) * squares) / choose(m - 1, r) ** 2;

  if (m === n) {
    const method = requested === "conservative" || (requested === "auto" && m < U_STATISTIC_TIGHT_MIN_SAMPLE) ? "conservative" : "tight";
    return { ...base, low: estimate, high: estimate, method, mean: { estimate: u, low: u, high: u }, ...(method === "tight" ? { standardError: 0, df: m - 1 } : {}) };
  }
  const useTight = requested === "tight" || (requested === "auto" && m >= U_STATISTIC_TIGHT_MIN_SAMPLE);
  if (useTight && variance > 0) {
    const df = m - 1;
    const se = Math.sqrt(variance);
    const half = tQuantile(1 - (1 - level) / 2, df) * se;
    return { ...base, method: "tight", ...ends(u, u - half, u + half, range, subsets), standardError: se * subsets, df };
  }
  if (range === undefined) {
    throw new RangeError(`${name}: the jackknife variance is 0, because all the totals are equal. Give the range, or use the method "conservative".`);
  }
  const k = Math.floor(m / r);
  const half = (range[1] - range[0]) * Math.sqrt(Math.log(2 / (1 - level)) / (2 * k));
  return { ...base, method: "conservative", ...ends(u, u - half, u + half, range, subsets) };
}

/** This function gives the interval of the mean in the range, if there is a range, and scales it to the total. */
function ends(
  u: number,
  lowMean: number,
  highMean: number,
  range: readonly [number, number] | undefined,
  subsets: number,
): Pick<UStatisticInterval, "low" | "high" | "mean"> {
  const low = range ? Math.max(range[0], lowMean) : lowMean;
  const high = range ? Math.min(range[1], highMean) : highMean;
  return { low: low * subsets, high: high * subsets, mean: { estimate: u, low, high } };
}

/** The binomial coefficient `C(n, k)`, as a product. Each step is a whole number, so it is exact below 2^53. */
function choose(n: number, k: number): number {
  let c = 1;
  for (let j = 0; j < k; j++) c = (c * (n - j)) / (j + 1);
  return c;
}
