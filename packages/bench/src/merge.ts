/**
 * The merge of the records of many jobs, and the pooled verdicts over them. Each job of a bench gives its own records.
 * A pooled verdict uses all jobs together, and the verdict of each job alone guards it.
 */
import { type LimitOptions, type LimitOutcome, type LimitVerdict, limitVerdict } from "./limit.ts";
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
  /** The label of the job, for example the index of its CI job. A record with a field `job` has this label, or `poolRecords` refuses it. */
  readonly job: string;
  readonly candidate: readonly PairedTime[];
  readonly aa: readonly PairedTime[];
  /** The cases that the job skipped, as `freshRun` gives them. `poolRecords` removes each of these cases from all jobs. */
  readonly skipped?: readonly { readonly case: string }[];
}

/** The records of one job in a pool: the cases that no job skipped, balanced with `balanceOrders`. */
export interface PooledJob {
  readonly job: string;
  readonly candidate: PairedTime[];
  readonly aa: PairedTime[];
}

/** The pool of the jobs: the merged records of all jobs, and the records of each job alone. */
export interface PooledRecords {
  /** The merged candidate records of all jobs, balanced with `balanceOrders`. */
  readonly candidate: PairedTime[];
  /** The merged A/A records of all jobs, balanced with `balanceOrders`. */
  readonly aa: PairedTime[];
  /** The records of each job alone, in the order of the jobs. */
  readonly jobs: readonly PooledJob[];
  /** The count of the records that `balanceOrders` removed from the merged candidate and A/A records. */
  readonly trimmed: number;
  /** The cases that a job skipped, in sorted order. The pool has no record of these cases. */
  readonly dropped: string[];
}

/**
 * This function gives the pool of the jobs. `pooledVerdict` and `pooledLimitVerdict` use it.
 * - It refuses two jobs with one label, a record with a different job label, and two jobs with a record of one case and one round.
 * - It removes each case that a job skipped from all jobs, so all jobs have the same cases.
 * - It merges the records of the jobs, and it balances the merged records and the records of each job with `balanceOrders`.
 */
export function poolRecords(jobs: readonly JobRecords[]): PooledRecords {
  return pool(jobs, "poolRecords");
}

/** The pool of `poolRecords`. Each error starts with the name `caller`. */
function pool(jobs: readonly JobRecords[], caller: string): PooledRecords {
  const labels = new Set<string>();
  for (const { job } of jobs) {
    if (labels.has(job)) throw new RangeError(`${caller}: two jobs have the label ${JSON.stringify(job)}.`);
    labels.add(job);
  }
  for (const { job, candidate: c, aa: a } of jobs) {
    for (const r of [...c, ...a] as readonly (PairedTime & { readonly job?: unknown })[]) {
      if (r.job !== undefined && r.job !== job) throw new RangeError(`${caller}: a record of the job ${JSON.stringify(job)} has the job ${JSON.stringify(r.job)}.`);
    }
  }
  const dropped = [...new Set(jobs.flatMap((j) => (j.skipped ?? []).map((s) => s.case)))].sort();
  const gone = new Set(dropped);
  const keep = (records: readonly PairedTime[]): PairedTime[] => records.filter((r) => !gone.has(r.case));
  const kept = jobs.map((j) => ({ job: j.job, candidate: keep(j.candidate), aa: keep(j.aa) }));
  uniqueRounds(kept, "candidate", caller);
  uniqueRounds(kept, "aa", caller);
  const candidate = balanceOrders(kept.flatMap((j) => j.candidate));
  const aa = balanceOrders(kept.flatMap((j) => j.aa));
  const each = kept.map(({ job, candidate: c, aa: a }): PooledJob => ({ job, candidate: balanceOrders(c).records, aa: balanceOrders(a).records }));
  return { candidate: candidate.records, aa: aa.records, jobs: each, trimmed: candidate.trimmed + aa.trimmed, dropped };
}

/** This function refuses two jobs with a record of one case and one round in one pair. */
function uniqueRounds(jobs: readonly PooledJob[], pair: "candidate" | "aa", caller: string): void {
  const seen = new Map<string, string>();
  for (const { job, [pair]: records } of jobs) {
    for (const r of records) {
      const key = `${r.case}\u0000${r.round}`;
      const other = seen.get(key);
      if (other !== undefined && other !== job) {
        throw new RangeError(
          `${caller}: the jobs ${JSON.stringify(other)} and ${JSON.stringify(job)} both have the round ${r.round} of the case ${JSON.stringify(r.case)} in the ${pair} pair. Set roundOffset of each job to job * rounds.`,
        );
      }
      seen.set(key, job);
    }
  }
}

