// The cumulative distribution and the quantile of each family of `distributions.ts`. A design draws a uniform number u
// in each stratum and gives the quantile of u. So the Latin hypercube and the stratified designs work with each family.
import type { DistributionSpec, Param } from "./distributions.ts";
import type { Random } from "./random.ts";

/** One point of a family: its parameters are fixed. */
export interface Distribution {
  /** The family of the point. */
  readonly family: DistributionSpec["family"];
  /** True when the values are a finite set, as in `zipf` and `recorded`. */
  readonly discrete: boolean;
  /** This function gives the probability of a value at or below `x`. */
  cdf(x: number): number;
  /** This function gives the smallest value whose `cdf` is `u` or more. `u` is from 0 to 1. */
  quantile(u: number): number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * This function gives the standard normal cumulative distribution. Below 0.75 in size, `x` uses the series of
 * `0.5 + phi(x) * (x + x^3/3 + x^5/15 + ...)`. The tails use the continued fraction of the Mills ratio, so a lower tail
 * has no cancellation. The fraction has `1000 / x^2 + 50` terms. This count converges to the last bit from 0.75.
 */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const z = Math.abs(x);
  if (z > 40) return x > 0 ? 1 : 0;
  const density = Math.exp((-z * z) / 2) / SQRT_2PI;
  if (z < 0.75) {
    let term = x;
    let sum = x;
    for (let k = 1; k < 200 && Math.abs(term) > Number.EPSILON * Math.abs(sum) * 0.01; k++) {
      term *= (x * x) / (2 * k + 1);
      sum += term;
    }
    return 0.5 + density * sum;
  }
  let fraction = z;
  for (let k = Math.ceil(1000 / (z * z)) + 50; k >= 1; k--) fraction = z + k / fraction;
  const tail = density / fraction;
  return x > 0 ? 1 - tail : tail;
}

const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const P_LOW = 0.02425;

/** This function gives the first guess of the normal quantile (Acklam), with a relative error of 1.15e-9. */
function normalGuess(p: number): number {
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) / ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1);
  }
  if (p > 1 - P_LOW) return -normalGuess(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((A[0]! * r + A[1]!) * r + A[2]!) * r + A[3]!) * r + A[4]!) * r + A[5]!) * q) / (((((B[0]! * r + B[1]!) * r + B[2]!) * r + B[3]!) * r + B[4]!) * r + 1);
}

/**
 * This function gives the standard normal quantile: the guess of Acklam and one step of Halley with `normalCdf`.
 * Above 0.5, `p` uses the lower tail at `1 - p`. This subtraction is exact, and the lower tail has no cancellation.
 */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) throw new RangeError(`normalQuantile: p is ${p}, and it must be from 0 to 1.`);
  if (p === 0) return Number.NEGATIVE_INFINITY;
  if (p === 1) return Number.POSITIVE_INFINITY;
  if (p > 0.5) return -normalQuantile(1 - p);
  const x = normalGuess(p);
  const u = (normalCdf(x) - p) * SQRT_2PI * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** This function gives the logarithm of the gamma function for `x` above 0 (Lanczos, g 7). */
function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const y = x - 1;
  let sum = LANCZOS[0]!;
  for (let i = 1; i < 9; i++) sum += LANCZOS[i]! / (y + i);
  const t = y + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** This function gives the continued fraction of the incomplete beta function (the method of Lentz). */
function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-16) break;
  }
  return h;
}

/** This function gives the regularized incomplete beta function: the beta cumulative distribution at `x`. */
export function betaCdf(x: number, a: number, b: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaFraction(a, b, x)) / a;
  return 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

/**
 * This function gives the smallest `x` from `lo` to `hi` whose `cdf` is `u` or more, by bisection.
 * The caller makes sure that `cdf(lo)` is `u` or less and `cdf(hi)` is `u` or more.
 */
function bisect(cdf: (x: number) => number, u: number, lo: number, hi: number): number {
  for (let i = 0; i < 2000 && lo < hi; i++) {
    const mid = lo + (hi - lo) / 2;
    if (mid <= lo || mid >= hi) break;
    if (cdf(mid) >= u) hi = mid;
    else lo = mid;
  }
  return cdf(lo) >= u ? lo : hi;
}

/** This function examines a parameter, as `sampler` does. Both ends of a range must pass `valid`. */
function checked(family: string, name: string, param: Param, valid: (value: number) => boolean, rule: string): void {
  const ends = typeof param === "number" ? [param] : param;
  for (const value of ends) {
    if (!Number.isFinite(value) || !valid(value)) throw new RangeError(`${family}: ${name} is ${value}, and it must be ${rule}.`);
  }
  if (typeof param !== "number" && param[0] > param[1]) throw new RangeError(`${family}: the range of ${name} starts above its end.`);
}

/** This function gives the value of a parameter: the number, or one draw from the range. */
function valueOf(param: Param, r: Random): number {
  return typeof param === "number" ? param : r.range(param[0], param[1]);
}

