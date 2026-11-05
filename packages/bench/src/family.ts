/**
 * The read of a family of cases. A run reads many cases, and each case has its own interval. Without a correction, the
 * chance of one false `slower` case or more grows with the count of cases. At 16 cases and 0.025 for each side, this
 * chance can be 1 - 0.975^16, approximately 0.33. These reads are reports, and they do not change a verdict.
 *
 * - The Holm read (Holm, 1979) keeps the chance of one false claim or more on one side at most `level`.
 * - The read of each job keeps a `slower` or `faster` case only when each job gives that outcome alone.
 * - The fourth read keeps a case only when the Holm read and the read of each job both keep it.
 */
import { random } from "@mark1russell7/rigor-generators";
import { holm } from "@mark1russell7/rigor-statistics";
import { type JobRecords, type PooledVerdict, pooledVerdict } from "./merge.ts";
import { firstArm, type PairedTime } from "./paired.ts";
import type { TimeOutcome, TimeVerdict, VerdictOptions } from "./verdict.ts";

/** One case of a family: a time verdict, or the pooled verdict of the jobs. */
export interface FamilyItem {
  readonly case: string;
  readonly verdict: TimeVerdict | PooledVerdict;
}

/** The three reads of one case. A read changes only `slower` and `faster`, to `cannot decide`. */
export interface FamilyCase {
  readonly case: string;
  /** The outcome with no correction. */
  readonly outcome: TimeOutcome;
  /** The outcome with Holm over the cases of the family, one side at a time. */
  readonly holm: TimeOutcome;
  /** The outcome when each job must give the same outcome alone. A time verdict has one job, so this read is its outcome. */
  readonly eachJob: TimeOutcome;
  /** The outcome when the Holm read and the read of each job both keep it. */
  readonly eachJobHolm: TimeOutcome;
  /** The p of the side "slower" after the Holm correction, or undefined when the verdict has no p. */
  readonly adjustedSlower: number | undefined;
  /** The p of the side "faster" after the Holm correction, or undefined when the verdict has no p. */
  readonly adjustedFaster: number | undefined;
}

/** The counts of the outcomes `slower` and `faster` of one read. */
export interface FamilyCount {
  readonly slower: number;
  readonly faster: number;
}

/** The read of a family. */
export interface FamilyRead {
  /** The level of each side of the Holm read. */
  readonly level: number;
  readonly cases: readonly FamilyCase[];
  readonly plain: FamilyCount;
  readonly holm: FamilyCount;
  readonly eachJob: FamilyCount;
  readonly eachJobHolm: FamilyCount;
  /** The smallest p that the draws can give: 1 / (the fewest finite runs + 1). The value is undefined when no case has a p. */
  readonly floor: number | undefined;
  /** The first step of Holm: `level` over the count of the cases with a p. The value is undefined when no case has a p. */
  readonly firstStep: number | undefined;
  /** The lines of the read: one line of counts, one line of the floor, and one line for each case that a read changes. */
  readonly lines: readonly string[];
}

const pooledOf = (verdict: TimeVerdict | PooledVerdict): PooledVerdict | undefined => ("pooled" in verdict ? verdict : undefined);

/** This function changes `slower` and `faster` to `cannot decide` when `keep` refuses the side. */
function kept(outcome: TimeOutcome, keep: (side: "slower" | "faster") => boolean): TimeOutcome {
  return (outcome === "slower" || outcome === "faster") && !keep(outcome) ? "cannot decide" : outcome;
}

/** This function gives the Holm read of one side, by the index of the case. A case with no p gets undefined. */
function holmSide(ps: readonly (number | undefined)[], level: number): (number | undefined)[] {
  const index = ps.flatMap((p, i) => (p === undefined ? [] : [i]));
  const corrected = holm(index.map((i) => ps[i] as number), level);
  const out = new Array<number | undefined>(ps.length).fill(undefined);
  index.forEach((i, k) => (out[i] = corrected[k]!.adjusted));
  return out;
}

const count = (outcomes: readonly TimeOutcome[]): FamilyCount => ({
  slower: outcomes.filter((o) => o === "slower").length,
  faster: outcomes.filter((o) => o === "faster").length,
});

