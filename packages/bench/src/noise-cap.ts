/**
 * The noise cap of `processVerdict` from the reads of earlier quiet jobs. The cap has one stated parameter: `level`, the
 * share of quiet reads with a noise at most the cap. So a run cannot decide when its typical read is noisier than that
 * share of quiet reads.
 *
 * The reads of one job share one runner, so they are not independent. Thus the quiet test, the interval and the decide
 * rate each read whole jobs. Give the reads of one case on one CPU model, because the noise of a case changes with the model.
 */
import { type BootstrapOptions, type Interval, binomialTest, bootstrapClusters, median, modifiedZ, quantile } from "@mark1russell7/rigor-statistics";
import { type ProcessRead, isValidRead, readNoise } from "./process-verdict.ts";
import type { DroppedJob } from "./run-limit.ts";

/** The reads of one case in one job. */
export interface JobReads {
  /** The label of the job, for example the id of its CI job. */
  readonly job: string;
  /** The reads of the processes of the job. Each read has an A/A band. */
  readonly reads: readonly ProcessRead[];
}

/** The options of `processNoiseCap`. */
export interface NoiseCapOptions {
  /** The count of valid processes that decides a case: the option `k` of `processVerdict`. */
  readonly k: number;
  /** The most processes of a case in one run. The default is 2k. */
  readonly processes?: number;
  /** The share of the quiet reads with a noise at most the cap, from 0 to 1. The default is 0.95. */
  readonly level?: number;
  /** The fewest quiet jobs that give a cap. The default is 5. */
  readonly minimum?: number;
  /** The cut of the robust z-score of the median read noise of a job. A job above it is not quiet. The default is 3.5. `Infinity` keeps each job. */
  readonly cut?: number;
  /** The decimals of the cap. The cap goes up to the next value with these decimals. The default is 4. */
  readonly digits?: number;
  /** The options of the bootstrap interval of the quantile. Each draw takes whole jobs. The default is the default of `bootstrapClusters`. */
  readonly bootstrap?: BootstrapOptions;
}

/** The facts of one quiet job at the cap. */
export interface JobDecide {
  readonly job: string;
  /** The median read noise of the job, on a log scale. */
  readonly median: number;
  readonly reads: number;
  /** The count of valid reads at the cap: the band contains 1, and the noise is at most the cap. */
  readonly valid: number;
  /** The chance of at least k valid reads in `processes` reads, with the valid share of this job. This is the chance that a run of this job decides. */
  readonly decide: number;
}

/** The jobs of a noise cap. */
export interface NoiseCapJobs {
  /** The quiet jobs, in the order of the input. */
  readonly jobs: readonly string[];
  /** The jobs that are not quiet. The field `spread` holds the median read noise of the job. */
  readonly dropped: readonly DroppedJob[];
}

/** A noise cap with its derivation, or too few quiet jobs for a cap. */
export type NoiseCap =
  | (NoiseCapJobs & {
      readonly source: "jobs";
      /** The cap: the estimate of `quantile`, up to the next value with `digits` decimals. */
      readonly cap: number;
      /** The `level` quantile of the read noise of the quiet jobs, with its bootstrap interval over whole jobs. */
      readonly quantile: Interval;
      /** The mean `decide` of the quiet jobs: the chance that a quiet run decides at the cap. */
      readonly decideRate: number;
      readonly decides: readonly JobDecide[];
    })
  | (NoiseCapJobs & { readonly source: "too few" });

/** This function tells if a value is a whole number of at least `low`. */
const whole = (x: number, low: number): boolean => Number.isSafeInteger(x) && x >= low;

