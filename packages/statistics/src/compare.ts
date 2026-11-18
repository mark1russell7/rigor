/**
 * The comparison of a candidate with a baseline, and the calibration of predictions. These functions make two fleet
 * rules into code. First, a change of a default is judged against the current default. The measure is the inputs that
 * gain and the inputs that lose beyond the noise, with the effect size. A sign test alone is not enough. Second, each
 * prediction states a probability, and the Brier score measures how good the stated probabilities were.
 */
import { allEqual, median, quantileSorted, sd, sorted } from "./describe.ts";
import { poissonBinomialOf, tailsOf } from "./discrete.ts";
import { type Proportion, signTest, wilson } from "./tests.ts";

export interface NoiseOptions {
  /** The number of standard deviations. The default is 2. */
  readonly k?: number;
  /** The fewest values (seeds or folds) that give a floor. The default is 5, the 5-seed rule. */
  readonly minimum?: number;
  /**
   * The margin of practical effect, in the units of the values. A difference that is real but smaller than the margin
   * is too small to matter, so it is not a result. Give the reason of the margin from the problem of the user. The
   * default is 0: no margin.
   */
  readonly margin?: number;
}

/** The checks of the options of the noise rule. It gives k, the minimum and the margin. */
function noiseOptions(name: string, values: readonly number[], options: NoiseOptions): { k: number; margin: number } {
  const minimum = options.minimum ?? 5;
  if (values.length < minimum) throw new RangeError(`${name}: ${values.length} values; the rule needs ${minimum} or more seeds or folds.`);
  const margin = options.margin ?? 0;
  if (!Number.isFinite(margin) || margin < 0) throw new RangeError(`${name}: the margin is a finite number of 0 or more, not ${margin}.`);
  return { k: options.k ?? 2, margin };
}

/**
 * The noise floor of a measure: k sample standard deviations of its value over independent seeds or folds. When the
 * margin of practical effect is larger, the floor is the margin. A difference smaller than the floor is not a result.
 */
export function noiseFloor(values: readonly number[], options: NoiseOptions = {}): number {
  const { k, margin } = noiseOptions("noiseFloor", values, options);
  return Math.max(k * sd(values), margin);
}

/**
 * The state of a difference over the seeds. "gain" and "loss": the mean is beyond the threshold. "noise": it is not.
 * "no-spread": each seed gives the same value, so the seeds do not sample the noise and the rule tests nothing.
 */
export type NoiseState = "gain" | "loss" | "noise" | "no-spread";

/** The noise rule of a difference over independent seeds or folds. */
export interface NoiseVerdict {
  /** The number of values. */
  readonly n: number;
  readonly mean: number;
  /** The sample standard deviation of the values. */
  readonly sd: number;
  /** k times the standard deviation. */
  readonly spread: number;
  readonly margin: number;
  /** The larger of `spread` and `margin`. The absolute mean must be above it. */
  readonly threshold: number;
  readonly state: NoiseState;
}

/**
 * The noise rule of a difference (candidate minus baseline) over independent seeds or folds: the mean against
 * max(k standard deviations, margin). With `better: "lower"`, a negative mean is the gain. When each value is equal,
 * the state is "no-spread" and not a result, also when the mean is beyond the margin. Find out why the seeds do not
 * change the value before you read the difference.
 */
export function noiseVerdict(values: readonly number[], options: NoiseOptions & { readonly better?: "higher" | "lower" } = {}): NoiseVerdict {
  const { k, margin } = noiseOptions("noiseVerdict", values, options);
  const s = sd(values);
  const m = values.reduce((sum, v) => sum + v, 0) / values.length;
  const spread = k * s;
  const threshold = Math.max(spread, margin);
  const up = (options.better ?? "higher") === "higher" ? m : -m;
  const state: NoiseState = allEqual(values) ? "no-spread" : Math.abs(m) <= threshold ? "noise" : up > 0 ? "gain" : "loss";
  return { n: values.length, mean: m, sd: s, spread, margin, threshold, state };
}

