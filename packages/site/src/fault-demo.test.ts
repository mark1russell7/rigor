import { describe, expect, it } from "vitest";
import { type FaultKind, FAULT_KINDS } from "@mark1russell7/rigor-chaos";
import {
  type DemoLane,
  type DemoRun,
  type FaultDemo,
  CONNECTION_CHOICES,
  DEMO_START,
  DIRECTION_CHOICES,
  FAULT_CHOICES,
  FRAME_BYTES,
  FRAMES,
  arrivalOf,
  demoCode,
  demoCounts,
  faultText,
  frameOutcome,
  pointText,
  runDemo,
  summaryText,
} from "./fault-demo.ts";

const SEEDS = ["1", "2", "3", "4", "5"];

/** The runs of one kind of fault: three connections with one fault each, for each seed. */
const runsOf = (kind: FaultKind, perConnection = 1): DemoRun[] =>
  SEEDS.map((seed) => runDemo({ seed, connections: 3, perConnection, kinds: [kind], directions: "both" }));

const lanesOf = (run: DemoRun): DemoLane[] => run.connections.flatMap((c) => [...c.lanes]);
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe("runDemo", () => {
  it("gives the same run for the same settings, and a new plan for a new seed", () => {
    expect(runDemo(DEMO_START)).toEqual(runDemo(DEMO_START));
    expect(JSON.stringify(runDemo({ ...DEMO_START, seed: "43" }).plan)).not.toBe(JSON.stringify(runDemo(DEMO_START).plan));
  });

  it("draws a plan of the settings, with each point in the frames of a direction", () => {
    const run = runDemo({ seed: "9", connections: 3, perConnection: 4, kinds: FAULT_KINDS, directions: "up" });
    expect(run.plan.faults).toHaveLength(12);
    for (const fault of run.plan.faults) {
      expect(fault.direction).toBe("up");
      expect("frame" in fault.at && fault.at.frame >= 0 && fault.at.frame < FRAMES).toBe(true);
    }
  });

  it("keeps the writes of each direction in the order of time", () => {
    for (const kind of FAULT_KINDS) {
      for (const run of runsOf(kind, 3)) {
        for (const lane of lanesOf(run)) {
          for (let i = 1; i < lane.writes.length; i++) expect(lane.writes[i]!.at >= lane.writes[i - 1]!.at).toBe(true);
        }
      }
    }
  });

  it("delays a frame: each frame goes out whole, at or after its arrival", () => {
    for (const run of runsOf("delay", 2)) {
      for (const lane of lanesOf(run)) {
        for (const frame of lane.frames) {
          expect(frame.read).toBe(frame.arrives);
          expect(sum(frame.writes.map((w) => w.bytes))).toBe(FRAME_BYTES);
          for (const write of frame.writes) expect(write.at >= frame.arrives && !write.lost).toBe(true);
        }
      }
      expect(run.connections.every((c) => c.close === undefined)).toBe(true);
      expect(demoCounts(run).changed).toBeGreaterThan(0);
    }
  });

  it("cuts a connection: the proxy reads no frame after the cut", () => {
    for (const run of runsOf("cut")) {
      for (const c of run.connections) {
        const close = c.close;
        expect(close?.kind).toBe("cut");
        if (close === undefined) continue;
        for (const lane of c.lanes) {
          for (const frame of lane.frames) {
            if (frame.arrives > close.at) expect(frame.read).toBe(undefined);
            if (frame.read !== undefined) expect(frame.read).toBeLessThanOrEqual(close.at);
            expect(frame.writes.some((w) => w.lost)).toBe(false);
          }
        }
      }
    }
    expect(sum(runsOf("cut").map((run) => demoCounts(run).lost))).toBeGreaterThan(0);
  });

  it("resets a connection: each write after the reset is lost", () => {
    for (const run of runsOf("reset")) {
      for (const c of run.connections) {
        const close = c.close;
        expect(close?.kind).toBe("reset");
        if (close === undefined) continue;
        for (const lane of c.lanes) for (const write of lane.writes) expect(write.lost).toBe(write.at > close.at);
      }
    }
  });

  it("duplicates a frame: the frame goes out 1 + copies times", () => {
    for (const run of runsOf("duplicate")) {
      for (const c of run.connections) {
        for (const record of c.records) {
          const fault = run.plan.faults[record.index];
          if (fault?.kind !== "duplicate") throw new Error("not a duplicate");
          const frame = c.lanes[record.direction === "up" ? 0 : 1].frames[record.frame]!;
          expect(frame.writes).toHaveLength(1 + fault.copies);
          for (const write of frame.writes) expect(write.bytes).toBe(FRAME_BYTES);
          expect(frameOutcome(frame)).toBe("changed");
        }
      }
    }
  });

  it("splits a frame: the pieces have the bytes of the frame", () => {
    for (const run of runsOf("split")) {
      for (const c of run.connections) {
        for (const record of c.records) {
          const fault = run.plan.faults[record.index];
          if (fault?.kind !== "split") throw new Error("not a split");
          const frame = c.lanes[record.direction === "up" ? 0 : 1].frames[record.frame]!;
          expect(frame.writes).toHaveLength(fault.pieces);
          expect(sum(frame.writes.map((w) => w.bytes))).toBe(FRAME_BYTES);
        }
      }
    }
  });

  it("reorders frames: a later frame goes out before an earlier frame", () => {
    const reversed = runsOf("reorder").flatMap(lanesOf).filter((lane) => lane.writes.some((w, i) => i > 0 && w.frame < lane.writes[i - 1]!.frame));
    expect(reversed.length).toBeGreaterThan(0);
  });

  it("stalls a direction: the proxy reads no frame of it before the end of the stall", () => {
    let paused = 0;
    for (const run of runsOf("stall", 2)) {
      for (const lane of lanesOf(run)) {
        for (const pause of lane.pauses) {
          paused += 1;
          for (const frame of lane.frames) {
            if (frame.arrives >= pause.from && frame.arrives < pause.until) expect(frame.read! >= pause.until).toBe(true);
          }
        }
        for (const frame of lane.frames) expect(frame.read! >= frame.arrives).toBe(true);
      }
    }
    expect(paused).toBeGreaterThan(0);
  });

  it("gives each fault of a connection a record or a place in the list of faults that did not occur", () => {
    for (const connections of CONNECTION_CHOICES) {
      for (const perConnection of FAULT_CHOICES) {
        for (const directions of DIRECTION_CHOICES) {
          for (const kinds of [FAULT_KINDS, ...FAULT_KINDS.map((k) => [k])]) {
            for (const seed of SEEDS.slice(0, 2)) {
              const demo: FaultDemo = { seed, connections, perConnection, kinds, directions };
              const run = runDemo(demo);
              for (const c of run.connections) {
                const mine = run.plan.faults.flatMap((f, index) => (f.connection === c.connection ? [index] : [])).sort((a, b) => a - b);
                const seen = [...c.records.map((r) => r.index), ...c.pending.map((p) => p.index)].sort((a, b) => a - b);
                expect(seen).toEqual(mine);
              }
              const counts = demoCounts(run);
              expect(counts.frames).toBe(connections * 2 * FRAMES);
              expect(counts.same + counts.changed + counts.lost).toBe(counts.frames);
              expect(counts.occurred + counts.pending).toBe(connections * perConnection);
            }
          }
        }
      }
    }
  });

  it("gives the run that the probe of the page expects: 3 connections of cuts with the start seed", () => {
    const run = runDemo({ ...DEMO_START, connections: 3, kinds: ["cut"] });
    expect(run.connections.filter((c) => c.close !== undefined)).toHaveLength(3);
    expect(demoCounts(run).lost).toBeGreaterThan(0);
    expect(sum(run.connections.map((c) => c.records.length + c.pending.length))).toBe(9);
    expect(lanesOf(runDemo(DEMO_START)).flatMap((lane) => lane.frames)).toHaveLength(40);
  });

  it("starts the down frames after the up frames", () => {
    expect(arrivalOf("up", 0)).toBe(0);
    expect(arrivalOf("down", 0)).toBeGreaterThan(0);
    expect(arrivalOf("up", 3)).toBe(3 * (arrivalOf("up", 1) - arrivalOf("up", 0)));
  });
});

