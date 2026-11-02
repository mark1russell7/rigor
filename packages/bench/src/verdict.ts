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
}

/**
 * This function gives the time verdict of the candidate arm `b` against the baseline arm `a`.
 * - The rule `difference` gives `faster` when the whole interval is below 1, and `slower` when it is above 1.
 *   It gives `same` when the interval is in `[exp(-margin), exp(margin)]`.
 * - The rule `band` gives `faster` below the band, `slower` above the band, and `same` in the band.
 * - Each other case is `cannot decide`, and so is an A/A arm with too few cases.
 */
export function timeVerdict(candidate: readonly PairedTime[], aa: readonly PairedTime[], options: VerdictOptions = {}): TimeVerdict {
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
  const band = aaBand(aa, options);
  const comparison = compareRatios(cases.map((c) => 1 + Math.log(c.ratio)), { better: "lower", noise: band.noise });
  const facts = { cases, rule, band, comparison };
  if (rule === "difference") {
    const margin = options.margin ?? 0.05;
    if (!(margin >= 0)) throw new RangeError(`timeVerdict: the margin is 0 or more, not ${margin}.`);
    const logs = cases.map((c) => Math.log(c.ratio));
    const aaLogs = aaRatios.map((c) => Math.log(c.ratio));
    const d = bootstrapTwo(logs, aaLogs, (x, y) => median(x) - median(y), options.bootstrap);
    const interval: Interval = { ...d, estimate: Math.exp(d.estimate), low: Math.exp(d.low), high: Math.exp(d.high) };
    const span = `The interval of the candidate median over the A/A median is [${round(interval.low)}, ${round(interval.high)}].`;
    if (interval.high < 1) return { ...facts, interval, outcome: "faster", reason: `${span} The interval is below 1.` };
    if (interval.low > 1) return { ...facts, interval, outcome: "slower", reason: `${span} The interval is above 1.` };
    if (d.low >= -margin && d.high <= margin) return { ...facts, interval, outcome: "same", reason: `${span} The interval is in the margin of ${margin}.` };
    return { ...facts, interval, outcome: "cannot decide", reason: `${span} The interval holds 1 and crosses the margin of ${margin}.` };
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
