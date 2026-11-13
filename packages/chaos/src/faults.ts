import { random } from "@mark1russell7/rigor-generators";

/**
 * A fault plan tells a proxy which faults to put into which connections, and at which points. A seed fixes the plan
 * before the run, as it fixes a schedule. Thus a record keeps the plan, and a later run applies the same faults.
 *
 * The plan is data, and this module has no I/O. The proxy that applies a plan is the package `@mark1russell7/rigor-proxy`.
 * Each draw of a plan is an integer from `mulberry32`, thus the same seed gives the same plan on each platform.
 */

/** This value is the format of a fault plan. */
export const FAULT_PLAN_FORMAT = "rigor-faults/1";

/** These are the kinds of faults, in the order that a weight list of a spec uses. */
export const FAULT_KINDS = ["delay", "stall", "cut", "reset", "split", "reorder", "duplicate"] as const;

/** A kind of fault. */
export type FaultKind = (typeof FAULT_KINDS)[number];

/** The direction of a stream. `up` goes from the client to the server, and `down` goes from the server to the client. */
export type Direction = "up" | "down";

/**
 * The point of a fault in the stream of its direction. `ms` counts from the start of the connection. `byte` counts the
 * bytes of the direction before the fault. `frame` counts the frames of the direction before the fault. The framer of
 * the proxy sets what a frame is: a WebSocket frame, a part of an HTTP message, or a chunk of a TCP stream.
 */
export type Trigger = { readonly ms: number } | { readonly byte: number } | { readonly frame: number };

/** These fields tell where a fault occurs. Connection `i` is the connection that the proxy accepts as number `i`, from 0. */
export interface FaultPoint {
  readonly connection: number;
  readonly direction: Direction;
  readonly at: Trigger;
}

/**
 * One fault of a plan.
 *
 * - `delay`: each frame that the proxy reads in the next `forMs` goes out `ms` later. The proxy keeps reading.
 * - `stall`: the proxy stops reading the direction for `ms`. Thus the sender sees back pressure.
 * - `cut`: the proxy ends both directions with a FIN, as a clean close of TCP.
 * - `reset`: the proxy destroys both directions with a TCP reset (RST).
 * - `split`: the frame goes out in `pieces` writes, with `gapMs` between two writes.
 * - `reorder`: the next `count` frames go out in the reverse order. After `holdMs`, the proxy sends the frames that it holds.
 * - `duplicate`: the frame goes out `1 + copies` times.
 */
export type Fault = FaultPoint &
  (
    | { readonly kind: "delay"; readonly ms: number; readonly forMs: number }
    | { readonly kind: "stall"; readonly ms: number }
    | { readonly kind: "cut" }
    | { readonly kind: "reset" }
    | { readonly kind: "split"; readonly pieces: number; readonly gapMs: number }
    | { readonly kind: "reorder"; readonly count: number; readonly holdMs: number }
    | { readonly kind: "duplicate"; readonly copies: number }
  );

/** A fault plan is data, thus a record can keep the plan that a proxy applied. */
export interface FaultPlan {
  readonly format: typeof FAULT_PLAN_FORMAT;
  /** The seed of a plan from a spec, or `null` for a plan that a person wrote. */
  readonly seed: number | string | null;
  /** The faults, in the order of their connections. In a plan from a spec, the faults of a connection are in the order of their points. */
  readonly faults: readonly Fault[];
}

/** An interval of whole numbers. Both ends are included, and the low end comes first. */
export type Interval = readonly [number, number];

/** These intervals hold the parameters of the faults of a spec. */
export interface FaultRanges {
  readonly delayMs: Interval;
  readonly delayForMs: Interval;
  readonly stallMs: Interval;
  readonly splitPieces: Interval;
  readonly splitGapMs: Interval;
  readonly reorderCount: Interval;
  readonly reorderHoldMs: Interval;
  readonly duplicateCopies: Interval;
}

/** These intervals are the default parameters of a spec. */
export const DEFAULT_FAULT_RANGES: FaultRanges = {
  delayMs: [50, 2000],
  delayForMs: [100, 5000],
  stallMs: [100, 10_000],
  splitPieces: [2, 8],
  splitGapMs: [0, 50],
  reorderCount: [2, 4],
  reorderHoldMs: [100, 1000],
  duplicateCopies: [1, 2],
};

/** A spec tells `faultPlan` how many faults to draw, of which kinds, and in which part of each stream. */
export interface FaultSpec {
  /** The number of connections that the plan covers. */
  readonly connections: number;
  /** The number of faults of each connection. */
  readonly perConnection: number;
  /** The weight of each kind. A kind without a weight, or with the weight 0, does not occur. */
  readonly kinds: Partial<Readonly<Record<FaultKind, number>>>;
  /** Each point is a whole number from 0 to less than this limit, in the measure of the limit. */
  readonly within: Trigger;
  /** The directions to draw from. The default is both directions. */
  readonly directions?: readonly Direction[];
  /** The intervals of the parameters. Each interval that the spec does not give comes from `DEFAULT_FAULT_RANGES`. */
  readonly ranges?: Partial<FaultRanges>;
}

