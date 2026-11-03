/**
 * The time verdict of a candidate against a baseline, with the noise of an A/A arm. An A/A pair runs the same code in
 * its two arms. Its ratios show how far apart two equal arms come on this machine. A candidate is faster or slower only
 * when its interval is out of that band.
 */
import { type BootstrapOptions, type Comparison, type Interval, bootstrapMedian, bootstrapTwo, compareRatios, median, quantile } from "@mark1russell7/rigor-statistics";
import { type CaseRatio, type PairedTime, caseRatios } from "./paired.ts";

/**
 * The two kinds of an A/A band.
 * - The band `case` holds the ratio of one A/A case. It is wide, so it finds only a large change.
 * - The band `median` holds the median ratio of the A/A cases. It has the scale of the median of the candidate.
 */
export type BandKind = "case" | "median";

/** The options of the A/A band. */
export interface BandOptions {
  /** The kind of the band. The default is `median`, from the power test of `verdictPower`. */
  readonly kind?: BandKind;
  /** The quantile of the band `case`, or the level of the bootstrap of the band `median`. The default is 0.95. */
  readonly level?: number;
  /** The fewest A/A cases that give a band. The default is 5, the 5-seed rule. */
  readonly minimum?: number;
  /** The bootstrap of the band `median`. The level of the band replaces its level. */
  readonly bootstrap?: BootstrapOptions;
}

/** The band of the A/A arm: two equal arms come out in this band of ratios. */
export interface Band {
  /** The count of the A/A cases. */
  readonly cases: number;
  readonly kind: BandKind;
  /**
   * The half width of the band on a log scale.
   * For the band `case`, it is the `level` quantile of `abs(log(ratio))` over the A/A cases.
   * For the band `median`, it is the larger distance of an end of the bootstrap interval of the A/A median from 0.
   */
  readonly noise: number;
  /** The ends of the band: `exp(-noise)` and `exp(noise)`. */
  readonly low: number;
  readonly high: number;
  /** The median ratio of the A/A cases. A value far from 1 shows a bias of the order or of the arm slots. */
  readonly median: number;
}

/** This function gives the band of the A/A arm. The band is symmetric on a log scale. It refuses fewer cases than `minimum`. */
export function aaBand(aa: readonly PairedTime[], options: BandOptions = {}): Band {
  const ratios = caseRatios(aa);
  const minimum = options.minimum ?? 5;
  if (ratios.length < minimum) throw new RangeError(`aaBand: the A/A arm has ${ratios.length} cases, and a band needs ${minimum} or more.`);
  const logs = ratios.map((r) => Math.log(r.ratio));
  const kind = options.kind ?? "median";
  const level = options.level ?? 0.95;
  let noise: number;
  if (kind === "case") noise = quantile(logs.map(Math.abs), level);
  else {
    const interval = bootstrapMedian(logs, { ...options.bootstrap, level });
    noise = Math.max(Math.abs(interval.low), Math.abs(interval.high));
  }
  return { cases: ratios.length, kind, noise, low: Math.exp(-noise), high: Math.exp(noise), median: Math.exp(quantile(logs, 0.5)) };
}

/**
 * This function gives the A/A spread: the `level` quantile of `abs(log(ratio))` over the A/A cases. The default level is 0.9.
 * It refuses an A/A arm with no cases.
 */
export function aaSpread(aa: readonly PairedTime[], level = 0.9): number {
  const ratios = caseRatios(aa);
  if (ratios.length === 0) throw new RangeError("aaSpread: the A/A arm has no cases.");
  return spreadOf(ratios, level);
}

function spreadOf(ratios: readonly CaseRatio[], level: number): number {
  return quantile(ratios.map((r) => Math.abs(Math.log(r.ratio))), level);
}

