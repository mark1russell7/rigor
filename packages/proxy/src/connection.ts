import type { Direction, Fault, FaultPlan } from "@mark1russell7/rigor-chaos";
import { type Applier, type FaultRecord, type Send, type Step, applierOf } from "./applier.ts";

/**
 * A fault connection holds the appliers of the two directions of one connection, the writes that wait, and the rules
 * between the two directions. It is pure: it reads no clock and writes no socket. The proxy gives it the frames of its
 * sockets, and a browser can give it frames of its own. Each time is in ms from the start of the connection.
 *
 * - A stall stops the reads of its direction until the latest end of the stalls of that direction.
 * - A cut ends the two appliers. Each write that waits goes out, and then each target gets a FIN.
 * - A reset closes the connection at once. Each write with a time after the reset is lost.
 * - After an answer, no write of the server goes to the client.
 */

/** A stall that moves the end of the pause of a direction: the direction reads nothing from `from` until `until`. */
export interface ConnectionPause {
  readonly direction: Direction;
  readonly from: number;
  readonly until: number;
}

/** The close of a connection: its kind, its time, and the direction of the fault. A `cut` goes out after the writes before it. */
export interface ConnectionClose {
  readonly kind: "cut" | "reset";
  readonly at: number;
  readonly direction: Direction;
}

/** The result of one call to a fault connection. */
export interface ConnectionStep {
  /** The records of the faults that occurred, in order. */
  readonly records: readonly FaultRecord[];
  /** The writes that each direction added to its queue, in order of time. */
  readonly sends: Readonly<Record<Direction, readonly Send[]>>;
  /** Each stall that moved the end of a pause. A stall inside a longer pause has a record and no pause. */
  readonly pauses: readonly ConnectionPause[];
  /** The close of the connection, when the connection closed in this call. */
  readonly close?: ConnectionClose;
  /** The writes that a reset lost: each write of the queues with a time after the reset. */
  readonly lost: Readonly<Record<Direction, readonly Send[]>>;
}

/** The two directions of a connection and the rules between them. `connectionOf` makes one. */
export interface FaultConnection {
  /** This method takes one frame of a direction that the proxy read at the time `now`. A closed connection takes no frame. */
  read(direction: Direction, frame: Uint8Array, now: number): ConnectionStep;
  /** This method applies the faults of a direction that are due at the time `now`. The proxy uses it at the time `wake`. */
  tick(direction: Direction, now: number): ConnectionStep;
  /** This method takes the end of the stream of a direction. The frames that a `reorder` holds go out. */
  end(direction: Direction, now: number): ConnectionStep;
  /** This method gives the next time that `tick` has work to do in a direction. It gives `undefined` after the close. */
  wake(direction: Direction): number | undefined;
  /** This method gives the time before which the direction reads nothing. It gives 0 before the first stall. */
  pausedUntil(direction: Direction): number;
  /** This method removes the writes of a direction with a time at or before `now` from its queue, and gives them in order. */
  due(direction: Direction, now: number): Send[];
  /** This method gives the time of the first write that waits in a direction, or `undefined` for an empty queue. */
  next(direction: Direction): number | undefined;
  /** This method is true after the end of the stream of a direction, and after a cut. The target ends after its last write. */
  ending(direction: Direction): boolean;
  /** The close of the connection, or `undefined` while the connection is open. */
  readonly close: ConnectionClose | undefined;
  /** This method gives the faults of the connection that did not occur, in the order of the plan. */
  pending(): readonly { readonly index: number; readonly fault: Fault }[];
}

const DIRECTIONS = ["up", "down"] as const;

interface Draft {
  readonly records: FaultRecord[];
  readonly sends: Record<Direction, Send[]>;
  readonly pauses: ConnectionPause[];
  close?: ConnectionClose;
  readonly lost: Record<Direction, Send[]>;
}

const draft = (): Draft => ({ records: [], sends: { up: [], down: [] }, pauses: [], lost: { up: [], down: [] } });

/**
 * This function gives the fault connection of one connection of a plan. `opened` is the start of the connection, in ms
 * from the start of the plan. The windows of the plan count from the start of the plan.
 */
export function connectionOf(plan: FaultPlan, connection: number, opened = 0): FaultConnection {
  const appliers: Record<Direction, Applier> = { up: applierOf(plan, connection, "up", opened), down: applierOf(plan, connection, "down", opened) };
  const queues: Record<Direction, Send[]> = { up: [], down: [] };
  const paused: Record<Direction, number> = { up: 0, down: 0 };
  const ended: Record<Direction, boolean> = { up: false, down: false };
  let close: ConnectionClose | undefined;
  /** After an answer, no write of the server goes to the client. */
  let answered = false;
  let out = draft();

  const queue = (direction: Direction, send: Send): void => {
    queues[direction].push(send);
    out.sends[direction].push(send);
  };

  const shut = (direction: Direction, kind: "cut" | "reset", at: number, now: number): void => {
    close = { kind, at, direction };
    out.close = close;
    if (kind === "reset") {
      for (const d of DIRECTIONS) {
        out.lost[d].push(...queues[d].filter((send) => send.at > at));
        queues[d] = queues[d].filter((send) => send.at <= at);
      }
      return;
    }
    // Each frame that a reorder holds goes out before the FIN.
    for (const d of DIRECTIONS) {
      apply(d, appliers[d].end(now), now);
      ended[d] = true;
    }
  };

  function apply(direction: Direction, step: Step, now: number): void {
    out.records.push(...step.records);
    if (!(answered && direction === "down")) for (const send of step.sends) queue(direction, send);
    if (step.answer !== undefined && !answered) {
      answered = true;
      queue("down", step.answer);
    }
    if (step.pauseUntil !== undefined && step.pauseUntil > paused[direction]) {
      paused[direction] = step.pauseUntil;
      out.pauses.push({ direction, from: now, until: step.pauseUntil });
    }
    if (step.close !== undefined && close === undefined) shut(direction, step.close.kind, step.close.at, now);
  }

  const run = (direction: Direction, now: number, step: Step): ConnectionStep => {
    out = draft();
    apply(direction, step, now);
    return out;
  };

  return {
    read(direction, frame, now) {
      return close === undefined ? run(direction, now, appliers[direction].push(frame, now)) : draft();
    },
    tick(direction, now) {
      return close === undefined ? run(direction, now, appliers[direction].tick(now)) : draft();
    },
    end(direction, now) {
      if (close !== undefined || ended[direction]) return draft();
      const step = run(direction, now, appliers[direction].end(now));
      ended[direction] = true;
      return step;
    },
    wake(direction) {
      return close === undefined ? appliers[direction].wake : undefined;
    },
    pausedUntil(direction) {
      return paused[direction];
    },
    due(direction, now) {
      const q = queues[direction];
      let count = 0;
      while (count < q.length && (q[count] as Send).at <= now) count += 1;
      return q.splice(0, count);
    },
    next(direction) {
      return queues[direction][0]?.at;
    },
    ending(direction) {
      return ended[direction];
    },
    get close() {
      return close;
    },
    pending() {
      return [...appliers.up.pending(), ...appliers.down.pending()].sort((a, b) => a.index - b.index);
    },
  };
}
