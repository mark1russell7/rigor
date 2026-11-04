/**
 * The scale ladder of a product, as data. A ladder has rungs at sizes that grow, for example 1, 10 and 100 tenants. Each
 * rung has budgets, and it names the test that holds it. A rung is held only when a record of that test shows each budget
 * `within`. A number in a document is not a rung.
 */
import { quantile, quantileInterval, quantileSamples, wilson } from "@mark1russell7/rigor-statistics";
import { type BudgetOutcome, type BudgetRound, budgetVerdict } from "./budget.ts";

/** The format name of a ladder. It changes when a reader of an older form cannot read the data. */
export const LADDER_FORMAT = "rigor-ladder/1";

/** One dimension of a ladder, for example tenants or nodes. */
export interface LadderDimension {
  readonly name: string;
  /** What one unit of the dimension is, in plain words. */
  readonly describe: string;
}

/** A budget on the median of each case, for example the time of a read. A record gives rounds and an A/A arm. */
export interface MedianBudget {
  readonly kind: "median";
  readonly measure: string;
  /** The unit of the limit and of the values. */
  readonly unit: string;
  /** The largest median that the budget permits. */
  readonly limit: number;
  /** The largest difference between the medians of the two arms. A larger difference makes the run too noisy. */
  readonly maxDifference: number;
  /** The level of the interval of each median. The default is 0.95. */
  readonly caseLevel?: number;
}

/** A budget on the share of failed trials, for example failed requests. A record gives failures and trials. */
export interface RateBudget {
  readonly kind: "rate";
  readonly measure: string;
  /** The largest share of failures that the budget permits, from 0 to 1. */
  readonly limit: number;
}

/** A budget on the largest value of a set of drills, for example the writes that a restore lost. One bad drill is `beyond`. */
export interface WorstBudget {
  readonly kind: "worst";
  readonly measure: string;
  readonly unit: string;
  /** The largest value that the budget permits in any drill. */
  readonly limit: number;
  /** The number of drills that a verdict needs, 1 or more. With fewer, the budget is `cannot decide`. */
  readonly minDrills: number;
}

/**
 * A budget on a high quantile, for example the p99 of a read. A record gives the values. The verdict is the distribution-free
 * interval of the quantile against the limit. A p99 needs 368 independent values at the level 0.95: refer to `quantileSamples`.
 * Successive times of one run can follow each other. Space them apart, or give one value for each run.
 *
 * The evidence can also hold `censored`: a lower bound for each arrival with no reply, and for each arrival that was not
 * sent. The bound is the time that the arrival waited. The true value is that bound or more, with no upper limit. Thus the
 * low end of the interval reads the bounds, and the high end reads each censored value as `Infinity`. A `beyond` stays
 * provable from the bounds alone. A `within` needs real replies up to the upper rank of the interval.
 */
export interface QuantileBudget {
  readonly kind: "quantile";
  readonly measure: string;
  /** The unit of the limit and of the values. */
  readonly unit: string;
  /** The quantile, more than 0 and less than 1, for example 0.99. */
  readonly quantile: number;
  /** The largest quantile that the budget permits. */
  readonly limit: number;
  /** The level of the interval. The default is 0.95. */
  readonly level?: number;
}

/** One budget of a rung. */
export type RungBudget = MedianBudget | QuantileBudget | RateBudget | WorstBudget;

/** One rung of a ladder. */
export interface Rung {
  /** The name of the rung, unique in the ladder. */
  readonly name: string;
  /** The size of the rung in each dimension that it names. */
  readonly at: Readonly<Record<string, number>>;
  readonly budgets: readonly RungBudget[];
  /** The name of the automatic test that holds the rung. */
  readonly test: string;
  /** True when a gate holds the rung: the verdict fails when the rung is not `within`. */
  readonly locked?: boolean;
}

