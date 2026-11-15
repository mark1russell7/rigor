import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAULT_RANGES,
  FAULT_KINDS,
  FAULT_PLAN_FORMAT,
  type Fault,
  type FaultPlan,
  type FaultSpec,
  WINDOW_PLAN_FORMAT,
  type WindowFault,
  checkFault,
  checkFaultPlan,
  checkFaultSpec,
  checkWindowFault,
  faultPlan,
  faultPlanOf,
  faultsOf,
  sweepPoints,
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

describe("a plan with windows", () => {
  const outage: WindowFault = { window: { from: 1000, to: 3000 }, direction: "up", at: { byte: 0 }, kind: "reset" };
  const slow: WindowFault = { window: { from: 0, to: 500 }, direction: "down", at: { ms: 0 }, kind: "delay", ms: 200, forMs: 500 };

  it("has the second format, and keeps the order of its windows", () => {
    const plan = faultPlanOf([{ connection: 2, direction: "up", at: { frame: 0 }, kind: "cut" }], [outage, slow]);
    expect(plan.format).toBe(WINDOW_PLAN_FORMAT);
    expect(plan.windows).toEqual([outage, slow]);
    expect(checkFaultPlan(plan)).toEqual([]);
    expect(faultPlanOf([], []).format).toBe(FAULT_PLAN_FORMAT);
    expect(faultPlanOf([]).windows).toBeUndefined();
  });

  it("states each problem of a window fault", () => {
    expect(checkWindowFault(outage)).toEqual([]);
    expect(checkWindowFault({ ...outage, window: { from: 3000, to: 3000 } })[0]).toMatch(/from before to/);
    expect(checkWindowFault({ ...outage, window: { from: -1, to: 3000 } })[0]).toMatch(/0 or more/);
    expect(checkWindowFault({ ...outage, window: null as unknown as WindowFault["window"] })[0]).toMatch(/object/);
    expect(checkWindowFault({ ...slow, forMs: 0 })[0]).toMatch(/forMs/);
    expect(() => faultPlanOf([], [{ ...outage, at: { byte: -1 } }])).toThrow(/The window fault 0/);
  });

  it("refuses windows in the first format, and a second format with no list of windows", () => {
    const first = { format: FAULT_PLAN_FORMAT, seed: null, faults: [], windows: [outage] } satisfies FaultPlan;
    expect(checkFaultPlan(first)).toEqual([`A plan with windows has the format ${WINDOW_PLAN_FORMAT}, not ${FAULT_PLAN_FORMAT}.`]);
    expect(checkFaultPlan({ format: WINDOW_PLAN_FORMAT, seed: null, faults: [] })).toEqual(["The windows are a list."]);
    expect(checkFaultPlan({ format: WINDOW_PLAN_FORMAT, seed: null, faults: [], windows: [] })).toEqual([]);
  });
});

describe("an answer in a written plan", () => {
  const answer = (fields: Record<string, unknown>): Fault => ({ connection: 0, direction: "down", at: { frame: 0 }, kind: "answer", status: 429, ...fields }) as Fault;

  it("is valid with a status, fields and a body, in both directions", () => {
    expect(checkFault(answer({ fields: { "retry-after": "120" }, body: "slow down" }))).toEqual([]);
    expect(checkFault({ ...answer({}), direction: "up" } as Fault)).toEqual([]);
    expect(checkFault(answer({ status: 304, fields: { etag: '"v1"' } }))).toEqual([]);
    expect(faultPlanOf([answer({ status: 503 })]).faults[0]?.kind).toBe("answer");
  });

  it("states each problem of its status, its fields and its body", () => {
    expect(checkFault(answer({ status: 101 }))[0]).toMatch(/status/);
    expect(checkFault(answer({ status: 600 }))[0]).toMatch(/status/);
    expect(checkFault(answer({ status: 429.5 }))[0]).toMatch(/status/);
    expect(checkFault(answer({ fields: { "bad name": "1" } }))[0]).toMatch(/token/);
    expect(checkFault(answer({ fields: { "Content-Length": "9" } }))[0]).toMatch(/proxy writes it/);
    expect(checkFault(answer({ fields: { "x-a": "1\r\nx-b: 2" } }))[0]).toMatch(/line end/);
    expect(checkFault(answer({ fields: { "x-a": " 1" } }))[0]).toMatch(/line end/);
    expect(checkFault(answer({ fields: { "x-a": 1 } }))[0]).toMatch(/line end/);
    expect(checkFault(answer({ fields: ["x"] }))[0]).toMatch(/object/);
    expect(checkFault(answer({ body: 7 }))[0]).toMatch(/text/);
    expect(checkFault(answer({ status: 304, body: "x" }))[0]).toMatch(/no body/);
    expect(checkFault(answer({ status: 204, body: "x" }))[0]).toMatch(/no body/);
  });

  it("is not a kind that a spec draws", () => {
    expect(FAULT_KINDS).not.toContain("answer");
    const spec = { connections: 1, perConnection: 1, kinds: { cut: 1, answer: 1 }, within: { frame: 5 } } as unknown as FaultSpec;
    expect(checkFaultSpec(spec)).toEqual(["A spec does not draw an answer. Write each answer in a plan with faultPlanOf."]);
  });
});

describe("the points of a sweep", () => {
  it("gives the edges and distinct seeded points, in order and in the stream", () => {
    const points = sweepPoints(1000, 16, "sweep");
    expect(points).toHaveLength(19);
    expect(points.slice(0, 2)).toEqual([0, 1]);
    expect(points.at(-1)).toBe(999);
    expect(new Set(points).size).toBe(19);
    expect([...points].sort((a, b) => a - b)).toEqual(points);
    for (const point of points.slice(2, -1)) expect(point >= 2 && point <= 998).toBe(true);
  });

  it("gives the same points for the same seed, and other points for another seed", () => {
    expect(sweepPoints(5000, 16, "a")).toEqual(sweepPoints(5000, 16, "a"));
    expect(sweepPoints(5000, 16, 7)).toEqual(sweepPoints(5000, 16, 7));
    expect(sweepPoints(5000, 16, "a")).not.toEqual(sweepPoints(5000, 16, "b"));
  });

  it("gives only the edges for no draw, and each point when the draws fill the stream", () => {
    expect(sweepPoints(10, 0, "a")).toEqual([0, 1, 9]);
    expect(sweepPoints(3, 0, "a")).toEqual([0, 1, 2]);
    expect(sweepPoints(8, 5, "a")).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("refuses a stream that is too short for the draws, and a count that is not whole", () => {
    expect(() => sweepPoints(7, 5, "a")).toThrow(RangeError);
    expect(() => sweepPoints(2, 0, "a")).toThrow(RangeError);
    expect(() => sweepPoints(100, -1, "a")).toThrow(RangeError);
    expect(() => sweepPoints(100.5, 1, "a")).toThrow(RangeError);
  });

  it("gives points that a written plan takes as byte points", () => {
    for (const offset of sweepPoints(600, 4, "plan")) {
      const plan = faultPlanOf([{ connection: 0, direction: "down", at: { byte: 180 + offset }, kind: "cut" }]);
      expect(checkFaultPlan(plan)).toEqual([]);
    }
  });
});
