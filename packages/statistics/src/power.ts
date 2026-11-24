/**
 * The count of values that a comparison of options needs before it starts. The Student t law gives this count, because the
 * normal formula is too low at a small count. These functions make no draws, so a caller reads the count with no bench.
 */

import { betaCdf } from "@mark1russell7/rigor-generators";

/** The share of the Student t law with `df` degrees of freedom below `t`, for `t` of 0 or more. */
function upperHalf(t: number, df: number): number {
  return 1 - 0.5 * betaCdf(df / (df + t * t), df / 2, 0.5);
}

/**
 * This function gives the quantile of the Student t law, from a bisection of its distribution function.
 *
 * @param p - The share of the law below the result, above 0 and below 1.
 * @param df - The degrees of freedom, above 0.
 */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`tQuantile: p is above 0 and below 1, not ${p}.`);
  if (!(df > 0 && Number.isFinite(df))) throw new RangeError(`tQuantile: df is a finite number above 0, not ${df}.`);
  if (p < 0.5) return -tQuantile(1 - p, df);
  let high = 1;
  while (upperHalf(high, df) < p) high *= 2;
  let low = 0;
  for (let step = 0; step < 200 && high - low > 1e-12 * high; step++) {
    const middle = (low + high) / 2;
    if (upperHalf(middle, df) < p) low = middle;
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