/**
 * This function gives the Holm read and the read of each job over a family of cases, as a report. The default `level` is 0.025 for each side.
 * It reads `pSlower` and `pFaster` of each time verdict, and of the pooled verdict of a pooled case. The option `pValues` of a verdict gives them.
 * A case with no p keeps its outcome in the Holm read, and a line gives the count of such cases.
 */
export function familyRead(items: readonly FamilyItem[], level = 0.025): FamilyRead {
  if (!(level > 0 && level < 1)) throw new RangeError(`familyRead: the level is more than 0 and less than 1, not ${level}.`);
  const times = items.map((item) => pooledOf(item.verdict)?.pooled ?? (item.verdict as TimeVerdict));
  const slower = holmSide(times.map((t) => t.pSlower), level);
  const faster = holmSide(times.map((t) => t.pFaster), level);
  const cases = items.map((item, i): FamilyCase => {
    const outcome = item.verdict.outcome;
    const adjusted = { slower: slower[i], faster: faster[i] };
    const pooled = pooledOf(item.verdict);
    const byHolm = kept(outcome, (side) => adjusted[side] === undefined || (adjusted[side] as number) < level);
    const byJobs = pooled === undefined ? outcome : kept(outcome, (side) => pooled.jobs.every((j) => j.verdict.outcome === side));
    return {
      case: item.case,
      outcome,
      holm: byHolm,
      eachJob: byJobs,
      eachJobHolm: byHolm === outcome ? byJobs : byHolm,
      adjustedSlower: adjusted.slower,
      adjustedFaster: adjusted.faster,
    };
  });
  const finite = times.filter((t) => t.pSlower !== undefined).map((t) => t.interval?.finite ?? 0);
  const floor = finite.length === 0 ? undefined : 1 / (Math.min(...finite) + 1);
  const firstStep = finite.length === 0 ? undefined : level / finite.length;
  const plain = count(cases.map((c) => c.outcome));
  const corrected = count(cases.map((c) => c.holm));
  const eachJob = count(cases.map((c) => c.eachJob));
  const eachJobHolm = count(cases.map((c) => c.eachJobHolm));
  const counts = (side: keyof FamilyCount): string =>
    `${String(plain[side])}, with Holm ${String(corrected[side])}, with each job ${String(eachJob[side])}, with each job and Holm ${String(eachJobHolm[side])}`;
  const lines = [`Family read (report only): ${String(cases.length)} cases. Slower: ${counts("slower")}. Faster: ${counts("faster")}.`];
  const bare = times.filter((t) => t.pSlower === undefined).length;
  if (bare > 0) lines.push(`${String(bare)} of ${String(times.length)} cases have no p, so the Holm read keeps their outcome. Give the verdicts the option pValues.`);
  if (floor !== undefined && firstStep !== undefined) {
    lines.push(
      floor < firstStep
        ? `The smallest p of the draws is ${round(floor)}, below the first step ${round(firstStep)} of Holm at the level ${String(level)}.`
        : `The smallest p of the draws is ${round(floor)}, not below the first step ${round(firstStep)} of Holm. No case can read slower with Holm, so give the bootstrap more runs.`,
    );
  }
  for (const c of cases) {
    if (c.holm !== c.outcome) lines.push(`The case ${JSON.stringify(c.case)} reads ${c.outcome}, and with Holm it reads ${c.holm}: the adjusted p is ${round((c.outcome === "slower" ? c.adjustedSlower : c.adjustedFaster) as number)}.`);
    if (c.eachJob !== c.outcome) lines.push(`The case ${JSON.stringify(c.case)} reads ${c.outcome}, and a job alone does not read ${c.outcome}.`);
  }
  return { level, cases, plain, holm: corrected, eachJob, eachJobHolm, floor, firstStep, lines };
}

/** The options of `familyPower`. */
export interface FamilyPowerOptions {
  /** The count of the cases of the family. */
  readonly family: number;
  /** The true ratio of the candidate time to the baseline time of the first case. The other cases have the ratio 1. The default is 1. */
  readonly ratio?: number;
  /** The count of the rounds of each case in each job. Each round is one case of the time verdict. The default is 5. */
  readonly rounds?: number;
  /** The count of the jobs. The default is 2. */
  readonly jobs?: number;
  /** The standard deviation of the log time of one arm in one round. The default is 0.1. */
  readonly sigma?: number;
  /**
   * The standard deviation of a shift of the log time of the candidate in one job, a new draw for each case and job. A shift
   * models a job whose machine changes the candidate more than the baseline. The default is 0, the best case for the read of each job.
   */
  readonly jobShift?: number;
  /** The count of the seeded families. The default is 200. */
  readonly trials?: number;
  /** The seed of the draws. The default is 1. */
  readonly seed?: number | string;
  /** The level of each side of the Holm read. The default is 0.025. */
  readonly level?: number;
  /** The options of each pooled verdict. */
  readonly verdict?: VerdictOptions;
}

