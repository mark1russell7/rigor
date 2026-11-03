/**
 * The merge of the records of many jobs, and the pooled verdict over them. Each job of a bench gives its own records.
 * The pooled verdict uses all jobs together, and the verdict of each job alone guards it.
 */
import { type Arm, type PairedTime } from "./paired.ts";
import { type TimeOutcome, type TimeVerdict, type VerdictOptions, timeVerdict } from "./verdict.ts";

/** The records of each case with a turned order, and the count of the records that the balance removed. */
export interface Balanced<T extends PairedTime> {
  readonly records: T[];
  /** The count of the removed records. It is 0 when each case has a turned order. */
  readonly trimmed: number;
}

/**
 * This function removes records until the two orders of each case differ in count by 1 or less.
 * It removes the records of the larger order with the highest rounds first. The other records keep their order.
 * A job that stopped early, or a missing job, can leave a case with 2 more rounds of one order. `caseRatios` refuses such a case.
 */
export function balanceOrders<T extends PairedTime>(records: readonly T[]): Balanced<T> {
  const byCase = new Map<string, Record<Arm, number[]>>();
  records.forEach((record, index) => {
    const orders = byCase.get(record.case) ?? { a: [], b: [] };
    orders[record.first === "b" ? "b" : "a"].push(index);
    byCase.set(record.case, orders);
  });
  const drop = new Set<number>();
  const highFirst = (x: number, y: number): number => records[y]!.round - records[x]!.round;
  for (const { a, b } of byCase.values()) {
    const [more, fewer] = a.length > b.length ? [a, b] : [b, a];
    const extra = more.length - fewer.length - 1;
    if (extra > 0) for (const index of more.toSorted(highFirst).slice(0, extra)) drop.add(index);
  }
  return { records: records.filter((_, index) => !drop.has(index)), trimmed: drop.size };
}

/** The records of one job: the candidate pair and the A/A pair. */
export interface JobRecords {
  /** The label of the job, for example the index of its CI job. */
  readonly job: string;
  readonly candidate: readonly PairedTime[];
  readonly aa: readonly PairedTime[];
}

/** The verdict of one job alone. */
export interface JobVerdict {
  readonly job: string;
  readonly verdict: TimeVerdict;
}

/** The pooled verdict over the jobs, with the verdict of each job alone. */
export interface PooledVerdict {
  /** The outcome of the pooled verdict, or `cannot decide` when a job decides the opposite direction. */
  readonly outcome: TimeOutcome;
  /** The verdict of the merged and balanced records of all jobs. */
  readonly pooled: TimeVerdict;
  /** The verdict of each job alone, with the options of the pooled verdict. */
  readonly jobs: readonly JobVerdict[];
  /** The jobs whose own outcome is the opposite direction of the pooled outcome. */
  readonly opposed: string[];
  /** The count of the records that `balanceOrders` removed from the merged candidate and A/A records. */
  readonly trimmed: number;
  /** The reason of the pooled verdict, and the opposed jobs. */
  readonly reason: string;
}

const opposite: Partial<Record<TimeOutcome, TimeOutcome>> = { faster: "slower", slower: "faster" };

/**
 * This function gives the time verdict over the records of all jobs.
 * - It merges the records of the jobs, and it balances the merged candidate and A/A records with `balanceOrders`.
 * - The verdict of each job alone uses the same options. A job with `cannot decide` or `same` does not change the outcome.
 * - A job that decides the opposite direction of the pooled outcome makes the outcome `cannot decide`.
 * - It refuses two jobs with one label, and two jobs with a record of one case and one round.
 */
export function pooledVerdict(jobs: readonly JobRecords[], options: VerdictOptions = {}): PooledVerdict {
  const labels = new Set<string>();
  for (const { job } of jobs) {
    if (labels.has(job)) throw new RangeError(`pooledVerdict: two jobs have the label ${JSON.stringify(job)}.`);
    labels.add(job);
  }
  uniqueRounds(jobs, "candidate");
  uniqueRounds(jobs, "aa");
  const candidate = balanceOrders(jobs.flatMap((j) => j.candidate));
  const aa = balanceOrders(jobs.flatMap((j) => j.aa));
  const pooled = timeVerdict(candidate.records, aa.records, options);
  const each = jobs.map(({ job, candidate: c, aa: a }): JobVerdict => ({ job, verdict: timeVerdict(balanceOrders(c).records, balanceOrders(a).records, options) }));
  const against = opposite[pooled.outcome];
  const opposed = against === undefined ? [] : each.filter((j) => j.verdict.outcome === against).map((j) => j.job);
  const trimmed = candidate.trimmed + aa.trimmed;
  if (opposed.length === 0) return { outcome: pooled.outcome, pooled, jobs: each, opposed, trimmed, reason: pooled.reason };
  const names = opposed.map((j) => JSON.stringify(j)).join(", ");
  const reason = `${pooled.reason} The pooled outcome is "${pooled.outcome}", but the jobs ${names} give "${against}". Thus the outcome is "cannot decide".`;
  return { outcome: "cannot decide", pooled, jobs: each, opposed, trimmed, reason };
}

/** This function refuses two jobs with a record of one case and one round in one pair. */
function uniqueRounds(jobs: readonly JobRecords[], pair: "candidate" | "aa"): void {
  const seen = new Map<string, string>();
  for (const { job, [pair]: records } of jobs) {
    for (const r of records) {
      const key = `${r.case}\u0000${r.round}`;
      const other = seen.get(key);
      if (other !== undefined && other !== job) {
        throw new RangeError(
          `pooledVerdict: the jobs ${JSON.stringify(other)} and ${JSON.stringify(job)} both have the round ${r.round} of the case ${JSON.stringify(r.case)} in the ${pair} pair. Set roundOffset of each job to job * rounds.`,
        );
      }
      seen.set(key, job);
    }
  }
}

/** The pairs of a run: the records of each pair, by the id of the pair. */
export interface RunPairs {
  readonly pairs: Readonly<Record<string, readonly PairedTime[]>>;
}

/**
 * This function gives the verdict of each candidate pair of a run against its A/A pair `aaPair`.
 * It balances the records of each pair with `balanceOrders` first. It refuses an `aaPair` that the run does not have.
 */
export function armVerdicts(run: RunPairs, aaPair: string, options: VerdictOptions = {}): Record<string, TimeVerdict> {
  const aaRecords = run.pairs[aaPair];
  if (aaRecords === undefined) throw new RangeError(`armVerdicts: the run has no pair ${JSON.stringify(aaPair)}.`);
  const aa = balanceOrders(aaRecords).records;
  const out: Record<string, TimeVerdict> = {};
  for (const [pair, records] of Object.entries(run.pairs)) {
    if (pair !== aaPair) out[pair] = timeVerdict(balanceOrders(records).records, aa, options);
  }
  return out;
}