describe("the texts of the demo", () => {
  it("tells the counts in one sentence", () => {
    const text = summaryText({ faults: 4, occurred: 3, pending: 1, frames: 40, same: 30, changed: 6, lost: 4 });
    expect(text).toBe("The plan has 4 faults. 3 occurred. 1 fault did not occur, because the connection closed before the point. Of the 40 frames, 30 went through with no change, 6 changed and 4 did not go through.");
    expect(summaryText({ faults: 1, occurred: 1, pending: 0, frames: 20, same: 20, changed: 0, lost: 0 })).toBe("The plan has 1 fault. Each one occurred. Of the 20 frames, 20 went through with no change, 0 changed and 0 did not go through.");
  });

  it("tells the parameters and the point of each kind", () => {
    const at = { connection: 0, direction: "up", at: { frame: 3 } } as const;
    expect(faultText({ ...at, kind: "delay", ms: 250, forMs: 400 })).toBe("250 ms for 400 ms");
    expect(faultText({ ...at, kind: "duplicate", copies: 1 })).toBe("1 copy");
    expect(faultText({ ...at, kind: "split", pieces: 3, gapMs: 10 })).toBe("3 pieces, 10 ms apart");
    expect(pointText({ ...at, kind: "cut" })).toBe("frame 3");
  });

  it("shows the calls of the settings", () => {
    const code = demoCode({ ...DEMO_START, seed: "7", kinds: ["delay", "cut"], directions: "down" });
    expect(code.includes(`within: { frame: ${FRAMES} }`)).toBe(true);
    expect(code.includes("kinds: { delay: 1, cut: 1 }")).toBe(true);
    expect(code.includes('directions: ["down"]')).toBe(true);
    expect(code.includes("}, 7);")).toBe(true);
    expect(demoCode({ ...DEMO_START, seed: "drill" }).includes('}, "drill");')).toBe(true);
  });
});