/** The shares of the trials of `familyPower`, for each read. */
export interface FamilyShares {
  readonly plain: number;
  readonly holm: number;
  readonly eachJob: number;
  readonly eachJobHolm: number;
}

/** The result of `familyPower`. */
export interface FamilyPower {
  readonly trials: number;
  /** The share of the trials with one case of ratio 1 or more that reads slower: the false-slower rate of the family. */
  readonly falseSlower: FamilyShares;
  /** The share of the trials in which the first case reads slower. With the ratio 1, this is a false slower too. */
  readonly firstSlower: FamilyShares;
}

/**
 * This function draws `trials` families of pooled verdicts and gives the share of each read. Each arm of each round adds a
 * normal noise of `sigma` to the log time. Without `jobShift`, the jobs have no shift between them, so the read of each job has its best case.
 */
export function familyPower(options: FamilyPowerOptions): FamilyPower {
  const { family } = options;
  const ratio = options.ratio ?? 1;
  const rounds = options.rounds ?? 5;
  const jobs = options.jobs ?? 2;
  const sigma = options.sigma ?? 0.1;
  const trials = options.trials ?? 200;
  const jobShift = options.jobShift ?? 0;
  for (const [name, n] of [["family", family], ["rounds", rounds], ["jobs", jobs], ["trials", trials]] as const) {
    if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`familyPower: ${name} is a whole number of 1 or more, not ${n}.`);
  }
  if (!(ratio > 0 && Number.isFinite(ratio))) throw new RangeError(`familyPower: the ratio is a finite number above 0, not ${ratio}.`);
  if (!(jobShift >= 0 && Number.isFinite(jobShift))) throw new RangeError(`familyPower: jobShift is a finite number of 0 or more, not ${jobShift}.`);
  const r = random(options.seed ?? 1);
  const draw = (truth: number, job: string, c: number): PairedTime[] =>
    Array.from({ length: rounds }, (_, round) => ({ case: `${job}:${String(round)}`, round: 0, first: firstArm(round, c), a: 10 * Math.exp(r.normal(0, sigma)), b: 10 * truth * Math.exp(r.normal(0, sigma)) }));
  const hits = { false: { plain: 0, holm: 0, eachJob: 0, eachJobHolm: 0 }, first: { plain: 0, holm: 0, eachJob: 0, eachJobHolm: 0 } };
  for (let t = 0; t < trials; t++) {
    const items = Array.from({ length: family }, (_, c): FamilyItem => {
      const records = Array.from({ length: jobs }, (_, j): JobRecords => ({ job: `job ${String(j)}`, candidate: draw((c === 0 ? ratio : 1) * (jobShift > 0 ? Math.exp(r.normal(0, jobShift)) : 1), String(j), c), aa: draw(1, String(j), c) }));
      return { case: `case ${String(c)}`, verdict: pooledVerdict(records, { ...options.verdict, pValues: true }) };
    });
    const read = familyRead(items, options.level);
    for (const key of ["plain", "holm", "eachJob", "eachJobHolm"] as const) {
      const outcome = (c: FamilyCase): TimeOutcome => (key === "plain" ? c.outcome : c[key]);
      if (read.cases.some((c, i) => (i > 0 || ratio === 1) && outcome(c) === "slower")) hits.false[key]++;
      if (outcome(read.cases[0]!) === "slower") hits.first[key]++;
    }
  }
  const share = (h: Record<keyof FamilyShares, number>): FamilyShares => ({ plain: h.plain / trials, holm: h.holm / trials, eachJob: h.eachJob / trials, eachJobHolm: h.eachJobHolm / trials });
  return { trials, falseSlower: share(hits.false), firstSlower: share(hits.first) };
}

function round(x: number): number {
  return Math.round(x * 100_000) / 100_000;
}