const isWhole = (value: unknown, least: number): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= least;
const isTime = (value: unknown, least: number): boolean => typeof value === "number" && Number.isFinite(value) && value >= least;

/** This function gives the measure and the value of a point, or `undefined` when the point is not valid. */
export function triggerOf(at: Trigger): { readonly measure: "ms" | "byte" | "frame"; readonly value: number } | undefined {
  if (typeof at !== "object" || at === null) return undefined;
  const keys = Object.keys(at);
  if (keys.length !== 1) return undefined;
  const measure = keys[0];
  const value = (at as Record<string, unknown>)[measure as string];
  if (measure === "ms" && isTime(value, 0)) return { measure, value: value as number };
  if ((measure === "byte" || measure === "frame") && isWhole(value, 0)) return { measure, value: value as number };
  return undefined;
}

const PARAMETERS: Readonly<Record<FaultKind, readonly (readonly [string, "time" | "whole", number])[]>> = {
  delay: [
    ["ms", "time", 1],
    ["forMs", "time", 1],
  ],
  stall: [["ms", "time", 1]],
  cut: [],
  reset: [],
  split: [
    ["pieces", "whole", 2],
    ["gapMs", "time", 0],
  ],
  reorder: [
    ["count", "whole", 2],
    ["holdMs", "time", 1],
  ],
  duplicate: [["copies", "whole", 1]],
};

/** This function gives each problem of one fault. An empty list means that the fault is valid. */
export function checkFault(fault: Fault): readonly string[] {
  const out: string[] = [];
  if (!isWhole(fault.connection, 0)) out.push(`The connection is a whole number of 0 or more, not ${String(fault.connection)}.`);
  if (fault.direction !== "up" && fault.direction !== "down") out.push(`The direction is up or down, not ${String(fault.direction)}.`);
  if (triggerOf(fault.at) === undefined) out.push(`The point has one key of ms, byte or frame, with a value of 0 or more, not ${JSON.stringify(fault.at)}.`);
  if (!(FAULT_KINDS as readonly string[]).includes(fault.kind)) {
    out.push(`The kind is one of ${FAULT_KINDS.join(", ")}, not ${String(fault.kind)}.`);
    return out;
  }
  for (const [name, type, least] of PARAMETERS[fault.kind]) {
    const value = (fault as unknown as Record<string, unknown>)[name];
    const valid = type === "whole" ? isWhole(value, least) : isTime(value, least);
    if (!valid) out.push(`The ${fault.kind} field ${name} is a ${type === "whole" ? "whole number" : "time"} of ${least} or more, not ${String(value)}.`);
  }
  return out;
}

/** This function gives each problem of a plan. An empty list means that the plan is valid. */
export function checkFaultPlan(plan: FaultPlan): readonly string[] {
  const out: string[] = [];
  if (plan.format !== FAULT_PLAN_FORMAT) out.push(`The format is ${FAULT_PLAN_FORMAT}, not ${String(plan.format)}.`);
  if (!Array.isArray(plan.faults)) return [...out, "The faults are a list."];
  plan.faults.forEach((fault, index) => {
    for (const problem of checkFault(fault)) out.push(`The fault ${index}: ${problem}`);
  });
  return out;
}

/**
 * This function makes a plan from faults that a person wrote. The faults go into the order of their connections, and the
 * faults of one connection keep their order. This function throws a `RangeError` for a fault with problems.
 */
export function faultPlanOf(faults: readonly Fault[]): FaultPlan {
  const plan: FaultPlan = { format: FAULT_PLAN_FORMAT, seed: null, faults: [...faults].sort((a, b) => a.connection - b.connection) };
  const problems = checkFaultPlan(plan);
  if (problems.length > 0) throw new RangeError(`faultPlanOf: ${problems.join(" ")}`);
  return plan;
}

/** This function gives the faults of one connection, in the order of the plan. */
export function faultsOf(plan: FaultPlan, connection: number): readonly Fault[] {
  return plan.faults.filter((fault) => fault.connection === connection);
}

/** The least value of each interval. A split has 2 pieces or more, and a reorder has 2 frames or more. */
const RANGE_LEAST: Readonly<Record<keyof FaultRanges, number>> = {
  delayMs: 1,
  delayForMs: 1,
  stallMs: 1,
  splitPieces: 2,
  splitGapMs: 0,
  reorderCount: 2,
  reorderHoldMs: 1,
  duplicateCopies: 1,
};

