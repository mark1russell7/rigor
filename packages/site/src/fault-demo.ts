/**
 * The pure part of the fault-plan demo. `faultPlan` of `@mark1russell7/rigor-chaos` draws the plan, and `applierOf` of
 * `@mark1russell7/rigor-proxy` applies it. This module only gives frames to the applier of each direction, at their times.
 *
 * The rules of a connection come from the proxy (`proxy.ts`), because the proxy uses sockets and a browser has none:
 * a pause stops the reads of one direction, a cut ends both appliers, and a reset loses each write that waits.
 * If a second user needs these rules without sockets, they move to the entry `rigor-proxy/applier`.
 */
import { type Direction, type Fault, type FaultKind, type FaultPlan, type FaultRanges, type FaultSpec, FAULT_KINDS, faultPlan } from "@mark1russell7/rigor-chaos";
import { type Applier, type FaultRecord, type Step, applierOf } from "@mark1russell7/rigor-proxy/applier";
import { seedFrom } from "./seed.ts";

/** The frames of each direction of each connection. */
export const FRAMES = 10;
/** The time between two frames of one direction, in ms. */
export const FRAME_GAP_MS = 100;
/** The server sends each down frame this long after the up frame of the same number, in ms. */
export const DOWN_LAG_MS = 40;
/** The bytes of each frame. Each byte of frame `i` has the value `i`, so each write tells its frame. */
export const FRAME_BYTES = 8;
/** Each side ends its stream this long after its last frame, in ms. */
export const END_GAP_MS = 100;

/** The parameters of the faults of the page. They are shorter than the defaults, so each fault fits the 1 s of the frames. */
export const DEMO_RANGES: FaultRanges = {
  delayMs: [50, 300],
  delayForMs: [100, 500],
  stallMs: [100, 400],
  splitPieces: [2, 4],
  splitGapMs: [5, 30],
  reorderCount: [2, 4],
  reorderHoldMs: [100, 400],
  duplicateCopies: [1, 2],
};

export type DirectionChoice = "both" | Direction;

/** The settings of the demo. Each kind in `kinds` has the weight 1. */
export interface FaultDemo {
  readonly seed: string;
  readonly connections: number;
  readonly perConnection: number;
  readonly kinds: readonly FaultKind[];
  readonly directions: DirectionChoice;
}

export const CONNECTION_CHOICES: readonly number[] = [1, 2, 3];
export const FAULT_CHOICES: readonly number[] = [1, 2, 3, 4];
export const DIRECTION_CHOICES: readonly DirectionChoice[] = ["both", "up", "down"];

/** The settings of the page when it opens. */
export const DEMO_START: FaultDemo = { seed: "42", connections: 2, perConnection: 3, kinds: FAULT_KINDS, directions: "both" };

/** What each kind does, in one sentence. The page shows it on the chip of the kind. */
export const KIND_TEXT: Readonly<Record<FaultKind, string>> = {
  delay: "Each frame of the next forMs goes out ms later.",
  stall: "The proxy reads nothing from the direction for ms.",
  cut: "The proxy ends both directions with a FIN.",
  reset: "The proxy destroys both directions with an RST.",
  split: "The frame goes out in pieces, with a gap between two pieces.",
  reorder: "The next frames go out in the reverse order.",
  duplicate: "The frame goes out more than one time.",
};

/** The heads of the columns of the table of faults. On a narrow screen, each cell shows its head. */
export const RECORD_HEADS = ["Fault", "Connection", "Direction", "Kind", "Point", "Parameters", "Time (ms)", "Bytes"] as const;

/** One write of the proxy: the frame of its bytes, the count of its bytes and its time. A reset loses each write after it. */
export interface DemoWrite {
  readonly frame: number;
  readonly bytes: number;
  readonly at: number;
  readonly lost: boolean;
}

/** One frame of a direction: its time of arrival at the proxy, its time of read, and its writes. */
export interface DemoFrame {
  readonly index: number;
  readonly arrives: number;
  /** The time of the read. A frame that arrives after a close has no read. */
  readonly read: number | undefined;
  readonly writes: readonly DemoWrite[];
}

/** The outcome of a frame: `same` for one whole write at its time of arrival, `lost` for no write that went out. */
export type FrameOutcome = "same" | "changed" | "lost";

/** One direction of a connection. */
export interface DemoLane {
  readonly direction: Direction;
  readonly frames: readonly DemoFrame[];
  /** The writes, in the order of the applier. */
  readonly writes: readonly DemoWrite[];
  /** The times when the proxy reads nothing from this direction, from a `stall`. */
  readonly pauses: readonly { readonly from: number; readonly until: number }[];
}

/** One connection: its two directions, the records of its faults, the faults that did not occur, and its close. */
export interface DemoConnection {
  readonly connection: number;
  readonly lanes: readonly [DemoLane, DemoLane];
  readonly records: readonly FaultRecord[];
  readonly pending: readonly { readonly index: number; readonly fault: Fault }[];
  readonly close: { readonly kind: "cut" | "reset"; readonly at: number; readonly direction: Direction } | undefined;
}