export interface CompareOptions {
  /** "higher" (the default): a ratio above 1 is a gain. "lower": a ratio below 1 is a gain, as for a time or a cost. */
  readonly better?: "higher" | "lower";
  /** A ratio at this distance from 1 or nearer is a tie. The default is 0: only a ratio of exactly 1 is a tie. */
  readonly tie?: number;
  /** A gain or a loss counts only beyond this distance from 1. The default is 0. Use noiseFloor. */
  readonly noise?: number;
}

/** The effect on the inputs that are not ties. */
export interface Effect {
  readonly n: number;
  readonly median: number;
  /** The 0.1 quantile (linear). */
  readonly p10: number;
  /** The 0.9 quantile (linear). */
  readonly p90: number;
}

export interface Comparison {
  /** The number of inputs. */
  readonly n: number;
  readonly ties: number;
  /** The inputs where the candidate is better, by any amount. */
  readonly wins: number;
  /** The inputs where the candidate is worse, by any amount. */
  readonly losses: number;
  /** The one-sided sign test of wins against losses. */
  readonly signP: number;
  /** The ratios of the inputs that are not ties, or undefined when each input is a tie. */
  readonly effect: Effect | undefined;
  /** The inputs that gain beyond the noise. */
  readonly gains: number;
  /** The inputs that lose beyond the noise. */
  readonly drops: number;
  /** gains / n, with its Wilson interval. */
  readonly gainShare: number;
  readonly gainInterval: Proportion;
  /** drops / n, with its Wilson interval. */
  readonly dropShare: number;
  readonly dropInterval: Proportion;
}

/**
 * The comparison of a candidate with a baseline, from the ratio candidate / baseline of each input. It answers the
 * three questions of a promotion. How often is the candidate better? By how much? How often is it worse beyond the
 * noise? A promotion reads `gains` against `drops` and `effect`, not `signP` alone, because a sign test counts a
 * win of any size.
 */
export function compareRatios(ratios: readonly number[], options: CompareOptions = {}): Comparison {
  if (ratios.length === 0) throw new RangeError("compareRatios: the list is empty.");
  const sign = (options.better ?? "higher") === "higher" ? 1 : -1;
  const tie = options.tie ?? 0;
  const noise = options.noise ?? 0;
  if (!(tie >= 0) || !(noise >= 0)) throw new RangeError("compareRatios: tie and noise are 0 or more.");
  let ties = 0;
  let wins = 0;
  let losses = 0;
  let gains = 0;
  let drops = 0;
  const changed: number[] = [];
  for (const ratio of ratios) {
    if (!Number.isFinite(ratio)) throw new RangeError(`compareRatios: each ratio is a finite number, not ${ratio}.`);
    const d = sign * (ratio - 1);
    if (Math.abs(ratio - 1) <= tie) {
      ties++;
      continue;
    }
    changed.push(ratio);
    if (d > 0) wins++;
    else losses++;
    if (d > noise) gains++;
    else if (-d > noise) drops++;
  }
  const n = ratios.length;
  const s = sorted(changed);
  const effect = s.length === 0 ? undefined : { n: s.length, median: median(s), p10: quantileSorted(s, 0.1), p90: quantileSorted(s, 0.9) };
  return {
    n,
    ties,
    wins,
    losses,
    signP: signTest(wins, losses),
    effect,
    gains,
    drops,
    gainShare: gains / n,
    gainInterval: wilson(gains, n),
    dropShare: drops / n,
    dropInterval: wilson(drops, n),
  };
}

/** A prediction: the stated probability that the claim holds, and if it held. */
export interface Forecast {
  readonly p: number;
  readonly hit: boolean;
}

function checkedForecasts(name: string, forecasts: readonly Forecast[]): void {
  if (forecasts.length === 0) throw new RangeError(`${name}: the list is empty.`);
  for (const f of forecasts) if (!(f.p >= 0 && f.p <= 1)) throw new RangeError(`${name}: each p is from 0 to 1, not ${f.p}.`);
}