/** The options of a pooled band: the A/A records of earlier quiet runs, and a floor. The caller keeps the pool. */
export interface PoolOptions {
  /** The A/A records of the earlier runs. Give each run its own case names, for example with the run id as a prefix. */
  readonly records: readonly PairedTime[];
  /** The smallest noise of the band, on a log scale. The default is 0. A floor of `Math.log(1.05)` gives at least the band `[1 / 1.05, 1.05]`. */
  readonly floor?: number;
  /** The fewest pooled cases that give a spread. With fewer cases, the noise of the band is the floor. The default is 5. */
  readonly minimum?: number;
  /**
   * The run of a record, for example the id of its CI run. The verdict counts the runs of the pool with it.
   * The cases of one run share one runner, so they are not independent. Many cases from few runs show the noise of few runners.
   */
  readonly run?: (record: PairedTime) => string;
}

/** The facts of the pooled band of a verdict. */
export interface PoolFacts {
  /** The count of the pooled A/A cases. */
  readonly cases: number;
  /** The count of the runs of the pool, from the option `run`. It is undefined without that option. */
  readonly runs: number | undefined;
  /** The A/A spread of the pooled cases, or undefined when the pool has fewer cases than `minimum`. */
  readonly spread: number | undefined;
  readonly floor: number;
  /** This value is `true` when the spread of the pool is larger than the floor, so the spread gives the noise of the band. */
  readonly pooled: boolean;
}

/**
 * This function gives the pooled band of the kind `case`. Its noise is the larger of the floor and the A/A spread of the pooled records.
 * The spread is the `level` quantile of `abs(log(ratio))`, with the default level 0.9.
 *
 * A band with fewer pooled cases than `minimum` uses the floor alone. A band with no pooled cases has the median 1.
 */
export function pooledBand(pool: PoolOptions, level = 0.9): Band {
  return poolOf(pool, level).band;
}

function poolOf(pool: PoolOptions, level: number): { band: Band; facts: PoolFacts } {
  const floor = pool.floor ?? 0;
  const minimum = pool.minimum ?? 5;
  if (!(floor >= 0 && Number.isFinite(floor))) throw new RangeError(`pooledBand: the floor is a finite number of 0 or more, not ${floor}.`);
  if (!Number.isSafeInteger(minimum) || minimum < 1) throw new RangeError(`pooledBand: the minimum is a whole number of 1 or more, not ${minimum}.`);
  const ratios = caseRatios(pool.records);
  const spread = ratios.length >= minimum ? spreadOf(ratios, level) : undefined;
  const noise = Math.max(floor, spread ?? 0);
  const median = ratios.length === 0 ? 1 : Math.exp(quantile(ratios.map((r) => Math.log(r.ratio)), 0.5));
  const band: Band = { cases: ratios.length, kind: "case", noise, low: Math.exp(-noise), high: Math.exp(noise), median };
  const runs = pool.run === undefined ? undefined : new Set(pool.records.map(pool.run)).size;
  return { band, facts: { cases: ratios.length, runs, spread, floor, pooled: spread !== undefined && spread > floor } };
}

/** The four outcomes of a time verdict. The candidate is the arm `b`, so `faster` is a ratio below 1. */
export type TimeOutcome = "faster" | "slower" | "same" | "cannot decide";

/** The options of a time verdict. The bootstrap gives the interval of the median ratio of the candidate, and the band `median`. */
/**
 * The two rules of a time verdict.
 * - The rule `band` compares the interval of the median ratio of the candidate with the A/A band.
 * - The rule `difference` compares the interval of the candidate median over the A/A median with 1 and with `margin`.
 */
export type VerdictRule = "band" | "difference";