/** The guard of a pooled verdict: the outcome, the opposed jobs and the reason. */
interface Guarded<O extends string> {
  readonly outcome: O | "cannot decide";
  readonly opposed: string[];
  readonly reason: string;
}

/**
 * This function applies the guard of the jobs to a pooled verdict. A job whose outcome is `opposite` of the pooled outcome
 * makes the outcome `cannot decide`. Each other job does not change the outcome.
 */
function guard<O extends string>(
  pooled: { readonly outcome: O; readonly reason: string },
  jobs: readonly { readonly job: string; readonly verdict: { readonly outcome: O } }[],
  opposite: Partial<Record<O, O>>,
): Guarded<O> {
  const against = opposite[pooled.outcome];
  const opposed = against === undefined ? [] : jobs.filter((j) => j.verdict.outcome === against).map((j) => j.job);
  if (opposed.length === 0) return { outcome: pooled.outcome, opposed, reason: pooled.reason };
  const names = opposed.map((j) => JSON.stringify(j)).join(", ");
  const reason = `${pooled.reason} The pooled outcome is "${pooled.outcome}", but the jobs ${names} give "${against}". Thus the outcome is "cannot decide".`;
  return { outcome: "cannot decide", opposed, reason };
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
  /** The cases that a job skipped, in sorted order. The verdicts use no record of these cases. */
  readonly dropped: string[];
  /** The reason of the pooled verdict, and the opposed jobs. */
  readonly reason: string;
}

const opposite: Partial<Record<TimeOutcome, TimeOutcome>> = { faster: "slower", slower: "faster" };

/**
 * This function gives the time verdict over the records of all jobs.
 * - It makes the pool of the jobs with `poolRecords`, and it gives the time verdict of the merged records.
 * - The verdict of each job alone uses the same options. A job with `cannot decide` or `same` does not change the outcome.
 * - A job that decides the opposite direction of the pooled outcome makes the outcome `cannot decide`.
 */
export function pooledVerdict(jobs: readonly JobRecords[], options: VerdictOptions = {}): PooledVerdict {
  const { candidate, aa, jobs: each, trimmed, dropped } = pool(jobs, "pooledVerdict");
  const pooled = timeVerdict(candidate, aa, options);
  const verdicts = each.map(({ job, candidate: c, aa: a }): JobVerdict => ({ job, verdict: timeVerdict(c, a, options) }));
  const { outcome, opposed, reason } = guard(pooled, verdicts, opposite);
  return { outcome, pooled, jobs: verdicts, opposed, trimmed, dropped, reason };
}

/** The limit verdict of one job alone. */
export interface JobLimitVerdict {
  readonly job: string;
  readonly verdict: LimitVerdict;
}

/** The pooled limit verdict over the jobs, with the limit verdict of each job alone. */
export interface PooledLimitVerdict {
  /** The outcome of the pooled limit verdict, or `cannot decide` when a job gives the opposite outcome. */
  readonly outcome: LimitOutcome;
  /** The limit verdict of the merged and balanced records of all jobs. */
  readonly pooled: LimitVerdict;
  /** The limit verdict of each job alone, with the options of the pooled verdict. */
  readonly jobs: readonly JobLimitVerdict[];
  /** The jobs whose own outcome is the opposite of the pooled outcome: `beyond` against `within`, or the reverse. */
  readonly opposed: string[];
  /** The count of the records that `balanceOrders` removed from the merged candidate and A/A records. */
  readonly trimmed: number;
  /** The cases that a job skipped, in sorted order. The verdicts use no record of these cases. */
  readonly dropped: string[];
  /** The reason of the pooled limit verdict, and the opposed jobs. */
  readonly reason: string;
}

const limitOpposite: Partial<Record<LimitOutcome, LimitOutcome>> = { within: "beyond", beyond: "within" };

/**
 * This function gives the limit verdict over the records of all jobs, for example for a speed gate on limits over a CI matrix.
 * - It makes the pool of the jobs with `poolRecords`, and it gives the limit verdict of the merged records.
 * - The verdict of each job alone uses the same options. A job with `cannot decide` does not change the outcome.
 * - A job with `beyond` against a pooled `within`, or the reverse, makes the outcome `cannot decide`.
 */
export function pooledLimitVerdict(jobs: readonly JobRecords[], options: LimitOptions): PooledLimitVerdict {
  const { candidate, aa, jobs: each, trimmed, dropped } = pool(jobs, "pooledLimitVerdict");
  const pooled = limitVerdict(candidate, aa, options);
  const verdicts = each.map(({ job, candidate: c, aa: a }): JobLimitVerdict => ({ job, verdict: limitVerdict(c, a, options) }));
  const { outcome, opposed, reason } = guard(pooled, verdicts, limitOpposite);
  return { outcome, pooled, jobs: verdicts, opposed, trimmed, dropped, reason };
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
