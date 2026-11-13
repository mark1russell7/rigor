/**
 * The choice of the next pair of a duel. A good pair has a result that is not sure: two items with near ratings, or
 * items with few picks. The choice uses a seed of `@mark1russell7/rigor-generators`, so a seed gives the same pair again.
 */
import { random } from "@mark1russell7/rigor-generators";
import { type RatingScale, eloExpected } from "./rating.ts";

/**
 * The uncertainty of an item with no standard error and no picks, in rating points. It is the first RD of Glicko-2.
 * An item with no standard error has the uncertainty `350 / sqrt(1 + picks)`.
 */
export const RATING_START_UNCERTAINTY = 350;

/** The largest pool of items for a full search of a pair that is not recent. */
export const PAIR_FULL_SEARCH = 64;

/** One item of a pool. The rating gives the order of the pool. */
export interface RatedItem {
  /** The key of the item. Each key occurs one time in a pool. A second item with the same key does not count. */
  readonly id: string;
  /** The rating, on the Elo scale of the options. */
  readonly rating: number;
  /** The standard error of the rating, in rating points, or `undefined` when the model gives none. */
  readonly se?: number | undefined;
  /** The number of picks of the item. */
  readonly picks: number;
}

/** The uncertainty of a rating, in rating points: its standard error, or `RATING_START_UNCERTAINTY / sqrt(1 + picks)`. */
export function ratingUncertainty(item: Pick<RatedItem, "se" | "picks">): number {
  return item.se ?? RATING_START_UNCERTAINTY / Math.sqrt(1 + item.picks);
}

/**
 * The expected information of a pick between two items: `p * (1 - p) * (ua^2 + ub^2)`. Here `p` is `eloExpected` of
 * the two ratings, and `ua` and `ub` are the uncertainties. The value is high when the result is not sure (a `p` near
 * 0.5) and the two ratings are not sure.
 */
export function pairInformation(a: RatedItem, b: RatedItem, options: RatingScale = {}): number {
  const p = eloExpected(a.rating, b.rating, options);
  return p * (1 - p) * (ratingUncertainty(a) ** 2 + ratingUncertainty(b) ** 2);
}

/** The options of `choosePair`. */
export interface PairChoiceOptions<T extends RatedItem = RatedItem> {
  /** The seed of the draws. */
  readonly seed: number | string;
  /** The pairs of the last duels, by key, in each order. The choice takes a recent pair only when there is no other pair. */
  readonly recent?: readonly (readonly [string, string])[];
  /** The number of second items to examine for the first item. It is a whole number of 1 or more. The default is 24. */
  readonly candidates?: number;
  /**
   * This function gives the information of a pick between two items, or `undefined` when the pair is not permitted.
   * The value is a finite number. The default is `pairInformation` with the default scale, and it permits each pair.
   */
  readonly information?: (a: T, b: T) => number | undefined;
}

