/**
 * The rating models of a log of picks. The Elo and the Glicko-2 replays read the picks in their order. The
 * Bradley-Terry fit reads the whole log at one time. The choice of a model compares the log-loss of each model on the
 * last picks of the log. Each function is pure: the same log gives the same result.
 */
import { type BradleyTerryOptions, type PairComparison, type PairOutcome, bradleyTerry } from "./bradley-terry.ts";
import { bradleyTerrySparse } from "./bradley-terry-sparse.ts";
import { logLoss } from "./compare.ts";
import { type EloOptions, type Glicko2Options, type Glicko2Rating, eloUpdate, glicko2Update, pairProbabilities, ratingToStrength } from "./rating.ts";

/** The options of `eloReplay`. */
export interface EloReplayOptions extends EloOptions {
  /** The rating of each item before its first pick. The default is 1500. */
  readonly start?: number;
}

/** The options of `glicko2Replay`. */
export interface Glicko2ReplayOptions extends Glicko2Options {
  /** The rating of each item before its first pick. The default is the rating 1500, the RD 350 and the volatility 0.06. */
  readonly start?: Glicko2Rating;
}

/** The score of the first item of a pick: 1 for a win, 0.5 for a tie and 0 for a loss. */
const SCORE: Readonly<Record<PairOutcome, number>> = { a: 1, b: 0, tie: 0.5 };

/** This function checks the indexes and the outcomes of `comparisons`. With `ordered`, it also refuses a weight other than 1. */
function checkedPicks(name: string, items: number, comparisons: readonly PairComparison[], ordered: boolean): void {
  if (!Number.isSafeInteger(items) || items < 0) throw new RangeError(`${name}: the number of items is a whole number of 0 or more, not ${items}.`);
  for (const [i, { a, b, outcome, weight }] of comparisons.entries()) {
    for (const index of [a, b]) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= items) {
        throw new RangeError(`${name}: pick ${i} has the index ${index}, and the indexes are whole numbers from 0 to ${items - 1}.`);
      }
    }
    if (a === b) throw new RangeError(`${name}: pick ${i} compares the item ${a} with itself.`);
    if (outcome !== "a" && outcome !== "b" && outcome !== "tie") throw new RangeError(`${name}: pick ${i} has the outcome ${String(outcome)}.`);
    if (ordered && weight !== undefined && weight !== 1) {
      throw new RangeError(`${name}: pick ${i} has the weight ${weight}. An ordered replay makes one update for each pick, so each weight is 1.`);
    }
  }
}

/**
 * The Elo ratings of `items` items after each pick of `comparisons`, in the order of the list. Each item starts at
 * `start`. The update of each pick is `eloUpdate` with the options. The order of the picks changes the result.
 */
export function eloReplay(items: number, comparisons: readonly PairComparison[], options: EloReplayOptions = {}): number[] {
  checkedPicks("eloReplay", items, comparisons, true);
  const start = options.start ?? 1500;
  if (!Number.isFinite(start)) throw new RangeError(`eloReplay: the start rating is a finite number, not ${start}.`);
  // One update of two equal ratings checks the options also when the list is empty.
  eloUpdate(start, start, 0.5, options);
  const ratings = new Array<number>(items).fill(start);
  for (const { a, b, outcome } of comparisons) {
    const next = eloUpdate(ratings[a] as number, ratings[b] as number, SCORE[outcome], options);
    ratings[a] = next.a;
    ratings[b] = next.b;
  }
  return ratings;
}

/**
 * The Glicko-2 ratings of `items` items after each pick of `comparisons`, in the order of the list. Each pick is one
 * rating period of its two items. Each item of a pick gets `glicko2Update` against the rating of the other item before
 * the pick. An item that is not in a pick does not change in that period. The order of the picks changes the result.
 */
