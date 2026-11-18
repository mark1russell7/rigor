import { type Direction, type Fault, faultPlan, faultPlanOf } from "@mark1russell7/rigor-chaos";
import { describe, expect, it } from "vitest";
import { type Send, applierOf } from "./applier.ts";
import { type ConnectionStep, connectionOf } from "./connection.ts";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const show = (sends: readonly Send[]): [string, number][] => sends.map((send) => [new TextDecoder().decode(send.bytes), send.at]);
/** A fault with no connection and no direction. The omit applies to each kind of the union. */
type Omitted<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Loose = Omitted<Fault, "connection" | "direction">;
const on = (direction: Direction, fault: Loose): Fault => ({ connection: 0, direction, ...fault }) as Fault;
const of = (...faults: Fault[]) => connectionOf(faultPlanOf(faults), 0);
const answer = { kind: "answer", status: 429, fields: { "retry-after": "120" } } as const;

describe("a fault connection", () => {
  it("queues each frame of each direction at once when no fault is due, and gives each write when it is due", () => {
    const c = of(on("up", { at: { frame: 5 }, kind: "cut" }));
    expect(show(c.read("up", text("a"), 0).sends.up)).toEqual([["a", 0]]);
    expect(show(c.read("down", text("b"), 3).sends.down)).toEqual([["b", 3]]);
    expect(c.next("up")).toBe(0);
    expect(show(c.due("up", 0))).toEqual([["a", 0]]);
    expect(c.due("up", 10)).toEqual([]);
    expect(c.next("up")).toBeUndefined();
    expect(show(c.due("down", 2))).toEqual([]);
    expect(show(c.due("down", 3))).toEqual([["b", 3]]);
    expect(c.close).toBeUndefined();
    expect(c.pending().map((entry) => entry.fault.kind)).toEqual(["cut"]);
  });

  it("stops the reads of a direction until the latest end of its stalls", () => {
    const c = of(
      on("up", { at: { ms: 0 }, kind: "stall", ms: 400 }),
      on("up", { at: { ms: 100 }, kind: "stall", ms: 50 }),
      on("up", { at: { ms: 300 }, kind: "stall", ms: 200 }),
    );
    expect(c.tick("up", 0).pauses).toEqual([{ direction: "up", from: 0, until: 400 }]);
    expect(c.pausedUntil("up")).toBe(400);
    expect(c.pausedUntil("down")).toBe(0);
    expect(c.wake("up")).toBe(100);
    // A shorter stall inside the pause has its record, and the pause keeps its end.
    const inside = c.tick("up", 100);
    expect(inside.records.map((record) => record.kind)).toEqual(["stall"]);
    expect(inside.pauses).toEqual([]);
    expect(c.pausedUntil("up")).toBe(400);
    expect(c.tick("up", 300).pauses).toEqual([{ direction: "up", from: 300, until: 500 }]);
    expect(c.pausedUntil("up")).toBe(500);
  });

  it("ends the two appliers on a cut: the frames that a reorder holds go out, and each target ends after its writes", () => {
    const c = of(on("down", { at: { frame: 0 }, kind: "reorder", count: 3, holdMs: 1000 }), on("up", { at: { frame: 1 }, kind: "cut" }));
    expect(c.read("down", text("x"), 0).sends.down).toEqual([]);
    expect(c.read("down", text("y"), 10).sends.down).toEqual([]);
    expect(c.wake("down")).toBe(1000);
    c.read("up", text("a"), 0);
    const step = c.read("up", text("b"), 20);
    expect(step.close).toEqual({ kind: "cut", at: 20, direction: "up" });
    expect(c.close).toEqual(step.close);
    expect(show(step.sends.up)).toEqual([]);
    expect(show(step.sends.down)).toEqual([
      ["y", 20],
      ["x", 20],
    ]);
    expect(step.records.map((record) => [record.direction, record.kind])).toEqual([
      ["up", "cut"],
      ["down", "reorder"],
    ]);
    expect([c.ending("up"), c.ending("down")]).toEqual([true, true]);
    expect([c.wake("up"), c.wake("down")]).toEqual([undefined, undefined]);
    // A closed connection takes no frame and no tick.
    const empty: ConnectionStep = { records: [], sends: { up: [], down: [] }, pauses: [], lost: { up: [], down: [] } };
    expect(c.read("down", text("z"), 30)).toEqual(empty);
    expect(c.tick("down", 1000)).toEqual(empty);
    expect(c.end("down", 40)).toEqual(empty);
  });

  it("closes at once on a reset: each write after the reset is lost, and each write at or before it stays due", () => {
    const c = of(on("up", { at: { frame: 0 }, kind: "delay", ms: 100, forMs: 1000 }), on("down", { at: { ms: 50 }, kind: "reset" }));
    expect(show(c.read("up", text("a"), 0).sends.up)).toEqual([["a", 100]]);
    expect(show(c.read("down", text("d"), 10).sends.down)).toEqual([["d", 10]]);
    expect(c.wake("down")).toBe(50);
    const step = c.tick("down", 50);
    expect(step.close).toEqual({ kind: "reset", at: 50, direction: "down" });
    expect(show(step.lost.up)).toEqual([["a", 100]]);
    expect(step.lost.down).toEqual([]);
    expect(c.due("up", 1000)).toEqual([]);
    expect(show(c.due("down", 50))).toEqual([["d", 10]]);
    expect([c.ending("up"), c.ending("down")]).toEqual([false, false]);
  });

  it("sends no write of the server to the client after an answer", () => {
    const c = of(on("down", { at: { frame: 0 }, kind: "reorder", count: 3, holdMs: 1000 }), on("up", { at: { frame: 0 }, ...answer }));
    c.read("down", text("server"), 0);
    const step = c.read("up", text("GET / HTTP/1.1\r\n\r\n"), 5);
    expect(step.sends.up).toEqual([]);
    expect(step.sends.down.map((send) => new TextDecoder().decode(send.bytes).split("\r\n")[0])).toEqual(["HTTP/1.1 429 Too Many Requests"]);
    expect(step.close).toEqual({ kind: "cut", at: 5, direction: "up" });
    expect(step.records.map((record) => record.kind)).toEqual(["answer", "reorder"]);
  });

  it("ends a stream once: the frames that a reorder holds go out, and the target of the direction ends after its writes", () => {
    const c = of(on("up", { at: { frame: 0 }, kind: "reorder", count: 3, holdMs: 100 }));
    c.read("up", text("a"), 0);
    expect(c.ending("up")).toBe(false);
    expect(show(c.end("up", 4).sends.up)).toEqual([["a", 4]]);
    expect([c.ending("up"), c.ending("down")]).toEqual([true, false]);
    expect(c.wake("up")).toBeUndefined();
    expect(c.end("up", 5).sends.up).toEqual([]);
    expect(c.close).toBeUndefined();
  });

  it("gives the writes of each applier of a plan with no cut, no reset, no stall and no answer", () => {
    const plan = faultPlan({ connections: 2, perConnection: 4, kinds: { delay: 1, split: 1, reorder: 1, duplicate: 1 }, within: { frame: 8 } }, 7);
    for (const connection of [0, 1]) {
      const c = connectionOf(plan, connection, 25);
      for (const direction of ["up", "down"] as const) {
        const applier = applierOf(plan, connection, direction, 25);
        const expected: Send[] = [];
        const got: Send[] = [];
        for (let i = 0; i < 8; i += 1) {
          expected.push(...applier.push(text(`f${i}`), i * 10).sends);
          got.push(...c.read(direction, text(`f${i}`), i * 10).sends[direction]);
        }
        expected.push(...applier.end(90).sends);
        got.push(...c.end(direction, 90).sends[direction]);
        expect({ connection, direction, sends: show(got) }).toEqual({ connection, direction, sends: show(expected) });
      }
      expect(c.pending()).toEqual([]);
    }
  });
});