/** The Brier score: the mean of (p - outcome)^2. 0 is perfect, and 0.25 is a constant 0.5. Lower is better. */
export function brier(forecasts: readonly Forecast[]): number {
  checkedForecasts("brier", forecasts);
  let sum = 0;
  for (const f of forecasts) sum += (f.p - (f.hit ? 1 : 0)) ** 2;
  return sum / forecasts.length;
}

/**
 * The log-loss of predictions: the mean of `-ln(p)` for a hit and `-ln(1 - p)` for a miss. 0 is perfect, and
 * `ln(2)` is a constant 0.5. Lower is better. A p of 0 for a hit gives Infinity. For an outcome of three values,
 * give the probability of the observed outcome as `p`, with `hit` true.
 */
export function logLoss(forecasts: readonly Forecast[]): number {
  checkedForecasts("logLoss", forecasts);
  let sum = 0;
  for (const f of forecasts) sum -= Math.log(f.hit ? f.p : 1 - f.p);
  return sum / forecasts.length;
}

/** The predictions of one stated level. */
export interface CalibrationLevel {
  readonly stated: number;
  readonly n: number;
  readonly hits: number;
  /** hits / n. A calibrated level has a rate near `stated`. */
  readonly rate: number;
  /** The Wilson interval of the rate. A level is overconfident when `stated` is above it. */
  readonly interval: Proportion;
}

/**
 * The hit rate of each stated level, from the lowest level. Each distinct p is a level. For continuous probabilities,
 * use `reliability`, because then each prediction is a level.
 */
export function calibration(forecasts: readonly Forecast[]): CalibrationLevel[] {
  checkedForecasts("calibration", forecasts);
  const levels = new Map<number, { n: number; hits: number }>();
  for (const f of forecasts) {
    const level = levels.get(f.p) ?? { n: 0, hits: 0 };
    level.n++;
    if (f.hit) level.hits++;
    levels.set(f.p, level);
  }
  return [...levels]
    .sort((a, b) => a[0] - b[0])
    .map(([stated, { n, hits }]) => ({ stated, n, hits, rate: hits / n, interval: wilson(hits, n) }));
}

/** The options of `reliability` and `calibrationError`. */
export interface ReliabilityOptions {
  /** The number of bins of equal width from 0 to 1. It is a whole number of 1 or more. The default is 10. */
  readonly bins?: number;
}

/** The predictions of one bin of stated probabilities. */
export interface ReliabilityBin {
  /** The lower end of the bin. A p equal to `low` is in the bin. */
  readonly low: number;
  /** The upper end of the bin. Only the last bin holds a p equal to `high`. */
  readonly high: number;
  /** The count of predictions in the bin. */
  readonly n: number;
  /** The mean stated p of the predictions in the bin. */
  readonly stated: number;
  readonly hits: number;
  /** hits / n. A calibrated bin has a rate near `stated`. */
  readonly rate: number;
  /** The Wilson interval of the rate. A bin is overconfident when `stated` is above it. */
  readonly interval: Proportion;
}

function checkedBins(name: string, options: ReliabilityOptions): number {
  const bins = options.bins ?? 10;
  if (!Number.isInteger(bins) || bins < 1) throw new RangeError(`${name}: bins is a whole number of 1 or more, not ${bins}.`);
  return bins;
}

function binsOf(name: string, forecasts: readonly Forecast[], options: ReliabilityOptions): ReliabilityBin[] {
  checkedForecasts(name, forecasts);
  const bins = checkedBins(name, options);
  const sums = new Map<number, { n: number; hits: number; sum: number }>();
  for (const f of forecasts) {
    const index = Math.min(bins - 1, Math.floor(f.p * bins));
    const bin = sums.get(index) ?? { n: 0, hits: 0, sum: 0 };
    bin.n++;
    bin.sum += f.p;
    if (f.hit) bin.hits++;
    sums.set(index, bin);
  }
  return [...sums]
    .sort((a, b) => a[0] - b[0])
    .map(([index, { n, hits, sum }]) => ({
      low: index / bins,
      high: (index + 1) / bins,
      n,
      stated: sum / n,
      hits,
      rate: hits / n,
      interval: wilson(hits, n),
    }));
}

