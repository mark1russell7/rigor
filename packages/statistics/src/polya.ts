/**
 * The Dirichlet-multinomial law of repeated categorical observations, as a Polya urn. Each unit draws its own
 * distribution of the values from a Dirichlet law with the concentration `a` and the mean `base`. The observations of the
 * unit are draws from that distribution. Thus two observations of one unit agree more often than two independent draws.
 *
 * - A large concentration gives independent observations. `Infinity` is the limit: each observation has the probability `base`.
 * - A small concentration gives copies. After the first observation, each observation of the unit is nearly the same value.
 */

/** The largest distance of the sum of a base distribution from 1. */
const SUM_TOLERANCE = 1e-6;

/** The number of points of the grid of `fitConcentration` in each factor of 10. */
const GRID_PER_DECADE = 4;

/** The number of steps of the golden-section search of `fitConcentration`. Each step makes the bracket 0.618 times as wide. */
const GOLDEN_STEPS = 48;

function concentrationProblem(name: string, concentration: number): void {
  if (Number.isNaN(concentration) || concentration <= 0) throw new RangeError(`${name}: the concentration is ${concentration}. It is more than 0, or Infinity.`);
}

/**
 * This function gives the probability that the next observation of a unit has a value: `(a * base + same) / (a + earlier)`.
 *
 * - `base` is the mean probability of the value, from 0 to 1.
 * - `same` is the number of the earlier observations of the unit with the value. `earlier` is the number of all earlier observations.
 * - The concentration `Infinity` gives `base`, because the observations are independent.
 */
export function polyaPredictive(base: number, concentration: number, same: number, earlier: number): number {
  if (!Number.isFinite(base) || base < 0 || base > 1) throw new RangeError(`polyaPredictive: the base probability is ${base}. It is from 0 to 1.`);
  concentrationProblem("polyaPredictive", concentration);
  if (!Number.isInteger(earlier) || earlier < 0) throw new RangeError(`polyaPredictive: earlier is ${earlier}. It is a whole number of 0 or more.`);
  if (!Number.isInteger(same) || same < 0 || same > earlier) throw new RangeError(`polyaPredictive: same is ${same}. It is a whole number from 0 to earlier (${earlier}).`);
  if (concentration === Number.POSITIVE_INFINITY) return base;
  return (concentration * base + same) / (concentration + earlier);
}

function baseProblems(name: string, base: Readonly<Record<string, number>>): void {
  let sum = 0;
  for (const [value, p] of Object.entries(base)) {
    if (!Number.isFinite(p) || p < 0) throw new RangeError(`${name}: the base probability of "${value}" is ${p}. Each probability is finite and 0 or more.`);
    sum += p;
  }
  if (Math.abs(sum - 1) > SUM_TOLERANCE) throw new RangeError(`${name}: the sum of the base probabilities is ${sum}, not 1.`);
}

function logLikelihoodOf(name: string, observations: readonly string[], base: Readonly<Record<string, number>>, concentration: number): number {
  const counts = new Map<string, number>();
  let sum = 0;
  observations.forEach((value, earlier) => {
    const p = base[value];
    if (p === undefined) throw new RangeError(`${name}: the observation "${value}" has no base probability.`);
    const same = counts.get(value) ?? 0;
    sum += Math.log(concentration === Number.POSITIVE_INFINITY ? p : (concentration * p + same) / (concentration + earlier));
    counts.set(value, same + 1);
  });
  return sum;
}

/**
 * This function gives the natural logarithm of the probability of the observations of one unit, in their order. The
 * order does not change the result, because the law is exchangeable. No observation gives 0.
 */
export function polyaLogLikelihood(observations: readonly string[], base: Readonly<Record<string, number>>, concentration: number): number {
  baseProblems("polyaLogLikelihood", base);
  concentrationProblem("polyaLogLikelihood", concentration);
  return logLikelihoodOf("polyaLogLikelihood", observations, base, concentration);
}

/** One unit of the fit of a concentration: its observations, and the mean probability of each value. */
export interface PolyaUnit {
  readonly observations: readonly string[];
  readonly base: Readonly<Record<string, number>>;
}

/** The options of `fitConcentration`: the range of the search of the concentration. */
export interface ConcentrationOptions {
  /** The lowest concentration of the search. The default is 0.001. */
  readonly low?: number | undefined;
  /** The highest finite concentration of the search. The default is 1000. */
  readonly high?: number | undefined;
}

/**
 * This function gives the concentration with the largest sum of the log-likelihoods of the units.
 *
 * - The search examines a grid of 4 points for each factor of 10 from `low` to `high`. Then a golden-section search
 *   refines the best point between its neighbors.
 * - It gives `Infinity` when independent observations explain the units equally well or better.
 * - A unit with one observation or none tells nothing about the concentration. Its log-likelihood is the same for each concentration.
 */
export function fitConcentration(units: readonly PolyaUnit[], options: ConcentrationOptions = {}): number {
  const low = options.low ?? 0.001;
  const high = options.high ?? 1000;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= low) throw new RangeError(`fitConcentration: low is ${low} and high is ${high}. They are finite, and 0 < low < high.`);
  if (units.length === 0) throw new RangeError("fitConcentration: the list of units is empty.");
  for (const unit of units) baseProblems("fitConcentration", unit.base);
  const total = (concentration: number): number => units.reduce((sum, unit) => sum + logLikelihoodOf("fitConcentration", unit.observations, unit.base, concentration), 0);
  const [lowLog, highLog] = [Math.log(low), Math.log(high)];
  const points = Math.max(2, Math.ceil(((highLog - lowLog) / Math.LN10) * GRID_PER_DECADE) + 1);
  const grid = Array.from({ length: points }, (_, i) => lowLog + ((highLog - lowLog) * i) / (points - 1));
  const values = grid.map((x) => total(Math.exp(x)));
  let best = 0;
  for (let i = 1; i < points; i++) if ((values[i] as number) > (values[best] as number)) best = i;
  // A golden-section search on the logarithm of the concentration, between the neighbors of the best point of the grid.
  let a = grid[Math.max(0, best - 1)] as number;
  let b = grid[Math.min(points - 1, best + 1)] as number;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let c = b - ratio * (b - a);
  let d = a + ratio * (b - a);
  let fc = total(Math.exp(c));
  let fd = total(Math.exp(d));
  for (let step = 0; step < GOLDEN_STEPS; step++) {
    if (fc >= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - ratio * (b - a);
      fc = total(Math.exp(c));
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + ratio * (b - a);
      fd = total(Math.exp(d));
    }
  }
  // The refined point is not worse than the grid only when the bracket has one peak. Thus the search keeps the better point.
  const refined = Math.exp((a + b) / 2);
  const refinedTotal = total(refined);
  const [fitted, fittedTotal] = refinedTotal >= (values[best] as number) ? [refined, refinedTotal] : [Math.exp(grid[best] as number), values[best] as number];
  return total(Number.POSITIVE_INFINITY) >= fittedTotal ? Number.POSITIVE_INFINITY : fitted;
}
