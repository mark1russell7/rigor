/**
 * The growth verdict of a cost over sizes: does the cost grow slower than a limit, for each step of size? An example is
 * the claim "the time of one publish grows less than 15 times for each 10 times more subscribers". A cost that grows as
 * n x n grows 100 times for each 10 times, and a linear cost grows 10 times.
 *
 * The verdict reads a ratio inside each job: the cost at the larger size over the cost at the smaller size, on the same
 * runner. So a slow runner changes both sizes, and the ratio keeps its value. The verdict needs no A/A arm.
 */
import { median, medianInterval } from "@mark1russell7/rigor-statistics";

/** One value of one job at one size. A job that gives more than one value at a size gives the median of its values. */
export interface GrowthRound {
  /** The name of the job: one runner, which gives each size. */
  readonly job: string;
  /** The size, for example the count of subscribers. It is finite and more than 0. */
  readonly size: number;
  /** The cost at the size, for example a time in ms. It is finite and more than 0. */
  readonly value: number;
}

/** The three outcomes of a growth verdict. */
export type GrowthOutcome = "within" | "beyond" | "cannot decide";

/** The options of a growth verdict. */
export interface GrowthOptions {
  /** The largest growth of the cost that the claim permits for each step of `per` times in size. It is more than 1. */
  readonly maxGrowth: number;
  /** The factor of size that `maxGrowth` refers to. The default is 10. */
  readonly per?: number;
  /** The level of the interval of the median growth of each step. The default is 0.95. */
  readonly level?: number;
}

/** The verdict of one step, from one size to the next larger size. */
export interface GrowthStep {
  readonly from: number;
  readonly to: number;
  /** The growth of each job that gives both sizes, for a step of `per` times in size, in the order of the job names. */
  readonly growths: readonly number[];
  /** The median of `growths`. */
  readonly median: number;
  readonly low: number;
  readonly high: number;
  /** The coverage of the interval from `low` to `high`. It is less than the level with 5 jobs or fewer. */
  readonly coverage: number;
  /** The exponent of the median growth: the cost grows as the size to this power. */
  readonly exponent: number;
  readonly outcome: GrowthOutcome;
}

/** The verdict of a cost over all its sizes. */
export interface GrowthVerdict {
  /** It is `beyond` when a step is beyond, `within` when each step is within, and `cannot decide` in the other cases. */
  readonly outcome: GrowthOutcome;
  readonly maxGrowth: number;
  readonly per: number;
  readonly steps: readonly GrowthStep[];
}

/** This function gives the growth verdict of a cost over its sizes, from the values of one or more jobs. */
export function growthVerdict(rounds: readonly GrowthRound[], options: GrowthOptions): GrowthVerdict {
  const per = options.per ?? 10;
  const level = options.level ?? 0.95;
  if (!(Number.isFinite(options.maxGrowth) && options.maxGrowth > 1)) throw new RangeError("growthVerdict: maxGrowth is not a finite number more than 1.");
  if (!(Number.isFinite(per) && per > 1)) throw new RangeError("growthVerdict: per is not a finite number more than 1.");
  const byJob = new Map<string, Map<number, number[]>>();
  for (const round of rounds) {
    if (!(Number.isFinite(round.size) && round.size > 0)) throw new RangeError(`growthVerdict: job ${round.job} has the size ${round.size}, which is not finite and more than 0.`);
    if (!(Number.isFinite(round.value) && round.value > 0)) throw new RangeError(`growthVerdict: job ${round.job} has the value ${round.value} at the size ${round.size}, which is not finite and more than 0.`);
    const sizes = byJob.get(round.job) ?? new Map<number, number[]>();
    byJob.set(round.job, sizes);
    const values = sizes.get(round.size) ?? [];
    sizes.set(round.size, values);
    values.push(round.value);
  }
  const sizes = [...new Set(rounds.map((round) => round.size))].sort((a, b) => a - b);
  if (sizes.length < 2) throw new RangeError("growthVerdict: the rounds give fewer than 2 sizes.");
  const jobs = [...byJob.keys()].sort();
  const steps: GrowthStep[] = [];
  for (let i = 0; i + 1 < sizes.length; i++) {
    const from = sizes[i] as number;
    const to = sizes[i + 1] as number;
    const growths: number[] = [];
    for (const job of jobs) {
      const values = byJob.get(job) as Map<number, number[]>;
      const small = values.get(from);
      const large = values.get(to);
      if (small === undefined || large === undefined) continue;
      // The exponent of this job, scaled to a step of `per` times in size
      const exponent = Math.log(median(large) / median(small)) / Math.log(to / from);
      growths.push(Math.pow(per, exponent));
    }
    if (growths.length === 0) throw new RangeError(`growthVerdict: no job gives both the size ${from} and the size ${to}.`);
    const interval = medianInterval(growths, level);
    const middle = median(growths);
    const outcome: GrowthOutcome = interval.high < options.maxGrowth ? "within" : interval.low > options.maxGrowth ? "beyond" : "cannot decide";
    steps.push({ from, to, growths, median: middle, low: interval.low, high: interval.high, coverage: interval.coverage, exponent: Math.log(middle) / Math.log(per), outcome });
  }
  const outcome: GrowthOutcome = steps.some((step) => step.outcome === "beyond") ? "beyond" : steps.every((step) => step.outcome === "within") ? "within" : "cannot decide";
  return { outcome, maxGrowth: options.maxGrowth, per, steps };
}