/**
 * This function gives the noise cap of one case from the reads of earlier jobs, with its derivation. With the level 0.95,
 * a quiet read passes the cap 95% of the time. The decide rate is a different value: the chance that a quiet run decides.
 * - A job whose median read noise has a robust z-score above `cut`, on the high side, is not quiet.
 * - The cap is the `level` quantile of the read noise of the quiet jobs. It goes up to `digits` decimals.
 * - Each quiet job gives the chance of a decision at the cap. Their mean is the decide rate of the cap.
 * - With fewer than `minimum` quiet jobs, the result has no cap.
 * - The function refuses a bad option, two jobs with one label, a job with no reads and a read with no band.
 */
export function processNoiseCap(jobs: readonly JobReads[], options: NoiseCapOptions): NoiseCap {
  const { k } = options;
  const processes = options.processes ?? 2 * k;
  const level = options.level ?? 0.95;
  const minimum = options.minimum ?? 5;
  const cut = options.cut ?? 3.5;
  const digits = options.digits ?? 4;
  if (!whole(k, 1)) throw new RangeError(`processNoiseCap: k is a whole number of 1 or more, not ${k}.`);
  if (!whole(processes, k)) throw new RangeError(`processNoiseCap: the processes are a whole number of k (${k}) or more, not ${processes}.`);
  if (!(level > 0 && level < 1)) throw new RangeError(`processNoiseCap: the level is a number between 0 and 1, not ${level}.`);
  if (!whole(minimum, 1)) throw new RangeError(`processNoiseCap: the minimum is a whole number of 1 or more, not ${minimum}.`);
  if (!(cut > 0)) throw new RangeError(`processNoiseCap: the cut is a number above 0, not ${cut}.`);
  if (!(whole(digits, 0) && digits <= 12)) throw new RangeError(`processNoiseCap: the digits are a whole number from 0 to 12, not ${digits}.`);
  const labels = new Set<string>();
  const noise = jobs.map((job) => {
    if (labels.has(job.job)) throw new RangeError(`processNoiseCap: two jobs have the label ${JSON.stringify(job.job)}.`);
    labels.add(job.job);
    if (job.reads.length === 0) throw new RangeError(`processNoiseCap: the job ${JSON.stringify(job.job)} has no reads.`);
    return job.reads.map((read) => {
      const n = readNoise(read);
      if (n === undefined || !Number.isFinite(n)) throw new RangeError(`processNoiseCap: the read of ${read.process} in the job ${JSON.stringify(job.job)} has no A/A band, so its noise is not known.`);
      return n;
    });
  });
  const medians = noise.map((n) => median(n));
  const z = medians.length === 0 || cut === Infinity ? undefined : modifiedZ(medians, { cut, side: "high" });
  const out = new Set(z?.outliers ?? []);
  const dropped = [...out].map((i) => ({ job: jobs[i]!.job, spread: medians[i]!, score: z!.scores[i]! }));
  const quiet = jobs.flatMap((job, i) => (out.has(i) ? [] : [{ job, noise: noise[i]!, median: medians[i]! }]));
  const facts = { jobs: quiet.map((q) => q.job.job), dropped };
  if (quiet.length < minimum) return { ...facts, source: "too few" };
  const rows = quiet.flatMap((q) => q.noise.map((n) => ({ job: q.job.job, noise: n })));
  const estimate = bootstrapClusters(
    rows,
    (row) => row.job,
    (drawn) => quantile(
      drawn.map((row) => row.noise),
      level,
    ),
    options.bootstrap,
  );
  const scale = 10 ** digits;
  // The cap goes away from the reads, so the quantile is always at most the cap.
  const cap = Math.ceil(estimate.estimate * scale) / scale;
  const decides = quiet.map((q): JobDecide => {
    const valid = q.job.reads.filter((read) => isValidRead(read, cap)).length;
    return { job: q.job.job, median: q.median, reads: q.job.reads.length, valid, decide: binomialTest(k, processes, valid / q.job.reads.length, "greater") };
  });
  const decideRate = decides.reduce((sum, d) => sum + d.decide, 0) / decides.length;
  return { ...facts, source: "jobs", cap, quantile: estimate, decideRate, decides };
}