/** This function examines `u` of a quantile. */
function unit(u: number): void {
  if (!(u >= 0 && u <= 1)) throw new RangeError(`quantile: u is ${u}, and it must be from 0 to 1.`);
}

/**
 * This function gives one point of a family, with its `cdf` and its `quantile`. It draws the parameters from `r` in
 * the order of `sampler`. Thus the same seed gives the same point of the family as `sampler`.
 * The values use `Math.exp`, `Math.log` or `Math.pow` when `dependsOnLibm` of the family is true.
 */
export function distributionOf(spec: DistributionSpec, r: Random): Distribution {
  switch (spec.family) {
    case "lognormal": {
      checked("lognormal", "sigma", spec.sigma, (v) => v >= 0, "0 or more");
      checked("lognormal", "mu", spec.mu, () => true, "finite");
      const mu = valueOf(spec.mu, r);
      const sigma = valueOf(spec.sigma, r);
      const median = Math.exp(mu);
      return {
        family: "lognormal",
        discrete: false,
        cdf: (x) => (x <= 0 ? 0 : sigma === 0 ? (x >= median ? 1 : 0) : normalCdf((Math.log(x) - mu) / sigma)),
        quantile: (u) => {
          unit(u);
          return sigma === 0 ? median : Math.exp(mu + sigma * normalQuantile(u));
        },
      };
    }
    case "pareto": {
      checked("pareto", "scale", spec.scale, (v) => v > 0, "above 0");
      checked("pareto", "shape", spec.shape, (v) => v > 0, "above 0");
      const scale = valueOf(spec.scale, r);
      const shape = valueOf(spec.shape, r);
      return {
        family: "pareto",
        discrete: false,
        cdf: (x) => (x < scale ? 0 : 1 - Math.pow(scale / x, shape)),
        quantile: (u) => {
          unit(u);
          return scale / Math.pow(1 - u, 1 / shape);
        },
      };
    }
    case "zipf": {
      if (!Number.isSafeInteger(spec.n) || spec.n < 1) throw new RangeError(`zipf: n is ${spec.n}, and it must be a whole number of 1 or more.`);
      checked("zipf", "exponent", spec.exponent, (v) => v >= 0, "0 or more");
      const exponent = valueOf(spec.exponent, r);
      const totals: number[] = [];
      let total = 0;
      for (let rank = 1; rank <= spec.n; rank++) {
        total += Math.pow(rank, -exponent);
        totals.push(total);
      }
      return {
        family: "zipf",
        discrete: true,
        cdf: (x) => (x < 1 ? 0 : x >= spec.n ? 1 : totals[Math.floor(x) - 1]! / total),
        quantile: (u) => {
          unit(u);
          const at = u * total;
          let lo = 0;
          let hi = spec.n - 1;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (totals[mid]! >= at) hi = mid;
            else lo = mid + 1;
          }
          return lo + 1;
        },
      };
    }
    case "beta": {
      checked("beta", "a", spec.a, (v) => v > 0, "above 0");
      checked("beta", "b", spec.b, (v) => v > 0, "above 0");
      const a = valueOf(spec.a, r);
      const b = valueOf(spec.b, r);
      const cdf = (x: number): number => betaCdf(x, a, b);
      return {
        family: "beta",
        discrete: false,
        cdf,
        quantile: (u) => {
          unit(u);
          return u === 0 ? 0 : u === 1 ? 1 : bisect(cdf, u, 0, 1);
        },
      };
    }
    case "mixture": {
      if (spec.parts.length === 0) throw new RangeError("mixture: the list of the parts is empty.");
      for (const { weight } of spec.parts) checked("mixture", "weight", weight, (v) => v > 0, "above 0");
      const parts = spec.parts.map(({ part }) => distributionOf(part, r));
      const sum = spec.parts.reduce((s, { weight }) => s + weight, 0);
      const weights = spec.parts.map(({ weight }) => weight / sum);
      const cdf = (x: number): number => Math.min(1, parts.reduce((s, part, i) => s + weights[i]! * part.cdf(x), 0));
      return {
        family: "mixture",
        discrete: parts.every((part) => part.discrete),
        cdf,
        quantile: (u) => {
          unit(u);
          const ends = parts.map((part) => part.quantile(u));
          const lo = Math.min(...ends);
          const hi = Math.max(...ends);
          return lo === hi || !Number.isFinite(hi) ? hi : bisect(cdf, u, lo, hi);
        },
      };
    }
    case "recorded": {
      if (spec.values.length === 0) throw new RangeError("recorded: the list of the values is empty.");
      for (const value of spec.values) checked("recorded", "value", value, () => true, "finite");
      const sorted = [...spec.values].sort((x, y) => x - y);
      const n = sorted.length;
      return {
        family: "recorded",
        discrete: true,
        cdf: (x) => {
          let lo = 0;
          let hi = n;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (sorted[mid]! <= x) lo = mid + 1;
            else hi = mid;
          }
          return lo / n;
        },
        quantile: (u) => {
          unit(u);
          return sorted[Math.max(0, Math.ceil(u * n) - 1)]!;
        },
      };
    }
  }
}