export function glicko2Replay(items: number, comparisons: readonly PairComparison[], options: Glicko2ReplayOptions = {}): Glicko2Rating[] {
  checkedPicks("glicko2Replay", items, comparisons, true);
  const start = options.start ?? { rating: 1500, rd: 350, volatility: 0.06 };
  // An update with no games checks the start rating and the options also when the list is empty.
  glicko2Update(start, [], options);
  const players: Glicko2Rating[] = Array.from({ length: items }, () => ({ rating: start.rating, rd: start.rd, volatility: start.volatility }));
  for (const { a, b, outcome } of comparisons) {
    const pa = players[a] as Glicko2Rating;
    const pb = players[b] as Glicko2Rating;
    players[a] = glicko2Update(pa, [{ rating: pb.rating, rd: pb.rd, score: SCORE[outcome] }], options);
    players[b] = glicko2Update(pb, [{ rating: pa.rating, rd: pa.rd, score: 1 - SCORE[outcome] }], options);
  }
  return players;
}

/** The rating models. */
export type RatingModel = "bradley-terry" | "elo" | "glicko2";

/** The options of `fitRatings`. */
export interface RatingFitOptions {
  /** The options of the Bradley-Terry fit. They go to `bradleyTerry` and to `bradleyTerrySparse`. */
  readonly bradleyTerry?: BradleyTerryOptions;
  /** The largest number of items for the dense fit `bradleyTerry`. A larger log uses `bradleyTerrySparse`. The default is 200. */
  readonly denseLimit?: number;
  /** The options of the Elo replay. Its scale also converts the ratings to log-strengths. */
  readonly elo?: EloReplayOptions;
  /** The options of the Glicko-2 replay. */
  readonly glicko2?: Glicko2ReplayOptions;
}

/** The result of `fitRatings`. The lists have one value for each item, in the order of the indexes. */
export interface RatingFit {
  /** The log-strength of each item. `strengthToRating` gives the rating. */
  readonly strengths: number[];
  /**
   * The standard error of each log-strength. Elo has no standard error, so each value is `undefined`. For Glicko-2, it
   * is the RD as a log-strength.
   */
  readonly se: (number | undefined)[];
  /** The Davidson tie parameter of the Bradley-Terry fit, or 0 for the other models. */
  readonly tie: number;
}

/** The default largest number of items of the dense Bradley-Terry fit in `fitRatings`. */
export const BRADLEY_TERRY_DENSE_LIMIT = 200;

/**
 * The log-strengths of `items` items with one rating model. The model `"bradley-terry"` uses `bradleyTerry`, or
 * `bradleyTerrySparse` above `denseLimit` items. The models `"elo"` and `"glicko2"` use `eloReplay` and
 * `glicko2Replay`, and they refuse a weight other than 1. A log of 0 items gives empty lists.
 */
export function fitRatings(model: RatingModel, items: number, comparisons: readonly PairComparison[], options: RatingFitOptions = {}): RatingFit {
  checkedPicks("fitRatings", items, comparisons, model !== "bradley-terry");
  const denseLimit = options.denseLimit ?? BRADLEY_TERRY_DENSE_LIMIT;
  if (!(denseLimit >= 0)) throw new RangeError(`fitRatings: denseLimit is a number of 0 or more, not ${denseLimit}.`);
  // The Bradley-Terry fits refuse 0 items, so an empty log gives empty lists here.
  if (items === 0) return { strengths: [], se: [], tie: 0 };
  switch (model) {
    case "bradley-terry": {
      const fit = items <= denseLimit ? bradleyTerry(items, comparisons, options.bradleyTerry) : bradleyTerrySparse(items, comparisons, options.bradleyTerry);
      return { strengths: fit.strengths, se: fit.se, tie: fit.tie };
    }
    case "elo": {
      const ratings = eloReplay(items, comparisons, options.elo);
      return { strengths: ratings.map((rating) => ratingToStrength(rating, options.elo)), se: ratings.map(() => undefined), tie: 0 };
    }
    case "glicko2": {
      const players = glicko2Replay(items, comparisons, options.glicko2);
      return {
        strengths: players.map((player) => ratingToStrength(player.rating)),
        se: players.map((player) => ratingToStrength(1500 + player.rd)),
        tie: 0,
      };
    }
    default:
      throw new RangeError(`fitRatings: the model is "bradley-terry", "elo" or "glicko2", not ${String(model)}.`);
  }
}

