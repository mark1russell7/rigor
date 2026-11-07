/**
 * The count of values that a comparison of options needs before it starts. The Student t law gives this count, because the
 * normal formula is too low at a small count. These functions make no draws, so a caller reads the count with no bench.
 */

/** The log of the gamma function, by the form of Lanczos with 6 terms. The argument is above 0. */
function logGamma(x: number): number {
  const terms = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  const base = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let series = 1.000000000190015;
  terms.forEach((term, i) => {
    series += term / (x + i + 1);
  });
  return -base + Math.log((2.5066282746310007 * series) / x);
}

/** The continued fraction of the incomplete beta function, by the method of Lentz. */
function betaFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const guard = (value: number): number => (Math.abs(value) < tiny ? tiny : value);
  let c = 1;
  let d = 1 / guard(1 - ((a + b) * x) / (a + 1));
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const twice = 2 * m;
    const even = (m * (b - m) * x) / ((a + twice - 1) * (a + twice));
    d = 1 / guard(1 + even * d);
    c = guard(1 + even / c);
    h *= d * c;
    const odd = (-(a + m) * (a + b + m) * x) / ((a + twice) * (a + twice + 1));
    d = 1 / guard(1 + odd * d);
    c = guard(1 + odd / c);
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-15) return h;
  }
  return h;
}

/** The regularized incomplete beta function at `x`, from 0 to 1. */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(x, a, b)) / a : 1 - (front * betaFraction(1 - x, b, a)) / b;
}

/** The share of the Student t law with `df` degrees of freedom below `t`, for `t` of 0 or more. */
function upperHalf(t: number, df: number): number {
  return 1 - 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
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
