/**
 * The comparison of a candidate with a baseline, and the calibration of predictions. These functions make two fleet
 * rules into code. First, a change of a default is judged against the current default. The measure is the inputs that
 * gain and the inputs that lose beyond the noise, with the effect size. A sign test alone is not enough. Second, each
 * prediction states a probability, and the Brier score measures how good the stated probabilities were.
 */
import { median, quantileSorted, sd, sorted } from "./describe.ts";
import { type Proportion, signTest, wilson } from "./tests.ts";

export interface NoiseOptions {
  /** The number of standard deviations. The default is 2. */
  readonly k?: number;
  /** The fewest values (seeds or folds) that give a floor. The default is 5, the 5-seed rule. */
  readonly minimum?: number;
}

/**
 * The noise floor of a measure: k sample standard deviations of its value over independent seeds or folds. A
 * difference smaller than the floor is not a result.
 */
export function noiseFloor(values: readonly number[], options: NoiseOptions = {}): number {
  const minimum = options.minimum ?? 5;
  if (values.length < minimum) throw new RangeError(`noiseFloor: ${values.length} values; the rule needs ${minimum} or more seeds or folds.`);
  return (options.k ?? 2) * sd(values);
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

/** The hit rate of each stated level, from the lowest level. */
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
