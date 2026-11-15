/**
 * The ratings of pairwise results. This module gives the Elo update and the Glicko-2 update of one rating period. It
 * also gives the probabilities of a pair under the Bradley-Terry model with Davidson ties, and the conversion between
 * a log-strength and a rating. Each function is pure. It changes no input, and the same inputs give the same result.
 */

/** The scale of a rating. A difference of `scale` points gives odds of `base` to 1. */
export interface RatingScale {
  /** The rating of the log-strength 0. The default is 1500. Elo uses only differences, so it does not read it. */
  readonly center?: number;
  /** The number of points that gives odds of `base` to 1. The default is 400. */
  readonly scale?: number;
  /** The base of the odds. The default is 10. */
  readonly base?: number;
}

/** The options of an Elo update. */
export interface EloOptions extends RatingScale {
  /** The largest change of a rating after one result (the K factor). The default is 32. */
  readonly k?: number;
}

/** The ratings of a pair after one result. */
export interface EloUpdate {
  /** The new rating of the first item. */
  readonly a: number;
  /** The new rating of the second item. */
  readonly b: number;
  /** The expected score of the first item before the result. */
  readonly expected: number;
}

function finite(name: string, label: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name}: ${label} is a finite number, not ${value}.`);
}

function positive(name: string, label: string, value: number): void {
  if (!(value > 0 && Number.isFinite(value))) throw new RangeError(`${name}: ${label} is a finite number above 0, not ${value}.`);
}

function checkedScale(name: string, options: RatingScale): { center: number; scale: number; base: number } {
  const center = options.center ?? 1500;
  const scale = options.scale ?? 400;
  const base = options.base ?? 10;
  finite(name, "the center", center);
  positive(name, "the scale", scale);
  if (!(base > 1 && Number.isFinite(base))) throw new RangeError(`${name}: the base is a finite number above 1, not ${base}.`);
  return { center, scale, base };
}

/**
 * The expected score of the first item against the second item: `1 / (1 + base ** ((rb - ra) / scale))`. A win
 * counts 1, a tie 0.5 and a loss 0. The expected score of the second item is 1 minus this value.
 */
export function eloExpected(ra: number, rb: number, options: RatingScale = {}): number {
  finite("eloExpected", "the first rating", ra);
  finite("eloExpected", "the second rating", rb);
  const { scale, base } = checkedScale("eloExpected", options);
  return 1 / (1 + base ** ((rb - ra) / scale));
}

/**
 * The Elo update of a pair after one result. The `score` is the score of the first item: 1 for a win, 0.5 for a tie
 * and 0 for a loss. Each rating moves by `k` times the difference between the score and the expected score. Thus
 * the sum of the two ratings does not change.
 */
export function eloUpdate(ra: number, rb: number, score: number, options: EloOptions = {}): EloUpdate {
  if (!(score >= 0 && score <= 1)) throw new RangeError(`eloUpdate: the score is from 0 to 1, not ${score}.`);
  const k = options.k ?? 32;
  if (!(k >= 0 && Number.isFinite(k))) throw new RangeError(`eloUpdate: k is a finite number of 0 or more, not ${k}.`);
  const expected = eloExpected(ra, rb, options);
  const change = k * (score - expected);
  return { a: ra + change, b: rb - change, expected };
}

/** A Glicko-2 rating on the Glicko scale: the rating, the rating deviation (RD) and the volatility. */
export interface Glicko2Rating {
  readonly rating: number;
  /** The rating deviation, in rating points. It is above 0. */
  readonly rd: number;
  /** The volatility: the expected size of a change of the true strength in one rating period. It is above 0. */
  readonly volatility: number;
}

/** One game of a rating period: the rating and the RD of the opponent, and the score of the player. */
export interface Glicko2Game {
  readonly rating: number;
  readonly rd: number;
  /** The score of the player: 1 for a win, 0.5 for a tie and 0 for a loss. */
  readonly score: number;
}

/** The options of a Glicko-2 update. */
export interface Glicko2Options {
  /** The constraint on the change of the volatility over time (tau). The default is 0.5. Glickman uses 0.3 to 1.2. */
  readonly tau?: number;
  /** The tolerance of the iteration for the new volatility (epsilon). The default is 0.000001, as in the paper. */
  readonly tolerance?: number;
}

/** The factor between the Glicko scale and the Glicko-2 scale: `400 / ln(10)`, to 4 places as in the paper. */
const GLICKO2_FACTOR = 173.7178;
const GLICKO2_CENTER = 1500;
const VOLATILITY_STEPS = 1000;

function checkedRating(name: string, player: Glicko2Rating): void {
  finite(name, "the rating", player.rating);
  positive(name, "the RD", player.rd);
  positive(name, "the volatility", player.volatility);
}

/**
 * The Glicko-2 update of one player after one rating period (Glickman, "Example of the Glicko-2 system", 2012). The
 * function uses the Illinois algorithm for the new volatility. The games use the ratings of the opponents from the
 * start of the period. An empty list of games gives `glicko2Idle(player)`.
 */
export function glicko2Update(player: Glicko2Rating, games: readonly Glicko2Game[], options: Glicko2Options = {}): Glicko2Rating {
  checkedRating("glicko2Update", player);
  const tau = options.tau ?? 0.5;
  const tolerance = options.tolerance ?? 1e-6;
  positive("glicko2Update", "tau", tau);
  positive("glicko2Update", "the tolerance", tolerance);
  for (const game of games) {
    finite("glicko2Update", "the rating of an opponent", game.rating);
    positive("glicko2Update", "the RD of an opponent", game.rd);
    if (!(game.score >= 0 && game.score <= 1)) throw new RangeError(`glicko2Update: a score is from 0 to 1, not ${game.score}.`);
  }
  if (games.length === 0) return glicko2Idle(player);
  const mu = (player.rating - GLICKO2_CENTER) / GLICKO2_FACTOR;
  const phi = player.rd / GLICKO2_FACTOR;
  const sigma = player.volatility;
  let information = 0;
  let improvement = 0;
  for (const game of games) {
    const muJ = (game.rating - GLICKO2_CENTER) / GLICKO2_FACTOR;
    const phiJ = game.rd / GLICKO2_FACTOR;
    const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
    const e = 1 / (1 + Math.exp(-g * (mu - muJ)));
    information += g * g * e * (1 - e);
    improvement += g * (game.score - e);
  }
  const v = 1 / information;
  const delta = v * improvement;
  const newSigma = newVolatility(phi, sigma, v, delta, tau, tolerance);
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * improvement;
  return { rating: GLICKO2_FACTOR * newMu + GLICKO2_CENTER, rd: GLICKO2_FACTOR * newPhi, volatility: newSigma };
}

/** Step 5 of the paper: the new volatility, by the Illinois algorithm on `x = ln(sigma^2)`. */
function newVolatility(phi: number, sigma: number, v: number, delta: number, tau: number, tolerance: number): number {
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const delta2 = delta * delta;
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const sum = phi2 + v + ex;
    return (ex * (delta2 - phi2 - v - ex)) / (2 * sum * sum) - (x - a) / (tau * tau);
  };
  let lowEnd = a;
  let highEnd: number;
  if (delta2 > phi2 + v) highEnd = Math.log(delta2 - phi2 - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0 && k < VOLATILITY_STEPS) k++;
    highEnd = a - k * tau;
  }
  let fLow = f(lowEnd);
  let fHigh = f(highEnd);
  for (let step = 0; Math.abs(highEnd - lowEnd) > tolerance && step < VOLATILITY_STEPS; step++) {
    const c = lowEnd + ((lowEnd - highEnd) * fLow) / (fHigh - fLow);
    const fC = f(c);
    if (fC * fHigh <= 0) {
      lowEnd = highEnd;
      fLow = fHigh;
    } else fLow /= 2;
    highEnd = c;
    fHigh = fC;
  }
  return Math.exp(lowEnd / 2);
}

/**
 * The Glicko-2 rating of a player after a rating period with no games. The rating and the volatility stay the same.
 * The RD grows to `sqrt(RD^2 + (173.7178 * volatility)^2)`.
 */
export function glicko2Idle(player: Glicko2Rating): Glicko2Rating {
  checkedRating("glicko2Idle", player);
  const phi = player.rd / GLICKO2_FACTOR;
  const rd = GLICKO2_FACTOR * Math.sqrt(phi * phi + player.volatility * player.volatility);
  return { rating: player.rating, rd, volatility: player.volatility };
}

/** The probabilities of the three outcomes of a pair. Their sum is 1. */
export interface PairProbabilities {
  /** The probability that the first item wins. */
  readonly a: number;
  /** The probability that the second item wins. */
  readonly b: number;
  /** The probability of a tie. It is 0 when the tie parameter is 0. */
  readonly tie: number;
}

/**
 * This function gives the three probabilities of a pair from the log-strengths `sa` and `sb` and the Davidson tie
 * parameter `nu`. The denominator is `exp(d / 2) + exp(-d / 2) + nu`, with `d = sa - sb`. The function does no
 * checks, because the fit uses it in its inner loop.
 */
export function pairOutcomes(sa: number, sb: number, nu: number): PairProbabilities {
  const half = (sa - sb) / 2;
  const top = Math.max(Math.abs(half), nu > 0 ? Math.log(nu) : Number.NEGATIVE_INFINITY);
  const ea = Math.exp(half - top);
  const eb = Math.exp(-half - top);
  const et = nu > 0 ? Math.exp(Math.log(nu) - top) : 0;
  const sum = ea + eb + et;
  return { a: ea / sum, b: eb / sum, tie: et / sum };
}

/**
 * The probabilities of a pair under the Bradley-Terry model with Davidson (1970) ties. The inputs are the
 * log-strengths of the two items and the tie parameter `tie` of `bradleyTerry`. With `tie` 0, the probability that
 * the first item wins is `1 / (1 + exp(sb - sa))`. A constant added to the two strengths changes no probability.
 */
export function pairProbabilities(sa: number, sb: number, tie = 0): PairProbabilities {
  finite("pairProbabilities", "the first strength", sa);
  finite("pairProbabilities", "the second strength", sb);
  if (!(tie >= 0 && Number.isFinite(tie))) throw new RangeError(`pairProbabilities: the tie parameter is a finite number of 0 or more, not ${tie}.`);
  return pairOutcomes(sa, sb, tie);
}

/**
 * The rating of a log-strength: `center + scale * strength / ln(base)`. The defaults give
 * `1500 + 400 * log10(e) * strength`. Thus `eloExpected` of two ratings is the Bradley-Terry win probability.
 */
export function strengthToRating(strength: number, options: RatingScale = {}): number {
  finite("strengthToRating", "the strength", strength);
  const { center, scale, base } = checkedScale("strengthToRating", options);
  return center + (scale * strength) / Math.log(base);
}

/** The log-strength of a rating. It is the inverse of `strengthToRating` with the same options. */
export function ratingToStrength(rating: number, options: RatingScale = {}): number {
  finite("ratingToStrength", "the rating", rating);
  const { center, scale, base } = checkedScale("ratingToStrength", options);
  return ((rating - center) * Math.log(base)) / scale;
}
