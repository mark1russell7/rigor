// The cumulative distribution and the quantile of each family of `distributions.ts`. A design draws a uniform number u
// in each stratum and gives the quantile of u. So the Latin hypercube and the stratified designs work with each family.
import type { DistributionSpec, Param } from "./distributions.ts";
import { millsRatio, normalCdf, normalQuantile } from "./normal.ts";
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

/** The two halves of the split of Veltkamp: `hi + lo` is `value`, and each half has 26 bits at most. */
function split(value: number): [number, number] {
  const scaled = 134217729 * value;
  const hi = scaled - (scaled - value);
  return [hi, value - hi];
}

/**
 * This function gives `a - (a + b) p` with no rounding of the sum and the product before the last subtraction (Dekker).
 * One ulp of `(a + b) p` is one ulp of `p` in the point. Near the mean, the shares of a law with a large `a + b` change by a large factor for each ulp of the point.
 * Thus the exact sum and product keep the digits that the point gives. Above 1e290, the split overflows, and the function gives the plain value.
 */
function centered(a: number, b: number, p: number): number {
  const sum = a + b;
  if (!(sum < 1e290)) return a - sum * p;
  const sumError = a >= b ? b - (sum - a) : a - (sum - b);
  const product = sum * p;
  const [sumHi, sumLo] = split(sum);
  const [pHi, pLo] = split(p);
  const productError = sumHi * pHi - product + sumHi * pLo + sumLo * pHi + sumLo * pLo;
  return a - product - productError - sumError * p;
}

/**
 * This function gives `x - log(1 + x)` for `x` above -1 (`rlog1` of TOMS 708), with its relative digits also near 0.
 * From -0.6 to 0.6, it uses the series of `log((1 + r) / (1 - r))` with `r = x / (2 + x)`: `x - log(1 + x) = r x - 2 (r^3 / 3 + r^5 / 5 + ...)`.
 */
function rlog1(x: number): number {
  if (Math.abs(x) > 0.6) return x - Math.log1p(x);
  const r = x / (2 + x);
  const square = r * r;
  let power = r * square;
  let sum = 0;
  for (let k = 3; k < 200; k += 2) {
    const term = power / k;
    sum += term;
    if (Math.abs(term) <= 1e-17 * Math.abs(sum)) break;
    power *= square;
  }
  return r * x - 2 * sum;
}

/**
 * This function gives the front factor `x^a y^b / B(a, b)` of the shares, for `a` and `b` of 10 or more (`brcomp` of TOMS 708).
 * - The factor is `sqrt(b x0 / (2 pi)) exp(-(a rlog1(x / x0 - 1) + b rlog1(y / y0 - 1)) - c)`, with `x0 = a / (a + b)`, `y0 = b / (a + b)` and the Stirling corrections `c`.
 * - `x / x0 - 1` is `-lambda / a` and `y / y0 - 1` is `lambda / b`. Thus no term of the exponent has the size of `a` or `b` near the mean.
 *   The sum of logs loses the digits of `a` times the epsilon there.
 */
function largeFront(a: number, b: number, x: number, y: number, lambda: number): number {
  const h = a < b ? a / b : b / a;
  const x0 = a < b ? h / (1 + h) : 1 / (1 + h);
  const y0 = a < b ? 1 / (1 + h) : h / (1 + h);
  let e = -lambda / a;
  const u = Math.abs(e) > 0.6 ? e - Math.log(x / x0) : rlog1(e);
  e = lambda / b;
  const v = Math.abs(e) > 0.6 ? e - Math.log(y / y0) : rlog1(e);
  const correction = stirlingCorrection(a) + stirlingCorrection(b) - stirlingCorrection(a + b);
  return Math.sqrt((b * x0) / (2 * Math.PI)) * Math.exp(-(a * u + b * v) - correction);
}

