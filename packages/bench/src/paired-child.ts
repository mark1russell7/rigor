/**
 * The paired child of a bench: one process that loads the three sources of a pair and takes their samples in turn.
 * The sources are the base, the candidate and a second copy of the base. Two fresh children of a pair start at
 * different times. Thus a slow period of the runner can fall on one child and not on the other. In a paired child, a
 * slow period falls on each source of a pair.
 *
 * The child has two pairs. The candidate pair is the base and the candidate. The A/A pair is the base and its copy,
 * two copies of one source. Thus the spread of this pair is the noise of the order alone. The caller loads the sources
 * and gives one sample function for each source. A second copy of the base needs its own module state, so the caller
 * loads it from a second folder.
 */
import { median } from "@mark1russell7/rigor-statistics";
import { type PairedTime, firstArm } from "./paired.ts";

/** The sources of a paired child. */
export const CHILD_SOURCES = ["base", "candidate", "copy"] as const;

/** A source of a paired child. */
export type ChildSource = (typeof CHILD_SOURCES)[number];

/** The two pairs of a paired child: the candidate pair and the A/A pair. */
export type ChildPair = "candidate" | "aa";

/** One sample of the order: the pair that it counts for, and the source that gives it. */
export interface ChildStep {
  readonly pair: ChildPair;
  readonly source: ChildSource;
}

/** The second source of each pair: arm `b` of its `PairedTime`. Arm `a` of each pair is the base. */
const ARM_B: Readonly<Record<ChildPair, ChildSource>> = { candidate: "candidate", aa: "copy" };

/**
 * This function gives the order of the samples of one child, for the round and the offset of the case.
 * - Each step has a block of four samples for each pair, in the order A B B A. `firstArm(round, offset)` gives A.
 * - The two blocks change places at each step, and the first block turns each round.
 * - Each source of a pair thus gives two samples in each step, one before and one after the other source.
 */
export function pairedChildOrder(round: number, offset: number, steps: number): ChildStep[] {
  if (!Number.isSafeInteger(steps) || steps < 1) throw new RangeError(`pairedChildOrder: a child needs 1 step or more, not ${steps}.`);
  const first = firstArm(round, offset);
  const block = (pair: ChildPair): ChildStep[] => {
    const [x, y]: ChildSource[] = first === "a" ? ["base", ARM_B[pair]] : [ARM_B[pair], "base"];
    return [x, y, y, x].map((source) => ({ pair, source: source as ChildSource }));
  };
  const order: ChildStep[] = [];
  for (let step = 0; step < steps; step++) {
    const candidateFirst = (step + round) % 2 === 0;
    order.push(...(candidateFirst ? [...block("candidate"), ...block("aa")] : [...block("aa"), ...block("candidate")]));
  }
  return order;
}

/** The two records of one paired child. The time of each arm is the median of its samples in that pair. */
export interface ChildRecords {
  readonly candidate: PairedTime;
  readonly aa: PairedTime;
}

/** This function gives the sample times of each source of each pair, in the order of the samples. */
export function childTimes(order: readonly ChildStep[], times: readonly number[]): Record<ChildPair, Record<ChildSource, number[]>> {
  if (order.length !== times.length) throw new RangeError(`childTimes: ${times.length} times for ${order.length} samples.`);
  const out: Record<ChildPair, Record<ChildSource, number[]>> = { candidate: { base: [], candidate: [], copy: [] }, aa: { base: [], candidate: [], copy: [] } };
  order.forEach((step, index) => out[step.pair][step.source].push(times[index] as number));
  return out;
}

/** This function gives the records of one paired child from its order and the time of each sample. */
export function childRecords(caseName: string, round: number, offset: number, order: readonly ChildStep[], times: readonly number[]): ChildRecords {
  const first = firstArm(round, offset);
  const bySource = childTimes(order, times);
  const record = (pair: ChildPair): PairedTime => ({ case: caseName, round, first, a: median(bySource[pair].base), b: median(bySource[pair][ARM_B[pair]]) });
  return { candidate: record("candidate"), aa: record("aa") };
}

/** The options of one paired child. */
export interface PairedChildOptions {
  /** The name of the case. */
  readonly case: string;
  /** The global number of the round, a whole number of 0 or more. */
  readonly round: number;
  /** The offset of the case for `firstArm`: its index in the list of the cases. */
  readonly offset: number;
  /** The count of steps. Each source of each pair gives 2 counted samples in each step. */
  readonly steps: number;
  /** The sample function of each source. Each call gives the time of one sample in milliseconds. */
  readonly sample: Readonly<Record<ChildSource, (tag: string) => Promise<number>>>;
}

/** The result of one paired child: its order, the time of each sample in that order, and its two records. */
export interface PairedChild {
  readonly order: readonly ChildStep[];
  readonly times: readonly number[];
  readonly records: ChildRecords;
}

/**
 * This function takes the samples of one paired child. Each source first gives one warm sample with the tag `warm`, and
 * the child does not count it. Then the sources give their samples in the order of `pairedChildOrder`, with the tags
 * `s0`, `s1` and on. The cost is 3 warm samples and 8 counted samples for each step.
 */
export async function pairedChild(options: PairedChildOptions): Promise<PairedChild> {
  const order = pairedChildOrder(options.round, options.offset, options.steps);
  for (const source of CHILD_SOURCES) await options.sample[source]("warm");
  const times: number[] = [];
  for (const [index, { source }] of order.entries()) times.push(await options.sample[source](`s${index}`));
  return { order, times, records: childRecords(options.case, options.round, options.offset, order, times) };
}
