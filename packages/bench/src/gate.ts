/**
 * The gate of a bench: the result that a check of a merge reads. A verdict gives one of the words of `LimitOutcome` for each
 * case, and the gate gives "pass", "block" or "no read". A case with no outcome does not pass.
 */
import { holm, median, partialConjunction, signTest } from "@mark1russell7/rigor-statistics";
import type { BudgetMore } from "./budget.ts";
import type { LimitOutcome } from "./limit.ts";
import type { JobRecords } from "./merge.ts";
import { type Arm, type PairedTime, checkPairedTime } from "./paired.ts";

/** The three results of a gate. */
export type GateOutcome = "pass" | "block" | "no read";

/** The fields of a case that a gate reads. The cases of `limitVerdict`, `budgetVerdict` and the verdict of this file have them. */
export interface GateCaseOutcome {
  readonly case: string;
  readonly outcome: LimitOutcome;
}

/** The result of a gate, with the cases that make it. */
export interface Gate {
  readonly outcome: GateOutcome;
  /** The reason of the result, in one sentence. */
  readonly reason: string;
  /** The cases with the outcome `beyond`. */
  readonly blocks: readonly string[];
  /** The cases with the outcome `cannot decide`. */
  readonly noRead: readonly string[];
}

/**
 * This function gives the gate of a list of case outcomes.
 * - The result is "block" when a case is `beyond`.
 * - The result is "pass" when each case is `within`.
 * - Each other result is "no read", and so is a list with no cases. A caller does not count "no read" as a pass.
 */
export function gateOf(cases: readonly GateCaseOutcome[]): Gate {
  const names = (outcome: LimitOutcome): string[] => cases.filter((c) => c.outcome === outcome).map((c) => c.case);
  const blocks = names("beyond");
  const noRead = names("cannot decide");
  if (cases.length === 0) return { outcome: "no read", reason: "The gate has no cases.", blocks, noRead };
  if (blocks.length > 0) return { outcome: "block", reason: `${blocks.length} of ${cases.length} cases are beyond the claim. The first is ${JSON.stringify(blocks[0])}.`, blocks, noRead };
  if (noRead.length > 0) return { outcome: "no read", reason: `${noRead.length} of ${cases.length} cases have no outcome. The first is ${JSON.stringify(noRead[0])}.`, blocks, noRead };
  return { outcome: "pass", reason: `Each of the ${cases.length} cases is within the claim.`, blocks, noRead };
}

/** The word of a case for the claim "not slower by more than the margin". The word "not slower" is apart from `same` of `timeVerdict`. */
export type NotSlowerRead = "not slower" | "slower" | "no read";

const READ_OF: Record<LimitOutcome, NotSlowerRead> = { within: "not slower", beyond: "slower", "cannot decide": "no read" };

/** The looks of `notSlowerVerdict`: the rounds in each job. The level of the family has an equal share at each look. */
export const GATE_LOOKS: readonly number[] = [12, 24, 48];

/** The options of `notSlowerVerdict`. */
export interface NotSlowerOptions {
  /** The margin of each case on a log scale: a number, or a function of the name of the case. */
  readonly margin: number | ((name: string) => number);
  /** The chance of a false "not slower", and apart from it the chance of a false "slower", over the family and all looks. The default is 0.05. */
  readonly level?: number;
  /** The looks: even whole numbers in rising order. The default is `GATE_LOOKS`. */
  readonly looks?: readonly number[];
  /** The count of jobs that each need the bound. The default is 2, because more rounds do not remove a difference between jobs. */
  readonly jobs?: number;
}

/** The read of one case in one job, at one look. */
export interface GateJobRead {
  readonly job: string;
  /** The pairs of rounds that the look uses. Below the rounds of the look, the job has not reached the look. */
  readonly rounds: number;
  /** The count of pairs with a difference below the margin. */
  readonly below: number;
  /** The count of pairs with a difference above the margin. */
  readonly above: number;
  /** The one-sided p of the sign test of the claim "the median difference is below the margin". */
  readonly notSlower: number;
  /** The one-sided p of the sign test of the claim "the median difference is above the margin". */
  readonly slower: number;
  /** The median of the differences, or undefined when the job has not reached the look. */
  readonly centre: number | undefined;
}