/** The options of a time verdict. The bootstrap gives each interval of the verdict. */
export interface VerdictOptions extends BandOptions {
  /** The rule of the verdict. The default is `difference`, from the power test of `verdictPower`. */
  readonly rule?: VerdictRule;
  /** The half width on a log scale of the ratios that the rule `difference` calls `same`. The default is 0.05. */
  readonly margin?: number;
  /**
   * The noise cap on the A/A spread of the run, on a log scale. Above the cap, the outcome is `cannot decide`.
   * The default is no cap.
   */
  readonly noiseCap?: number;
  /** The quantile of the A/A spread of the noise cap and of the pooled band. The default is 0.9. */
  readonly spreadLevel?: number;
  /**
   * The pooled band. It replaces the band of the A/A arm of the run in the rule `band` and in `comparison`.
   * The rule `difference` uses the larger of `margin` and the noise of the pooled band as its margin. The default is no pool.
   */
  readonly pool?: PoolOptions;
}

/** The noise cap of a verdict: the A/A spread of the run and the cap. */
export interface NoiseCheck {
  /** The A/A spread of the run, or undefined when the A/A arm has no cases. */
  readonly spread: number | undefined;
  readonly cap: number;
  /** This value is `true` when the spread is above the cap, or when the A/A arm has no cases. */
  readonly noisy: boolean;
}

/** A time verdict, with the facts that it uses. */
export interface TimeVerdict {
  readonly outcome: TimeOutcome;
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
  readonly cases: readonly CaseRatio[];
  readonly rule: VerdictRule;
  /**
   * The interval that the rule compares, or undefined when there are no candidate cases.
   * With too few A/A cases, it is the interval of the median ratio of the candidate.
   * For the rule `band`, it is the bootstrap interval of the median ratio of the candidate.
   * For the rule `difference`, it is the interval of the candidate median ratio over the A/A median ratio.
   */
  readonly interval: Interval | undefined;
  /** The band of the A/A arm, or undefined when the A/A arm has too few cases. */
  readonly band: Band | undefined;
  /**
   * The counts of the cases out of the band, or undefined without a band.
   * The comparison uses the value `1 + log(ratio)` of each case and the noise of the band, so its two sides are the ends of the band.
   */
  readonly comparison: Comparison | undefined;
  /** The facts of the pooled band. The verdict has this field only with the option `pool`. */
  readonly pool?: PoolFacts;
  /** The noise cap. The verdict has this field only with the option `noiseCap`. */
  readonly noise?: NoiseCheck;
}

/**
 * This function gives the time verdict of the candidate arm `b` against the baseline arm `a`.
 * - The rule `difference` gives `faster` when the whole interval is below 1, and `slower` when it is above 1.
 *   It gives `same` when the interval is in `[exp(-margin), exp(margin)]`.
 * - The rule `band` gives `faster` below the band, `slower` above the band, and `same` in the band.
 * - Each other case is `cannot decide`, and so is an A/A arm with too few cases.
 * - With `noiseCap`, an A/A spread of the run above the cap gives `cannot decide`.
 * - With `pool`, the pooled band replaces the band of the A/A arm of the run. The run still needs `minimum` A/A cases.
 */
export function timeVerdict(candidate: readonly PairedTime[], aa: readonly PairedTime[], options: VerdictOptions = {}): TimeVerdict {
  const level = options.spreadLevel ?? 0.9;
  if (options.noiseCap !== undefined && !(options.noiseCap >= 0 && Number.isFinite(options.noiseCap))) {
    throw new RangeError(`timeVerdict: the noise cap is a finite number of 0 or more, not ${options.noiseCap}.`);
  }
  const pool = options.pool === undefined ? undefined : poolOf(options.pool, level);
  let verdict = ruleVerdict(candidate, aa, options, pool?.band);
  if (pool !== undefined) verdict = { ...verdict, pool: pool.facts };
  if (options.noiseCap !== undefined) {
    const cap = options.noiseCap;
    const aaRatios = caseRatios(aa);
    const spread = aaRatios.length === 0 ? undefined : spreadOf(aaRatios, level);
    const noise: NoiseCheck = { spread, cap, noisy: spread === undefined || spread > cap };
    verdict = { ...verdict, noise };
    // The early outcomes (no candidate cases, too few A/A cases) keep their reason. Each other outcome gives way to the cap.
    if (noise.noisy && verdict.band !== undefined) {
      const why = spread === undefined ? "The A/A arm of the run has no cases, so the noise cap has no spread." : `The A/A spread of the run is ${round(spread)}, above the noise cap ${cap}.`;
      const reason = `${why} Without the cap, the outcome is "${verdict.outcome}".`;
      verdict = { ...verdict, outcome: "cannot decide", reason };
    }
  }
  return verdict;
}

