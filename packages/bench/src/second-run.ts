/**
 * The second run of a slow case. A bench can run each case two times. The second run tells if the result stays the same.
 * A case with a first run over a time limit can drop its second run, and then it has no read of the same result.
 * Sentinel cases keep both runs, so that the check stays live on the slow cases.
 */
import { median } from "@mark1russell7/rigor-statistics";
import { deriveSeed, seedOf, stablePick } from "@mark1russell7/rigor-generators";

/**
 * The method of one case. Each record states its method.
 *
 * - `two runs`: the first run is at most the limit, or the bench has no limit.
 * - `sentinel`: the first run is over the limit, and the case keeps its second run.
 * - `one run`: the first run is over the limit, and the case drops its second run.
 */
export type RunMethod = "two runs" | "sentinel" | "one run";

function checkMs(where: string, ms: number): void {
  if (!(Number.isFinite(ms) && ms >= 0)) throw new RangeError(`${where}: a time is a finite number of 0 or more, not ${ms}.`);
}

function checkLimit(where: string, limitMs: number | undefined): void {
  if (limitMs !== undefined && !(Number.isFinite(limitMs) && limitMs > 0)) {
    throw new RangeError(`${where}: the limit is a finite number above 0, or no limit, not ${limitMs}.`);
  }
}

/** This function tells if a first run is over the limit. With no limit, no run is over it. A time equal to the limit is not over it. */
export function overLimit(firstMs: number, limitMs?: number): boolean {
  checkMs("overLimit", firstMs);
  checkLimit("overLimit", limitMs);
  return limitMs !== undefined && firstMs > limitMs;
}

/** The options of `runMethod`. */
export interface RunMethodOptions {
  /** The limit of a first run in milliseconds. With no limit, each case keeps its second run. */
  readonly limitMs?: number;
  /** True for a sentinel case of `sentinelCases`. The default is false. */
  readonly sentinel?: boolean;
}

/** This function gives the method of one case from the time of its first run. */
export function runMethod(firstMs: number, options: RunMethodOptions = {}): RunMethod {
  if (!overLimit(firstMs, options.limitMs)) return "two runs";
  return options.sentinel === true ? "sentinel" : "one run";
}

/**
 * This function gives the claim of one case that the result stays the same. The claim is `true` for equal hashes and
 * `false` for different hashes. The method `one run` makes no claim, so its claim is `null`.
 * It refuses a second hash for the method `one run`, and no second hash for the other methods.
 */
export function sameResult(method: RunMethod, firstHash: string, secondHash?: string): boolean | null {
  if (method === "one run") {
    if (secondHash !== undefined) throw new RangeError("sameResult: the method one run has no second hash.");
    return null;
  }
  if (secondHash === undefined) throw new RangeError(`sameResult: the method ${method} needs a second hash.`);
  return firstHash === secondHash;
}

/** One case for the choice of the sentinels: its key, its group and the time of its first run. */
export interface TimedCase {
  /** The key of the case. Each key occurs once. */
  readonly key: string;
  /** The group of the case, for example the engine that it runs. */
  readonly group: string;
  /** The time of the first run in milliseconds, from this run or from an earlier run. */
  readonly ms: number;
}

/** The options of `sentinelCases`. */
export interface SentinelOptions {
  /** The limit of a first run in milliseconds. With no limit, no case is a sentinel. */
  readonly limitMs?: number;
  /** The seed of the run. Give a new seed to each run, for example its date, so that the rotating cases turn. */
  readonly seed: number | string;
}

/** One sentinel case, with the reason of the choice. */
export interface Sentinel {
  readonly key: string;
  readonly group: string;
  /** `smallest`: the case over the limit with the smallest time. `rotating`: the case of its group for this seed. */
  readonly reason: "smallest" | "rotating";
}

/**
 * This function gives the sentinel cases of a run. These cases keep their second run when their first run is over the limit.
 *
 * - The first sentinel is the case over the limit with the smallest time. A tie goes to the smaller key.
 * - Each group with a case over the limit gets one rotating sentinel. `stablePick` chooses it under the seed of the run and the name of the group.
 *   The choice skips the first sentinel when its group has another case over the limit.
 *
 * The order of the list does not change the choice. The result has the first sentinel, and then the rotating sentinels in the order of their groups.
 */
export function sentinelCases(cases: readonly TimedCase[], options: SentinelOptions): Sentinel[] {
  checkLimit("sentinelCases", options.limitMs);
  const keys = new Set<string>();
  for (const c of cases) {
    checkMs("sentinelCases", c.ms);
    if (keys.has(c.key)) throw new RangeError(`sentinelCases: the key ${JSON.stringify(c.key)} occurs twice.`);
    keys.add(c.key);
  }
  const over = cases.filter((c) => overLimit(c.ms, options.limitMs));
  if (over.length === 0) return [];
  const smallest = over.reduce((a, b) => (b.ms < a.ms || (b.ms === a.ms && b.key < a.key) ? b : a));
  const groups = new Map<string, TimedCase[]>();
  for (const c of over) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  const seed = seedOf(options.seed);
  const out: Sentinel[] = [{ key: smallest.key, group: smallest.group, reason: "smallest" }];
  for (const group of [...groups.keys()].sort()) {
    const members = groups.get(group)!;
    const pool = members.length > 1 ? members.filter((c) => c.key !== smallest.key) : members;
    if (pool.length === 1 && pool[0]!.key === smallest.key) continue;
    const pick = stablePick(deriveSeed(seed, group), pool, (c) => c.key);
    out.push({ key: pick.key, group, reason: "rotating" });
  }
  return out;
}

/** One case with two runs: its group and the times of the two runs. */
export interface TwoRunTimes {
  readonly group: string;
  readonly firstMs: number;
  readonly secondMs: number;
}

/** The ratio second / first of the cases of one group with two runs. */
export interface FirstAgainstSecond {
  readonly group: string;
  /** The count of cases. */
  readonly n: number;
  /** The median, the smallest and the largest ratio of the time of the second run over the time of the first run. */
  readonly median: number;
  readonly low: number;
  readonly high: number;
}

/**
 * This function gives the ratio second / first of each group, in the order of the group names.
 * A ratio under 1 tells that the second run is faster, so a time of the first run alone is a different measure.
 * It refuses a first time of 0.
 */
export function firstAgainstSecond(rows: readonly TwoRunTimes[]): FirstAgainstSecond[] {
  const ratios = new Map<string, number[]>();
  for (const r of rows) {
    checkMs("firstAgainstSecond", r.firstMs);
    checkMs("firstAgainstSecond", r.secondMs);
    if (r.firstMs === 0) throw new RangeError("firstAgainstSecond: a first time of 0 has no ratio.");
    ratios.set(r.group, [...(ratios.get(r.group) ?? []), r.secondMs / r.firstMs]);
  }
  return [...ratios.keys()].sort().map((group) => {
    const values = ratios.get(group)!;
    return { group, n: values.length, median: median(values), low: Math.min(...values), high: Math.max(...values) };
  });
}

/** This function gives one line of text for the result of `firstAgainstSecond`, with 2 decimals for each ratio. */
export function firstAgainstSecondLine(groups: readonly FirstAgainstSecond[]): string {
  if (groups.length === 0) return "First against second: no case has two runs.";
  const parts = groups.map((g) => `${g.group} ${g.n} ${g.n === 1 ? "case" : "cases"}, median ${g.median.toFixed(2)} (${g.low.toFixed(2)} to ${g.high.toFixed(2)})`);
  return `First against second, the time of the second run over the first: ${parts.join("; ")}.`;
}