/** The log-loss of one model on the held-out picks. */
export interface RatingModelScore {
  readonly model: RatingModel;
  /** The mean of `-ln(p)` over the held-out picks, with `p` the forecast of the outcome of the pick. Lower is better. */
  readonly logLoss: number;
}

/** The result of `selectRatingModel`. */
export interface RatingModelChoice {
  /** The model with the lowest log-loss, or `"bradley-terry"` when the log has too few picks for a test. */
  readonly model: RatingModel;
  /** The score of each model, from the best to the worst. It is empty when the log has too few picks for a test. */
  readonly scores: RatingModelScore[];
  /** The number of picks that the models learn from. */
  readonly trained: number;
  /** The number of held-out picks. */
  readonly tested: number;
}

/** The options of `selectRatingModel`. */
export interface RatingModelOptions extends RatingFitOptions {
  /** The part of the picks, at the end of the log, that the test uses. It is above 0 and below 1. The default is 0.2. */
  readonly holdout?: number;
  /** The fewest picks for a test. With fewer picks, the choice is `"bradley-terry"`. The default is 30. */
  readonly minimum?: number;
  /** The models to compare. The default is all three, in the order `"bradley-terry"`, `"elo"` and `"glicko2"`. */
  readonly models?: readonly RatingModel[];
}

/** The lowest probability of a forecast. An outcome with a probability of 0 gives a log-loss of Infinity. */
const FORECAST_FLOOR = 1e-9;

/**
 * The choice of a rating model by the log-loss on held-out picks. Each model learns from the first picks of the log
 * and forecasts the last `holdout` part. All models use the tie parameter of the Bradley-Terry fit of the first picks.
 * Thus the strengths are the only difference. Two equal scores keep the order of `models`. Each pick has the weight 1.
 */
export function selectRatingModel(items: number, comparisons: readonly PairComparison[], options: RatingModelOptions = {}): RatingModelChoice {
  checkedPicks("selectRatingModel", items, comparisons, true);
  const holdout = options.holdout ?? 0.2;
  const minimum = options.minimum ?? 30;
  const models = options.models ?? (["bradley-terry", "elo", "glicko2"] as const);
  if (!(holdout > 0 && holdout < 1)) throw new RangeError(`selectRatingModel: the holdout is above 0 and below 1, not ${holdout}.`);
  if (!Number.isSafeInteger(minimum) || minimum < 0) throw new RangeError(`selectRatingModel: the minimum is a whole number of 0 or more, not ${minimum}.`);
  if (models.length === 0) throw new RangeError("selectRatingModel: the list of models is empty.");
  for (const model of models) {
    if (model !== "bradley-terry" && model !== "elo" && model !== "glicko2") {
      throw new RangeError(`selectRatingModel: a model is "bradley-terry", "elo" or "glicko2", not ${String(model)}.`);
    }
  }
  const tested = Math.floor(comparisons.length * holdout);
  if (comparisons.length < minimum || tested < 1) return { model: "bradley-terry", scores: [], trained: comparisons.length, tested: 0 };

  const train = comparisons.slice(0, comparisons.length - tested);
  const test = comparisons.slice(comparisons.length - tested);
  const bradley = fitRatings("bradley-terry", items, train, options);
  const scores = models.map((model): RatingModelScore => {
    const { strengths } = model === "bradley-terry" ? bradley : fitRatings(model, items, train, options);
    const forecasts = test.map(({ a, b, outcome }) => {
      const p = pairProbabilities(strengths[a] as number, strengths[b] as number, bradley.tie)[outcome];
      return { p: Math.max(p, FORECAST_FLOOR), hit: true };
    });
    return { model, logLoss: logLoss(forecasts) };
  });
  // The sort is stable, so two equal scores keep the order of the models.
  scores.sort((x, y) => x.logLoss - y.logLoss);
  return { model: (scores[0] as RatingModelScore).model, scores, trained: train.length, tested };
}
