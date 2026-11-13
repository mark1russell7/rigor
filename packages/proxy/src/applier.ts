import { type Direction, type Fault, type FaultKind, type FaultPlan, triggerOf } from "@mark1russell7/rigor-chaos";

/**
 * An applier puts the faults of a plan into the frames of one direction of one connection. It is pure: it reads no
 * clock and writes no socket. Each time is in ms from the start of the connection. The proxy gives it each frame
 * with the time of the read, and it gives back the writes with their times.
 */

/** One write of bytes at a time. The time of each write of one direction is the same as, or more than, the time of the write before it. */
export interface Send {
  readonly bytes: Uint8Array;
  readonly at: number;
}

/** A record of one fault that the proxy applied. */
export interface FaultRecord {
  /** The position of the fault in the list of the plan. */
  readonly index: number;
  readonly connection: number;
  readonly direction: Direction;
  readonly kind: FaultKind;
  /** The time of the fault, in ms from the start of the connection. */
  readonly at: number;
  /** The bytes of the direction before the fault. */
  readonly byte: number;
  /** The frames of the direction before the fault. */
  readonly frame: number;
  /** The bytes of the frames that a `split`, a `duplicate` or a `reorder` changed. It is 0 for the other kinds. */
  readonly bytes: number;
}

/** The result of one call to an applier. */
export interface Step {
  readonly sends: readonly Send[];
  readonly records: readonly FaultRecord[];
  /** The direction stops reading until this time. */
  readonly pauseUntil?: number;
  /** The connection closes. A `cut` closes after the writes before it, and a `reset` closes at once. */
  readonly close?: { readonly kind: "cut" | "reset"; readonly at: number };
}

/** An applier of one direction of one connection. */
export interface Applier {
  /** This method takes one frame that the proxy read at the time `now`. */
  push(frame: Uint8Array, now: number): Step;
  /** This method applies the faults that are due at the time `now`. The proxy uses it at the time `wake`. */
  tick(now: number): Step;
  /** This method sends the frames that a `reorder` holds, at the end of the stream. */
  end(now: number): Step;
  /** The next time that `tick` has work to do, or `undefined`. */
  readonly wake: number | undefined;
  /** The faults of this direction that did not occur, with their positions in the plan. */
  pending(): readonly { readonly index: number; readonly fault: Fault }[];
}

interface Entry {
  readonly index: number;
  readonly fault: Fault;
  readonly value: number;
}

interface Piece {
  readonly bytes: Uint8Array;
  readonly offset: number;
}

interface Unit {
  readonly pieces: readonly Piece[];
  readonly base: number;
}

interface Hold {
  readonly entry: Entry;
  readonly units: Unit[];
  left: number;
  readonly until: number;
  readonly at: number;
  readonly byte: number;
  readonly frame: number;
}

/** This function cuts bytes into `pieces` parts of near the same length. Each part has one byte or more. */
export function splitBytes(bytes: Uint8Array, pieces: number): Uint8Array[] {
  const count = Math.max(1, Math.min(pieces, bytes.length));
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) out.push(bytes.subarray(Math.floor((i * bytes.length) / count), Math.floor(((i + 1) * bytes.length) / count)));
  return out;
}

