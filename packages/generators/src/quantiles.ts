// The cumulative distribution and the quantile of each family of `distributions.ts`. A design draws a uniform number u
// in each stratum and gives the quantile of u. So the Latin hypercube and the stratified designs work with each family.
import type { DistributionSpec, Param } from "./distributions.ts";
import { normalCdf, normalQuantile } from "./normal.ts";
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

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

/**
 * This function gives the logarithm of the gamma function for `x` above 0 (Lanczos, g 7, 9 terms).
 * The relative error is below 1e-14, away from the zeros at 1 and 2. Below 0.5, the reflection formula gives the value.
 */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const y = x - 1;
  let sum = LANCZOS[0]!;
  for (let i = 1; i < 9; i++) sum += LANCZOS[i]! / (y + i);
  const t = y + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** The coefficients of the Stirling series of the log of the gamma function: B(2k) / (2k (2k - 1)) for k from 1 to 8. */
const STIRLING = [1 / 12, -1 / 360, 1 / 1260, -1 / 1680, 1 / 1188, -691 / 360360, 1 / 156, -3617 / 122400];

/**
 * This function gives the Stirling correction: `logGamma(x)` less `(x - 0.5) log x - x + log(2 pi) / 2`, for `x` of 10 or more.
 * At 10, the first term that the series omits is below 2e-18.
 */
function stirlingCorrection(x: number): number {
  const square = 1 / (x * x);
  let sum = 0;
  for (let i = STIRLING.length - 1; i >= 0; i--) sum = sum * square + STIRLING[i]!;
  return sum / x;
}

/**
 * This function gives the logarithm of the beta function, `logGamma(a) + logGamma(b) - logGamma(a + b)`, for `a` and `b` above 0.
 * - When an argument is 10 or more, the Stirling series gives the difference of the large terms (as `lbeta` of R).
 *   Thus the value is accurate also when `a + b` is near 1e13. There, the sum of `logGamma` loses all digits of the difference.
 * - When both arguments are below 10, the value is the sum of `logGamma`.
 */
export function logBeta(a: number, b: number): number {
  const p = Math.min(a, b);
  const q = Math.max(a, b);
  const share = p / (p + q);
  if (p >= 10) {
    const correction = stirlingCorrection(p) + stirlingCorrection(q) - stirlingCorrection(p + q);
    return -0.5 * Math.log(q) + 0.5 * Math.log(2 * Math.PI) + correction + (p - 0.5) * Math.log(share) + q * Math.log1p(-share);
  }
  if (q >= 10) {
    const correction = stirlingCorrection(q) - stirlingCorrection(p + q);
    return logGamma(p) + correction + p - p * Math.log(p + q) + (q - 0.5) * Math.log1p(-share);
  }
  return logGamma(p) + logGamma(q) - logGamma(p + q);
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

/** The shares of a beta law below and above a point. */
export interface BetaShares {
  /** The share of the law below the point: the regularized incomplete beta function. */
  readonly below: number;
  /** The share of the law above the point. */
  readonly above: number;
}

/**
 * This function gives the shares of the beta law with the parameters `a` and `b` below and above `x`.
 * - The caller gives `x` and `y = 1 - x`, each with its full digits. Thus a point near 1 keeps the digits of its distance from 1.
 *   For example, `df / (df + t^2)` and `t^2 / (df + t^2)` give both shares of the Student t law with no rounding near 1.
 * - The continued fraction gives the smaller share with its relative digits. The other share is 1 less that share.
 * - The fraction loses digits when its point is near 1 and its first parameter is large. This is the share above `x` when `x` is above `(a + 1) / (a + b + 2)`.
 *   The tests hold the relative error of that share below `2e-16 * b`, for `b` from 5e5 to 5e8.
 * - The logs of the front factor use the smaller of `x` and `y`, and the factor uses `logBeta`. Thus a parameter near 1e13 keeps the digits of the shares.
 *
 * @throws RangeError when `x` or `y` is not from 0 to 1, or when `x + y` is not 1
 */
export function betaShares(x: number, y: number, a: number, b: number): BetaShares {
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1 && Math.abs(x + y - 1) <= 1e-12)) {
    throw new RangeError(`betaShares: x and y are from 0 to 1 and their sum is 1, not ${x} and ${y}.`);
  }
  if (x === 0) return { below: 0, above: 1 };
  if (y === 0) return { below: 1, above: 0 };
  const logX = x < 0.5 ? Math.log(x) : Math.log1p(-y);
  const logY = y < 0.5 ? Math.log(y) : Math.log1p(-x);
  const front = Math.exp(a * logX + b * logY - logBeta(a, b));
  if (x < (a + 1) / (a + b + 2)) {
    const below = (front * betaFraction(a, b, x)) / a;
    return { below, above: 1 - below };
  }
  const above = (front * betaFraction(b, a, y)) / b;
  return { below: 1 - above, above };
}

/** This function gives the regularized incomplete beta function: the beta cumulative distribution at `x` (`betaShares` with `1 - x`). */
export function betaCdf(x: number, a: number, b: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return betaShares(x, 1 - x, a, b).below;
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
        cdf: (x) => (Number.isNaN(x) ? Number.NaN : x <= 0 ? 0 : sigma === 0 ? (x >= median ? 1 : 0) : normalCdf((Math.log(x) - mu) / sigma)),
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
