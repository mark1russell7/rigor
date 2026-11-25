/**
 * The gamma law: its distribution function and its quantile.
 *
 * - The gamma law with the shape `shape` and the rate `rate` has the mean `shape / rate`.
 * - The distribution function is the regularized lower incomplete gamma function `P(shape, rate * x)`.
 * - Below `shape + 1`, a power series gives `P`. Above it, a continued fraction gives `Q = 1 - P`, so the upper tail keeps its digits.
 */
import { logGamma } from "@mark1russell7/rigor-generators";

/** The relative size of the last term of the series or of the last change of the continued fraction. */
const EPSILON = 1e-15;

/** The most terms of the series or of the continued fraction. A shape of 10^8 needs fewer than 10^5. */
const MAX_TERMS = 1_000_000;

/** A small number that keeps the continued fraction away from a division by 0 (the method of Lentz). */
const TINY = 1e-300;

/** The steps of the bisection of the quantile. Each step makes the bracket half as wide. */
const BISECTION_STEPS = 2000;

function checkLaw(name: string, shape: number, rate: number): void {
  if (!(Number.isFinite(shape) && shape > 0)) throw new RangeError(`${name}: the shape is ${shape}. It is a finite number of more than 0.`);
  if (!(Number.isFinite(rate) && rate > 0)) throw new RangeError(`${name}: the rate is ${rate}. It is a finite number of more than 0.`);
}

/** The log of `x^a e^-x / Gamma(a)`, the factor in front of the series and of the continued fraction. */
function logFront(a: number, x: number): number {
  return a * Math.log(x) - x - logGamma(a);
}

/** `P(a, x)` from its power series, for `x < a + 1`. */
function lowerSeries(a: number, x: number): number {
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n <= MAX_TERMS; n += 1) {
    term *= x / (a + n);
    sum += term;
    if (term < sum * EPSILON) return sum * Math.exp(logFront(a, x));
  }
  throw new RangeError(`gammaCdf: the series did not converge for the shape ${a} at ${x}.`);
}

/** `Q(a, x)` from its continued fraction, for `x >= a + 1`. */
function upperFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let n = 1; n <= MAX_TERMS; n += 1) {
    const an = -n * (n - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < EPSILON) return h * Math.exp(logFront(a, x));
  }
  throw new RangeError(`gammaCdf: the continued fraction did not converge for the shape ${a} at ${x}.`);
}

/** The pair `[P(a, x), Q(a, x)]`. Each value of the pair comes from its own method, so a value near 0 keeps its digits. */
function regularized(a: number, x: number): readonly [number, number] {
  if (x <= 0) return [0, 1];
  if (x === Number.POSITIVE_INFINITY) return [1, 0];
  if (x < a + 1) {
    const p = Math.min(1, lowerSeries(a, x));
    return [p, 1 - p];
  }
  const q = Math.min(1, upperFraction(a, x));
  return [1 - q, q];
}

/**
 * This function gives the chance that a value of the gamma law with the shape `shape` and the rate `rate` is `x` or less.
 * A value `x` of 0 or less gives 0. The value `Infinity` gives 1.
 *
 * @throws RangeError when the shape or the rate is not a finite number of more than 0, or `x` is NaN
 */
export function gammaCdf(x: number, shape: number, rate: number): number {
  checkLaw("gammaCdf", shape, rate);
  if (Number.isNaN(x)) throw new RangeError("gammaCdf: x is NaN.");
  return regularized(shape, rate * x)[0];
}

/**
 * This function gives the quantile of the gamma law with the shape `shape` and the rate `rate`: the value `x` with `gammaCdf(x) = p`.
 *
 * - The level 0 gives 0, and the level 1 gives `Infinity`.
 * - A bracket that doubles finds the quantile. Then a bisection makes the bracket as narrow as the spacing of the floats.
 * - Above the median of the law, the bisection compares `1 - p` with the upper tail `Q`. Thus a level near 1 keeps its digits.
 *
 * @throws RangeError when `p` is not in [0, 1], or the shape or the rate is not a finite number of more than 0
 */
export function gammaQuantile(p: number, shape: number, rate: number): number {
  checkLaw("gammaQuantile", shape, rate);
  if (!(p >= 0 && p <= 1)) throw new RangeError(`gammaQuantile: the level is ${p}. It is in [0, 1].`);
  if (p === 0) return 0;
  if (p === 1) return Number.POSITIVE_INFINITY;
  const upper = p > 0.5;
  const target = upper ? 1 - p : p;
  // `below(y)` is true when the quantile of the law with the rate 1 is more than y.
  const below = (y: number): boolean => {
    const [lower, tail] = regularized(shape, y);
    return upper ? tail > target : lower < target;
  };
  let low = 0;
  let high = Math.max(shape, 1);
  while (below(high)) {
    low = high;
    high *= 2;
    if (!Number.isFinite(high)) return Number.POSITIVE_INFINITY;
  }
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const middle = low + (high - low) / 2;
    if (middle <= low || middle >= high) break;
    if (below(middle)) low = middle;
    else high = middle;
  }
  return high / rate;
}
