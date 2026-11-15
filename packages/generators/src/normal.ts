// The standard normal law: its cumulative distribution `normalCdf` and its quantile `normalQuantile`. This file is the
// one home of the two functions. `@mark1russell7/rigor-statistics` exports them from here. The final home is the
// probability layer, and a move to that layer keeps these exports.

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * This function gives `e^(-z^2/2)` for a `z` of 0 or more, with its relative digits for a large `z`. The rounding of
 * `z^2` costs `z^2/2` ulps, so the function splits `z` into `hi + lo`. `hi` has 4 bits after the point, so `hi^2` is
 * exact for each `z` below 2^20.
 */
function halfSquareExp(z: number): number {
  const hi = Math.round(z * 16) / 16;
  const lo = z - hi;
  return Math.exp((-hi * hi) / 2) * Math.exp((-lo * (z + hi)) / 2);
}

/**
 * This function gives the standard normal cumulative distribution, `P(Z <= x)`. Below 0.75 in size, `x` uses the
 * series of `0.5 + phi(x) * (x + x^3/3 + x^5/15 + ...)`. The tails use the continued fraction of the Mills ratio, so a
 * lower tail has no cancellation. On 2026-11-09 the error was at most 4.4 ulps from -38 to 9, against `mpmath`.
 * `normalCdf(-37)` is approximately 5.7e-300, not 0.
 *
 * @param x - A number. `-Infinity` gives 0 and `Infinity` gives 1. `NaN` throws a `RangeError`.
 */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) throw new RangeError("normalCdf: x is NaN.");
  const z = Math.abs(x);
  // Below -38.5, the value is below the smallest double.
  if (z > 40) return x > 0 ? 1 : 0;
  const density = halfSquareExp(z) / SQRT_2PI;
  if (z < 0.75) {
    let term = x;
    let sum = x;
    for (let k = 1; k < 200 && Math.abs(term) > Number.EPSILON * Math.abs(sum) * 0.01; k++) {
      term *= (x * x) / (2 * k + 1);
      sum += term;
    }
    return 0.5 + density * sum;
  }
  // The fraction has `1000 / x^2 + 50` terms. This count converges to the last bit from 0.75.
  let fraction = z;
  for (let k = Math.ceil(1000 / (z * z)) + 50; k >= 1; k--) fraction = z + k / fraction;
  const tail = density / fraction;
  return x > 0 ? 1 - tail : tail;
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

/** This function gives the value of the polynomial `c[0] + c[1] x + ...`, by the rule of Horner. */
function poly(c: readonly number[], x: number): number {
  let value = 0;
  for (let i = c.length - 1; i >= 0; i--) value = value * x + c[i]!;
  return value;
}

/**
 * This function gives the quantile of the standard normal law: the `x` with `normalCdf(x) = p`. It uses PPND16 of
 * Wichura (algorithm AS 241). Below 0.075, one step of Halley with `normalCdf` follows. Above 0.5, `p` uses the lower
 * tail at `1 - p`. This subtraction is exact. On 2026-11-09 the error was at most 1.2 ulps in the tails and 5.5 ulps
 * from 0.075 to 0.925, against `mpmath`.
 *
 * @param p - The share of the law below the result, from 0 to 1. A `p` of 0 gives `-Infinity` and 1 gives `Infinity`.
 */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) throw new RangeError(`normalQuantile: p is from 0 to 1, not ${p}.`);
  if (p === 0) return Number.NEGATIVE_INFINITY;
  if (p === 1) return Number.POSITIVE_INFINITY;
  if (p > 0.5) return -normalQuantile(1 - p);
  const q = p - 0.5;
  if (q >= -0.425) {
    const r = 0.180625 - q * q;
    return (q * poly(A, r)) / poly(B, r);
  }
  let r = Math.sqrt(-Math.log(p));
  let x: number;
  if (r <= 5) {
    r -= 1.6;
    x = -poly(C, r) / poly(D, r);
  } else {
    r -= 5;
    x = -poly(E, r) / poly(F, r);
  }
  // One step of Halley. `u` is the error of the cdf over the density.
  const u = ((normalCdf(x) - p) * SQRT_2PI) / halfSquareExp(-x);
  return x - u / (1 + (x * u) / 2);
}