/** The result of the demo. `end` is the last time of the diagram, in ms. */
export interface DemoRun {
  readonly spec: FaultSpec;
  readonly plan: FaultPlan;
  readonly connections: readonly DemoConnection[];
  readonly end: number;
}

/** This function gives the spec of `faultPlan` for the settings: the points are frames from 0 to `FRAMES` less 1. */
export function demoSpec(demo: FaultDemo): FaultSpec {
  return {
    connections: demo.connections,
    perConnection: demo.perConnection,
    kinds: Object.fromEntries(demo.kinds.map((kind) => [kind, 1])),
    within: { frame: FRAMES },
    directions: demo.directions === "both" ? ["up", "down"] : [demo.directions],
    ranges: DEMO_RANGES,
  };
}

/** This function gives the time of arrival of frame `index` of a direction, in ms from the start of the connection. */
export const arrivalOf = (direction: Direction, index: number): number => index * FRAME_GAP_MS + (direction === "down" ? DOWN_LAG_MS : 0);

/** This function gives the bytes of frame `index`. */
export const frameBytes = (index: number): Uint8Array => new Uint8Array(FRAME_BYTES).fill(index);

const DIRECTIONS = ["up", "down"] as const;

interface Event {
  readonly time: number;
  readonly direction: Direction;
  readonly kind: "wake" | "read" | "end";
}

const ORDER: Readonly<Record<Event["kind"], number>> = { wake: 0, read: 1, end: 2 };
const before = (a: Event, b: Event): boolean => a.time < b.time || (a.time === b.time && (ORDER[a.kind] < ORDER[b.kind] || (ORDER[a.kind] === ORDER[b.kind] && a.direction === "up" && b.direction === "down")));

/** This function gives the frames of one connection to its two appliers in the order of time, and keeps each result. */
function runConnection(plan: FaultPlan, connection: number): DemoConnection {
  const appliers: Record<Direction, Applier> = { up: applierOf(plan, connection, "up"), down: applierOf(plan, connection, "down") };
  const frames: Record<Direction, { index: number; arrives: number; read: number | undefined; writes: DemoWrite[] }[]> = {
    up: Array.from({ length: FRAMES }, (_, index) => ({ index, arrives: arrivalOf("up", index), read: undefined, writes: [] })),
    down: Array.from({ length: FRAMES }, (_, index) => ({ index, arrives: arrivalOf("down", index), read: undefined, writes: [] })),
  };
  const writes: Record<Direction, { frame: number; bytes: number; at: number; lost: boolean }[]> = { up: [], down: [] };
  const pauses: Record<Direction, { from: number; until: number }[]> = { up: [], down: [] };
  const state: Record<Direction, { next: number; paused: number; ended: boolean }> = { up: { next: 0, paused: 0, ended: false }, down: { next: 0, paused: 0, ended: false } };
  const records: FaultRecord[] = [];
  let close: DemoConnection["close"];

  const apply = (direction: Direction, step: Step, now: number): void => {
    records.push(...step.records);
    for (const send of step.sends) {
      const write = { frame: send.bytes[0] ?? 0, bytes: send.bytes.length, at: send.at, lost: false };
      writes[direction].push(write);
      frames[direction][write.frame]?.writes.push(write);
    }
    if (step.pauseUntil !== undefined) {
      state[direction].paused = Math.max(state[direction].paused, step.pauseUntil);
      pauses[direction].push({ from: now, until: step.pauseUntil });
    }
    if (step.close === undefined || close !== undefined) return;
    close = { kind: step.close.kind, at: step.close.at, direction };
    if (step.close.kind === "reset") {
      // The proxy destroys both sockets at once, thus each write that waits does not go out.
      for (const d of DIRECTIONS) for (const write of writes[d]) if (write.at > step.close.at) write.lost = true;
      return;
    }
    // A cut ends both appliers. Each frame that a reorder holds goes out, and then each side sends a FIN.
    for (const d of DIRECTIONS) apply(d, appliers[d].end(now), now);
  };

  // Each pass takes the first event: a wake of an applier, the read of the next frame, or the end of a stream.
  for (let guard = 0; close === undefined && guard < 10_000; guard += 1) {
    let next: Event | undefined;
    const consider = (event: Event): void => {
      if (next === undefined || before(event, next)) next = event;
    };
    for (const direction of DIRECTIONS) {
      const s = state[direction];
      if (s.ended) continue;
      const wake = appliers[direction].wake;
      if (wake !== undefined) consider({ time: wake, direction, kind: "wake" });
      const arrives = s.next < FRAMES ? arrivalOf(direction, s.next) : arrivalOf(direction, FRAMES - 1) + END_GAP_MS;
      consider({ time: Math.max(arrives, s.paused), direction, kind: s.next < FRAMES ? "read" : "end" });
    }
    if (next === undefined) break;
    const { time, direction, kind } = next;
    const s = state[direction];
    if (kind === "wake") apply(direction, appliers[direction].tick(time), time);
    else if (kind === "read") {
      const frame = frames[direction][s.next];
      if (frame !== undefined) frame.read = time;
      apply(direction, appliers[direction].push(frameBytes(s.next), time), time);
      s.next += 1;
    } else {
      apply(direction, appliers[direction].end(time), time);
      s.ended = true;
    }
  }

  const lane = (direction: Direction): DemoLane => ({ direction, frames: frames[direction], writes: writes[direction], pauses: pauses[direction] });
  const pending = [...appliers.up.pending(), ...appliers.down.pending()].sort((a, b) => a.index - b.index);
  return { connection, lanes: [lane("up"), lane("down")], records, pending, close };
}

