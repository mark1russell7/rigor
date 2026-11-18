/**
 * The limits of `processVerdict` from the reads of earlier jobs. A gate keeps the limits as data. A test gives them again
 * from the reads of the jobs, so the limits and their jobs stay the same.
 *
 * - (a) The median of a job is the median of its first k valid reads, as `processVerdict` takes them. The limit is
 *   `runLimit` of the job medians: the worst median plus the spread of the medians. The slow line is the limit.
 * - (b) The slow rate is the upper end of the Wilson interval of the share of the used reads above the limit. The
 *   largest count `maxSlow` is the smallest count with P(Binomial(k, slow rate) > count) under `risk`.
 *
 * Give the reads of one case on one CPU model, because the ratio of a case changes with the model.
 */
import { type Proportion, Z95, binomialTest, median, wilson } from "@mark1russell7/rigor-statistics";
import type { JobReads } from "./noise-cap.ts";
import { type ProcessLimits, isValidRead } from "./process-verdict.ts";
import { type RunLimit, runLimit } from "./run-limit.ts";

/** The options of `processLimits`. */
export interface ProcessLimitsOptions {
  /** The count of valid processes that decides a case: the option `k` of `processVerdict`. */
  readonly k: number;
  /** The fewest jobs that give limits. The default is 5. */
  readonly minimum?: number;
  /** The decimals of the limit. The limit goes up to the next value with these decimals. The default is 4. */
  readonly digits?: number;
  /** The z of the Wilson interval of the slow rate. The default is `Z95`, for a 95% interval. */
  readonly z?: number;
  /** The largest chance that a job at the slow rate has more than `maxSlow` slow processes, above 0 and below 1. The default is 0.01. */
  readonly risk?: number;
  /** The noise cap of the case. A read with a noise above it is not valid, as in `processVerdict`. The default is no cap. */
  readonly noiseCap?: number;
}

/** The derivation of the largest count of slow processes. */
export interface SlowCount {
  /** The count of used reads above the limit, in all jobs. */
  readonly above: number;
  /** The count of used reads in all jobs. */
  readonly reads: number;
  /** The Wilson interval of the share of used reads above the limit. Its upper end is the slow rate. */
  readonly rate: Proportion;
  readonly maxSlow: number;
  /** P(Binomial(k, slow rate) > maxSlow): the chance that a job at the slow rate fails check (b). It is under `risk`. */
  readonly chance: number;
}

/** The limits of one case from its jobs, with their derivation, or too few jobs for limits. */
export type ProcessLimitsFit =
  | {
      readonly source: "jobs";
      /** The jobs, in the order of the input. */
      readonly jobs: readonly string[];
      /** The limit, the slow line and `maxSlow`, ready for `processVerdict`. With the option `noiseCap`, also the noise cap. */
      readonly limits: ProcessLimits;
      /** The limit from the job medians, in the order of the jobs. */
      readonly median: RunLimit;
      readonly slow: SlowCount;
    }
  | { readonly source: "too few"; readonly jobs: readonly string[] };

/** This function tells if a value is a whole number of at least `low`. */
const whole = (x: number, low: number): boolean => Number.isSafeInteger(x) && x >= low;

/**
 * This function gives the limits of `processVerdict` for one case from the reads of earlier jobs, with their derivation.
 * - With fewer than `minimum` jobs, the result has no limits.
 * - The function refuses a bad option, two jobs with one label and a job with no valid read.
 * - It also refuses a ratio that is not a finite number above 0.
 */
export function processLimits(jobs: readonly JobReads[], options: ProcessLimitsOptions): ProcessLimitsFit {
  const { k, noiseCap } = options;
  const minimum = options.minimum ?? 5;
  const digits = options.digits ?? 4;
  const z = options.z ?? Z95;
  const risk = options.risk ?? 0.01;
  if (!whole(k, 1)) throw new RangeError(`processLimits: k is a whole number of 1 or more, not ${k}.`);
  if (!whole(minimum, 1)) throw new RangeError(`processLimits: the minimum is a whole number of 1 or more, not ${minimum}.`);
  if (!(z > 0 && Number.isFinite(z))) throw new RangeError(`processLimits: z is a finite number above 0, not ${z}.`);
  if (!(risk > 0 && risk < 1)) throw new RangeError(`processLimits: the risk is a number between 0 and 1, not ${risk}.`);
  if (noiseCap !== undefined && !(noiseCap > 0 && Number.isFinite(noiseCap))) throw new RangeError(`processLimits: the noise cap is a finite number above 0, not ${noiseCap}.`);
  const labels = new Set<string>();
  const used = jobs.map((job) => {
    if (labels.has(job.job)) throw new RangeError(`processLimits: two jobs have the label ${JSON.stringify(job.job)}.`);
    labels.add(job.job);
    const bad = job.reads.find((read) => !(Number.isFinite(read.ratio) && read.ratio > 0));
    if (bad !== undefined) throw new RangeError(`processLimits: the ratio of ${JSON.stringify(bad.process)} in the job ${JSON.stringify(job.job)} is not a finite number above 0, but ${bad.ratio}.`);
    const ratios = job.reads.filter((read) => isValidRead(read, noiseCap)).slice(0, k).map((read) => read.ratio);
    if (ratios.length === 0) throw new RangeError(`processLimits: the job ${JSON.stringify(job.job)} has no valid read.`);
    return ratios;
  });
  const names = jobs.map((job) => job.job);
  if (jobs.length < minimum) return { source: "too few", jobs: names };
  const run = runLimit(
    used.map((ratios) => median(ratios)),
    { minimum, digits },
  );
  const all = used.flat();
  const above = all.filter((ratio) => ratio > run.limit).length;
  const rate = wilson(above, all.length, z);
  // P(X > count) is P(X >= count + 1). The count k always passes, because no job has more than k used reads.
  let maxSlow = k;
  let chance = 0;
  for (let count = 0; count < k; count++) {
    const p = binomialTest(count + 1, k, rate.high, "greater");
    if (p < risk) {
      maxSlow = count;
      chance = p;
      break;
    }
  }
  const limits: ProcessLimits = { limit: run.limit, slow: run.limit, maxSlow, ...(noiseCap === undefined ? {} : { noiseCap }) };
  return { source: "jobs", jobs: names, limits, median: run, slow: { above, reads: all.length, rate, maxSlow, chance } };
}
