/**
 * The budget verdict of one build: is the median of a measure of each case at most an absolute limit? An example is the
 * claim "the median blocking time of this page is at most 450 ms". The time verdict and the limit verdict judge a ratio
 * of two arms, so they cannot use a value of 0. Their A/A band is also a ratio.
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
 * - A case is `cannot decide` when the A/A arm does not have it, or when an arm has too few rounds for the level.
 * - A case is also `cannot decide` when the medians of the two arms differ by more than `maxDifference`.
 * - Other cases are `within` when the high end of the interval is at most the limit.
 * - They are `beyond` when the low end of the interval is above the limit.
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
  return verdictOf(cases, { limit, maxDifference, level });
}

/** This function gives the verdict of a list of case verdicts. */
function verdictOf(cases: readonly CaseBudget[], claim: Pick<BudgetVerdict, "limit" | "maxDifference" | "level">): BudgetVerdict {
  const facts = { ...claim, cases };
  if (cases.length === 0) return { outcome: "cannot decide", reason: "The verdict has no cases.", ...facts };
  const first = cases.find((c) => c.outcome === "beyond") ?? cases.find((c) => c.outcome === "cannot decide");
  if (first === undefined) {
    const top = cases.reduce((a, b) => (b.high > a.high ? b : a));
    return { outcome: "within", reason: `Each of the ${cases.length} cases is within. The largest is this one: ${top.reason}`, ...facts };
  }
  const count = cases.filter((c) => c.outcome === first.outcome).length;
  return { outcome: first.outcome, reason: `${count} of ${cases.length} cases have this outcome. The first is this one: ${first.reason}`, ...facts };
}

/** One look of a budget with looks: the rounds of each arm, and the level of the interval at those rounds. */
export interface BudgetLook {
  readonly rounds: number;
  readonly level: number;
}

/**
 * These looks start with 6 rounds, as `budgetVerdict` does, and they stop at 24. The three looks spend 0.0442 of the
 * overall 0.05. On the blocking times of a noisy web page, 97% of the runs with a median 16% under the limit stop by 24.
 */
export const BUDGET_LOOKS: readonly BudgetLook[] = [
  { rounds: 6, level: 0.95 },
  { rounds: 12, level: 0.99 },
  { rounds: 24, level: 0.99 },
];

/** The options of a budget verdict with looks. */
export interface BudgetLooksOptions {
  /** The largest median that the claim permits, in the unit of the values. */
  readonly limit: number;
  /** The largest difference between the medians of the two arms of the same build. */
  readonly maxDifference: number;
  /** The looks, with the rounds in rising order. The default is `BUDGET_LOOKS`. */
  readonly looks?: readonly BudgetLook[];
  /** The level over all looks of one case. The default is 0.95. */
  readonly level?: number;
}

/** The next look of one case: the rounds that each arm of the case needs. */
export interface BudgetMore {
  readonly case: string;
  readonly rounds: number;
}

/** A budget verdict with looks. The field `level` is the level over all looks. */
export interface BudgetLooksVerdict extends BudgetVerdict {
  /** The chance of error that the looks spend: the sum of 1 - coverage over the looks. */
  readonly spent: number;
  /** The cases with no outcome that can have another look. The list is empty when the verdict is final. */
  readonly more: readonly BudgetMore[];
  /** True only when the interval of a case is above the limit. A case with no outcome at the last look does not fail. */
  readonly fails: boolean;
}

/**
 * This function gives the chance of error that a list of looks spends: the sum of 1 - coverage of each look. This sum is
 * the Bonferroni bound over the looks. A look that has too few rounds for its level gives a `RangeError`.
 */
export function budgetLookSpend(looks: readonly BudgetLook[]): number {
  if (looks.length === 0) throw new RangeError("budgetLookSpend: the list of looks is empty.");
  let spent = 0;
  let last = 0;
  for (const { rounds, level } of looks) {
    if (!(Number.isInteger(rounds) && rounds > last)) throw new RangeError(`budgetLookSpend: the rounds of the looks are whole numbers in rising order, not ${rounds} after ${last}.`);
    const { coverage } = medianInterval(
      Array.from({ length: rounds }, (_, i) => i),
      level,
    );
    if (coverage < level) throw new RangeError(`budgetLookSpend: ${rounds} rounds are too few for the level ${level}.`);
    spent += 1 - coverage;
    last = rounds;
  }
  return spent;
}

/** This function gives the outcome of one case: the first look with an outcome, or the last look that the rounds reach. */
function caseAtLooks(name: string, values: readonly number[], aaValues: readonly number[], options: BudgetOptions, looks: readonly BudgetLook[]): { verdict: CaseBudget; next: number | undefined } {
  let verdict: CaseBudget | undefined;
  for (const { rounds, level } of looks) {
    if (values.length < rounds || aaValues.length < rounds) {
      return { verdict: verdict ?? caseBudget(name, values, aaValues, options, level), next: rounds };
    }
    verdict = caseBudget(name, values.slice(0, rounds), aaValues.slice(0, rounds), options, level);
    if (verdict.outcome !== "cannot decide") return { verdict, next: undefined };
  }
  return { verdict: verdict as CaseBudget, next: undefined };
}

/**
 * This function gives the budget verdict of a run that adds rounds. A caller gives all rounds so far, and it gets a
 * verdict and the field `more`. It adds the rounds of `more` to both arms, and it calls the function again.
 * - The first look of a case with an outcome decides the case. Later rounds do not change it.
 * - Each look reads the rounds of that look in the order of their numbers. Thus a verdict comes again from its records.
 * - A sum of `budgetLookSpend` above 1 - `level` gives a `RangeError`, because many looks at one level spend too much.
 * - The field `fails` is true only for the outcome `beyond`. Tell a final `cannot decide` to the reader of the run.
 */
export function budgetLooksVerdict(rounds: readonly BudgetRound[], aa: readonly BudgetRound[], options: BudgetLooksOptions): BudgetLooksVerdict {
  const { limit, maxDifference } = options;
  const looks = options.looks ?? BUDGET_LOOKS;
  const level = options.level ?? 0.95;
  const spent = budgetLookSpend(looks);
  if (spent > 1 - level) throw new RangeError(`budgetLooksVerdict: the looks spend ${round(spent)}, over the ${round(1 - level)} of the level ${level}.`);
  if (!(limit >= 0 && Number.isFinite(limit))) throw new RangeError(`budgetLooksVerdict: the limit is finite and 0 or more, not ${limit}.`);
  if (!(maxDifference >= 0 && Number.isFinite(maxDifference))) throw new RangeError(`budgetLooksVerdict: the largest difference is finite and 0 or more, not ${maxDifference}.`);
  const byRound = (list: readonly BudgetRound[]): BudgetRound[] => [...list].sort((a, b) => a.round - b.round);
  const values = valuesOfCases("the rounds", byRound(rounds));
  const aaValues = valuesOfCases("the A/A arm", byRound(aa));
  const results = [...values.keys()].sort().map((name) => ({ name, ...caseAtLooks(name, values.get(name) ?? [], aaValues.get(name) ?? [], { limit, maxDifference }, looks) }));
  const verdict = verdictOf(
    results.map((r) => r.verdict),
    { limit, maxDifference, level },
  );
  const more = results.flatMap((r) => (r.next === undefined ? [] : [{ case: r.name, rounds: r.next }]));
  return { ...verdict, spent, more, fails: verdict.cases.some((c) => c.outcome === "beyond") };
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
