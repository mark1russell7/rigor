/**
 * The tail limit verdict of a bench with few rounds. The median of each case has one limit, and a high value of its rounds
 * has another limit. The verdict `limitVerdict` needs an interval of the median, and a few rounds give a wide interval.
 * This verdict reads each value as it is, and the A/A arm of the same run tells which tail is noise.
 */
import { type PairedTime, caseRatios } from "./paired.ts";
import type { LimitOutcome } from "./limit.ts";

/** The value at one rank of the ratios of one case, from the largest. */
export interface CaseTail {
  readonly case: string;
  /** The value at the rank, or undefined when the rounds do not put the rank above the median. */
  readonly tail: number | undefined;
  readonly rounds: number;
}

/** The two limits of one case. */
export interface TailLimit {
  /** The largest median of the ratio `b / a` that the claim permits. */
  readonly median: number;
  /** The largest tail of the ratio `b / a` that the claim permits. */
  readonly tail: number;
}

/** The options of `tailFalseFails`. */
export interface TailRuleOptions {
  /** The limits of all the cases, or a function that gives the limits of one case. */
  readonly limit: TailLimit | ((caseName: string) => TailLimit);
  /** The rank of the tail, from the largest. The default 2 reads the second largest ratio, so one slow process cannot move it. */
  readonly rank?: number;
}

/** The options of a tail limit verdict. */
export interface TailLimitOptions extends TailRuleOptions {
  /**
   * The largest tail of the A/A arm that lets a run decide. Each row under the tail of the A/A arm passes the tail limit, so
   * a loud run has no power. This option has no default, because a run with no cap passes each row when it is loud.
   */
  readonly aaCap: number;
  /** The smallest number of A/A cases with a tail. The default is 5. */
  readonly minimum?: number;
}

/** The verdict of one case. */
export interface CaseTailLimit extends CaseTail {
  /** The median ratio of the case: the value `ratio` of `caseRatios`. */
  readonly ratio: number;
  readonly limit: TailLimit;
  /** The median is over its limit. */
  readonly overMedian: boolean;
  /** The tail is over its limit and over the tail of the A/A arm of the run. */
  readonly overTail: boolean;
  readonly outcome: LimitOutcome;
}

/** A tail limit verdict, with the facts that it uses. */
export interface TailLimitVerdict {
  readonly outcome: LimitOutcome;
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
  readonly cases: readonly CaseTailLimit[];
  /** The largest tail over the cases of the A/A arm, or undefined when that arm has too few cases. */
  readonly aaTail: number | undefined;
  readonly aaCap: number;
  readonly rank: number;
}

function ratiosOf(records: readonly PairedTime[]): Map<string, number[]> {
  const ratios = new Map<string, number[]>();
  for (const r of records) {
    const list = ratios.get(r.case) ?? [];
    list.push(r.b / r.a);
    ratios.set(r.case, list);
  }
  return ratios;
}

function checkRank(rank: number): void {
  if (!Number.isSafeInteger(rank) || rank < 1) throw new RangeError(`tail: the rank is a whole number of 1 or more, not ${rank}.`);
}

/**
 * This function gives the value at one rank of the ratios of each case, from the largest, in the order of `caseRatios`. It
 * examines the records as `caseRatios` does. A case needs `2 * rank + 1` rounds, so that the value is above the median.
 */
export function caseTails(records: readonly PairedTime[], rank = 2): CaseTail[] {
  checkRank(rank);
  const ratios = ratiosOf(records);
  return caseRatios(records).map((c) => {
    const sorted = (ratios.get(c.case) ?? []).toSorted((x, y) => y - x);
    return { case: c.case, rounds: c.rounds, tail: c.rounds >= 2 * rank + 1 ? sorted[rank - 1] : undefined };
  });
}

function limitOf(options: TailRuleOptions, name: string): TailLimit {
  const limit = typeof options.limit === "function" ? options.limit(name) : options.limit;
  for (const value of [limit.median, limit.tail]) {
    if (!(value > 0 && Number.isFinite(value))) throw new RangeError(`tail: each limit is a finite number above 0, not ${value} for the case ${JSON.stringify(name)}.`);
  }
  return limit;
}

function largestTail(tails: readonly CaseTail[]): number | undefined {
  const values = tails.flatMap((c) => (c.tail === undefined ? [] : [c.tail]));
  return values.length === 0 ? undefined : Math.max(...values);
}

