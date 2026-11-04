/**
 * The budget verdict of one build: is the median of a measure of each case at most an absolute limit? For example, the
 * claim "the median blocking time of this page is at most 450 ms" needs it. The time verdict and the limit verdict judge
 * a ratio of two arms, so they cannot use a value of 0, and their A/A band is a ratio.
 */
import { median, medianInterval } from "@mark1russell7/rigor-statistics";

/** One value of one build on one case. The value is finite and 0 or more. */
export interface BudgetRound {
  /** The name of the case: one input of the bench. */
  readonly case: string;
  /** The number of the round, a whole number of 0 or more. */
  readonly round: number;
  readonly value: number;
}

/** The three outcomes of a budget verdict. */
export type BudgetOutcome = "within" | "beyond" | "cannot decide";

/** The options of a budget verdict. */
export interface BudgetOptions {
  /** The largest median that the claim permits, in the unit of the values. */
  readonly limit: number;
  /** The largest difference between the medians of the two arms of the same build. A larger difference makes the run too noisy. */
  readonly maxDifference: number;
  /** The level of the interval of each median. The default is 0.95, which needs 6 rounds or more in each arm. */
  readonly caseLevel?: number;
}

/** The verdict of one case against the budget. */
export interface CaseBudget {
  readonly case: string;
  /** The number of rounds of the case. */
  readonly rounds: number;
  /** The number of rounds of the case in the A/A arm. */
  readonly aaRounds: number;
  readonly median: number;
  /** The median of the A/A arm, or undefined when the A/A arm does not have the case. */
  readonly aaMedian: number | undefined;
  /** The size of the difference between the two medians, or undefined when the A/A arm does not have the case. */
  readonly difference: number | undefined;
  /** The ends of the distribution-free interval of the median. */
  readonly low: number;
  readonly high: number;
  /** The coverage of the interval. Below the level, the case has too few rounds. */
  readonly coverage: number;
  readonly outcome: BudgetOutcome;
  /** The reason of the outcome, in one sentence, with the limit, the medians, the difference and the rounds. */
  readonly reason: string;
}

/** A budget verdict, with the facts that it uses. */
export interface BudgetVerdict {
  readonly outcome: BudgetOutcome;
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
  readonly limit: number;
  readonly maxDifference: number;
  readonly level: number;
  readonly cases: readonly CaseBudget[];
}

/** This function gives the values of each case, and it refuses a value out of range or a round that comes twice. */
function valuesOfCases(name: string, rounds: readonly BudgetRound[]): Map<string, number[]> {
  const seen = new Set<string>();
  const out = new Map<string, number[]>();
  for (const r of rounds) {
    if (!(Number.isFinite(r.value) && r.value >= 0)) throw new RangeError(`budgetVerdict: the value of ${JSON.stringify(r.case)} in ${name} is finite and 0 or more, not ${r.value}.`);
    const key = JSON.stringify([r.case, r.round]);
    if (seen.has(key)) throw new RangeError(`budgetVerdict: the round ${r.round} of ${JSON.stringify(r.case)} comes twice in ${name}.`);
    seen.add(key);
    out.set(r.case, [...(out.get(r.case) ?? []), r.value]);
  }
  return out;
}

/** This function gives the verdict of one case. */
function caseBudget(name: string, values: readonly number[], aaValues: readonly number[], options: BudgetOptions, level: number): CaseBudget {
  const { limit, maxDifference } = options;
  const interval = medianInterval(values, level);
  const middle = median(values);
  const aaMedian = aaValues.length > 0 ? median(aaValues) : undefined;
  const difference = aaMedian === undefined ? undefined : Math.abs(middle - aaMedian);
  const aaCoverage = aaValues.length > 0 ? medianInterval(aaValues, level).coverage : 0;
  const facts = `median ${round(middle)} of ${values.length} rounds, interval ${round(interval.low)} to ${round(interval.high)}, limit ${limit}, A/A median ${aaMedian === undefined ? "none" : round(aaMedian)} of ${aaValues.length} rounds, difference ${difference === undefined ? "none" : round(difference)}`;
  const decide = (outcome: BudgetOutcome, why: string): CaseBudget => ({
    case: name,
    rounds: values.length,
    aaRounds: aaValues.length,
    median: middle,
    aaMedian,
    difference,
    low: interval.low,
    high: interval.high,
    coverage: interval.coverage,
    outcome,
    reason: `The case ${JSON.stringify(name)} has the outcome "${outcome}": ${why} (${facts}).`,
  });
  if (difference === undefined) return decide("cannot decide", "the A/A arm does not have the case");
  if (interval.coverage < level || aaCoverage < level) return decide("cannot decide", `an arm has too few rounds for the level ${level}`);
  if (difference > maxDifference) return decide("cannot decide", `the A/A difference is above ${maxDifference}`);
  if (interval.high <= limit) return decide("within", "the interval is at or below the limit");
  if (interval.low > limit) return decide("beyond", "the interval is above the limit");
  return decide("cannot decide", "the interval holds the limit");
}

/**
 * This function gives the verdict of the claim "the median of each case is at most `limit`". The arm `aa` is a second
 * arm of the same build, and it shows the noise of the run as a difference. Values of 0 are valid.
 * - A case is `cannot decide` when the A/A arm does not have it, when an arm has too few rounds for the level, or when
 *   the medians of the two arms differ by more than `maxDifference`.
 * - Else a case is `within` when the high end of its interval is at most the limit, and `beyond` when the low end is above it.
 * - The verdict is `beyond` when a case is `beyond`, and `within` when each case is `within`.
 * - Each other verdict is `cannot decide`, and so is a verdict with no cases.
 */
export function budgetVerdict(rounds: readonly BudgetRound[], aa: readonly BudgetRound[], options: BudgetOptions): BudgetVerdict {
  const { limit, maxDifference } = options;
  const level = options.caseLevel ?? 0.95;
  if (!(limit >= 0 && Number.isFinite(limit))) throw new RangeError(`budgetVerdict: the limit is finite and 0 or more, not ${limit}.`);
  if (!(maxDifference >= 0 && Number.isFinite(maxDifference))) throw new RangeError(`budgetVerdict: the largest difference is finite and 0 or more, not ${maxDifference}.`);
  const values = valuesOfCases("the rounds", rounds);
  const aaValues = valuesOfCases("the A/A arm", aa);
  const cases = [...values.keys()].sort().map((name) => caseBudget(name, values.get(name) ?? [], aaValues.get(name) ?? [], options, level));
  const facts = { limit, maxDifference, level, cases };
  if (cases.length === 0) return { outcome: "cannot decide", reason: "The verdict has no cases.", ...facts };
  const first = cases.find((c) => c.outcome === "beyond") ?? cases.find((c) => c.outcome === "cannot decide");
  if (first === undefined) {
    const top = cases.reduce((a, b) => (b.high > a.high ? b : a));
    return { outcome: "within", reason: `Each of the ${cases.length} cases is within. The largest is this one: ${top.reason}`, ...facts };
  }
  const count = cases.filter((c) => c.outcome === first.outcome).length;
  return { outcome: first.outcome, reason: `${count} of ${cases.length} cases have this outcome. The first is this one: ${first.reason}`, ...facts };
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
