import { type Fault, faultPlan, faultPlanOf } from "@mark1russell7/rigor-chaos";
import { describe, expect, it } from "vitest";
import { type Send, applierOf, splitBytes } from "./applier.ts";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const show = (sends: readonly Send[]): [string, number][] => sends.map((send) => [new TextDecoder().decode(send.bytes), send.at]);
/** A fault with no connection and no direction. The omit applies to each kind of the union. */
type Omitted<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Loose = Omitted<Fault, "connection" | "direction">;
const up = (fault: Loose): Fault => ({ connection: 0, direction: "up", ...fault }) as Fault;
const one = (...faults: Fault[]) => applierOf(faultPlanOf(faults), 0, "up");

describe("the bytes of a split", () => {
  it("go into parts of near the same length, and no part is empty", () => {
    expect(splitBytes(text("abcdefg"), 3).map((part) => part.length)).toEqual([2, 2, 3]);
    expect(splitBytes(text("ab"), 5).map((part) => part.length)).toEqual([1, 1]);
  });
});

describe("an applier", () => {
  it("sends each frame at once when no fault is due", () => {
    const applier = one(up({ at: { frame: 5 }, kind: "cut" }));
    expect(show(applier.push(text("a"), 0).sends)).toEqual([["a", 0]]);
    expect(show(applier.push(text("b"), 3).sends)).toEqual([["b", 3]]);
    expect(applier.pending().map((entry) => entry.fault.kind)).toEqual(["cut"]);
  });

  it("applies only the faults of its connection and direction", () => {
    const plan = faultPlanOf([
      { connection: 1, direction: "up", at: { frame: 0 }, kind: "cut" },
      { connection: 0, direction: "down", at: { frame: 0 }, kind: "cut" },
    ]);
    expect(applierOf(plan, 0, "up").push(text("a"), 0).close).toBeUndefined();
    expect(applierOf(plan, 0, "down").push(text("a"), 0).close?.kind).toBe("cut");
  });

  it("cuts a frame at a byte point, and drops the bytes after a cut", () => {
    const applier = one(up({ at: { byte: 3 }, kind: "cut" }));
    const step = applier.push(text("abcdef"), 10);
    expect(show(step.sends)).toEqual([["abc", 10]]);
    expect(step.close).toEqual({ kind: "cut", at: 10 });
    expect(step.records).toEqual([{ index: 0, connection: 0, direction: "up", kind: "cut", at: 10, byte: 3, frame: 0, bytes: 0 }]);
    expect(applier.push(text("x"), 11).sends).toEqual([]);
    expect(applier.wake).toBeUndefined();
  });

  it("closes after the writes that wait on a cut, and at once on a reset", () => {
    const cut = one(up({ at: { frame: 0 }, kind: "delay", ms: 100, forMs: 50 }), up({ at: { frame: 1 }, kind: "cut" }));
    expect(show(cut.push(text("a"), 0).sends)).toEqual([["a", 100]]);
    expect(cut.push(text("b"), 5).close).toEqual({ kind: "cut", at: 100 });
    const reset = one(up({ at: { frame: 0 }, kind: "delay", ms: 100, forMs: 50 }), up({ at: { frame: 1 }, kind: "reset" }));
    reset.push(text("a"), 0);
    expect(reset.push(text("b"), 5).close).toEqual({ kind: "reset", at: 5 });
  });

  it("delays each frame of the window, keeps the order, and ends the window", () => {
    const applier = one(up({ at: { ms: 10 }, kind: "delay", ms: 100, forMs: 50 }));
    expect(applier.wake).toBe(10);
    expect(show(applier.push(text("a"), 5).sends)).toEqual([["a", 5]]);
    expect(applier.tick(10).records.map((record) => record.kind)).toEqual(["delay"]);
    expect(show(applier.push(text("b"), 20).sends)).toEqual([["b", 120]]);
    expect(show(applier.push(text("c"), 59).sends)).toEqual([["c", 159]]);
    expect(show(applier.push(text("d"), 60).sends)).toEqual([["d", 159]]);
    expect(show(applier.push(text("e"), 200).sends)).toEqual([["e", 200]]);
  });

  it("stalls the direction, and holds the rest of the frame until the stall ends", () => {
    const applier = one(up({ at: { byte: 2 }, kind: "stall", ms: 300 }));
    const step = applier.push(text("abcd"), 7);
    expect(show(step.sends)).toEqual([
      ["ab", 7],
      ["cd", 307],
    ]);
    expect(step.pauseUntil).toBe(307);
  });

  it("splits a frame into pieces with gaps", () => {
    const applier = one(up({ at: { frame: 1 }, kind: "split", pieces: 3, gapMs: 4 }));
    applier.push(text("x"), 0);
    const step = applier.push(text("abcdef"), 10);
    expect(show(step.sends)).toEqual([
      ["ab", 10],
      ["cd", 14],
      ["ef", 18],
    ]);
    expect(step.records[0]).toMatchObject({ kind: "split", frame: 1, byte: 1, bytes: 6 });
  });

  it("splits at a byte point inside a frame, and applies the split to the bytes after the point", () => {
    const applier = one(up({ at: { byte: 4 }, kind: "split", pieces: 2, gapMs: 0 }));
    expect(show(applier.push(text("abcdefgh"), 0).sends)).toEqual([
      ["abcd", 0],
      ["ef", 0],
      ["gh", 0],
    ]);
  });

  it("duplicates a frame", () => {
    const applier = one(up({ at: { frame: 0 }, kind: "duplicate", copies: 2 }));
    expect(show(applier.push(text("hi"), 1).sends)).toEqual([
      ["hi", 1],
      ["hi", 1],
      ["hi", 1],
    ]);
  });

  it("applies a frame fault of a time point to the next frame", () => {
    const applier = one(up({ at: { ms: 50 }, kind: "duplicate", copies: 1 }));
    expect(applier.tick(50).records).toEqual([]);
    expect(applier.wake).toBeUndefined();
    expect(show(applier.push(text("z"), 60).sends)).toEqual([
      ["z", 60],
      ["z", 60],
    ]);
  });

  it("reverses the frames of a reorder, and sends the frames that it holds after the hold time", () => {
    const full = one(up({ at: { frame: 0 }, kind: "reorder", count: 3, holdMs: 1000 }));
    expect(full.push(text("a"), 0).sends).toEqual([]);
    expect(full.push(text("b"), 1).sends).toEqual([]);
    const step = full.push(text("c"), 2);
    expect(show(step.sends)).toEqual([
      ["c", 2],
      ["b", 2],
      ["a", 2],
    ]);
    expect(step.records[0]).toMatchObject({ kind: "reorder", at: 0, frame: 0, bytes: 3 });
    const timed = one(up({ at: { frame: 0 }, kind: "reorder", count: 3, holdMs: 100 }));
    timed.push(text("a"), 0);
    timed.push(text("b"), 1);
    expect(timed.wake).toBe(100);
    expect(show(timed.tick(100).sends)).toEqual([
      ["b", 100],
      ["a", 100],
    ]);
    const ended = one(up({ at: { frame: 0 }, kind: "reorder", count: 3, holdMs: 100 }));
    ended.push(text("a"), 0);
    expect(show(ended.end(4).sends)).toEqual([["a", 4]]);
  });

  it("applies a fault at the time 0 before the first frame", () => {
    const applier = one(up({ at: { ms: 0 }, kind: "reset" }));
    expect(applier.tick(0).close).toEqual({ kind: "reset", at: 0 });
  });

  it("keeps each byte of a stream when no fault drops bytes, and the times of the writes never go down", () => {
    const plan = faultPlan({ connections: 1, perConnection: 30, kinds: { delay: 1, stall: 1, split: 1, reorder: 1, duplicate: 0 }, within: { byte: 400 }, directions: ["up"] }, 3);
    const applier = applierOf(plan, 0, "up");
    const stream = new Uint8Array(500).map((_, i) => i % 251);
    const sends: Send[] = [];
    for (let at = 0, now = 0; at < stream.length; at += 17, now += 9) {
      sends.push(...applier.push(stream.subarray(at, at + 17), now).sends);
      const wake = applier.wake;
      if (wake !== undefined && wake <= now) sends.push(...applier.tick(now).sends);
    }
    sends.push(...applier.end(10_000).sends);
    const times = sends.map((send) => send.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const total = sends.reduce((sum, send) => sum + send.bytes.length, 0);
    expect(total).toBe(stream.length);
    const sorted = [...sends.flatMap((send) => [...send.bytes])].sort((a, b) => a - b);
    expect(sorted).toEqual([...stream].sort((a, b) => a - b));
  });
});
