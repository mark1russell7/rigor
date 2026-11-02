/**
 * The time verdict of a candidate against a baseline, with the noise of an A/A arm. An A/A pair runs the same code in
 * its two arms. Its ratios show how far apart two equal arms come on this machine. A candidate is faster or slower only
 * when its interval is out of that band.
 */
import { type BootstrapOptions, type Comparison, type Interval, bootstrapMedian, compareRatios, quantile } from "@mark1russell7/rigor-statistics";
import { type CaseRatio, type PairedTime, caseRatios } from "./paired.ts";

/** The options of the A/A band. */
export interface BandOptions {
  /** The quantile of the distances of the A/A cases from a ratio of 1, on a log scale. The default is 0.95. */
  readonly level?: number;
  /** The fewest A/A cases that give a band. The default is 5, the 5-seed rule. */
  readonly minimum?: number;
}

/** The band of the A/A arm: two equal arms come out in this band of ratios. */
export interface Band {
  /** The count of the A/A cases. */
  readonly cases: number;
  /** The `level` quantile of `abs(log(ratio))` over the A/A cases. */
  readonly noise: number;
  /** The ends of the band: `exp(-noise)` and `exp(noise)`. */
  readonly low: number;
  readonly high: number;
  /** The median ratio of the A/A cases. A value far from 1 shows a bias of the order or of the arm slots. */
  readonly median: number;
}

/** This function gives the band of the A/A arm. It refuses fewer cases than `minimum`. */
export function aaBand(aa: readonly PairedTime[], options: BandOptions = {}): Band {
  const ratios = caseRatios(aa);
  const minimum = options.minimum ?? 5;
  if (ratios.length < minimum) throw new RangeError(`aaBand: the A/A arm has ${ratios.length} cases, and a band needs ${minimum} or more.`);
  const logs = ratios.map((r) => Math.log(r.ratio));
  const noise = quantile(logs.map(Math.abs), options.level ?? 0.95);
  return { cases: ratios.length, noise, low: Math.exp(-noise), high: Math.exp(noise), median: Math.exp(quantile(logs, 0.5)) };
}

/** The four outcomes of a time verdict. The candidate is the arm `b`, so `faster` is a ratio below 1. */
export type TimeOutcome = "faster" | "slower" | "same" | "cannot decide";

/** The options of a time verdict: the band, and the bootstrap of the median ratio. */
export interface VerdictOptions extends BandOptions {
  readonly bootstrap?: BootstrapOptions;
}

/** A time verdict, with the facts that it uses. */
export interface TimeVerdict {
  readonly outcome: TimeOutcome;
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
  readonly cases: readonly CaseRatio[];
  /** The bootstrap interval of the median ratio over the cases, or undefined when there are no candidate cases. */
  readonly interval: Interval | undefined;
  /** The band of the A/A arm, or undefined when the A/A arm has too few cases. */
  readonly band: Band | undefined;
  /** The counts of the cases that gain and drop beyond the upper end of the band, or undefined without a band. */
  readonly comparison: Comparison | undefined;
}

/**
 * This function gives the time verdict of the candidate arm `b` against the baseline arm `a`.
 * - The outcome is `faster` when the interval is below the band, and `slower` when it is above the band.
 * - The outcome is `same` when the interval is in the band.
 * - Each other case is `cannot decide`, and so is an A/A arm with too few cases.
 */
export function timeVerdict(candidate: readonly PairedTime[], aa: readonly PairedTime[], options: VerdictOptions = {}): TimeVerdict {
  const cases = caseRatios(candidate);
  const aaCases = caseRatios(aa).length;
  const minimum = options.minimum ?? 5;
  if (cases.length === 0) return { outcome: "cannot decide", reason: "The candidate has no cases.", cases, interval: undefined, band: undefined, comparison: undefined };
  const interval = bootstrapMedian(cases.map((c) => c.ratio), options.bootstrap);
  if (aaCases < minimum) {
    const reason = `The A/A arm has ${aaCases} cases, and a band needs ${minimum} or more.`;
    return { outcome: "cannot decide", reason, cases, interval, band: undefined, comparison: undefined };
  }
  const band = aaBand(aa, options);
  const comparison = compareRatios(cases.map((c) => c.ratio), { better: "lower", noise: band.high - 1 });
  const span = `The interval of the median ratio is [${round(interval.low)}, ${round(interval.high)}], and the A/A band is [${round(band.low)}, ${round(band.high)}].`;
  if (interval.high < band.low) return { outcome: "faster", reason: `${span} The interval is below the band.`, cases, interval, band, comparison };
  if (interval.low > band.high) return { outcome: "slower", reason: `${span} The interval is above the band.`, cases, interval, band, comparison };
  if (interval.low >= band.low && interval.high <= band.high) return { outcome: "same", reason: `${span} The interval is in the band.`, cases, interval, band, comparison };
  return { outcome: "cannot decide", reason: `${span} The interval crosses an end of the band.`, cases, interval, band, comparison };
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