/** This function gives the applier of one direction of one connection of a plan. */
export function applierOf(plan: FaultPlan, connection: number, direction: Direction): Applier {
  const lists: Record<"ms" | "byte" | "frame", Entry[]> = { ms: [], byte: [], frame: [] };
  plan.faults.forEach((fault, index) => {
    if (fault.connection !== connection || fault.direction !== direction) return;
    const trigger = triggerOf(fault.at);
    if (trigger !== undefined) lists[trigger.measure].push({ index, fault, value: trigger.value });
  });
  for (const list of Object.values(lists)) list.sort((a, b) => a.value - b.value);

  const applied = new Set<number>();
  let byte = 0;
  let frame = 0;
  let last = 0;
  let closed = false;
  let delay: { readonly until: number; readonly ms: number } | undefined;
  let armed: Entry[] = [];
  let hold: Hold | undefined;

  let sends: Send[] = [];
  let records: FaultRecord[] = [];
  let pauseUntil: number | undefined;
  let close: Step["close"];

  const record = (entry: Entry, at: number, bytes: number, where: { byte: number; frame: number } = { byte, frame }): void => {
    applied.add(entry.index);
    records.push({ index: entry.index, connection, direction, kind: entry.fault.kind, at, byte: where.byte, frame: where.frame, bytes });
  };

  const schedule = (unit: Unit, now: number): void => {
    const base = Math.max(now, unit.base);
    for (const piece of unit.pieces) {
      last = Math.max(last, base + piece.offset);
      sends.push({ bytes: piece.bytes, at: last });
    }
  };

  const release = (now: number): void => {
    if (hold === undefined) return;
    const held = hold;
    hold = undefined;
    const total = held.units.reduce((sum, unit) => sum + unit.pieces.reduce((s, piece) => s + piece.bytes.length, 0), 0);
    record(held.entry, held.at, total, held);
    for (const unit of [...held.units].reverse()) schedule(unit, now);
  };

  /** This function applies one fault at the time `now`. */
  const fire = (entry: Entry, now: number): void => {
    const fault = entry.fault;
    switch (fault.kind) {
      case "cut":
      case "reset":
        release(now);
        record(entry, now, 0);
        closed = true;
        close = { kind: fault.kind, at: fault.kind === "cut" ? Math.max(now, last) : now };
        return;
      case "stall":
        record(entry, now, 0);
        pauseUntil = Math.max(pauseUntil ?? 0, now + fault.ms);
        last = Math.max(last, now + fault.ms);
        return;
      case "delay":
        record(entry, now, 0);
        delay = { until: now + fault.forMs, ms: Math.max(fault.ms, delay !== undefined && now < delay.until ? delay.ms : 0) };
        return;
      case "reorder":
        release(now);
        hold = { entry, units: [], left: fault.count, until: now + fault.holdMs, at: now, byte, frame };
        return;
      default:
        armed.push(entry);
    }
  };

  const fireUntil = (list: Entry[], value: number, now: number): void => {
    while (!closed && list.length > 0 && (list[0] as Entry).value <= value) fire(list.shift() as Entry, now);
  };

  const fireTimes = (now: number): void => {
    fireUntil(lists.ms, now, now);
    if (!closed && hold !== undefined && now >= hold.until) release(now);
  };

  /** This function sends one piece of a frame, with the faults that wait for a frame. */
  const emit = (bytes: Uint8Array, now: number): void => {
    if (delay !== undefined && now >= delay.until) delay = undefined;
    let pieces: Piece[] = [{ bytes, offset: 0 }];
    for (const entry of armed) {
      const fault = entry.fault;
      if (fault.kind === "split") {
        const parts = pieces.flatMap((piece) => splitBytes(piece.bytes, fault.pieces));
        pieces = parts.map((part, i) => ({ bytes: part, offset: i * fault.gapMs }));
      } else if (fault.kind === "duplicate") {
        const span = pieces.length === 0 ? 0 : (pieces[pieces.length - 1] as Piece).offset;
        pieces = Array.from({ length: fault.copies + 1 }, (_, copy) => pieces.map((piece) => ({ bytes: piece.bytes, offset: piece.offset + copy * span }))).flat();
      }
      record(entry, now, bytes.length);
    }
    armed = [];
    const unit: Unit = { pieces, base: now + (delay?.ms ?? 0) };
    if (hold === undefined) {
      schedule(unit, now);
      return;
    }
    hold.units.push(unit);
    hold.left -= 1;
    if (hold.left === 0) release(now);
  };

  const step = (): Step => {
    const out: Step = { sends, records, ...(pauseUntil === undefined ? {} : { pauseUntil }), ...(close === undefined ? {} : { close }) };
    sends = [];
    records = [];
    pauseUntil = undefined;
    close = undefined;
    return out;
  };

  return {
    push(bytes, now) {
      if (closed) return step();
      fireTimes(now);
      fireUntil(lists.frame, frame, now);
      let rest = bytes;
      while (!closed && rest.length > 0) {
        fireUntil(lists.byte, byte, now);
        if (closed) break;
        const next = lists.byte[0]?.value;
        const take = next !== undefined && next < byte + rest.length ? next - byte : rest.length;
        emit(rest.subarray(0, take), now);
        byte += take;
        rest = rest.subarray(take);
      }
      frame += 1;
      return step();
    },
    tick(now) {
      if (!closed) fireTimes(now);
      return step();
    },
    end(now) {
      if (!closed) release(now);
      closed = true;
      return step();
    },
    get wake() {
      if (closed) return undefined;
      const times = [lists.ms[0]?.value, hold?.until].filter((time): time is number => time !== undefined);
      return times.length === 0 ? undefined : Math.min(...times);
    },
    pending() {
      return plan.faults.flatMap((fault, index) => (fault.connection === connection && fault.direction === direction && !applied.has(index) ? [{ index, fault }] : []));
    },
  };
}
