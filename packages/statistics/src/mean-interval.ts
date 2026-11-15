/**
 * The interval of a mean with the Student t law. It assumes independent values from a law that is near normal. For a
 * law with heavy tails or few values, the distribution-free `medianInterval` is safer.
 */
import { mean, sd } from "./describe.ts";
import { tQuantile } from "./power.ts";

/** The interval of a mean: `mean` plus or minus `half`. */
export interface MeanInterval {
  readonly mean: number;
  /** The half width: `t * sd / sqrt(n)`. */
  readonly half: number;
  readonly low: number;
  readonly high: number;
  /** The two-sided level of the interval. */
  readonly level: number;
  /** The degrees of freedom of the t law: the count of values minus 1. */
  readonly df: number;
  /** The t quantile of the interval: `tQuantile((1 + level) / 2, df)`. */
  readonly t: number;
}

/**
 * This function gives the two-sided interval of the mean of `values` at `level`: the mean plus or minus `t * sd / sqrt(n)`.
 * - The t quantile is `tQuantile((1 + level) / 2, n - 1)`. Thus the level 0.9 uses the one-sided 0.95 quantile.
 * - Equal values give a half width of 0.
 * - The function needs 2 finite values or more, and a level above 0 and below 1.
 *
 * @param values - The values, 2 or more.
 * @param level - The two-sided level. The default is 0.95.
 */
export function meanInterval(values: readonly number[], level = 0.95): MeanInterval {
  if (!(level > 0 && level < 1)) throw new RangeError(`meanInterval: the level is above 0 and below 1, not ${level}.`);
  if (values.length < 2) throw new RangeError(`meanInterval: the list needs 2 values or more, not ${values.length}.`);
  const m = mean(values);
  const df = values.length - 1;
  const t = tQuantile((1 + level) / 2, df);
  const half = (t * sd(values)) / Math.sqrt(values.length);
  return { mean: m, half, low: m - half, high: m + half, level, df, t };
}