/**
 * This function gives the verdict of the claim "the median and the tail of each case are at most their limits".
 * - A case is `beyond` when its median is over its limit. It is also `beyond` when its tail is over its limit and over the
 *   largest tail of the A/A arm of the run.
 * - A case with too few rounds for the rank is `cannot decide`, unless its median is over its limit.
 * - The verdict is `beyond` when a case is `beyond`, and `within` when each case is `within`.
 * - Each case and the verdict are `cannot decide` when the largest tail of the A/A arm is over `aaCap`. The same applies
 *   when the A/A arm has fewer than `minimum` cases with a tail. This is not a pass, so the caller takes another read.
 *
 * With the default rank, a real cost in 1 round cannot fail the tail limit, because 1 round cannot be told from noise. A
 * cost in 2 rounds or more can fail it. The verdict has no interval, so a limit needs a margin from the spread of earlier
 * runs.
 */
export function tailLimitVerdict(candidate: readonly PairedTime[], aa: readonly PairedTime[], options: TailLimitOptions): TailLimitVerdict {
  const { aaCap } = options;
  const rank = options.rank ?? 2;
  const minimum = options.minimum ?? 5;
  checkRank(rank);
  if (!(aaCap > 0 && Number.isFinite(aaCap))) throw new RangeError(`tailLimitVerdict: the cap is a finite number above 0, not ${aaCap}.`);
  if (!Number.isSafeInteger(minimum) || minimum < 1) throw new RangeError(`tailLimitVerdict: the minimum is a whole number of 1 or more, not ${minimum}.`);
  const aaTails = caseTails(aa, rank).filter((c) => c.tail !== undefined);
  const aaTail = aaTails.length < minimum ? undefined : largestTail(aaTails);
  const tails = new Map(caseTails(candidate, rank).map((c) => [c.case, c]));
  const facts = { aaTail, aaCap, rank };
  const cases = caseRatios(candidate).map((c): CaseTailLimit => {
    const { tail } = tails.get(c.case) ?? { tail: undefined };
    const limit = limitOf(options, c.case);
    if (aaTail === undefined || aaTail > aaCap) return { case: c.case, tail, rounds: c.rounds, ratio: c.ratio, limit, overMedian: false, overTail: false, outcome: "cannot decide" };
    const overMedian = c.ratio > limit.median;
    const overTail = tail !== undefined && tail > limit.tail && tail > aaTail;
    const outcome: LimitOutcome = overMedian || overTail ? "beyond" : tail === undefined ? "cannot decide" : "within";
    return { case: c.case, tail, rounds: c.rounds, ratio: c.ratio, limit, overMedian, overTail, outcome };
  });
  if (aaTail === undefined) return { ...facts, outcome: "cannot decide", cases, reason: `The A/A arm has ${aaTails.length} cases with a tail, and the verdict needs ${minimum} or more.` };
  if (aaTail > aaCap) return { ...facts, outcome: "cannot decide", cases, reason: `The largest tail ${round(aaTail)} of the A/A arm is over the cap ${aaCap}, so this run has no power.` };
  if (cases.length === 0) return { ...facts, outcome: "cannot decide", cases, reason: "The candidate has no cases." };
  const beyond = cases.filter((c) => c.outcome === "beyond");
  if (beyond.length > 0) return { ...facts, outcome: "beyond", cases, reason: `${beyond.length} of ${cases.length} cases are over a limit. The first is ${JSON.stringify(beyond[0]!.case)}.` };
  const open = cases.filter((c) => c.outcome === "cannot decide");
  if (open.length > 0) return { ...facts, outcome: "cannot decide", cases, reason: `${open.length} of ${cases.length} cases have too few rounds for the rank ${rank}. The first is ${JSON.stringify(open[0]!.case)}.` };
  return { ...facts, outcome: "within", cases, reason: `Each of the ${cases.length} cases is at most its limits, or its tail is at most the tail ${round(aaTail)} of the A/A arm.` };
}

/**
 * This function applies the rule of `tailLimitVerdict` to each case of the A/A arm, and gives the cases that fail. Each
 * case reads the tail of the other cases, because a case cannot be the noise of itself. An arm with one case gives no
 * case. A case with a limit under 1 fails by that limit, so a caller states those cases apart.
 */
export function tailFalseFails(aa: readonly PairedTime[], options: TailRuleOptions): string[] {
  const rank = options.rank ?? 2;
  const tails = caseTails(aa, rank);
  const ratios = new Map(caseRatios(aa).map((c) => [c.case, c.ratio]));
  return tails
    .filter((c) => {
      const others = largestTail(tails.filter((other) => other !== c));
      if (others === undefined) return false;
      const limit = limitOf(options, c.case);
      return (ratios.get(c.case) ?? 0) > limit.median || (c.tail !== undefined && c.tail > limit.tail && c.tail > others);
    })
    .map((c) => c.case);
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
