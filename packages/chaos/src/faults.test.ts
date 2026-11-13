import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAULT_RANGES,
  FAULT_KINDS,
  FAULT_PLAN_FORMAT,
  type Fault,
  type FaultSpec,
  checkFault,
  checkFaultPlan,
  checkFaultSpec,
  faultPlan,
  faultPlanOf,
  faultsOf,
  triggerOf,
} from "./faults.ts";

const every: FaultSpec = {
  connections: 4,
  perConnection: 50,
  kinds: { delay: 1, stall: 1, cut: 1, reset: 1, split: 1, reorder: 1, duplicate: 1 },
  within: { byte: 10_000 },
};

describe("a fault plan from a spec", () => {
  it("gives the same plan for the same seed, and the plan stays the same after JSON", () => {
    const plan = faultPlan(every, "drill");
    expect(faultPlan(every, "drill")).toEqual(plan);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(plan).toMatchObject({ format: FAULT_PLAN_FORMAT, seed: "drill" });
    expect(plan.faults).toHaveLength(200);
    expect(faultPlan(every, "other").faults).not.toEqual(plan.faults);
  });

  it("keeps the faults of the first connections when the spec has more connections", () => {
    const small = faultPlan({ ...every, connections: 2 }, 7);
    const large = faultPlan({ ...every, connections: 5 }, 7);
    expect(faultsOf(large, 0)).toEqual(faultsOf(small, 0));
    expect(faultsOf(large, 1)).toEqual(faultsOf(small, 1));
  });

  it("gives valid faults, in the order of their points, inside the limit", () => {
    const plan = faultPlan(every, 1);
    expect(checkFaultPlan(plan)).toEqual([]);
    for (let connection = 0; connection < every.connections; connection += 1) {
      const points = faultsOf(plan, connection).map((fault) => triggerOf(fault.at)?.value ?? -1);
      expect(points).toEqual([...points].sort((a, b) => a - b));
      for (const point of points) expect(point >= 0 && point < 10_000 && Number.isInteger(point)).toBe(true);
    }
    expect(new Set(plan.faults.map((fault) => fault.kind))).toEqual(new Set(FAULT_KINDS));
    expect(new Set(plan.faults.map((fault) => fault.direction))).toEqual(new Set(["up", "down"]));
  });

  it("draws only the kinds with a weight, the directions of the spec and the parameters inside their intervals", () => {
    const plan = faultPlan({ connections: 3, perConnection: 40, kinds: { split: 3, delay: 1, cut: 0 }, within: { ms: 5000 }, directions: ["down"], ranges: { splitPieces: [3, 3] } }, 9);
    for (const fault of plan.faults) {
      expect(["split", "delay"]).toContain(fault.kind);
      expect(fault.direction).toBe("down");
      expect(triggerOf(fault.at)?.measure).toBe("ms");
      if (fault.kind === "split") expect(fault.pieces).toBe(3);
      if (fault.kind === "split") expect(fault.gapMs >= DEFAULT_FAULT_RANGES.splitGapMs[0] && fault.gapMs <= DEFAULT_FAULT_RANGES.splitGapMs[1]).toBe(true);
      if (fault.kind === "delay") expect(fault.ms >= DEFAULT_FAULT_RANGES.delayMs[0] && fault.ms <= DEFAULT_FAULT_RANGES.delayMs[1]).toBe(true);
    }
    const splits = plan.faults.filter((fault) => fault.kind === "split").length;
    expect(splits).toBeGreaterThan(plan.faults.length / 2);
  });

  it("states each problem of a spec, and throws a RangeError for it", () => {
    expect(checkFaultSpec(every)).toEqual([]);
    const bad = checkFaultSpec({ connections: 0, perConnection: -1, kinds: { cut: 0, jam: 1 }, within: { byte: 0 }, directions: [], ranges: { stallMs: [5, 1], loud: [1, 2] } } as unknown as FaultSpec);
    expect(bad.join("\n")).toMatch(/connections/);
    expect(bad.join("\n")).toMatch(/faults of each connection/);
    expect(bad.join("\n")).toMatch(/jam is not a kind/);
    expect(bad.join("\n")).toMatch(/weight more than 0/);
    expect(bad.join("\n")).toMatch(/limit of the points/);
    expect(bad.join("\n")).toMatch(/directions/);
    expect(bad.join("\n")).toMatch(/range stallMs/);
    expect(bad.join("\n")).toMatch(/range loud is not/);
    expect(checkFaultSpec({ ...every, ranges: { splitPieces: [1, 4] } }).join("")).toMatch(/splitPieces .* 2 or more/);
    expect(() => faultPlan({ ...every, connections: 0 }, 1)).toThrow(RangeError);
    expect(() => faultPlan({ ...every, kinds: { jam: 1 } as unknown as FaultSpec["kinds"] }, 1)).toThrow(/weight more than 0/);
  });
});

describe("a fault plan that a person writes", () => {
  const faults: readonly Fault[] = [
    { connection: 1, direction: "down", at: { frame: 3 }, kind: "duplicate", copies: 1 },
    { connection: 0, direction: "up", at: { byte: 512 }, kind: "split", pieces: 2, gapMs: 0 },
    { connection: 0, direction: "down", at: { ms: 250 }, kind: "reset" },
  ];

  it("puts the faults in the order of their connections, and keeps the order inside a connection", () => {
    const plan = faultPlanOf(faults);
    expect(plan.seed).toBeNull();
    expect(plan.faults.map((fault) => fault.kind)).toEqual(["split", "reset", "duplicate"]);
    expect(faultsOf(plan, 0).map((fault) => fault.kind)).toEqual(["split", "reset"]);
    expect(faultsOf(plan, 2)).toEqual([]);
  });

  it("states each problem of a fault, and throws a RangeError for it", () => {
    expect(checkFault({ connection: -1, direction: "up", at: { ms: 1 }, kind: "cut" })[0]).toMatch(/connection/);
    expect(checkFault({ connection: 0, direction: "sideways" as "up", at: { ms: 1 }, kind: "cut" })[0]).toMatch(/direction/);
    expect(checkFault({ connection: 0, direction: "up", at: { ms: 1, byte: 2 } as unknown as { ms: number }, kind: "cut" })[0]).toMatch(/one key/);
    expect(checkFault({ connection: 0, direction: "up", at: { byte: 1.5 }, kind: "cut" })[0]).toMatch(/one key/);
    expect(checkFault({ connection: 0, direction: "up", at: { frame: 0 }, kind: "split", pieces: 1, gapMs: 0 })[0]).toMatch(/pieces/);
    expect(checkFault({ connection: 0, direction: "up", at: { frame: 0 }, kind: "reorder", count: 2, holdMs: 0 })[0]).toMatch(/holdMs/);
    expect(checkFault({ connection: 0, direction: "up", at: { frame: 0 }, kind: "jam" } as unknown as Fault)[0]).toMatch(/kind/);
    expect(checkFaultPlan({ format: "rigor-faults/0" as typeof FAULT_PLAN_FORMAT, seed: null, faults: [] })[0]).toMatch(/format/);
    expect(() => faultPlanOf([{ connection: 0, direction: "up", at: { ms: -1 }, kind: "stall", ms: 10 }])).toThrow(RangeError);
  });
});
