/**
 * The gamma-Poisson law of the counts of units that have their own rates. Each unit draws its rate from a gamma law with
 * the shape `shape` and the mean `mean`. Its count in the exposure `exposure` is a Poisson count with the mean `rate * exposure`.
 *
 * - The marginal law of the count of one unit is a negative binomial law. The fit maximizes the sum of its logarithms.
 * - The pooled rate of a unit is the mean of its rate after its count: `(count + shape) / (exposure + shape / mean)`.
 *   A unit with a small exposure gets a rate near the mean of all units. A unit with a large exposure keeps a rate near `count / exposure`.
 * - The shape `Infinity` tells that the units show no spread of their rates. Then the pooled rate of each unit is the mean.
 */

import { logGamma } from "@mark1russell7/rigor-generators";
import { gammaQuantile } from "./gamma.ts";

/** One unit of a fit of rates: a count of events in an exposure, for example the events of a county in its years. */
export interface RateUnit {
  /** The count of events, a whole number of 0 or more. */
  readonly count: number;
  /** The exposure of the count, a finite number of more than 0. */
  readonly exposure: number;
}

/** The gamma law of the rates of the units: its shape, and its mean. The shape `Infinity` gives one rate for each unit. */
export interface GammaRates {
  readonly shape: number;
  readonly mean: number;
}

/** The options of `fitGammaRates`: the range of the search of the shape. */
export interface GammaRatesOptions {
  /** The lowest shape of the search. The default is 0.001. */
  readonly low?: number | undefined;
  /** The highest finite shape of the search. The default is 10000. */
  readonly high?: number | undefined;
}

/** The number of points of the grid of `fitGammaRates` in each factor of 10. */
const GRID_PER_DECADE = 4;

/** The number of steps of the golden-section search of the shape. Each step makes the bracket 0.618 times as wide. */
const GOLDEN_STEPS = 48;

/** The number of steps of the bisection of the mean for one shape, on the logarithm of the mean. */
const BISECTION_STEPS = 80;

/** Below this count, the log of the rising factorial is a sum of logarithms, because a difference of two log-gamma values loses digits. */
const DIRECT_SUM_LIMIT = 64;

/** The log of the rising factorial `shape * (shape + 1) * ... * (shape + count - 1)`. */
function logRising(shape: number, count: number): number {
  if (count < DIRECT_SUM_LIMIT) {
    let sum = 0;
    for (let k = 0; k < count; k++) sum += Math.log(shape + k);
    return sum;
  }
  return logGamma(shape + count) - logGamma(shape);
}

/** The log of `count!`. */
function logFactorial(count: number): number {
  return count < DIRECT_SUM_LIMIT ? logRising(1, count) : logGamma(count + 1);
}

function unitProblems(name: string, units: readonly RateUnit[]): void {
  if (units.length === 0) throw new RangeError(`${name}: the list of units is empty.`);
  for (const unit of units) unitProblem(name, unit);
}

function unitProblem(name: string, unit: RateUnit): void {
  if (!Number.isInteger(unit.count) || unit.count < 0) throw new RangeError(`${name}: a count is ${unit.count}. It is a whole number of 0 or more.`);
  if (!Number.isFinite(unit.exposure) || unit.exposure <= 0) throw new RangeError(`${name}: an exposure is ${unit.exposure}. It is a finite number of more than 0.`);
}

/** The log-likelihood of one unit, with no checks. */
function unitLogLikelihood(unit: RateUnit, shape: number, mean: number): number {
  const { count, exposure } = unit;
  if (mean === 0) return count === 0 ? 0 : Number.NEGATIVE_INFINITY;
  const expected = mean * exposure;
  if (shape === Number.POSITIVE_INFINITY) return count * Math.log(expected) - expected - logFactorial(count);
  // The negative binomial law: the rising factorial of the shape, and the terms of the shape and of the count.
  return logRising(shape, count) - logFactorial(count) - shape * Math.log1p(expected / shape) + count * (Math.log(expected) - Math.log(shape + expected));
}

function totalOf(units: readonly RateUnit[], shape: number, mean: number): number {
  return units.reduce((sum, unit) => sum + unitLogLikelihood(unit, shape, mean), 0);
}

/**
 * This function gives the sum of the log-likelihoods of the counts of the units, with the constant `log(count!)` of each count.
 * The shape `Infinity` gives the Poisson law with the rate `mean`. The order of the units does not change the result.
 */
export function gammaPoissonLogLikelihood(units: readonly RateUnit[], shape: number, mean: number): number {
  unitProblems("gammaPoissonLogLikelihood", units);
  if (Number.isNaN(shape) || shape <= 0) throw new RangeError(`gammaPoissonLogLikelihood: the shape is ${shape}. It is more than 0, or Infinity.`);
  if (!Number.isFinite(mean) || mean < 0) throw new RangeError(`gammaPoissonLogLikelihood: the mean is ${mean}. It is a finite number of 0 or more.`);
  return totalOf(units, shape, mean);
}

/**
 * The mean with the largest likelihood for one finite shape. The score times the mean, `h(mean)`, falls as the mean grows.
 * Thus a bisection on the logarithm of the mean finds its one root. The total count is more than 0.
 */
function meanFor(units: readonly RateUnit[], shape: number, count: number, exposure: number): number {
  const h = (mean: number): number => count - units.reduce((sum, unit) => sum + ((shape + unit.count) * mean * unit.exposure) / (shape + mean * unit.exposure), 0);
  let low = Math.log(count / exposure);
  let high = low;
  while (h(Math.exp(low)) < 0) low -= Math.LN10;
  while (h(Math.exp(high)) > 0) high += Math.LN10;
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const middle = (low + high) / 2;
    if (h(Math.exp(middle)) > 0) low = middle;
    else high = middle;
  }
  return Math.exp((low + high) / 2);
}

