/**
 * The limits of a time gate from earlier runs. The rule of the gate limits: a limit is the worst value of 5 or more CI
 * runs plus their spread (max - min), with no factor. A limit goes away from the data at its last digit, so each run of
 * the limit stays inside it.
 *
 * `aaLimits` gives the margin and the noise cap of `timeVerdict` for each family of cases from the A/A records of the jobs.
 * A job whose A/A spread is far above the other jobs goes out by the robust z-score, and the result names it.
 */
import { median, modifiedZ, quantile } from "@mark1russell7/rigor-statistics";
import type { Better } from "./model-limit.ts";
import { type PairedTime, caseRatios } from "./paired.ts";

/** The options of `runLimit`. */
export interface RunLimitOptions {
  /** The fewest values that give a limit. The default is 5. */
  readonly minimum?: number;
  /** The decimals of the limit. The default is 4. */
  readonly digits?: number;
  /** The direction of a good change of the measure. The default is `lower`. */
  readonly better?: Better;
  /** The limit is at least `bound` for `lower`, and at most `bound` for `higher`. The default is no bound. */
  readonly bound?: number;
  /** The spread that the limit adds to the worst value (`RunSpread`). The default is `range`. Since 0.3.6. */
  readonly spread?: RunSpread;
}

/**
 * The spread of the values that `runLimit` adds to the worst value.
 *
 * - `range`: max - min. A value far on the better side makes the limit larger.
 * - `worse-half`: the distance from the median to the worst value. A value on the better side of the median does not change the limit.
 *   Use it for a measure of noise, for example an A/A spread. With `range`, a job with less noise makes the cap larger.
 */
export type RunSpread = "range" | "worse-half";

/** A limit from the values of the runs, with its derivation. A later run gives `runLimit(values)` again and compares. */
export interface RunLimit {
  readonly limit: number;
  /** The worst value: the largest value for `lower`, the smallest value for `higher`. */
  readonly worst: number;
  /** The spread of the values: max - min for `range`, and the distance from the median to the worst value for `worse-half`. */
  readonly spread: number;
  readonly values: readonly number[];
}

/**
 * This function gives the limit of the rule of the gate limits. For `lower`, the limit is the worst value plus the spread.
 * For `higher`, it is the worst value minus the spread. It rounds the limit away from the values to `digits` decimals.
 * It refuses fewer values than `minimum` and a value that is not finite.
 * With the option `spread` set to `worse-half`, the spread is the distance from the median to the worst value.
 */
export function runLimit(values: readonly number[], options: RunLimitOptions = {}): RunLimit {
  const minimum = options.minimum ?? 5;
  const digits = options.digits ?? 4;
  const better = options.better ?? "lower";
  if (!(Number.isSafeInteger(minimum) && minimum >= 1)) throw new RangeError(`runLimit: the minimum is a whole number of 1 or more, not ${minimum}.`);
  if (!(Number.isSafeInteger(digits) && digits >= 0 && digits <= 12)) throw new RangeError(`runLimit: the digits are a whole number from 0 to 12, not ${digits}.`);
  if (options.bound !== undefined && !Number.isFinite(options.bound)) throw new RangeError(`runLimit: the bound is a finite number, not ${options.bound}.`);
  const rule = options.spread ?? "range";
  if (rule !== "range" && rule !== "worse-half") throw new RangeError(`runLimit: the spread is "range" or "worse-half", not ${String(rule)}.`);
  for (const v of values) if (!Number.isFinite(v)) throw new RangeError(`runLimit: each value is a finite number, not ${v}.`);
  if (values.length < minimum) throw new RangeError(`runLimit: a limit needs ${minimum} values or more, not ${values.length}.`);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const center = rule === "range" ? undefined : median(values);
  const spread = center === undefined ? high - low : better === "lower" ? high - center : center - low;
  const scale = 10 ** digits;
  if (better === "lower") {
    const raw = Math.max(high + spread, options.bound ?? -Infinity);
    return { limit: Math.ceil(raw * scale - 1e-9) / scale, worst: high, spread, values: [...values] };
  }
  const raw = Math.min(low - spread, options.bound ?? Infinity);
  return { limit: Math.floor(raw * scale + 1e-9) / scale, worst: low, spread, values: [...values] };
}

/** The A/A statistics of one case in one job, on a log scale. */
export interface CaseAaStat {
  readonly case: string;
  /** The median of `log(b / a)` over the A/A rounds of the case: the bias of the job. */
  readonly median: number;
  /** The `level` quantile of `abs(log(b / a))` over the A/A rounds: the noise of the job. It is the `aaSpread` of the rounds. */
  readonly spread: number;
  readonly rounds: number;
}

/**
 * This function gives the A/A statistics of each case of the A/A records of one job. The order is the order of the first
 * record of each case. It checks the records as `caseRatios` does. The default level of the spread is 0.9, the level of `aaSpread`.
 */
export function aaStats(aa: readonly PairedTime[], level = 0.9): CaseAaStat[] {
  if (!(level > 0 && level < 1)) throw new RangeError(`aaStats: the level is a number between 0 and 1, not ${level}.`);
  const ratios = caseRatios(aa);
  const logs = new Map<string, number[]>();
  for (const record of aa) logs.set(record.case, [...(logs.get(record.case) ?? []), Math.abs(Math.log(record.b / record.a))]);
  return ratios.map((r) => ({ case: r.case, median: Math.log(r.ratio), spread: quantile(logs.get(r.case)!, level), rounds: r.rounds }));
}

/** The A/A statistics of the cases of one job. */
export interface JobAaStats {
  readonly job: string;
  readonly cases: readonly CaseAaStat[];
}