/** This function gives each problem of a spec. An empty list means that the spec is valid. */
export function checkFaultSpec(spec: FaultSpec): readonly string[] {
  const out: string[] = [];
  if (!isWhole(spec.connections, 1)) out.push(`The connections are a whole number of 1 or more, not ${String(spec.connections)}.`);
  if (!isWhole(spec.perConnection, 0)) out.push(`The faults of each connection are a whole number of 0 or more, not ${String(spec.perConnection)}.`);
  const weights = Object.entries(spec.kinds ?? {});
  for (const [kind, weight] of weights) {
    if (!(FAULT_KINDS as readonly string[]).includes(kind)) out.push(`The kind ${kind} is not a kind of fault.`);
    else if (!isTime(weight, 0)) out.push(`The weight of ${kind} is a number of 0 or more, not ${String(weight)}.`);
  }
  if (!weights.some(([, weight]) => typeof weight === "number" && weight > 0)) out.push("At least one kind has a weight more than 0.");
  const within = triggerOf(spec.within);
  if (within === undefined || !Number.isSafeInteger(within.value) || within.value < 1) {
    out.push(`The limit of the points has one key of ms, byte or frame, with a whole value of 1 or more, not ${JSON.stringify(spec.within)}.`);
  }
  const directions = spec.directions ?? ["up", "down"];
  if (directions.length === 0 || directions.some((d) => d !== "up" && d !== "down")) out.push(`The directions are up or down, not ${JSON.stringify(spec.directions)}.`);
  for (const [name, interval] of Object.entries(spec.ranges ?? {})) {
    if (!Object.hasOwn(RANGE_LEAST, name)) {
      out.push(`The range ${name} is not a range of a fault parameter.`);
      continue;
    }
    const [low, high] = Array.isArray(interval) ? interval : [];
    const least = RANGE_LEAST[name as keyof FaultRanges];
    if (!isWhole(low, least) || !isWhole(high, least) || (high as number) < (low as number)) {
      out.push(`The range ${name} has two whole numbers of ${least} or more, the low one first, not ${JSON.stringify(interval)}.`);
    }
  }
  return out;
}

/**
 * This function draws a fault plan from a spec and a seed. Each connection draws from its own stream, `fork` of the seed.
 * Thus a spec with more connections keeps the faults of the first connections. The faults of a connection are in the
 * order of their points. This function throws a `RangeError` for a spec with problems.
 */
export function faultPlan(spec: FaultSpec, seed: number | string): FaultPlan {
  const problems = checkFaultSpec(spec);
  if (problems.length > 0) throw new RangeError(`faultPlan: ${problems.join(" ")}`);
  const ranges: FaultRanges = { ...DEFAULT_FAULT_RANGES, ...spec.ranges };
  const kinds = FAULT_KINDS.filter((kind) => (spec.kinds[kind] ?? 0) > 0);
  const weights = kinds.map((kind) => spec.kinds[kind] as number);
  const directions = spec.directions ?? (["up", "down"] as const);
  const within = triggerOf(spec.within) as { readonly measure: "ms" | "byte" | "frame"; readonly value: number };
  const root = random(seed);
  const faults: Fault[] = [];
  for (let connection = 0; connection < spec.connections; connection += 1) {
    const rng = root.fork(`connection ${connection}`);
    const draw = (interval: Interval): number => rng.int(interval[0], interval[1]);
    const drawn: { readonly point: number; readonly fault: Fault }[] = [];
    for (let index = 0; index < spec.perConnection; index += 1) {
      const kind = kinds[rng.weighted(weights)] as FaultKind;
      const direction = rng.pick(directions);
      const point = rng.int(0, within.value - 1);
      const base = { connection, direction, at: { [within.measure]: point } as Trigger };
      const fault: Fault =
        kind === "delay"
          ? { ...base, kind, ms: draw(ranges.delayMs), forMs: draw(ranges.delayForMs) }
          : kind === "stall"
            ? { ...base, kind, ms: draw(ranges.stallMs) }
            : kind === "split"
              ? { ...base, kind, pieces: draw(ranges.splitPieces), gapMs: draw(ranges.splitGapMs) }
              : kind === "reorder"
                ? { ...base, kind, count: draw(ranges.reorderCount), holdMs: draw(ranges.reorderHoldMs) }
                : kind === "duplicate"
                  ? { ...base, kind, copies: draw(ranges.duplicateCopies) }
                  : { ...base, kind };
      drawn.push({ point, fault });
    }
    drawn.sort((a, b) => a.point - b.point);
    faults.push(...drawn.map((entry) => entry.fault));
  }
  return { format: FAULT_PLAN_FORMAT, seed, faults };
}