/**
 * This function puts the predictions in `bins` bins of equal width from 0 to 1, and gives the hit rate of each bin. The
 * bin of a p is `min(bins - 1, floor(p * bins))`, so a p of 1 is in the last bin. The result has only the bins with
 * predictions, from the lowest bin. It throws a `RangeError` for an empty list, a p outside 0 to 1 or a bad `bins`.
 */
export function reliability(forecasts: readonly Forecast[], options: ReliabilityOptions = {}): ReliabilityBin[] {
  return binsOf("reliability", forecasts, options);
}

/**
 * The expected calibration error of predictions: the sum over the bins of `reliability` of `(n / N) * |stated - rate|`.
 * 0 is perfect, and lower is better. With few predictions in each bin, the value is above 0 also for calibrated
 * predictions. The function throws a `RangeError` for the same inputs as `reliability`.
 */
export function calibrationError(forecasts: readonly Forecast[], options: ReliabilityOptions = {}): number {
  let sum = 0;
  for (const bin of binsOf("calibrationError", forecasts, options)) sum += bin.n * Math.abs(bin.stated - bin.rate);
  return sum / forecasts.length;
}

/** The count of hits of many predictions, against the sum of their stated chances. */
export interface TotalCalibration {
  /** The count of predictions. */
  readonly n: number;
  /** The sum of the stated chances: the expected count of hits. */
  readonly expected: number;
  /** The count of hits. */
  readonly hits: number;
  /** The sd of the count of hits of calibrated, independent predictions: `sqrt(sum of p (1 - p))`. */
  readonly sd: number;
  /**
   * The value `(hits - expected) / sd`, from the normal approximation. It is NaN when `sd` is 0. A positive value means
   * more hits than expected, so the stated chances are too low.
   */
  readonly z: number;
  /** True when `|hits - expected| <= 2 sd`. When `sd` is 0, it is true only when `hits` is equal to `expected`. */
  readonly within2: boolean;
  /** The exact `P(X <= hits)` of the Poisson binomial law of the stated chances. A small value means too few hits. */
  readonly pLess: number;
  /** The exact `P(X >= hits)` of the same law. A small value means too many hits. */
  readonly pGreater: number;
  /** Two times the smaller of `pLess` and `pGreater`, and not more than 1: the p of the two-sided test. */
  readonly pTwoSided: number;
}

/**
 * This function compares the count of hits of independent predictions with the sum of their stated chances. The value
 * `z` comes from the normal approximation. The three p values come from the exact Poisson binomial law
 * (`poissonBinomial`), so they are also correct for few predictions. The time grows as the square of the count of
 * predictions. The function throws a `RangeError` for an empty list and for a chance outside 0 to 1.
 */
export function totalCalibration(forecasts: readonly Forecast[]): TotalCalibration {
  checkedForecasts("totalCalibration", forecasts);
  let [expected, variance, hits] = [0, 0, 0];
  for (const f of forecasts) {
    expected += f.p;
    variance += f.p * (1 - f.p);
    if (f.hit) hits++;
  }
  const spread = Math.sqrt(variance);
  const law = poissonBinomialOf("totalCalibration", forecasts.map((f) => f.p));
  const [pLess, pGreater] = tailsOf(law, hits);
  return {
    n: forecasts.length,
    expected,
    hits,
    sd: spread,
    z: spread === 0 ? Number.NaN : (hits - expected) / spread,
    within2: Math.abs(hits - expected) <= 2 * spread,
    pLess,
    pGreater,
    pTwoSided: Math.min(1, 2 * Math.min(pLess, pGreater)),
  };
}
