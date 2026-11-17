/**
 * The records of a run of arms: one fresh child for each arm in each round. `freshArms` of the entry `/fresh` makes
 * them, and `armTimes` gives the time and the spread of each arm over its children.
 */
import { median, quantile } from "@mark1russell7/rigor-statistics";
import type { ChildFields } from "./fresh.ts";

/** The record of one child of a run of arms. */
export interface ArmProcess {
  readonly arm: string;
  readonly case: string;
  /** The global round of the child. */
  readonly round: number;
  /** The position of the child in its round, from 0. */
  readonly position: number;
  /** The time of the child in milliseconds. */
  readonly ms: number;
  /** The fields of the child line in addition to its time. Only a record of a child that gives a field has it. */
  readonly fields?: ChildFields;
}

/** The time of one arm over its children. */
export interface ArmTimes {
  readonly arm: string;
  readonly case: string;
  /** The count of the children of the arm. */
  readonly processes: number;
  /** The median of the times of the children, in milliseconds. */
  readonly median: number;
  /** The 10th percentile of the times of the children. */
  readonly p10: number;
  /** The 90th percentile of the times of the children. */
  readonly p90: number;
  /** The value `p90 / p10`. A claim on the spread of an arm uses it, because one bad child does not decide it. */
  readonly spread: number;
  /** The least time of the children, in milliseconds. One fast child sets it. */
  readonly min: number;
  /** The greatest time of the children, in milliseconds. One slow child sets it, so a report uses it, and a gate uses `spread`. */
  readonly max: number;
}

/**
 * This function gives the time of each arm over its children, in the order of the first record of each arm.
 * A time that is not a finite number above 0 is an error, and so is an arm with records of two cases.
 */
export function armTimes(processes: readonly ArmProcess[]): ArmTimes[] {
  const byArm = new Map<string, { case: string; ms: number[] }>();
  for (const p of processes) {
    if (typeof p.arm !== "string" || p.arm === "") throw new RangeError("armTimes: the arm of a record is a string that is not empty.");
    if (!(typeof p.ms === "number" && Number.isFinite(p.ms) && p.ms > 0)) throw new RangeError(`armTimes: the time of the arm ${JSON.stringify(p.arm)} in the round ${p.round} is a finite number above 0, not ${String(p.ms)}.`);
    const group = byArm.get(p.arm);
    if (group === undefined) byArm.set(p.arm, { case: p.case, ms: [p.ms] });
    else if (group.case !== p.case) throw new RangeError(`armTimes: the arm ${JSON.stringify(p.arm)} has records of the cases ${JSON.stringify(group.case)} and ${JSON.stringify(p.case)}.`);
    else group.ms.push(p.ms);
  }
  return [...byArm].map(([arm, group]) => {
    const p10 = quantile(group.ms, 0.1);
    const p90 = quantile(group.ms, 0.9);
    const min = group.ms.reduce((x, y) => Math.min(x, y));
    const max = group.ms.reduce((x, y) => Math.max(x, y));
    return { arm, case: group.case, processes: group.ms.length, median: median(group.ms), p10, p90, spread: p90 / p10, min, max };
  });
}
