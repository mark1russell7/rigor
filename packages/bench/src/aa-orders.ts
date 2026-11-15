/**
 * The A/A ratio of each order. Two arms of the same code give a ratio near 1 in each order. A runner with a bias of
 * order gives two orders on the two sides of 1. With rounds that are not balanced, that bias moves the ratio of all rounds.
 */
import { median, medianInterval } from "@mark1russell7/rigor-statistics";
import { type PairedTime, checkPairedTime } from "./paired.ts";

/** The A/A ratio of a set of rounds, with the distribution-free interval of its median. */
export interface OrderRatio {
  /** The value `exp(median(log(b / a)))` over the rounds. */
  readonly ratio: number;
  /** The low end of the interval of the median of `b / a`. */
  readonly low: number;
  /** The high end of the interval of the median of `b / a`. */
  readonly high: number;
  /** The chance that the interval holds the median. For 5 rounds or fewer, the interval is the range, and this chance is below the level. */
  readonly coverage: number;
  readonly rounds: number;
}

/** The A/A ratio of one case over all rounds and over the rounds of each order. */
export interface AaOrders {
  readonly case: string;
  readonly all: OrderRatio;
  /** The ratio of the rounds where arm `a` started first. Only a case with such a round has it. */
  readonly aFirst?: OrderRatio;
  /** The ratio of the rounds where arm `b` started first. Only a case with such a round has it. */
  readonly bFirst?: OrderRatio;
}

/** This function gives the ratio and the interval of one set of log ratios. */
function orderRatio(logs: readonly number[], level: number): OrderRatio {
  const interval = medianInterval(logs, level);
  return { ratio: Math.exp(median(logs)), low: Math.exp(interval.low), high: Math.exp(interval.high), coverage: interval.coverage, rounds: logs.length };
}

/**
 * This function gives the A/A ratio of each case over all rounds and over the rounds of each order, at `level`
 * (default 0.9). The order is the order of the first record of each case. It examines each record, and it refuses
 * two records of one round of a case. It accepts orders with different counts, because it shows their effect.
 */
export function aaOrders(aa: readonly PairedTime[], level = 0.9): AaOrders[] {
  if (!(level > 0 && level < 1)) throw new RangeError(`aaOrders: the level is a number between 0 and 1, not ${level}.`);
  const byCase = new Map<string, { rounds: Set<number>; all: number[]; a: number[]; b: number[] }>();
  for (const record of aa) {
    checkPairedTime(record);
    let group = byCase.get(record.case);
    if (group === undefined) {
      group = { rounds: new Set(), all: [], a: [], b: [] };
      byCase.set(record.case, group);
    }
    if (group.rounds.has(record.round)) throw new RangeError(`aaOrders: the case ${JSON.stringify(record.case)} has 2 records of the round ${record.round}.`);
    group.rounds.add(record.round);
    const log = Math.log(record.b / record.a);
    group.all.push(log);
    group[record.first].push(log);
  }
  return [...byCase].map(([id, group]) => ({
    case: id,
    all: orderRatio(group.all, level),
    ...(group.a.length === 0 ? {} : { aFirst: orderRatio(group.a, level) }),
    ...(group.b.length === 0 ? {} : { bFirst: orderRatio(group.b, level) }),
  }));
}
