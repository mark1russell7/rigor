/**
 * The timed rounds of one case in one process, for a base arm and one or more candidate arms. Each round times one
 * batch of each arm in the order of `armOrder`. The A/A arm, a second batch of the base or of a second copy of its code,
 * gives the noise of the order.
 * Each candidate makes a pair with the base, as in a fresh run. Thus `armVerdicts`, `caseRatios` and `aaStats` read
 * the records. Start this function in a fresh process for each case.
 */
import { type PairedTime, armOrder } from "./paired.ts";

/** One arm of the timed rounds in one process: its id and its call. Each call gives a number. */
export interface ProcessArm {
  readonly id: string;
  readonly run: () => number;
}

/** The options of the timed rounds of one case with a base arm and one or more candidate arms. */
export interface ArmRoundsOptions {
  /** The name of the case. */
  readonly case: string;
  /** The base arm. It is arm `a` of each pair. */
  readonly base: ProcessArm;
  /** The candidate arms. Each candidate is arm `b` of its own pair, and the id of the pair is its id. */
  readonly candidates: readonly ProcessArm[];
  /** The count of the rounds. */
  readonly rounds: number;
  /** The turn of the arms before `armOrder`. Give the index of the case, so the cases start with different arms. The default is 0. */
  readonly offset?: number;
  /**
   * The A/A pair, with the id `${base.id}~aa`. The value `true` adds the pair (base, base). A function adds the pair (base, that function).
   * Give a second copy of the code of the base, for example from a second load of its module. The value `false` adds no pair. The default is `true`.
   */
  readonly aa?: boolean | (() => number);
  /** The least time in milliseconds of one batch of the base arm. The default is 10. */
  readonly targetMs?: number;
  /** The time in milliseconds of the warm-up of the arms. The default is 1000. */
  readonly warmMs?: number;
  /** The clock in milliseconds. The default is `performance.now` of the global `performance` of Node and of each browser. */
  readonly now?: () => number;
}

/** The result of the timed rounds of one case with a base arm and one or more candidate arms. */
export interface ArmRounds {
  /** The records of each pair, by the id of the pair. Arm `a` of each record is the base, and its time is the time of the base batch of that round. */
  readonly pairs: Record<string, PairedTime[]>;
  /** The ids of the arms in the order of their batches, for each round. */
  readonly orders: readonly (readonly string[])[];
  /** The count of calls of each arm in one batch. */
  readonly count: number;
  /** The sum of the numbers that the arms gave. The engine cannot remove the work of a call, because this sum uses it. */
  readonly sink: number;
}

/** The suffix of the id of the A/A arm. */
const AA_SUFFIX = "~aa";

/** This function examines the options, and gives the arms in their order before the turn. A bad option is a `RangeError`. */
function armsOf(options: ArmRoundsOptions): ProcessArm[] {
  const { base, candidates, rounds } = options;
  const offset = options.offset ?? 0;
  const targetMs = options.targetMs ?? 10;
  const warmMs = options.warmMs ?? 1000;
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError(`timeArmRounds: the rounds are a whole number of 1 or more, not ${rounds}.`);
  if (!Number.isSafeInteger(offset)) throw new RangeError(`timeArmRounds: the offset is a whole number, not ${offset}.`);
  if (!(targetMs > 0) || !(warmMs >= 0)) throw new RangeError("timeArmRounds: the target time is above 0, and the warm-up time is 0 or more.");
  const aa = options.aa === undefined ? true : options.aa;
  if (typeof aa !== "boolean" && typeof aa !== "function") throw new RangeError("timeArmRounds: aa is true, false or a function.");
  const arms = aa === false ? [base, ...candidates] : [base, ...candidates, { id: `${base.id}${AA_SUFFIX}`, run: aa === true ? base.run : aa }];
  if (arms.length < 2) throw new RangeError("timeArmRounds: a run needs 1 pair or more: give a candidate, or keep the A/A pair.");
  for (const arm of arms) {
    if (typeof arm.id !== "string" || arm.id === "") throw new RangeError("timeArmRounds: the id of each arm is a string that is not empty.");
    if (typeof arm.run !== "function") throw new RangeError(`timeArmRounds: the arm ${JSON.stringify(arm.id)} has no run function.`);
  }
  const ids = arms.map((arm) => arm.id);
  if (new Set(ids).size !== ids.length) throw new RangeError(`timeArmRounds: the ids of the arms are not unique: ${ids.join(", ")}.`);
  return arms;
}

/**
 * This function times a base arm and one or more candidate arms of one case, in this process.
 * - The arms first operate in turn for the warm-up time. Then the count of calls of one batch grows until a batch of the base takes the target time.
 * - Each round times one batch of each arm. The order is `armOrder` of the arms, turned by `offset` first.
 *   Thus the two arms of each pair have each order one time in each two rounds.
 * - Each candidate pair and the A/A pair use the one base batch of the round. The first arm of a record is the arm of its pair that came first.
 * - Each call of an arm gives a number, and the sum of these numbers keeps the work.
 */
export function timeArmRounds(options: ArmRoundsOptions): ArmRounds {
  const arms = armsOf(options);
  const { rounds } = options;
  const shift = ((((options.offset ?? 0) % arms.length) + arms.length) % arms.length);
  const turned = [...arms.slice(shift), ...arms.slice(0, shift)];
  const targetMs = options.targetMs ?? 10;
  const warmMs = options.warmMs ?? 1000;
  const now = options.now ?? (() => performance.now());
  const [base, ...others] = arms as [ProcessArm, ...ProcessArm[]];
  let sink = 0;
  const batch = (arm: ProcessArm, count: number): number => {
    const run = arm.run;
    const start = now();
    for (let i = 0; i < count; i++) sink += run();
    return now() - start;
  };
  let count = 1;
  const warmUntil = now() + warmMs;
  while (now() < warmUntil) {
    if (batch(base, count) < targetMs / 4) count *= 2;
    for (const arm of others) batch(arm, count);
  }
  while (batch(base, count) < targetMs) count *= 2;
  const pairs: Record<string, PairedTime[]> = Object.fromEntries(others.map((arm) => [arm.id, []]));
  const orders: string[][] = [];
  for (let round = 0; round < rounds; round++) {
    const order = armOrder(turned, round);
    const times = new Map<string, number>();
    const place = new Map<string, number>();
    for (const [index, arm] of order.entries()) {
      times.set(arm.id, batch(arm, count));
      place.set(arm.id, index);
    }
    orders.push(order.map((arm) => arm.id));
    for (const arm of others) {
      const first = (place.get(base.id) as number) < (place.get(arm.id) as number) ? "a" : "b";
      pairs[arm.id]?.push({ case: options.case, round, first, a: times.get(base.id) as number, b: times.get(arm.id) as number });
    }
  }
  return { pairs, orders, count, sink };
}