/** A pair for a duel. `a` is the left item, and `b` is the right item. */
export interface PairChoice {
  readonly a: string;
  readonly b: string;
  /** The information of the pair. */
  readonly information: number;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/**
 * The indexes of the second items to examine: the neighbors in the order, and random items. Only the indexes in
 * `allowed` are candidates.
 */
function candidatesOf(first: number, allowed: ReadonlySet<number>, size: number, count: number, draw: (n: number) => number): number[] {
  if (allowed.size <= count) return [...allowed].sort((x, y) => x - y);
  const chosen = new Set<number>();
  const near = Math.ceil(count / 2);
  for (let step = 1; chosen.size < near && step < size; step++) {
    if (allowed.has(first - step)) chosen.add(first - step);
    if (chosen.size < near && allowed.has(first + step)) chosen.add(first + step);
  }
  while (chosen.size < count) {
    const index = draw(size);
    if (allowed.has(index)) chosen.add(index);
  }
  return [...chosen];
}

/**
 * The choice of the next pair of a duel from a pool of rated items. The pool goes in the order of the ratings, from
 * the highest. These are the steps:
 *
 * 1. A draw selects the first item. The weight of an item is `1 / (1 + picks)`, so the items with few picks come first.
 *    An item with no permitted pair leaves the draw.
 * 2. The second item is the candidate with the most information. The candidates are the neighbors of the first item in
 *    the order, and random items, each in a permitted pair. A recent pair loses to each pair that is not recent.
 * 3. A draw selects the left and the right side, so the side does not change the picks.
 *
 * In a pool of `PAIR_FULL_SEARCH` items or fewer, a recent pair comes only when each permitted pair is recent. The
 * function gives `undefined` when there is no permitted pair. Each step has its own stream of the seed.
 */
export function choosePair<T extends RatedItem>(items: readonly T[], options: PairChoiceOptions<T>): PairChoice | undefined {
  const candidates = options.candidates ?? 24;
  if (!Number.isSafeInteger(candidates) || candidates < 1) throw new RangeError(`choosePair: candidates is a whole number of 1 or more, not ${candidates}.`);
  for (const item of items) {
    if (!Number.isFinite(item.rating)) throw new RangeError(`choosePair: the item ${item.id} has the rating ${item.rating}, and a rating is a finite number.`);
    if (!Number.isSafeInteger(item.picks) || item.picks < 0) {
      throw new RangeError(`choosePair: the item ${item.id} has ${item.picks} picks, and a count of picks is a whole number of 0 or more.`);
    }
  }
  const seen = new Set<string>();
  const pool = items.filter((item) => !seen.has(item.id) && seen.add(item.id)).sort((x, y) => y.rating - x.rating);
  if (pool.length < 2) return undefined;
  const draw = random(options.seed);
  const recent = new Set((options.recent ?? []).map(([a, b]) => pairKey(a, b)));
  const at = (i: number): T => pool[i] as T;
  const isRecent = (i: number, j: number): boolean => recent.has(pairKey(at(i).id, at(j).id));
  const information = options.information ?? ((a: T, b: T) => pairInformation(a, b));
  const informationOf = (i: number, j: number): number | undefined => {
    const value = information(at(i), at(j));
    if (value !== undefined && !Number.isFinite(value)) {
      throw new RangeError(`choosePair: the information of ${at(i).id} and ${at(j).id} is ${value}, and it is a finite number or undefined.`);
    }
    return value;
  };
  const jitter = draw.fork("jitter");

  let best: { i: number; j: number; fresh: boolean; score: number; tie: number } | undefined;
  const consider = (i: number, j: number, score: number | undefined): void => {
    if (score === undefined) return;
    const option = { i, j, fresh: !isRecent(i, j), score, tie: jitter.next() };
    if (
      best === undefined ||
      (option.fresh && !best.fresh) ||
      (option.fresh === best.fresh && (option.score > best.score || (option.score === best.score && option.tie > best.tie)))
    ) {
      best = option;
    }
  };

  // The first item: a draw by weight, again for each item with no permitted pair.
  const weights = pool.map((item) => 1 / (1 + item.picks));
  const firstDraw = draw.fork("first");
  let first = -1;
  const scores = new Map<number, number>();
  while (first < 0 && weights.some((weight) => weight > 0)) {
    const index = firstDraw.weighted(weights);
    for (let j = 0; j < pool.length; j++) {
      const score = j === index ? undefined : informationOf(index, j);
      if (score !== undefined) scores.set(j, score);
    }
    if (scores.size > 0) first = index;
    else weights[index] = 0;
  }
  if (first < 0) return undefined;

  const second = draw.fork("second");
  const allowed = new Set(scores.keys());
  for (const j of candidatesOf(first, allowed, pool.length, candidates, (n) => second.below(n))) consider(first, j, scores.get(j));
  // The candidates of the first item are permitted, so `best` has a value here.
  const chosen = best as unknown as { i: number; j: number; fresh: boolean; score: number };
  if (!chosen.fresh && pool.length <= PAIR_FULL_SEARCH) {
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) consider(i, j, informationOf(i, j));
  }

  const { i, j, score } = best as unknown as { i: number; j: number; score: number };
  const [left, right] = draw.fork("side").chance(0.5) ? [at(j), at(i)] : [at(i), at(j)];
  return { a: left.id, b: right.id, information: score };
}
