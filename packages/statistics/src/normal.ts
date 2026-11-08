/**
 * The standard normal law: its distribution function `normalCdf` and its quantile `normalQuantile`. The two functions
 * keep their relative digits in the far tails, so a small tail probability does not become 0.
 */

const SQRT_PI = Math.sqrt(Math.PI);

/** The series of `erf(z)` with positive terms, `2/√π · e^(-z²) · Σ (2z²)^n · z / (1·3·…·(2n+1))`, for a small `z` of 0 or more. */
function erfSeries(z: number): number {
  const twoZ2 = 2 * z * z;
  let term = z;
  let sum = z;
  for (let n = 1; n < 500 && term > sum * 1e-17; n++) {
    term *= twoZ2 / (2 * n + 1);
    sum += term;
  }
  return (2 / SQRT_PI) * expMinusSquare(z) * sum;
}

/**
 * The continued fraction of `erfc(z)`, `e^(-z²)/√π · 1/(z + (1/2)/(z + 1/(z + (3/2)/(z + …))))`, by the method of
 * Lentz, for a `z` of 1.5 or more.
 */
function erfcFraction(z: number): number {
  const tiny = 1e-300;
  let f = z;
  let c = z;
  let d = 0;
  for (let n = 1; n < 5000; n++) {
    const a = n / 2;
    d = z + a * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = z + a / c;
    if (Math.abs(c) < tiny) c = tiny;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return expMinusSquare(z) / (SQRT_PI * f);
}

/**
 * The value of `e^(-z²)` with its relative digits for a large `z`. The rounding of `z²` costs `z²` ulps, so the
 * function splits `z` into `hi + lo`. `hi` has 4 bits after the point, so `hi²` is exact.
 */
function expMinusSquare(z: number): number {
  const hi = Math.round(z * 16) / 16;
  const lo = z - hi;
  return Math.exp(-hi * hi) * Math.exp(-lo * (z + hi));
}

/** The complementary error function `erfc(z) = 1 - erf(z)`, with its relative digits for a large `z`. */
function erfc(z: number): number {
  if (z < 0) return 2 - erfc(-z);
  return z < 1.5 ? 1 - erfSeries(z) : erfcFraction(z);
}

/**
 * This function gives the distribution function of the standard normal law, `P(Z <= x)`. Its relative error is below
 * 1e-14, also in the lower tail: `normalCdf(-37)` is approximately 5.7e-300, not 0.
 *
 * @param x - A number. `-Infinity` gives 0 and `Infinity` gives 1.
 */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) throw new RangeError("normalCdf: x is NaN.");
  if (x === Number.NEGATIVE_INFINITY) return 0;
  if (x === Number.POSITIVE_INFINITY) return 1;
  return erfc(-x / Math.SQRT2) / 2;
}

// The coefficients of PPND16 of Wichura (1988), algorithm AS 241. The first set is for |p - 0.5| <= 0.425.
const A = [
  3.387132872796366608, 133.14166789178437745, 1971.5909503065514427, 13731.693765509461125, 45921.953931549871457,
  67265.770927008700853, 33430.575583588128105, 2509.0809287301226727,
];
const B = [
  1, 42.313330701600911252, 687.1870074920579083, 5394.1960214247511077, 21213.794301586595867, 39307.89580009271061,
  28729.085735721942674, 5226.495278852854561,
];
// The second set is for a tail with r = sqrt(-ln(tail)) of 5 or less.
const C = [
  1.42343711074968357734, 4.6303378461565452959, 5.7694972214606914055, 3.64784832476320460504, 1.27045825245236838258,
  0.24178072517745061177, 0.0227238449892691845833, 7.7454501427834140764e-4,
];
const D = [
  1, 2.05319162663775882187, 1.6763848301838038494, 0.68976733498510000455, 0.14810397642748007459,
  0.0151986665636164571966, 5.475938084995344946e-4, 1.05075007164441684324e-9,
];
// The third set is for a far tail, with r above 5.
const E = [
  6.6579046435011037772, 5.4637849111641143699, 1.7848265399172913358, 0.29656057182850489123, 0.026532189526576123093,
  0.0012426609473880784386, 2.71155556874348757815e-5, 2.01033439929228813265e-7,
];
const F = [
  1, 0.59983220655588793769, 0.13692988092273580531, 0.0148753612908506148525, 7.868691311456132591e-4,
  1.8463183175100546818e-5, 1.4215117583164458887e-7, 2.04426310338993978564e-15,
];

/** The value of a polynomial with the coefficients `c[0] + c[1] x + …`, by the rule of Horner. */
function poly(c: readonly number[], x: number): number {
  let value = 0;
  for (let i = c.length - 1; i >= 0; i--) value = value * x + (c[i] as number);
  return value;
}

/**
 * This function gives the quantile of the standard normal law, the `x` with `normalCdf(x) = p`. It uses PPND16 of
 * Wichura (algorithm AS 241). Its relative error is near 1e-16 for each `p` from 1e-300 to 1 - 1e-16.
 *
 * @param p - The share of the law below the result, from 0 to 1. A `p` of 0 gives `-Infinity` and 1 gives `Infinity`.
 */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) throw new RangeError(`normalQuantile: p is from 0 to 1, not ${p}.`);
  if (p === 0) return Number.NEGATIVE_INFINITY;
  if (p === 1) return Number.POSITIVE_INFINITY;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (q * poly(A, r)) / poly(B, r);
  }
  let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
  let value: number;
  if (r <= 5) {
    r -= 1.6;
    value = poly(C, r) / poly(D, r);
  } else {
    r -= 5;
    value = poly(E, r) / poly(F, r);
  }
  return q < 0 ? -value : value;
}
