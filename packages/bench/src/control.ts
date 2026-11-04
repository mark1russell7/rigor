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
  /** The name of the case. The same key in two groups names the same work. */
  readonly key: string;
  /** The time. It is finite and more than 0. */
  readonly value: number;
  /** This field is true when the run stopped the case at `value`. Thus the real time is at least `value`. */
  readonly censored?: boolean;
}

/** The options of `controlFactor`. */
export interface ControlOptions {
  /** The group that the factors compare with. Without it, the base is the median control time of all groups. */
  readonly base?: string;
  /** The least number of keys in a factor. A factor with fewer keys is refused. The default is 5. */
  readonly minPairs?: number;
}

/** The factor of one group. */
export interface GroupFactor {
  readonly group: string;
  /** The median ratio of the times of this group over the base. A factor of 1.6 means that this group took 1.6 times as long. */
  readonly factor: number;
  /** The number of keys that the factor reads. */
  readonly pairs: number;
  /** The quartiles of the ratios. A wide spread means that one factor does not explain the load. */
  readonly low: number;
  readonly high: number;
  /** The number of keys that this function left out because a time of the key was censored. */
  readonly censored: number;
}

/** The factors of a run, with the base that they use. */
export interface ControlFactors {
  /** The base group, or undefined when the base is the median of all groups. */
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

function factorOf(group: string, ratios: readonly number[], censored: number, minPairs: number): GroupFactor {
  if (ratios.length < minPairs) throw new RangeError(`controlFactor: the group ${JSON.stringify(group)} has ${ratios.length} usable keys, and the least is ${minPairs}.`);
  return { group, factor: median(ratios), pairs: ratios.length, low: quantile(ratios, 0.25), high: quantile(ratios, 0.75), censored };
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
    for (const [key, r] of rows) {
      const b = baseRows.get(key);
      if (b === undefined) continue;
      if (r.censored === true || b.censored === true) censored += 1;
      else ratios.push(r.value / b.value);
    }
    factors.push(factorOf(group, ratios, censored, minPairs));
  }
  return { base, factors };
}

/** This function gives the factors over the median control time of all groups, as one run grouped by shard needs. */
function againstMedian(groups: Map<string, Map<string, ControlRow>>, minPairs: number): ControlFactors {
  const all = [...groups.values()].flatMap((rows) => [...rows.values()]);
  const clean = all.filter((r) => r.censored !== true);
  if (clean.length === 0) throw new RangeError("controlFactor: the rows have no time that is not censored.");
  const middle = median(clean.map((r) => r.value));
  const factors = [...groups].map(([group, rows]) => {
    const kept = [...rows.values()].filter((r) => r.censored !== true);
    return factorOf(group, kept.map((r) => r.value / middle), rows.size - kept.length, minPairs);
  });
  return { base: undefined, factors };
}

/**
 * This function gives the load factor of each group from the times of a control.
 * With `base`, a factor compares the keys that a group shares with that group. Without it, a factor compares the times of a group with the median of all times.
 * A censored time is only a lower limit, so no ratio reads it. The result counts those keys.
 */
export function controlFactor(rows: readonly ControlRow[], options: ControlOptions = {}): ControlFactors {
  const minPairs = options.minPairs ?? DEFAULT_MIN_PAIRS;
  if (!(Number.isInteger(minPairs) && minPairs >= 1)) throw new RangeError(`controlFactor: minPairs is a whole number of 1 or more, not ${minPairs}.`);
  const groups = checkedRows(rows);
  return options.base === undefined ? againstMedian(groups, minPairs) : againstGroup(groups, options.base, minPairs);
}
