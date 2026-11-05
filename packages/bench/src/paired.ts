/**
 * The paired-time record of a bench. Each round runs the two arms of a pair on one case, one after the other, in a
 * fresh process. The order turns each round, so a warm cache or a slow start does not always help the same arm.
 */
import { median } from "@mark1russell7/rigor-statistics";

/** The two arms of a pair. Arm `a` is the baseline, and arm `b` is the candidate. */
export type Arm = "a" | "b";

/** One round of one pair on one case: the times of the two arms in milliseconds, and the arm that ran first. */
export interface PairedTime {
  /** The name of the case: one input of the bench. */
  readonly case: string;
  /** The number of the round, a whole number of 0 or more. */
  readonly round: number;
  readonly first: Arm;
  /** The time of the baseline arm, in milliseconds. */
  readonly a: number;
  /** The time of the candidate arm, in milliseconds. */
  readonly b: number;
}

/**
 * This function gives the arm that runs first in a round. The order turns each round. A case with an odd `offset`
 * starts with arm `b`, so half of the cases start with each arm.
 */
export function firstArm(round: number, offset = 0): Arm {
  if (!Number.isSafeInteger(round) || round < 0) throw new RangeError(`firstArm: the round is a whole number of 0 or more, not ${round}.`);
  if (!Number.isSafeInteger(offset)) throw new RangeError(`firstArm: the offset is a whole number, not ${offset}.`);
  return (((round + offset) % 2) + 2) % 2 === 0 ? "a" : "b";
}

/**
 * This function gives the order of three or more arms in one round. Each odd round is the reverse of the round before it,
 * and each even round turns the arms by one more place. So each pair of arms has each order one time in each two rounds,
 * at each count of arms. After any count of rounds, the two orders of a pair differ by 1 or less, and `caseRatios` accepts
 * the records.
 *
 * A plain turn of the arms does not give this. With 3 arms, each arm comes before the next arm in 2 of 3 rounds. Over 7
 * rounds, a pair can have one order 5 times, and `caseRatios` refuses those records.
 */
export function armOrder<T>(arms: readonly T[], round: number): readonly T[] {
  if (arms.length === 0) throw new RangeError("armOrder: there is no arm.");
  if (!Number.isSafeInteger(round) || round < 0) throw new RangeError(`armOrder: the round is a whole number of 0 or more, not ${round}.`);
  const shift = Math.floor(round / 2) % arms.length;
  const turned = [...arms.slice(shift), ...arms.slice(0, shift)];
  return round % 2 === 0 ? turned : turned.toReversed();
}

/** This function examines one record. A time that is not a finite number above 0 is an error. */
export function checkPairedTime(record: PairedTime): PairedTime {
  const where = `the record of the case ${JSON.stringify(record.case)}, round ${record.round}`;
  if (typeof record.case !== "string" || record.case === "") throw new RangeError("checkPairedTime: the case is a string that is not empty.");
  if (!Number.isSafeInteger(record.round) || record.round < 0) throw new RangeError(`checkPairedTime: in ${where}, the round is a whole number of 0 or more.`);
  if (record.first !== "a" && record.first !== "b") throw new RangeError(`checkPairedTime: in ${where}, the first arm is "a" or "b", not ${String(record.first)}.`);
  for (const arm of ["a", "b"] as const) {
    const ms = record[arm];
    if (!(typeof ms === "number" && Number.isFinite(ms) && ms > 0)) throw new RangeError(`checkPairedTime: in ${where}, the time of arm ${arm} is a finite number above 0, not ${String(ms)}.`);
  }
  return record;
}

/** The ratio of one case: the candidate time over the baseline time, over the rounds of the case. */
export interface CaseRatio {
  readonly case: string;
  /** The value `exp(median(log(b / a)))` over the rounds. For an odd count of rounds, it is the median of the ratios. */
  readonly ratio: number;
  readonly rounds: number;
}

/**
 * This function gives the ratio of each case, in the order of the first record of each case.
 * It examines each record. It refuses a case with 2 records of one round.
 * It also refuses a case whose two orders differ in count by more than 1, because that order did not turn each round.
 */
export function caseRatios(records: readonly PairedTime[]): CaseRatio[] {
  const cases = new Map<string, PairedTime[]>();
  for (const record of records) {
    checkPairedTime(record);
    const list = cases.get(record.case) ?? [];
    list.push(record);
    cases.set(record.case, list);
  }
  return [...cases].map(([name, list]) => {
    const rounds = new Set(list.map((r) => r.round));
    if (rounds.size !== list.length) throw new RangeError(`caseRatios: the case ${JSON.stringify(name)} has 2 records of one round.`);
    const aFirst = list.filter((r) => r.first === "a").length;
    if (Math.abs(2 * aFirst - list.length) > 1) {
      throw new RangeError(`caseRatios: the case ${JSON.stringify(name)} starts with arm a in ${aFirst} of ${list.length} rounds. The order turns each round.`);
    }
    return { case: name, ratio: Math.exp(median(list.map((r) => Math.log(r.b / r.a)))), rounds: list.length };
  });
}
