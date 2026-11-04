/**
 * The load factor of a run, read from a control. Runs on shared machines differ by load. A change does not touch a control.
 * So the change of its time between two groups measures the machine and not the code.
 * The groups can be two runs, or the shards of one run.
 */
import { median, quantile } from "@mark1russell7/rigor-statistics";

/** One time of the control in one group. */
export interface ControlRow {
  /** The name of the group: a run, or a shard of one run. */
  readonly group: string;
  /** The name of a class of work. The same key in two groups names equal work, so a ratio of the two measures the load. */
  readonly key: string;
  /** The time. It is finite and more than 0. */
  readonly value: number;
  /** This field is true when the run stopped the case at `value`. Thus the real time is at least `value`. */
  readonly censored?: boolean;
}

/** The options of `controlFactor`. */
export interface ControlOptions {
  /** The group that the factors compare with. Without it, the base of each key is the median of that key over the groups. */
  readonly base?: string;
  /** The least number of keys in a factor. A group with fewer keys has no factor. The default is 5. */
  readonly minPairs?: number;
}

/** The counts of one group, with or without a factor. */
export interface GroupCounts {
  readonly group: string;
  /** The number of keys that the factor reads. */
  readonly pairs: number;
  /** The number of keys that this function left out because a time of the key was censored. The factor reads low when this count is not 0. */
  readonly censored: number;
  /** The number of keys of this group that have no time to compare with, so no ratio reads them. */
  readonly unshared: number;
}

/** The factor of one group. */
export interface MeasuredFactor extends GroupCounts {
  /** The median ratio of the times of this group over the base. A factor of 1.6 means that this group took 1.6 times as long. */
  readonly factor: number;
  /** The quartiles of the ratios. A wide spread means that one factor does not explain the load. */
  readonly low: number;
  readonly high: number;
}

/** A group with too few usable keys. It has no factor, and the other groups keep theirs. */
export interface NoFactor extends GroupCounts {
  readonly factor: undefined;
  /** The reason that this group has no factor. */
  readonly reason: string;
}

/** The result of one group. Read `factor` first: a group with too few usable keys has no factor. */
export type GroupFactor = MeasuredFactor | NoFactor;

/** The factors of a run, with the base that they use. */
export interface ControlFactors {
  /** The base group, or undefined when the base of each key is its median over the groups. */
  readonly base: string | undefined;
  readonly factors: readonly GroupFactor[];
}

const DEFAULT_MIN_PAIRS = 5;

function checkedRows(rows: readonly ControlRow[]): Map<string, Map<string, ControlRow>> {
  const groups = new Map<string, Map<string, ControlRow>>();
  for (const r of rows) {
    if (!(Number.isFinite(r.value) && r.value > 0)) throw new RangeError(`controlFactor: the value of ${JSON.stringify(r.key)} in ${JSON.stringify(r.group)} is finite and more than 0, not ${r.value}.`);
    const group = groups.get(r.group) ?? new Map<string, ControlRow>();
    if (group.has(r.key)) throw new RangeError(`controlFactor: the key ${JSON.stringify(r.key)} comes twice in ${JSON.stringify(r.group)}.`);
    group.set(r.key, r);
    groups.set(r.group, group);
  }
  return groups;
}

function factorOf(group: string, ratios: readonly number[], censored: number, unshared: number, minPairs: number): GroupFactor {
  const counts = { group, pairs: ratios.length, censored, unshared };
  if (ratios.length < minPairs) return { ...counts, factor: undefined, reason: `the group ${JSON.stringify(group)} has ${ratios.length} usable keys, and the least is ${minPairs}.` };
  return { ...counts, factor: median(ratios), low: quantile(ratios, 0.25), high: quantile(ratios, 0.75) };
}

/** This function refuses a result with no factor at all, because such a result measures nothing. */
function withFactors(base: string | undefined, factors: readonly GroupFactor[]): ControlFactors {
  if (factors.every((f) => f.factor === undefined)) {
    const thin = factors.find((f): f is NoFactor => f.factor === undefined);
    throw new RangeError(`controlFactor: no group has a factor: ${thin?.reason ?? "the rows hold no group to compare."}`);
  }
  return { base, factors };
}

/** This function gives the factors over one base group. Each factor reads the keys that the two groups share. */
function againstGroup(groups: Map<string, Map<string, ControlRow>>, base: string, minPairs: number): ControlFactors {
  const baseRows = groups.get(base);
  if (baseRows === undefined) throw new RangeError(`controlFactor: the base ${JSON.stringify(base)} is not a group of the rows.`);
  const factors: GroupFactor[] = [];
  for (const [group, rows] of groups) {
    if (group === base) continue;
    const ratios: number[] = [];
    let censored = 0;
    let unshared = 0;
    for (const [key, r] of rows) {
      const b = baseRows.get(key);
      if (b === undefined) unshared += 1;
      else if (r.censored === true || b.censored === true) censored += 1;
      else ratios.push(r.value / b.value);
    }
    factors.push(factorOf(group, ratios, censored, unshared, minPairs));
  }
  return withFactors(base, factors);
}

/**
 * This function gives the factors over the median of each key, as one run grouped by shard needs.
 * Each group holds a different mix of work, so a time compares only with the times of the same key. A key in one group has nothing to compare with.
 */
function againstKeys(groups: Map<string, Map<string, ControlRow>>, minPairs: number): ControlFactors {
  const clean = new Map<string, number[]>();
  for (const rows of groups.values()) {
    for (const [key, r] of rows) if (r.censored !== true) clean.set(key, [...(clean.get(key) ?? []), r.value]);
  }
  const factors = [...groups].map(([group, rows]) => {
    const ratios: number[] = [];
    let censored = 0;
    let unshared = 0;
    for (const [key, r] of rows) {
      const times = clean.get(key) ?? [];
      if (r.censored === true) censored += 1;
      else if (times.length >= 2) ratios.push(r.value / median(times));
      else unshared += 1;
    }
    return factorOf(group, ratios, censored, unshared, minPairs);
  });
  return withFactors(undefined, factors);
}

/**
 * This function gives the load factor of each group from the times of a control.
 *
 * With `base`, a factor compares the keys that a group shares with that group. Without it, a factor compares each time with the median of its key over the groups.
 * A key names a class of work, so equal keys in two groups mean equal work. Each group has at most one row for a key.
 *
 * A censored time is only a lower limit, so no ratio reads it, and the result counts those keys. A run stops its slowest cases, so a factor reads low when `censored` is not 0.
 *
 * A group with too few usable keys gets an entry with no factor and its reason, so the other groups keep their factors. This function refuses a result where no group has a factor.
 */
export function controlFactor(rows: readonly ControlRow[], options: ControlOptions = {}): ControlFactors {
  const minPairs = options.minPairs ?? DEFAULT_MIN_PAIRS;
  if (!(Number.isInteger(minPairs) && minPairs >= 1)) throw new RangeError(`controlFactor: minPairs is a whole number of 1 or more, not ${minPairs}.`);
  const groups = checkedRows(rows);
  return options.base === undefined ? againstKeys(groups, minPairs) : againstGroup(groups, options.base, minPairs);
}