/**
 * This function gives `I_x(a, b)` by the asymptotic expansion for a large `a` and `b` (`basym` of TOMS 708), with 20 terms at most.
 * - The caller gives `lambda = a - (a + b) x` of 0 or more, and uses the function when `a` and `b` are above 100 and `lambda` is `0.03 min(a, b)` or less.
 * - Near the mean, the count of terms of the continued fraction grows with `sqrt(min(a, b))`. It does not converge in 10000 terms at 1e12.
 * - `exp(z^2) erfc(z)` of TOMS 708 is `2 M(sqrt(2) z) / sqrt(2 pi)`, with the Mills ratio `M`. Thus no term underflows before the result.
 */
function asymptoticBelow(a: number, b: number, lambda: number): number {
  const e0 = 2 / Math.sqrt(Math.PI);
  const e1 = 2 ** -1.5;
  const f = a * rlog1(-lambda / a) + b * rlog1(lambda / b);
  const t = Math.exp(-f);
  if (t === 0) return 0;
  const z0 = Math.sqrt(f);
  const z = Math.SQRT2 * z0;
  const z2 = f + f;
  const h = a < b ? a / b : b / a;
  const r0 = 1 / (h + 1);
  const r1 = (b - a) / Math.max(a, b);
  const w0 = 1 / Math.sqrt(Math.min(a, b) * (h + 1));
  const size = 21;
  const a0 = new Array<number>(size).fill(0);
  const b0 = new Array<number>(size).fill(0);
  const c = new Array<number>(size).fill(0);
  const d = new Array<number>(size).fill(0);
  const first = (2 / 3) * r1;
  a0[0] = first;
  c[0] = -0.5 * first;
  d[0] = 0.5 * first;
  let j0 = e1 * millsRatio(z);
  let j1 = e1;
  let sum = j0 + 0.5 * first * w0 * j1;
  let s = 1;
  let hn = 1;
  let w = w0;
  let znm1 = z;
  let zn = z2;
  for (let n = 2; n < size; n += 2) {
    hn *= h * h;
    a0[n - 1] = (2 * r0 * (h * hn + 1)) / (n + 2);
    s += hn;
    a0[n] = (2 * r1 * s) / (n + 3);
    for (let i = n; i <= n + 1; i++) {
      const r = -0.5 * (i + 1);
      b0[0] = r * a0[0]!;
      for (let m = 2; m <= i; m++) {
        let bsum = 0;
        for (let j = 1; j < m; j++) bsum += (j * r - (m - j)) * a0[j - 1]! * b0[m - j - 1]!;
        b0[m - 1] = r * a0[m - 1]! + bsum / m;
      }
      c[i - 1] = b0[i - 1]! / (i + 1);
      let dsum = 0;
      for (let j = 1; j < i; j++) dsum += d[i - j - 1]! * c[j - 1]!;
      d[i - 1] = -(dsum + c[i - 1]!);
    }
    j0 = e1 * znm1 + (n - 1) * j0;
    j1 = e1 * zn + n * j1;
    znm1 *= z2;
    zn *= z2;
    w *= w0;
    const t0 = d[n - 1]! * w * j0;
    w *= w0;
    const t1 = d[n]! * w * j1;
    sum += t0 + t1;
    if (Math.abs(t0) + Math.abs(t1) <= 1e-16 * sum) break;
  }
  const correction = stirlingCorrection(a) + stirlingCorrection(b) - stirlingCorrection(a + b);
  return e0 * t * Math.exp(-correction) * sum;
}

/**
 * This function gives the continued fraction of the incomplete beta function in the form of `bfrac` of TOMS 708 (Didonato and Morris, 1992).
 * `I_x(a, b)` is the front factor `x^a y^b / B(a, b)` times the result.
 * - The caller gives `lambda = a - (a + b) x`. It computes `lambda` from the smaller of `x` and `y`, so `lambda` has no cancellation.
 * - The terms of the fraction use `lambda`, `x` and `y`, and no term subtracts two numbers near 1.
 *   The fraction of Lentz has the first term `1 - (a + b) x / (a + 1)`. With `x` near 1 and a large `a`, it loses the digits of `b` times the epsilon.
 */