/** The verdict of one case. */
export interface CaseGate extends GateCaseOutcome {
  readonly read: NotSlowerRead;
  readonly margin: number;
  /** The rounds of the look that decides the case, or undefined when the case has no outcome. */
  readonly look: number | undefined;
  /** The reads of each job, at the look that decides the case, or else at the last look that a job reached. */
  readonly jobs: readonly GateJobRead[];
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
}

/** The gate of the claim "not slower by more than the margin", with the facts that it uses. */
export interface NotSlowerVerdict extends Gate {
  readonly level: number;
  readonly looks: readonly number[];
  /** The count of jobs that each need the bound. */
  readonly need: number;
  readonly cases: readonly CaseGate[];
  /** The cases with no outcome that can have another look. The list is empty when the verdict is final. */
  readonly more: readonly BudgetMore[];
}

/** This function examines the options. */
function checkOptions(level: number, looks: readonly number[], need: number): void {
  if (!(level > 0 && level < 1)) throw new RangeError(`notSlowerVerdict: the level is above 0 and below 1, not ${level}.`);
  if (looks.length === 0) throw new RangeError("notSlowerVerdict: the list of looks is empty.");
  let last = 0;
  for (const rounds of looks) {
    if (!(Number.isInteger(rounds) && rounds > last && rounds % 2 === 0)) throw new RangeError(`notSlowerVerdict: the looks are even whole numbers in rising order, not ${rounds} after ${last}.`);
    last = rounds;
  }
  if (!(Number.isInteger(need) && need >= 1)) throw new RangeError(`notSlowerVerdict: the count of jobs is a whole number of 1 or more, not ${need}.`);
}

/** This function gives the records of one case of one job in the order of the rounds. It refuses a round that comes twice. */
function casesOf(records: readonly PairedTime[]): Map<string, PairedTime[]> {
  const out = new Map<string, PairedTime[]>();
  for (const record of records) {
    checkPairedTime(record);
    const list = out.get(record.case) ?? [];
    if (list.some((r) => r.round === record.round)) throw new RangeError(`notSlowerVerdict: the round ${record.round} of ${JSON.stringify(record.case)} comes twice.`);
    list.push(record);
    out.set(record.case, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.round - b.round);
  return out;
}

/**
 * This function gives the differences of the first `rounds` rounds: log(b / a) of the candidate minus log(b / a) of the A/A arm.
 * A pair has two records with the same first arm, because a difference of two orders holds the effect of the order.
 */
function differences(candidate: readonly PairedTime[], aa: readonly PairedTime[], rounds: number): number[] {
  const out: number[] = [];
  const ofOrder = (list: readonly PairedTime[], first: Arm): PairedTime[] => list.slice(0, rounds).filter((r) => r.first === first);
  for (const first of ["a", "b"] as const) {
    const left = ofOrder(candidate, first);
    const right = ofOrder(aa, first);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const c = left[i] as PairedTime;
      const a = right[i] as PairedTime;
      out.push(Math.log(c.b / c.a) - Math.log(a.b / a.a));
    }
  }
  return out;
}

/** This function gives the read of one job. A job that has not reached the look gives a p of 1 in both directions. */
function jobRead(job: string, diffs: readonly number[], margin: number, rounds: number): GateJobRead {
  if (diffs.length < rounds) return { job, rounds: diffs.length, below: 0, above: 0, notSlower: 1, slower: 1, centre: undefined };
  const below = diffs.filter((d) => d < margin).length;
  const above = diffs.filter((d) => d > margin).length;
  // A difference equal to the margin counts against each claim.
  return { job, rounds: diffs.length, below, above, notSlower: signTest(below, diffs.length - below), slower: signTest(above, diffs.length - above), centre: median(diffs) };
}

/** This function gives the words of the facts of one job, for a reason. */
function jobFacts(read: GateJobRead): string {
  if (read.centre === undefined) return `job ${read.job} has ${read.rounds} pairs`;
  return `job ${read.job} has ${read.below} of ${read.rounds} pairs below the margin, centre ${Math.round(read.centre * 100_000) / 1000} %`;
}

