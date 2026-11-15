/**
 * The verdict of a slope claim from a ladder on a log-log scale. Each round measures some rungs of size `n`, for
 * example a time or a count of bytes. The slope of `log value` against `log n` in a round tells the power of the
 * growth. A linear cost gives 1, and a cost of the square of the size gives 2. One ratio of two sizes cannot tell a
 * constant factor from a power, thus each round needs 3 rungs or more.
 *
 * Each round also carries its A/A ratio: a second copy of one rung over the first copy, in the same passes. A run
 * counts only when the A/A band of its rounds contains 1, the rule of `isValidRead`. Else the run measured the runner and not the code.
 */
import { leastSquares, median, medianInterval, quantile } from "@mark1russell7/rigor-statistics";
import type { LimitOutcome } from "./limit.ts";

/** One rung of a round: its size and its value, for example a time in milliseconds or a count of bytes. */
export interface SlopeRung {
  readonly size: number;
  readonly value: number;
}

/** One round of a ladder. */
export interface SlopeRound {
  /** The run of the round, for example the id of its CI job. The A/A check reads the rounds of each run. */
  readonly run: string;
  /** The rungs of the round, 3 or more, with 2 different sizes or more. */
  readonly rungs: readonly SlopeRung[];
  /** The A/A ratio of the round: the value of a second copy of one rung over the value of the first copy. */
  readonly aa: number;
}

/** The options of a slope verdict. */
export interface SlopeOptions {
  /** The highest slope that the claim permits, for example 1.2. */
  readonly limit: number;
  /** A slope that the interval must meet, with `band`. The claim "linear" gives 1. Without it, the claim is only "at most `limit`". */
  readonly holds?: number;
  /** The half width of the band around `holds`. The default is 0. */
  readonly band?: number;
  /**
   * The kind of the interval of the slopes. The default `"spread"` is the quantiles `(1 - level) / 2` and
   * `(1 + level) / 2` of the slopes of all counted rounds. The value `"median"` is the distribution-free interval of the
   * median slope at `level`. It is narrower, and it reads the typical round, not each round.
   */
  readonly interval?: "spread" | "median";
  /** The level of the interval. The default is 0.9. */
  readonly level?: number;
  /** The level of the A/A band of a run: the quantiles `(1 - aaLevel) / 2` and `(1 + aaLevel) / 2` of its A/A ratios. The default is 0.9. */
  readonly aaLevel?: number;
  /** The fewest counted runs that give a read. The default is 1. */
  readonly minRuns?: number;
}

/** The facts of one run of a ladder. */
export interface SlopeRun {
  readonly run: string;
  readonly rounds: number;
  /** The median slope of the rounds of the run. */
  readonly median: number;
  /** The ends of the A/A band of the run. */
  readonly aaLow: number;
  readonly aaHigh: number;
  /** The value is `true` when the A/A band of the run contains 1. Only the rounds of a counted run go into the interval. */
  readonly counts: boolean;
}

/** The verdict of a slope claim, with the facts that it uses. */
export interface SlopeVerdict {
  readonly outcome: LimitOutcome;
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
  /** The slope of each round of the counted runs, in the order of the rounds. */
  readonly slopes: readonly number[];
  /** The median of `slopes`. It is NaN when too few runs count. */
  readonly slope: number;
  /** The ends of the interval of the slopes. They are NaN when too few runs count. */
  readonly low: number;
  readonly high: number;
  /** The facts of each run, in the order of the first round of each run. */
  readonly runs: readonly SlopeRun[];
  readonly limit: number;
  readonly holds: number | undefined;
  readonly band: number;
}

/**
 * This function gives the slope of one round: the least-squares slope of `log value` against `log size`.
 * It refuses fewer than 3 rungs and a round with one size only.
 * It also refuses a size or a value that is not a finite number above 0.
 */
export function roundSlope(rungs: readonly SlopeRung[]): number {
  if (rungs.length < 3) throw new RangeError(`roundSlope: a round needs 3 rungs or more, not ${rungs.length}.`);
  for (const { size, value } of rungs) {
    if (!(Number.isFinite(size) && size > 0)) throw new RangeError(`roundSlope: a size is a finite number above 0, not ${size}.`);
    if (!(Number.isFinite(value) && value > 0)) throw new RangeError(`roundSlope: a value is a finite number above 0, not ${value}.`);
  }
  const fit = leastSquares(
    rungs.map((r) => [Math.log(r.size)]),
    rungs.map((r) => Math.log(r.value)),
  );
  const slope = fit.coefficients[1] as number;
  if (Number.isNaN(slope)) throw new RangeError("roundSlope: a round needs 2 different sizes or more.");
  return slope;
}

function levelOf(name: string, value: number): number {
  if (!(value > 0 && value < 1)) throw new RangeError(`slopeVerdict: the ${name} is above 0 and below 1, not ${value}.`);
  return value;
}

function fmt(x: number): string {
  return String(Math.round(x * 1000) / 1000);
}

