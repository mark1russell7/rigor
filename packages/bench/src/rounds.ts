/**
 * The timed rounds of one case in one process. The two arms first run for a warm-up time. Then the count of calls of
 * one batch grows until a batch of arm `a` takes the target time. Each round times one batch of each arm, in the order
 * of `firstArm`. Start this function in a fresh process for each case.
 */
import { performance } from "node:perf_hooks";
import { type Arm, type PairedTime, firstArm } from "./paired.ts";

/** The options of the timed rounds of one case. */
export interface RoundsOptions {
  /** The name of the case. */
  readonly case: string;
  /** The count of the rounds. */
  readonly rounds: number;
  /** The offset of `firstArm`: give the index of the case, so half of the cases start with each arm. The default is 0. */
  readonly offset?: number;
  /** The least time in milliseconds of one batch of arm `a`. The default is 10. */
  readonly targetMs?: number;
  /** The time in milliseconds of the warm-up of the two arms. The default is 1000. */
  readonly warmMs?: number;
  /** The clock in milliseconds. The default is `performance.now`. */
  readonly now?: () => number;
}

/** The result of the timed rounds of one case. */
export interface Rounds {
  readonly records: PairedTime[];
  /** The count of calls of each arm in one batch. */
  readonly count: number;
  /** The sum of the numbers that the arms gave. The engine cannot remove the work of a call, because this sum uses it. */
  readonly sink: number;
}

/**
 * This function times the arms `a` and `b` of one case, and gives one `PairedTime` record for each round. The time of
 * a record is the time of one batch, in milliseconds. Each call of an arm gives a number, and the sum of these numbers
 * keeps the work.
 */
export function timeRounds(arms: Readonly<Record<Arm, () => number>>, options: RoundsOptions): Rounds {
  const { rounds } = options;
  const offset = options.offset ?? 0;
  const targetMs = options.targetMs ?? 10;
  const warmMs = options.warmMs ?? 1000;
  const now = options.now ?? (() => performance.now());
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError(`timeRounds: the rounds are a whole number of 1 or more, not ${rounds}.`);
  if (!Number.isSafeInteger(offset)) throw new RangeError(`timeRounds: the offset is a whole number, not ${offset}.`);
  if (!(targetMs > 0) || !(warmMs >= 0)) throw new RangeError("timeRounds: the target time is above 0, and the warm-up time is 0 or more.");
  let sink = 0;
  const batch = (arm: Arm, count: number): number => {
    const run = arms[arm];
    const start = now();
    for (let i = 0; i < count; i++) sink += run();
    return now() - start;
  };
  let count = 1;
  const warmUntil = now() + warmMs;
  while (now() < warmUntil) {
    if (batch("a", count) < targetMs / 4) count *= 2;
    batch("b", count);
  }
  while (batch("a", count) < targetMs) count *= 2;
  const records: PairedTime[] = [];
  for (let round = 0; round < rounds; round++) {
    const first = firstArm(round, offset);
    const second: Arm = first === "a" ? "b" : "a";
    const times = { [first]: batch(first, count), [second]: batch(second, count) } as Record<Arm, number>;
    records.push({ case: options.case, round, first, a: times.a, b: times.b });
  }
  return { records, count, sink };
}
