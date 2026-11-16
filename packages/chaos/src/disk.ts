import { type StopTrigger, choiceProblems, planPoints, pointProblem, pointSpecProblems, seedProblem } from "./stops.ts";

/**
 * A disk plan tells a harness which fault of the disk to apply to the files of a process of a test, and at which point.
 * An example is a power cut in a transaction: the disk loses each write that no fsync made durable, and the process stops.
 * Then the test examines the files that the disk kept, for example to measure the data loss of a setting of a database.
 *
 * The faults are one family with one shape: a kind and a point. A later kind adds its own fields to this shape. The plan
 * is data, and this module has no I/O. The disk tier of `@mark1russell7/harness` applies a plan. A seed fixes the points
 * of a plan before the run, thus a record keeps the plan, and a later run applies the same faults.
 */

/** This value is the format of a disk plan. */
export const DISK_PLAN_FORMAT = "rigor-disk/1";

/**
 * The kinds of the family of disk faults. `lose-unsynced` is a power cut: the process stops at once, and the disk loses
 * each write after the last fsync of its file. A torn write and an fsync error are the next kinds of the family.
 */
export const DISK_FAULT_KINDS = ["lose-unsynced"] as const;

/** A kind of a disk fault. */
export type DiskFaultKind = (typeof DISK_FAULT_KINDS)[number];

/**
 * One disk fault: its kind and its point. The point has the form of the point of a stop. A step counts the calls of the
 * stop point in the program from 0. A time counts the ms from the start of the process.
 */
export interface DiskFault {
  readonly kind: DiskFaultKind;
  readonly at: StopTrigger;
}

/** A disk plan is data, thus a record can keep the faults that a harness applied. Each fault is one run of the process. */
export interface DiskPlan {
  readonly format: typeof DISK_PLAN_FORMAT;
  /** The seed of a plan from a spec, or `null` for a plan that a person wrote. */
  readonly seed: number | string | null;
  /** The faults, one for each run. In a plan from a spec, the faults are in the order of their points, then of their kinds. */
  readonly faults: readonly DiskFault[];
}

/** A spec tells `diskPlan` the measure of the points, the number of the drawn points and the kinds. */
export interface DiskSpec {
  /**
   * Each point is a whole number from 0 to less than this limit, in the measure of the limit. For steps, the limit is the
   * number of the stop points of a complete run, for example from `countStops` of `@mark1russell7/rigor-testkit`.
   */
  readonly within: StopTrigger;
  /** The number of the seeded points between the edges. */
  readonly draws: number;
  /** The kinds of each point. The default is `["lose-unsynced"]`. */
  readonly kinds?: readonly DiskFaultKind[];
}

/** This function gives each problem of a disk fault. An empty list means that the fault is valid. */
export function checkDiskFault(fault: DiskFault): readonly string[] {
  if (typeof fault !== "object" || fault === null) return ["A disk fault is an object."];
  const out: string[] = [];
  if (!(DISK_FAULT_KINDS as readonly unknown[]).includes(fault.kind)) out.push(`The kind is one of ${DISK_FAULT_KINDS.join(", ")}, not ${String(fault.kind)}.`);
  const point = pointProblem(fault.at);
  if (point !== undefined) out.push(point);
  return out;
}

/** This function gives each problem of a disk plan. An empty list means that the plan is valid. */
export function checkDiskPlan(plan: DiskPlan): readonly string[] {
  const out: string[] = [];
  if (plan.format !== DISK_PLAN_FORMAT) out.push(`The format is ${DISK_PLAN_FORMAT}, not ${String(plan.format)}.`);
  const seed = seedProblem(plan.seed);
  if (seed !== undefined) out.push(seed);
  if (!Array.isArray(plan.faults)) return [...out, "The faults are a list."];
  plan.faults.forEach((fault, index) => {
    for (const problem of checkDiskFault(fault)) out.push(`The fault ${index}: ${problem}`);
  });
  return out;
}

/** This function gives each problem of a disk spec. An empty list means that the spec is valid. */
export function checkDiskSpec(spec: DiskSpec): readonly string[] {
  return [...pointSpecProblems(spec.within, spec.draws), ...choiceProblems(spec.kinds ?? ["lose-unsynced"], DISK_FAULT_KINDS, { one: "kind", many: "kinds" })];
}

/**
 * This function makes a plan from faults that a person wrote. The faults keep their order. This function throws a
 * `RangeError` for a fault with problems.
 */
export function diskPlanOf(faults: readonly DiskFault[]): DiskPlan {
  const plan: DiskPlan = { format: DISK_PLAN_FORMAT, seed: null, faults: [...faults] };
  const problems = checkDiskPlan(plan);
  if (problems.length > 0) throw new RangeError(`diskPlanOf: ${problems.join(" ")}`);
  return plan;
}

/**
 * This function draws a disk plan from a spec and a seed. The points are those of `stopPlan`: the edges 0, 1 and the
 * limit less 1, and `draws` distinct seeded points between them. Each point has one fault for each kind of the spec.
 * This function throws a `RangeError` for a spec with problems.
 */
export function diskPlan(spec: DiskSpec, seed: number | string): DiskPlan {
  const problems = checkDiskSpec(spec);
  if (problems.length > 0) throw new RangeError(`diskPlan: ${problems.join(" ")}`);
  const kinds = spec.kinds ?? (["lose-unsynced"] as const);
  const faults = planPoints(spec.within, spec.draws, seed).flatMap((at) => kinds.map((kind): DiskFault => ({ kind, at })));
  return { format: DISK_PLAN_FORMAT, seed, faults };
}
