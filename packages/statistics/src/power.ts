/**
 * The count of values that a comparison of options needs before it starts. The Student t law gives this count, because the
 * normal formula is too low at a small count. These functions make no draws, so a caller reads the count with no bench.
 */

import { betaShares, normalQuantile } from "@mark1russell7/rigor-generators";

/**
 * From this count of degrees of freedom, `tQuantile` uses the Cornish-Fisher series. Below it, the bisection of the beta shares has a relative error below 1e-12.
 * Above it, the series needs no bisection, and its error is not more than the error of the bisection.
 * The series term that the sum omits is below 1e-16 at this count, for `p` from 1e-12 to 1 - 1e-12.
 */
const T_SERIES_DF = 1e5;

/**
 * This function gives the Cornish-Fisher series of the quantile of the Student t law, to the power -4 of `df` (Abramowitz and Stegun, 26.7.5).
 * The series is odd in the normal quantile `z` of `p`. Its terms grow as `z^2 / df` in each power, so it is for a large `df` only.
 */
function seriesQuantile(p: number, df: number): number {
  const z = normalQuantile(p);
  const square = z * z;
  const g1 = (z * (square + 1)) / 4;
  const g2 = (z * ((5 * square + 16) * square + 3)) / 96;
  const g3 = (z * (((3 * square + 19) * square + 17) * square - 15)) / 384;
  const g4 = (z * ((((79 * square + 776) * square + 1482) * square - 1920) * square - 945)) / 92160;
  return z + (g1 + (g2 + (g3 + g4 / df) / df) / df) / df;
}

/**
 * This function tells if the share of the Student t law with `df` degrees of freedom below `t` is below `p`.
 * The value `t` is 0 or more, and `p` is 0.5 or more.
 * - Below a `p` of 0.75, it compares the share between `-t` and `t` with `2 p - 1`. Thus the read near `p` of 0.5 keeps its digits.
 * - Else it compares the share above `|t|` on both sides with `2 (1 - p)`. Thus the read near `p` of 1 keeps its digits.
 *
 * The two subtractions are exact for `p` from 0.5 to 1. The shares come from `betaShares` with `x` and `1 - x`, so no share rounds near 1.
 */
function below(t: number, df: number, p: number): boolean {
  const square = t * t;
  const shares = betaShares(square / (square + df), df / (square + df), 0.5, df / 2);
  return p < 0.75 ? shares.below < 2 * p - 1 : shares.above > 2 * (1 - p);
}

/**
 * This function gives the quantile of the Student t law.
 * - Below `T_SERIES_DF` degrees of freedom, it is a bisection of the shares of the law (`betaShares`).
 * - From `T_SERIES_DF`, it is the Cornish-Fisher series of the quantile.
 *
 * The tests hold a relative error below 1e-10 from `p` of 0.5 + 1e-9 to 1 - 1e-12, at `df` from 1 to 1e12.
 *
 * @param p - The share of the law below the result, above 0 and below 1.
 * @param df - The degrees of freedom, above 0.
 */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`tQuantile: p is above 0 and below 1, not ${p}.`);
  if (!(df > 0 && Number.isFinite(df))) throw new RangeError(`tQuantile: df is a finite number above 0, not ${df}.`);
  if (p < 0.5) return -tQuantile(1 - p, df);
  if (df >= T_SERIES_DF) return seriesQuantile(p, df);
  let high = 1;
  while (below(high, df, p)) high *= 2;
  let low = 0;
  for (let step = 0; step < 200 && high - low > 1e-12 * high; step++) {
    const middle = (low + high) / 2;
    if (below(middle, df, p)) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** The options of `optionFloor`. */
export interface OptionFloorOptions {
  /** The standard deviation of one value about the mean of its option. All options have the same value. */
  readonly sigma: number;
  /** The smallest difference between the means of two options that the comparison finds. */
  readonly delta: number;
  /** The count of tests in the family. The level of each test is `alpha / tests`. */
  readonly tests: number;
  /** The two-sided level of the family. The default is 0.05. */
  readonly alpha?: number;
  /** The share of comparisons that find a difference of `delta`. The default is 0.8. */
  readonly power?: number;
}

/**
 * This function gives the smallest count of values for each of two options. With it, one test finds a difference of
 * `delta` with the stated power. The form is `n = 2 ((t(1 - alpha / (2 tests), df) + t(power, df)) sigma / delta)^2`,
 * with `df = 2 n - 2`. The count is on both sides of that form, so the function takes the first count that meets it.
 *
 * The function assumes independent values, unpaired groups of equal size, equal `sigma`, and a Bonferroni family.
 * Holm gives each test a level of `alpha / tests` or more. Thus for a Holm family the count is an upper bound, not the exact count.
 * The tests read the power by simulation: 2,000 draws at the floor for 1, 5 and 67 tests, from the fixed seeds `rigor-statistics/optionFloor/at/<tests>`.
 * Each read gives 0.78 or more, and one count below the floor gives less.
 * A value of `sigma` from an older run gives a count for that run. Read `sigma` again on the new values.
 *
 * @param options - The spread, the difference, the family and the targets.
 * @returns A whole number of 2 or more.
 */
export function optionFloor(options: OptionFloorOptions): number {
  const { sigma, delta, tests, alpha = 0.05, power = 0.8 } = options;
  if (!(sigma > 0 && Number.isFinite(sigma))) throw new RangeError(`optionFloor: sigma is a finite number above 0, not ${sigma}.`);
  if (!(delta > 0 && Number.isFinite(delta))) throw new RangeError(`optionFloor: delta is a finite number above 0, not ${delta}.`);
  if (!Number.isSafeInteger(tests) || tests < 1) throw new RangeError(`optionFloor: tests is a whole number of 1 or more, not ${tests}.`);
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`optionFloor: alpha is above 0 and below 1, not ${alpha}.`);
  if (!(power > 0.5 && power < 1)) throw new RangeError(`optionFloor: power is above 0.5 and below 1, not ${power}.`);
  const level = 1 - alpha / (2 * tests);
  for (let n = 2; n < 1e7; n++) {
    const df = 2 * n - 2;
    const need = 2 * (((tQuantile(level, df) + tQuantile(power, df)) * sigma) / delta) ** 2;
    if (n >= need) return n;
  }
  throw new RangeError(`optionFloor: no count under 10,000,000 for sigma ${sigma} and delta ${delta}.`);
}