/** This function gives the outcome of the rule. A pooled band replaces the band of the A/A arm, and it widens the margin of the rule `difference`. */
function ruleVerdict(candidate: readonly PairedTime[], aa: readonly PairedTime[], options: VerdictOptions, pooled: Band | undefined): TimeVerdict {
  const rule = options.rule ?? "difference";
  const cases = caseRatios(candidate);
  const aaRatios = caseRatios(aa);
  const minimum = options.minimum ?? 5;
  const none = { cases, rule, interval: undefined, band: undefined, comparison: undefined };
  if (cases.length === 0) return { ...none, outcome: "cannot decide", reason: "The candidate has no cases." };
  if (aaRatios.length < minimum) {
    const interval = bootstrapMedian(cases.map((c) => c.ratio), options.bootstrap);
    return { ...none, interval, outcome: "cannot decide", reason: `The A/A arm has ${aaRatios.length} cases, and a band needs ${minimum} or more.` };
  }
  const band = pooled ?? aaBand(aa, options);
  const comparison = compareRatios(cases.map((c) => 1 + Math.log(c.ratio)), { better: "lower", noise: band.noise });
  const facts = { cases, rule, band, comparison };
  if (rule === "difference") {
    const given = options.margin ?? 0.05;
    if (!(given >= 0)) throw new RangeError(`timeVerdict: the margin is 0 or more, not ${given}.`);
    const margin = pooled === undefined ? given : Math.max(given, pooled.noise);
    const shown = pooled === undefined ? margin : round(margin);
    const logs = cases.map((c) => Math.log(c.ratio));
    const aaLogs = aaRatios.map((c) => Math.log(c.ratio));
    const d = bootstrapTwo(logs, aaLogs, (x, y) => median(x) - median(y), options.bootstrap);
    const interval: Interval = { ...d, estimate: Math.exp(d.estimate), low: Math.exp(d.low), high: Math.exp(d.high) };
    const span = `The interval of the candidate median over the A/A median is [${round(interval.low)}, ${round(interval.high)}].`;
    if (interval.high < 1) return { ...facts, interval, outcome: "faster", reason: `${span} The interval is below 1.` };
    if (interval.low > 1) return { ...facts, interval, outcome: "slower", reason: `${span} The interval is above 1.` };
    if (d.low >= -margin && d.high <= margin) return { ...facts, interval, outcome: "same", reason: `${span} The interval is in the margin of ${shown}.` };
    return { ...facts, interval, outcome: "cannot decide", reason: `${span} The interval holds 1 and crosses the margin of ${shown}.` };
  }
  const interval = bootstrapMedian(cases.map((c) => c.ratio), options.bootstrap);
  const span = `The interval of the median ratio is [${round(interval.low)}, ${round(interval.high)}], and the A/A band is [${round(band.low)}, ${round(band.high)}].`;
  if (interval.high < band.low) return { ...facts, interval, outcome: "faster", reason: `${span} The interval is below the band.` };
  if (interval.low > band.high) return { ...facts, interval, outcome: "slower", reason: `${span} The interval is above the band.` };
  if (interval.low >= band.low && interval.high <= band.high) return { ...facts, interval, outcome: "same", reason: `${span} The interval is in the band.` };
  return { ...facts, interval, outcome: "cannot decide", reason: `${span} The interval crosses an end of the band.` };
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