/** A job that went out of the limits of a group of cases, with its worst A/A spread and its robust z-score. */
export interface DroppedJob {
  readonly job: string;
  readonly spread: number;
  readonly score: number;
}

/** The facts of a group of cases: its cases, the jobs of its limits and the jobs that went out. */
export interface GroupJobs {
  readonly cases: readonly string[];
  readonly jobs: readonly string[];
  readonly dropped: readonly DroppedJob[];
}

/** The limits of a group of cases, on a log scale. These are the options `margin` and `noiseCap` of `timeVerdict`. */
export interface GroupLimits extends GroupJobs {
  /** The limit of the worst `abs(median)` of a case in each job. */
  readonly margin: RunLimit;
  /** The limit of the worst `spread` of a case in each job. */
  readonly noiseCap: RunLimit;
}

/** The limits of a family: its own limits, or too few jobs, so the cases of the family use the fallback limits. */
export type FamilyLimits = (GroupLimits & { readonly source: "family" }) | (GroupJobs & { readonly source: "fallback" });

/** The options of `aaLimits`. */
export interface AaLimitOptions {
  /** The family of a case. A case with no family uses the fallback limits. The default gives no family. */
  readonly family?: (name: string) => string | undefined;
  /** The fewest jobs that give the limits of a group. The default is 5. */
  readonly minimum?: number;
  /** The decimals of the limits. The default is 4. */
  readonly digits?: number;
  /** The least margin, on a log scale. The default is 0. */
  readonly marginFloor?: number;
  /** The cut of the robust z-score of the worst spread of a job. A job above it goes out. The default is 3.5. `Infinity` keeps each job. */
  readonly cut?: number;
}

/** The limits of the families and the fallback limits of all cases. */
export interface AaLimits {
  readonly families: Readonly<Record<string, FamilyLimits>>;
  readonly fallback: GroupLimits;
}

/**
 * This function gives the margin and the noise cap of each family of cases, and the fallback limits of all cases.
 * - Each job gives its worst `abs(median)` and its worst `spread` over the cases of a group.
 * - A job whose worst spread has a robust z-score above `cut`, on the high side, goes out of the group.
 * - The margin and the noise cap are `runLimit` over the jobs that stay. A family with fewer than `minimum` jobs uses the fallback limits.
 * - The function refuses fewer than `minimum` jobs for the fallback limits, and two jobs with one label.
 */
export function aaLimits(jobs: readonly JobAaStats[], options: AaLimitOptions = {}): AaLimits {
  const minimum = options.minimum ?? 5;
  const cut = options.cut ?? 3.5;
  const family = options.family ?? (() => undefined);
  const limit = { minimum, ...(options.digits === undefined ? {} : { digits: options.digits }) };
  const labels = new Set<string>();
  for (const job of jobs) {
    if (labels.has(job.job)) throw new RangeError(`aaLimits: two jobs have the label ${JSON.stringify(job.job)}.`);
    labels.add(job.job);
  }
  const group = (keep: (name: string) => boolean): GroupJobs & { worst: { job: string; median: number; spread: number }[] } => {
    const cases = new Set<string>();
    const worst = jobs.flatMap((job) => {
      const own = job.cases.filter((c) => keep(c.case));
      for (const c of own) cases.add(c.case);
      return own.length === 0 ? [] : [{ job: job.job, median: Math.max(...own.map((c) => Math.abs(c.median))), spread: Math.max(...own.map((c) => c.spread)) }];
    });
    const z = worst.length === 0 || cut === Infinity ? undefined : modifiedZ(worst.map((w) => w.spread), { cut, side: "high" });
    const out = new Set(z?.outliers ?? []);
    const dropped = [...out].map((i) => ({ job: worst[i]!.job, spread: worst[i]!.spread, score: z!.scores[i]! }));
    const kept = worst.filter((_, i) => !out.has(i));
    return { cases: [...cases], jobs: kept.map((w) => w.job), dropped, worst: kept };
  };
  const limits = (facts: ReturnType<typeof group>): GroupLimits => {
    const { worst, ...rest } = facts;
    return {
      ...rest,
      margin: runLimit(
        worst.map((w) => w.median),
        { ...limit, bound: options.marginFloor ?? 0 },
      ),
      noiseCap: runLimit(
        worst.map((w) => w.spread),
        limit,
      ),
    };
  };
  const all = group(() => true);
  if (all.jobs.length < minimum) {
    const out = all.dropped.length === 0 ? "" : ` The jobs that went out: ${all.dropped.map((d) => d.job).join(", ")}.`;
    throw new RangeError(`aaLimits: the limits need the A/A records of ${minimum} jobs or more, not ${all.jobs.length}.${out}`);
  }
  const fallback = limits(all);
  const names = [...new Set(jobs.flatMap((job) => job.cases.flatMap((c) => family(c.case) ?? [])))];
  const families = Object.fromEntries(
    names.map((name): [string, FamilyLimits] => {
      const facts = group((c) => family(c) === name);
      if (facts.jobs.length < minimum) {
        const { worst: _worst, ...rest } = facts;
        return [name, { ...rest, source: "fallback" }];
      }
      return [name, { ...limits(facts), source: "family" }];
    }),
  );
  return { families, fallback };
}

/** This function gives the options `margin` and `noiseCap` of `timeVerdict` for a family, or the fallback limits for no family. */
export function aaLimitOf(limits: AaLimits, family: string | undefined): { readonly margin: number; readonly noiseCap: number; readonly source: "family" | "fallback" } {
  const own = family === undefined ? undefined : limits.families[family];
  const group = own?.source === "family" ? own : limits.fallback;
  return { margin: group.margin.limit, noiseCap: group.noiseCap.limit, source: own?.source === "family" ? "family" : "fallback" };
}