/**
 * This function gives the gamma law of the rates with the largest likelihood of the counts of the units.
 *
 * - For each shape, the mean is the root of its score. With equal exposures, that mean is the total count over the total exposure.
 * - The search of the shape examines a grid of 4 points for each factor of 10 from `low` to `high`. Then a golden-section search
 *   refines the best point between its neighbors.
 * - It gives the shape `Infinity` and the mean `total count / total exposure` when one rate explains the units equally well or better.
 * - Units with no count give the shape `Infinity` and the mean 0.
 * - A shape at `low` or at `high` tells that the search stopped at that limit. The peak can be outside the range, so give a wider range.
 * - The order of the units changes the result only by rounding.
 */
export function fitGammaRates(units: readonly RateUnit[], options: GammaRatesOptions = {}): GammaRates {
  const low = options.low ?? 0.001;
  const high = options.high ?? 10_000;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= low) throw new RangeError(`fitGammaRates: low is ${low} and high is ${high}. They are finite, and 0 < low < high.`);
  unitProblems("fitGammaRates", units);
  const count = units.reduce((sum, unit) => sum + unit.count, 0);
  const exposure = units.reduce((sum, unit) => sum + unit.exposure, 0);
  const poissonMean = count / exposure;
  if (count === 0) return { shape: Number.POSITIVE_INFINITY, mean: 0 };
  const profile = (logShape: number): number => {
    const shape = Math.exp(logShape);
    return totalOf(units, shape, meanFor(units, shape, count, exposure));
  };
  const [lowLog, highLog] = [Math.log(low), Math.log(high)];
  const points = Math.max(2, Math.ceil(((highLog - lowLog) / Math.LN10) * GRID_PER_DECADE) + 1);
  const grid = Array.from({ length: points }, (_, i) => lowLog + ((highLog - lowLog) * i) / (points - 1));
  const values = grid.map(profile);
  let best = 0;
  for (let i = 1; i < points; i++) if ((values[i] as number) > (values[best] as number)) best = i;
  // A golden-section search on the logarithm of the shape, between the neighbors of the best point of the grid.
  let a = grid[Math.max(0, best - 1)] as number;
  let b = grid[Math.min(points - 1, best + 1)] as number;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let c = b - ratio * (b - a);
  let d = a + ratio * (b - a);
  let fc = profile(c);
  let fd = profile(d);
  for (let step = 0; step < GOLDEN_STEPS; step++) {
    if (fc >= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - ratio * (b - a);
      fc = profile(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + ratio * (b - a);
      fd = profile(d);
    }
  }
  // The refined point is not worse than the grid only when the bracket has one peak. Thus the search keeps the better point.
  const refinedLog = (a + b) / 2;
  const refinedTotal = profile(refinedLog);
  const [fittedLog, fittedTotal] = refinedTotal >= (values[best] as number) ? [refinedLog, refinedTotal] : [grid[best] as number, values[best] as number];
  if (totalOf(units, Number.POSITIVE_INFINITY, poissonMean) >= fittedTotal) return { shape: Number.POSITIVE_INFINITY, mean: poissonMean };
  const shape = Math.exp(fittedLog);
  return { shape, mean: meanFor(units, shape, count, exposure) };
}

/**
 * This function gives the pooled rate of a unit: the mean of its rate after its count, `(count + shape) / (exposure + shape / mean)`.
 * The value is between `count / exposure` and the mean of the law. The shape `Infinity` gives the mean, and the mean 0 gives 0.
 */
export function pooledRate(unit: RateUnit, law: GammaRates): number {
  unitProblem("pooledRate", unit);
  if (Number.isNaN(law.shape) || law.shape <= 0) throw new RangeError(`pooledRate: the shape is ${law.shape}. It is more than 0, or Infinity.`);
  if (!Number.isFinite(law.mean) || law.mean < 0) throw new RangeError(`pooledRate: the mean is ${law.mean}. It is a finite number of 0 or more.`);
  if (law.shape === Number.POSITIVE_INFINITY || law.mean === 0) return law.mean;
  return (unit.count + law.shape) / (unit.exposure + law.shape / law.mean);
}

/**
 * This function gives an upper bound of the rate of a unit: the quantile `level` of the gamma law of its rate after its count.
 *
 * - That law has the shape `shape + count` and the rate `shape / mean + exposure`. Its mean is `pooledRate`.
 * - A pooled rate is a mean, so a plan for a bad case can take this bound in place of it. The default level is 0.95.
 * - The shape `Infinity` gives the mean of the law, because the rates show no spread. The mean 0 gives 0.
 *
 * @throws RangeError when the level is not in (0, 1), or the unit or the law is not valid
 */
export function pooledRateUpper(unit: RateUnit, law: GammaRates, level = 0.95): number {
  unitProblem("pooledRateUpper", unit);
  if (Number.isNaN(law.shape) || law.shape <= 0) throw new RangeError(`pooledRateUpper: the shape is ${law.shape}. It is more than 0, or Infinity.`);
  if (!Number.isFinite(law.mean) || law.mean < 0) throw new RangeError(`pooledRateUpper: the mean is ${law.mean}. It is a finite number of 0 or more.`);
  if (!(level > 0 && level < 1)) throw new RangeError(`pooledRateUpper: the level is ${level}. It is in (0, 1).`);
  if (law.shape === Number.POSITIVE_INFINITY || law.mean === 0) return law.mean;
  return gammaQuantile(level, law.shape + unit.count, law.shape / law.mean + unit.exposure);
}