function betaFraction(a: number, b: number, x: number, y: number, lambda: number): number {
  const c = lambda + 1;
  const c0 = b / a;
  const c1 = 1 / a + 1;
  const yp1 = y + 1;
  let p = 1;
  let s = a + 1;
  let an = 0;
  let bn = 1;
  let anp1 = 1;
  let bnp1 = c / c1;
  let r = c1 / c;
  for (let n = 1; n <= 10000; n++) {
    let t = n / a;
    const w = n * (b - n) * x;
    let e = a / s;
    const alpha = p * (p + c0) * e * e * (w * x);
    e = (t + 1) / (c1 + t + t);
    const beta = n + w / s + e * (c + n * yp1);
    p = t + 1;
    s += 2;
    t = alpha * an + beta * anp1;
    an = anp1;
    anp1 = t;
    t = alpha * bn + beta * bnp1;
    bn = bnp1;
    bnp1 = t;
    const r0 = r;
    r = anp1 / bnp1;
    if (Math.abs(r - r0) <= 1e-16 * r) break;
    an /= bnp1;
    bn /= bnp1;
    anp1 = r;
    bnp1 = 1;
  }
  return r;
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
 * - The methods are those of TOMS 708 (Didonato and Morris, 1992), as `pbeta` of R. Each method gives the smaller share with its relative digits.
 *   The other share is 1 less that share.
 * - `lambda = a - (a + b) x` comes from the smaller of `x` and `y`, with an exact sum and product. Thus a large `a + b` keeps the digits of the point.
 * - When `a` and `b` are above 100 and `|lambda|` is `0.03 min(a, b)` or less, the asymptotic expansion (`basym`) gives the share.
 * - Elsewhere, the continued fraction (`bfrac`) gives the share. Its terms use `lambda`, so a point near 1 with a large parameter keeps its digits.
 * - When `a` and `b` are 10 or more, the front factor (`brcomp`) uses `x / x0 - 1` with `x0 = a / (a + b)`. Elsewhere, it uses the logs of `x` and `y` and `logBeta`.
 * - The tests hold the relative error below 1e-12 against exact references, with parameters up to 1e13.
 *
 * @throws RangeError when `x` or `y` is not from 0 to 1, or when `x + y` is not 1
 */
export function betaShares(x: number, y: number, a: number, b: number): BetaShares {
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1 && Math.abs(x + y - 1) <= 1e-12)) {
    throw new RangeError(`betaShares: x and y are from 0 to 1 and their sum is 1, not ${x} and ${y}.`);
  }
  if (x === 0) return { below: 0, above: 1 };
  if (y === 0) return { below: 1, above: 0 };
  // lambda = a - (a + b) x, from the smaller of x and y. The share above uses the swapped fraction, with -lambda.
  const lambda = x <= y ? centered(a, b, x) : -centered(b, a, y);
  const logX = x < 0.5 ? Math.log(x) : Math.log1p(-y);
  const logY = y < 0.5 ? Math.log(y) : Math.log1p(-x);
  const least = Math.min(a, b);
  if (least > 100 && Math.abs(lambda) <= 0.03 * least) {
    if (lambda >= 0) {
      const below = asymptoticBelow(a, b, lambda);
      return { below, above: 1 - below };
    }
    const above = asymptoticBelow(b, a, -lambda);
    return { below: 1 - above, above };
  }
  const front = least >= 10 ? largeFront(a, b, x, y, lambda) : Math.exp(a * logX + b * logY - logBeta(a, b));
  if (x < (a + 1) / (a + b + 2)) {
    const below = front * betaFraction(a, b, x, y, lambda);
    return { below, above: 1 - below };
  }
  const above = front * betaFraction(b, a, y, x, -lambda);
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