/** The ladder of one subject. The rungs go from the smallest to the largest. */
export interface Ladder {
  readonly format: typeof LADDER_FORMAT;
  /** The product or the service that the ladder is for. */
  readonly subject: string;
  readonly dimensions: readonly LadderDimension[];
  readonly rungs: readonly Rung[];
}

/** The measured evidence for one budget. Its `kind` is the kind of the budget. */
export type RungEvidence =
  | { readonly kind: "median"; readonly measure: string; readonly rounds: readonly BudgetRound[]; readonly aa: readonly BudgetRound[] }
  | { readonly kind: "quantile"; readonly measure: string; readonly values: readonly number[]; readonly censored?: readonly number[] }
  | { readonly kind: "rate"; readonly measure: string; readonly failures: number; readonly trials: number }
  | { readonly kind: "worst"; readonly measure: string; readonly values: readonly number[] };

/** One run of the test of a rung. */
export interface RungRecord {
  /** The name of the rung. */
  readonly rung: string;
  /** The commit that the run measured. */
  readonly commit: string;
  /** The time of the run, as an ISO 8601 string. */
  readonly at: string;
  /** What the run did for real, for example "2 processes" or "a restore from a real backup". */
  readonly real: readonly string[];
  /** What the run made up, for example "90 % of the tenants as data at rest". An empty list states that nothing was synthetic. */
  readonly synthetic: readonly string[];
  readonly evidence: readonly RungEvidence[];
}

/** The verdict of one budget of a rung. */
export interface BudgetResult {
  readonly measure: string;
  readonly outcome: BudgetOutcome;
  /** The reason of the outcome, in one sentence, with the numbers. */
  readonly reason: string;
}

/** The verdict of one rung. */
export interface RungVerdict {
  readonly rung: string;
  readonly test: string;
  readonly locked: boolean;
  readonly outcome: BudgetOutcome;
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
  readonly budgets: readonly BudgetResult[];
  /** The commit of the record, or undefined when the rung has no record. */
  readonly commit: string | undefined;
  readonly real: readonly string[];
  readonly synthetic: readonly string[];
}

/** The verdict of a ladder. */
export interface LadderVerdict {
  readonly subject: string;
  /** The highest rung with each rung up to it `within`, or undefined when the first rung is not `within`. */
  readonly held: string | undefined;
  /** The first rung that is not `within`, or undefined when each rung is `within`. */
  readonly next: string | undefined;
  /** True when a locked rung is not `within`. A rung with no result is not held, so `cannot decide` fails too. */
  readonly failed: boolean;
  /** The reason of `failed`, in one sentence. */
  readonly reason: string;
  readonly rungs: readonly RungVerdict[];
}