/**
 * This function gives the verdict of the claim "the slope is at most `limit`", and with `holds`, "the slope is near `holds`".
 * - A run counts when the A/A band of its rounds contains 1. The interval reads only the rounds of the counted runs.
 * - The outcome is `within` when the high end is at most `limit`, and the interval meets the band `holds` plus or minus `band`.
 * - The outcome is `beyond` when the low end is above `limit`, or when the interval is outside the band around `holds`.
 * - Each other outcome is `cannot decide`, and so is a ladder with fewer counted runs than `minRuns`.
 */
export function slopeVerdict(rounds: readonly SlopeRound[], options: SlopeOptions): SlopeVerdict {
  const { limit, holds } = options;
  const band = options.band ?? 0;
  const kind = options.interval ?? "spread";
  const level = levelOf("level", options.level ?? 0.9);
  const aaLevel = levelOf("A/A level", options.aaLevel ?? 0.9);
  const minRuns = options.minRuns ?? 1;
  if (!Number.isFinite(limit)) throw new RangeError(`slopeVerdict: the limit is a finite number, not ${limit}.`);
  if (holds !== undefined && !(Number.isFinite(holds) && holds <= limit)) throw new RangeError(`slopeVerdict: the slope to hold is a finite number of at most the limit, not ${holds}.`);
  if (!(Number.isFinite(band) && band >= 0)) throw new RangeError(`slopeVerdict: the band is a finite number of 0 or more, not ${band}.`);
  if (kind !== "spread" && kind !== "median") throw new RangeError(`slopeVerdict: the interval is "spread" or "median", not ${JSON.stringify(kind)}.`);
  if (!Number.isSafeInteger(minRuns) || minRuns < 1) throw new RangeError(`slopeVerdict: the fewest runs are a whole number of 1 or more, not ${minRuns}.`);
  if (rounds.length === 0) throw new RangeError("slopeVerdict: the ladder has no rounds.");
  const byRun = new Map<string, { slopes: number[]; aa: number[] }>();
  const slopeOf: number[] = [];
  for (const round of rounds) {
    if (typeof round.run !== "string" || round.run === "") throw new RangeError("slopeVerdict: the run of each round is a string that is not empty.");
    if (!(Number.isFinite(round.aa) && round.aa > 0)) throw new RangeError(`slopeVerdict: the A/A ratio of a round of the run ${JSON.stringify(round.run)} is a finite number above 0, not ${round.aa}.`);
    const slope = roundSlope(round.rungs);
    slopeOf.push(slope);
    const entry = byRun.get(round.run) ?? { slopes: [], aa: [] };
    entry.slopes.push(slope);
    entry.aa.push(round.aa);
    byRun.set(round.run, entry);
  }
  const runs: SlopeRun[] = [...byRun].map(([run, { slopes, aa }]) => {
    const aaLow = quantile(aa, (1 - aaLevel) / 2);
    const aaHigh = quantile(aa, (1 + aaLevel) / 2);
    return { run, rounds: slopes.length, median: median(slopes), aaLow, aaHigh, counts: aaLow <= 1 && 1 <= aaHigh };
  });
  const counted = new Set(runs.filter((r) => r.counts).map((r) => r.run));
  const slopes = slopeOf.filter((_, i) => counted.has(rounds[i]!.run));
  const facts = { runs, limit, holds, band };
  if (counted.size < minRuns) {
    const reason = `${counted.size} of ${runs.length} runs count, and a read needs ${minRuns} or more. A run counts when its A/A band contains 1.`;
    return { outcome: "cannot decide", reason, slopes, slope: Number.NaN, low: Number.NaN, high: Number.NaN, ...facts };
  }
  const interval = kind === "median" ? medianInterval(slopes, level) : { low: quantile(slopes, (1 - level) / 2), high: quantile(slopes, (1 + level) / 2) };
  const { low, high } = interval;
  const span = `${fmt(low)} to ${fmt(high)}`;
  const around = holds === undefined ? "" : `${fmt(holds - band)} to ${fmt(holds + band)}`;
  const meets = holds === undefined || (low <= holds + band && high >= holds - band);
  const off = holds !== undefined && (high < holds - band || low > holds + band);
  let outcome: LimitOutcome;
  let reason: string;
  if (low > limit) {
    outcome = "beyond";
    reason = `The interval ${span} of the slopes is above the limit ${limit}.`;
  } else if (off) {
    outcome = "beyond";
    reason = `The interval ${span} of the slopes is outside the band ${around}.`;
  } else if (high <= limit && meets) {
    outcome = "within";
    reason = `The interval ${span} of the slopes is at most the limit ${limit}${holds === undefined ? "" : `, and it meets the band ${around}`}.`;
  } else {
    outcome = "cannot decide";
    reason = `The interval ${span} of the slopes holds the limit ${limit}.`;
  }
  return { outcome, reason, slopes, slope: median(slopes), low, high, ...facts };
}