/**
 * This function gives the gate of the claim "the candidate is not slower than the A/A arm by more than the margin" for each
 * case. A one-sided bound answers the claim. Thus a case with its whole interval under the margin reads "not slower", also
 * when its interval holds 1.
 *
 * - In each job, the sign test compares the median of the differences with the margin. It uses no random numbers.
 * - A case reads in `jobs` jobs or more: `partialConjunction` joins the p of each job, with no condition on how they depend.
 * - The level is for the family. Each look has `level / looks` of it, and `holm` corrects each look over all cases.
 * - The first look with an outcome decides a case. Later rounds do not change it. Each look uses the first rounds of a job.
 * - The result is "block" when a case reads "slower", and "pass" when each case reads "not slower".
 * - Each other result is "no read". The field `more` gives the next look of each case. After the last look, the caller adds jobs.
 *
 * The level needs independent rounds. Rounds with a shared cause, for example a slow computer for one job, do not have it.
 * A job that a caller adds after the last look is one more look, and the level does not count it.
 */
export function notSlowerVerdict(jobs: readonly JobRecords[], options: NotSlowerOptions): NotSlowerVerdict {
  const level = options.level ?? 0.05;
  const looks = options.looks ?? GATE_LOOKS;
  const need = options.jobs ?? 2;
  checkOptions(level, looks, need);
  const marginOf = (name: string): number => {
    const margin = typeof options.margin === "number" ? options.margin : options.margin(name);
    if (!(margin >= 0 && Number.isFinite(margin))) throw new RangeError(`notSlowerVerdict: the margin of ${JSON.stringify(name)} is finite and 0 or more, not ${margin}.`);
    return margin;
  };
  const records = jobs.map((job) => ({ job: job.job, candidate: casesOf(job.candidate), aa: casesOf(job.aa) }));
  const names = [...new Set(records.flatMap((job) => [...job.candidate.keys()]))].sort();
  const margins = names.map(marginOf);
  const decided = new Map<string, { outcome: LimitOutcome; look: number; reads: readonly GateJobRead[] }>();
  const reached = new Map<string, readonly GateJobRead[]>();
  const each = level / looks.length;
  for (const rounds of looks) {
    const reads = names.map((name, i) => records.map((job) => jobRead(job.job, differences(job.candidate.get(name) ?? [], job.aa.get(name) ?? [], rounds), margins[i] as number, rounds)));
    const joined = (pick: (read: GateJobRead) => number): number[] => reads.map((list) => (list.length < need ? 1 : partialConjunction(list.map(pick), need)));
    const within = holm(joined((read) => read.notSlower), each);
    const beyond = holm(joined((read) => read.slower), each);
    names.forEach((name, i) => {
      const list = reads[i] as GateJobRead[];
      if (!reached.has(name) || list.some((read) => read.rounds >= rounds)) reached.set(name, list);
      if (decided.has(name)) return;
      if (within[i]?.reject === true) decided.set(name, { outcome: "within", look: rounds, reads: list });
      else if (beyond[i]?.reject === true) decided.set(name, { outcome: "beyond", look: rounds, reads: list });
    });
  }
  const cases = names.map((name, i): CaseGate => {
    const decision = decided.get(name);
    const outcome = decision?.outcome ?? "cannot decide";
    const reads = decision?.reads ?? reached.get(name) ?? [];
    const facts = reads.map(jobFacts).join(", ");
    const where = decision === undefined ? `no look of ${looks.join(", ")} rounds decides it` : `the look of ${decision.look} rounds decides it`;
    return { case: name, outcome, read: READ_OF[outcome], margin: margins[i] as number, look: decision?.look, jobs: reads, reason: `The case ${JSON.stringify(name)} reads "${READ_OF[outcome]}": ${where} (${facts}).` };
  });
  const more = cases.flatMap((c): BudgetMore[] => {
    if (c.outcome !== "cannot decide") return [];
    const next = looks.find((rounds) => records.some((job) => differences(job.candidate.get(c.case) ?? [], job.aa.get(c.case) ?? [], rounds).length < rounds));
    return next === undefined ? [] : [{ case: c.case, rounds: next }];
  });
  return { ...gateOf(cases), level, looks, need, cases, more };
}