/** The options of a ladder verdict. */
export interface LadderOptions {
  /** The time of the verdict, as an ISO 8601 string. It is an input, so that a verdict is the same at each read. */
  readonly now: string;
  /** The largest age of a record, in days. An older record gives `cannot decide`. The default accepts any age. */
  readonly maxAgeDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** This function gives the problems of one budget. */
function budgetProblems(where: string, budget: RungBudget): string[] {
  const out: string[] = [];
  const name = `${where}, budget ${JSON.stringify(budget.measure)}`;
  if (budget.measure.trim() === "") out.push(`${where}: a budget has no measure.`);
  if (!(Number.isFinite(budget.limit) && budget.limit >= 0)) out.push(`${name}: the limit is finite and 0 or more, not ${budget.limit}.`);
  if (budget.kind === "rate" && budget.limit > 1) out.push(`${name}: a rate limit is at most 1, not ${budget.limit}.`);
  if (budget.kind === "median" && !(Number.isFinite(budget.maxDifference) && budget.maxDifference >= 0)) {
    out.push(`${name}: the largest difference is finite and 0 or more, not ${budget.maxDifference}.`);
  }
  if (budget.kind === "worst" && !(Number.isInteger(budget.minDrills) && budget.minDrills >= 1)) {
    out.push(`${name}: the number of drills is a whole number of 1 or more, not ${budget.minDrills}.`);
  }
  if (budget.kind === "quantile" && !(budget.quantile > 0 && budget.quantile < 1)) out.push(`${name}: a quantile is more than 0 and less than 1, not ${budget.quantile}.`);
  if (budget.kind === "quantile" && budget.level !== undefined && !(budget.level > 0 && budget.level < 1)) out.push(`${name}: a level is more than 0 and less than 1, not ${budget.level}.`);
  return out;
}

/** This function gives the problems of one rung, in the order of its fields. */
function rungProblems(rung: Rung, dimensions: ReadonlySet<string>): string[] {
  const where = `The rung ${JSON.stringify(rung.name)}`;
  const out: string[] = [];
  const names = Object.keys(rung.at);
  if (names.length === 0) out.push(`${where} names no dimension.`);
  for (const name of names) {
    if (!dimensions.has(name)) out.push(`${where} names the unknown dimension ${JSON.stringify(name)}.`);
    const size = rung.at[name];
    if (!(typeof size === "number" && Number.isFinite(size) && size > 0)) out.push(`${where}: the size of ${JSON.stringify(name)} is finite and above 0, not ${size}.`);
  }
  if (rung.test.trim() === "") out.push(`${where} names no test.`);
  if (rung.budgets.length === 0) out.push(`${where} has no budgets.`);
  const measures = new Set<string>();
  for (const budget of rung.budgets) {
    if (measures.has(budget.measure)) out.push(`${where} has two budgets of ${JSON.stringify(budget.measure)}.`);
    measures.add(budget.measure);
    out.push(...budgetProblems(where, budget));
  }
  return out;
}

/**
 * This function gives each problem of a ladder as data, or an empty list. A ladder needs a subject, one dimension or more,
 * and one rung or more. Names are unique. Each rung names a test and has budgets. From one rung to the next, each dimension
 * that the two rungs name grows.
 */
export function checkLadder(ladder: Ladder): readonly string[] {
  const out: string[] = [];
  if (ladder.format !== LADDER_FORMAT) out.push(`The format is ${JSON.stringify(LADDER_FORMAT)}, not ${JSON.stringify(ladder.format)}.`);
  if (ladder.subject.trim() === "") out.push("The ladder has no subject.");
  if (ladder.dimensions.length === 0) out.push("The ladder has no dimensions.");
  if (ladder.rungs.length === 0) out.push("The ladder has no rungs.");
  const dimensions = new Set(ladder.dimensions.map((d) => d.name));
  if (dimensions.size !== ladder.dimensions.length) out.push("Two dimensions have the same name.");
  if (new Set(ladder.rungs.map((r) => r.name)).size !== ladder.rungs.length) out.push("Two rungs have the same name.");
  ladder.rungs.forEach((rung, index) => {
    out.push(...rungProblems(rung, dimensions));
    const before = ladder.rungs[index - 1];
    if (before === undefined) return;
    for (const [name, size] of Object.entries(rung.at)) {
      const low = before.at[name];
      if (low !== undefined && !(size > low)) out.push(`The rung ${JSON.stringify(rung.name)}: ${JSON.stringify(name)} does not grow from ${low} to ${size}.`);
    }
  });
  return out;
}

/** This function gives the verdict of a rate: the Wilson interval at 95 % against the limit. */
function rateResult(budget: RateBudget, failures: number, trials: number): BudgetResult {
  const interval = wilson(failures, trials);
  const facts = `${failures} failures of ${trials} trials, interval ${interval.low} to ${interval.high}, limit ${budget.limit}`;
  const outcome: BudgetOutcome = trials === 0 ? "cannot decide" : interval.high <= budget.limit ? "within" : interval.low > budget.limit ? "beyond" : "cannot decide";
  return { measure: budget.measure, outcome, reason: `The measure ${JSON.stringify(budget.measure)} is "${outcome}" (${facts}).` };
}

/** This function gives the verdict of a set of drills: the largest value against the limit. */
function worstResult(budget: WorstBudget, values: readonly number[]): BudgetResult {
  const largest = values.length === 0 ? undefined : Math.max(...values);
  const facts = `${values.length} drills, the largest ${largest ?? "none"} ${budget.unit}, limit ${budget.limit}`;
  const outcome: BudgetOutcome = largest !== undefined && largest > budget.limit ? "beyond" : values.length < budget.minDrills ? "cannot decide" : "within";
  return { measure: budget.measure, outcome, reason: `The measure ${JSON.stringify(budget.measure)} is "${outcome}" (${facts}, ${budget.minDrills} drills needed).` };
}

/**
 * This function gives the verdict of a quantile: its distribution-free interval against the limit. With censored values, the
 * low end reads their bounds and the high end reads them as `Infinity`. Each true sample has its interval inside that one.
 */
function quantileResult(budget: QuantileBudget, values: readonly number[], censored: readonly number[]): BudgetResult {
  const level = budget.level ?? 0.95;
  const needed = quantileSamples(budget.quantile, level);
  const say = (outcome: BudgetOutcome, facts: string): BudgetResult => ({ measure: budget.measure, outcome, reason: `The measure ${JSON.stringify(budget.measure)} is "${outcome}" (${facts}, ${needed} values needed).` });
  const open = censored.length > 0;
  const bounds = [...values, ...censored];
  if (bounds.length === 0) return say("cannot decide", `0 values, limit ${budget.limit} ${budget.unit}`);
  if (values.some((value) => Number.isNaN(value))) return say("cannot decide", "the values have a NaN");
  if (!censored.every((value) => Number.isFinite(value))) return say("cannot decide", "a censored value is not a finite number");
  const lowest = quantileInterval(bounds, budget.quantile, level);
  const highest = open ? quantileInterval([...values, ...censored.map(() => Infinity)], budget.quantile, level) : lowest;
  const [count, point] = open ? [`${values.length} values and ${censored.length} censored`, "at least"] : [`${values.length} values`, "at"];
  const facts = `${count}, quantile ${budget.quantile} ${point} ${quantile(bounds, budget.quantile, "nearest-rank")} ${budget.unit}, interval ${lowest.low} to ${highest.high}, limit ${budget.limit}`;
  return say(highest.high <= budget.limit ? "within" : lowest.low > budget.limit ? "beyond" : "cannot decide", facts);
}

/** This function gives the verdict of one budget from the evidence of a record. */
function budgetResult(budget: RungBudget, evidence: readonly RungEvidence[]): BudgetResult {
  const found = evidence.find((e) => e.measure === budget.measure);
  const none = (why: string): BudgetResult => ({ measure: budget.measure, outcome: "cannot decide", reason: `The measure ${JSON.stringify(budget.measure)} is "cannot decide": ${why}.` });
  if (found === undefined) return none("the record has no evidence for it");
  if (budget.kind === "median" && found.kind === "median") {
    const v = budgetVerdict(found.rounds, found.aa, { limit: budget.limit, maxDifference: budget.maxDifference, ...(budget.caseLevel === undefined ? {} : { caseLevel: budget.caseLevel }) });
    return { measure: budget.measure, outcome: v.outcome, reason: v.reason };
  }
  if (budget.kind === "quantile" && found.kind === "quantile") return quantileResult(budget, found.values, found.censored ?? []);
  if (budget.kind === "rate" && found.kind === "rate") return rateResult(budget, found.failures, found.trials);
  if (budget.kind === "worst" && found.kind === "worst") return worstResult(budget, found.values);
  return none(`the budget is ${budget.kind}, and the evidence is ${found.kind}`);
}

/** This function gives the reason that a record cannot decide a rung, or undefined when the record can. */
function recordProblem(record: RungRecord, options: LadderOptions): string | undefined {
  if (record.real.length === 0) return "the record does not state what was real";
  const { maxAgeDays } = options;
  if (maxAgeDays === undefined) return undefined;
  const age = (Date.parse(options.now) - Date.parse(record.at)) / DAY_MS;
  if (!Number.isFinite(age)) return `a time does not parse: now ${options.now}, record ${record.at}`;
  return age > maxAgeDays ? `the record of ${record.at} is older than ${maxAgeDays} days` : undefined;
}

/** This function gives the outcome of a set of budgets: `beyond` first, then `cannot decide`, and `within` only when each budget is. */
function worstOutcome(results: readonly BudgetResult[]): BudgetOutcome {
  if (results.some((r) => r.outcome === "beyond")) return "beyond";
  return results.length > 0 && results.every((r) => r.outcome === "within") ? "within" : "cannot decide";
}

/** This function gives the verdict of one rung from its record. With no record, the rung is `cannot decide`. */
export function rungVerdict(rung: Rung, record: RungRecord | undefined, options: LadderOptions): RungVerdict {
  const base = { rung: rung.name, test: rung.test, locked: rung.locked === true };
  if (record === undefined) {
    return { ...base, outcome: "cannot decide", reason: `The rung ${JSON.stringify(rung.name)} has no record of the test ${JSON.stringify(rung.test)}.`, budgets: [], commit: undefined, real: [], synthetic: [] };
  }
  const facts = { commit: record.commit, real: record.real, synthetic: record.synthetic };
  const problem = recordProblem(record, options);
  if (problem !== undefined) return { ...base, ...facts, outcome: "cannot decide", reason: `The rung ${JSON.stringify(rung.name)} is "cannot decide": ${problem}.`, budgets: [] };
  const budgets = rung.budgets.map((b) => budgetResult(b, record.evidence));
  const outcome = worstOutcome(budgets);
  const first = budgets.find((b) => b.outcome === outcome);
  return { ...base, ...facts, outcome, reason: outcome === "within" ? `The ${budgets.length} budgets of the rung ${JSON.stringify(rung.name)} are within.` : `The rung ${JSON.stringify(rung.name)} is "${outcome}". ${first?.reason ?? ""}`, budgets };
}

/** This function gives the newest record of each rung. It keeps the first of two records with the same time. */
function newestRecords(records: readonly RungRecord[]): Map<string, RungRecord> {
  const out = new Map<string, RungRecord>();
  for (const record of records) {
    const old = out.get(record.rung);
    if (old === undefined || Date.parse(record.at) > Date.parse(old.at)) out.set(record.rung, record);
  }
  return out;
}

/**
 * This function gives the verdict of a ladder from the records of its rungs. It uses the newest record of each rung, so an
 * older pass does not hide a newer failure. A rung high up does not count when a rung below it is not `within`. It throws
 * a `RangeError` for a ladder with problems, because a verdict on a bad ladder has no meaning. See `checkLadder`.
 */
export function ladderVerdict(ladder: Ladder, records: readonly RungRecord[], options: LadderOptions): LadderVerdict {
  const problems = checkLadder(ladder);
  if (problems.length > 0) throw new RangeError(`ladderVerdict: ${problems.join(" ")}`);
  const newest = newestRecords(records);
  const rungs = ladder.rungs.map((r) => rungVerdict(r, newest.get(r.name), options));
  const firstOpen = rungs.findIndex((r) => r.outcome !== "within");
  const heldCount = firstOpen === -1 ? rungs.length : firstOpen;
  const lost = rungs.filter((r) => r.locked && r.outcome !== "within");
  const reason = lost.length === 0 ? `Each of the ${rungs.filter((r) => r.locked).length} locked rungs is within.` : `${lost.length} locked rungs are not within. ${lost[0]?.reason ?? ""}`;
  return { subject: ladder.subject, held: rungs[heldCount - 1]?.rung, next: rungs[heldCount]?.rung, failed: lost.length > 0, reason, rungs };
}
