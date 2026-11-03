/**
 * The limit verdict of a bench: is the ratio of each case at most a limit? For example, the claim "the new code takes at most
 * 2 times the time of the old code" needs it. The time verdict compares only with 1.
 */
import { medianInterval } from "@mark1russell7/rigor-statistics";
import { type CaseRatio, type PairedTime, caseRatios } from "./paired.ts";
import { type Band, type BandOptions, aaBand } from "./verdict.ts";

/** The ratio of one case with the interval of its median over the rounds. */
export interface CaseInterval extends CaseRatio {
  /** The ends of the interval: `exp` of `medianInterval` over the values `log(b / a)` of the rounds. */
  readonly low: number;
  readonly high: number;
  /** The coverage of the interval. It is at least the level. */
  readonly coverage: number;
}

/**
 * This function gives the ratio of each case with a distribution-free interval of its median, in the order of
 * `caseRatios`. It needs enough rounds for the level: 6 rounds or more for the level 0.95.
 */
export function caseIntervals(records: readonly PairedTime[], level = 0.95): CaseInterval[] {
  const logs = new Map<string, number[]>();
  for (const r of records) {
    const list = logs.get(r.case) ?? [];
    list.push(Math.log(r.b / r.a));
    logs.set(r.case, list);
  }
  return caseRatios(records).map((c) => {
    const interval = medianInterval(logs.get(c.case)!, level);
    return { ...c, low: Math.exp(interval.low), high: Math.exp(interval.high), coverage: interval.coverage };
  });
}

/** The three outcomes of a limit verdict. */
export type LimitOutcome = "within" | "beyond" | "cannot decide";

/** The options of a limit verdict. */
export interface LimitOptions extends BandOptions {
  /** The largest ratio `b / a` that the claim permits, for example 2. */
  readonly limit: number;
  /** The level of the interval of each case. The default is 0.95. */
  readonly caseLevel?: number;
  /**
   * The share of the cases that the claim needs `within`, above 0 and at most 1. The default 1 needs each case. With 0.95
   * and 20 cases, 1 case can be `beyond` or `cannot decide`. The option `timeTailQ` of a promotion record is this share.
   */
  readonly share?: number;
}

/** The verdict of one case against the limit. */
export interface CaseLimit extends CaseInterval {
  /** The high end of the interval of the case, times the high end of the A/A band. */
  readonly bound: number;
  /** The low end of the interval of the case, times the low end of the A/A band. */
  readonly floor: number;
  readonly outcome: LimitOutcome;
}

/** A limit verdict, with the facts that it uses. */
export interface LimitVerdict {
  readonly outcome: LimitOutcome;
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
  readonly limit: number;
  readonly cases: readonly CaseLimit[];
  /** The band of the A/A arm, or undefined when the A/A arm has too few cases. */
  readonly band: Band | undefined;
  /** The share of the option `share`. */
  readonly share: number;
  /** The number of cases that can be other than `within`: the floor of the number of cases times `1 - share`. */
  readonly allowed: number;
}

/**
 * This function gives the verdict of the claim "the ratio `b / a` of each case is at most `limit`". The A/A band widens
 * the interval of each case: the bound is the high end times the high end of the band.
 * - A case is `within` when its bound is at most the limit, and `beyond` when its floor is above the limit.
 * - The verdict is `within` when `allowed` cases or fewer are other than `within`. With the default share 1, `allowed` is 0.
 * - The verdict is `beyond` when more than `allowed` cases are `beyond`.
 * - Each other verdict is `cannot decide`, and so is an A/A arm with too few cases or a candidate with no cases.
 */
export function limitVerdict(candidate: readonly PairedTime[], aa: readonly PairedTime[], options: LimitOptions): LimitVerdict {
  const { limit } = options;
  if (!(limit > 0 && Number.isFinite(limit))) throw new RangeError(`limitVerdict: the limit is a finite number above 0, not ${limit}.`);
  const share = options.share ?? 1;
  if (!(share > 0 && share <= 1)) throw new RangeError(`limitVerdict: the share is above 0 and at most 1, not ${share}.`);
  const intervals = caseIntervals(candidate, options.caseLevel);
  const minimum = options.minimum ?? 5;
  // The small term keeps a product such as 10 * (1 - 0.9) = 0.9999999999999998 from a floor of 0.
  const allowed = Math.floor(intervals.length * (1 - share) + 1e-9);
  if (intervals.length === 0) return { outcome: "cannot decide", reason: "The candidate has no cases.", limit, cases: [], band: undefined, share, allowed };
  const aaCount = caseRatios(aa).length;
  if (aaCount < minimum) {
    const cases = intervals.map((c) => ({ ...c, bound: c.high, floor: c.low, outcome: "cannot decide" as const }));
    return { outcome: "cannot decide", reason: `The A/A arm has ${aaCount} cases, and a band needs ${minimum} or more.`, limit, cases, band: undefined, share, allowed };
  }
  const band = aaBand(aa, options);
  const cases = intervals.map((c): CaseLimit => {
    const bound = c.high * band.high;
    const floor = c.low * band.low;
    const outcome: LimitOutcome = bound <= limit ? "within" : floor > limit ? "beyond" : "cannot decide";
    return { ...c, bound, floor, outcome };
  });
  const facts = { limit, cases, band, share, allowed };
  const beyond = cases.filter((c) => c.outcome === "beyond");
  const others = cases.filter((c) => c.outcome !== "within");
  const permit = allowed === 0 ? "" : `, and the share ${share} permits ${allowed}`;
  if (beyond.length > allowed) {
    return { outcome: "beyond", reason: `${beyond.length} of ${cases.length} cases are above the limit ${limit}${permit}. The first is ${JSON.stringify(beyond[0]!.case)}.`, ...facts };
  }
  if (others.length <= allowed) {
    const inside = cases.filter((c) => c.outcome === "within");
    const top = (inside.length > 0 ? inside : cases).reduce((a, b) => (b.bound > a.bound ? b : a));
    const rest = others.length === 0 ? "" : ` ${others.length} of ${cases.length} cases are not within${permit}.`;
    return { outcome: "within", reason: `The largest bound of a case within is ${round(top.bound)} in the case ${JSON.stringify(top.case)}, and it is at most the limit ${limit}.${rest}`, ...facts };
  }
  const top = cases.reduce((a, b) => (b.bound > a.bound ? b : a));
  return { outcome: "cannot decide", reason: `${others.length} of ${cases.length} cases are not within${permit}. The bound of the case ${JSON.stringify(top.case)} is ${round(top.bound)}, above the limit ${limit}, and too few floors are above it.`, ...facts };
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