/** This function draws the plan of the settings and applies it. One seed gives the same result each time, in Node and in each browser. */
export function runDemo(demo: FaultDemo): DemoRun {
  const spec = demoSpec(demo);
  const plan = faultPlan(spec, seedFrom(demo.seed));
  const connections = Array.from({ length: demo.connections }, (_, c) => runConnection(plan, c));
  let end = arrivalOf("down", FRAMES - 1) + END_GAP_MS;
  for (const c of connections) {
    if (c.close !== undefined) end = Math.max(end, c.close.at);
    for (const lane of c.lanes) {
      for (const write of lane.writes) end = Math.max(end, write.at);
      for (const pause of lane.pauses) end = Math.max(end, pause.until);
    }
  }
  return { spec, plan, connections, end };
}

/** This function gives the outcome of a frame. A frame with a lost write and a write that went out is `changed`. */
export function frameOutcome(frame: DemoFrame): FrameOutcome {
  const out = frame.writes.filter((write) => !write.lost);
  if (frame.read === undefined || out.length === 0) return "lost";
  const only = frame.writes[0];
  return frame.writes.length === 1 && only !== undefined && only.at === frame.arrives && only.bytes === FRAME_BYTES ? "same" : "changed";
}

/** The counts of a run: the faults of the plan, the faults that occurred, and the frames of each outcome. */
export interface DemoCounts {
  readonly faults: number;
  readonly occurred: number;
  readonly pending: number;
  readonly frames: number;
  readonly same: number;
  readonly changed: number;
  readonly lost: number;
}

export function demoCounts(run: DemoRun): DemoCounts {
  const counts = { faults: run.plan.faults.length, occurred: 0, pending: 0, frames: 0, same: 0, changed: 0, lost: 0 };
  for (const c of run.connections) {
    counts.occurred += c.records.length;
    counts.pending += c.pending.length;
    for (const lane of c.lanes) {
      for (const frame of lane.frames) {
        counts.frames += 1;
        counts[frameOutcome(frame)] += 1;
      }
    }
  }
  return counts;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** This function gives one plain sentence about the counts. */
export function summaryText(counts: DemoCounts): string {
  const faults = `The plan has ${plural(counts.faults, "fault", "faults")}.`;
  const occurred = counts.pending === 0 ? " Each one occurred." : ` ${counts.occurred} occurred. ${plural(counts.pending, "fault did", "faults did")} not occur, because the connection closed before the point.`;
  return `${faults}${occurred} Of the ${counts.frames} frames, ${counts.same} went through with no change, ${counts.changed} changed and ${counts.lost} did not go through.`;
}

/** This function gives the parameters of a fault as text, for example `250 ms for 400 ms` for a delay. */
export function faultText(fault: Fault): string {
  switch (fault.kind) {
    case "delay":
      return `${fault.ms} ms for ${fault.forMs} ms`;
    case "stall":
      return `${fault.ms} ms`;
    case "split":
      return `${fault.pieces} pieces, ${fault.gapMs} ms apart`;
    case "reorder":
      return `${fault.count} frames, held up to ${fault.holdMs} ms`;
    case "duplicate":
      return plural(fault.copies, "copy", "copies");
    case "cut":
      return "a FIN";
    case "reset":
      return "an RST";
    case "answer":
      return `HTTP ${fault.status}`;
  }
}

/** This function gives the point of a fault as text, for example `frame 3`. */
export function pointText(fault: Fault): string {
  const [measure, value] = Object.entries(fault.at)[0] ?? ["frame", 0];
  return `${measure} ${String(value)}`;
}

/** This function gives the code of the calls that the page makes. */
export function demoCode(demo: FaultDemo): string {
  const spec = demoSpec(demo);
  const kinds = Object.keys(spec.kinds).map((kind) => `${kind}: 1`).join(", ");
  const directions = (spec.directions ?? []).map((d) => JSON.stringify(d)).join(", ");
  return `import { faultPlan } from "@mark1russell7/rigor-chaos";
import { applierOf } from "@mark1russell7/rigor-proxy/applier";

const plan = faultPlan({
  connections: ${spec.connections},
  perConnection: ${spec.perConnection},
  kinds: { ${kinds} },
  within: { frame: ${FRAMES} },
  directions: [${directions}],
  ranges: { delayMs: [50, 300], stallMs: [100, 400] /* and the others of the page */ },
}, ${JSON.stringify(seedFrom(demo.seed))});

const up = applierOf(plan, 0, "up");
const step = up.push(frame, now); // step.sends, step.records, step.pauseUntil, step.close`;
}
