import { describe, expect, it } from "vitest";
import { DISK_FAULT_KINDS, DISK_PLAN_FORMAT, type DiskFault, type DiskPlan, type DiskSpec, checkDiskFault, checkDiskPlan, checkDiskSpec, diskPlan, diskPlanOf } from "./disk.ts";
import { stopPlan } from "./stops.ts";

describe("a disk plan from a spec", () => {
  it("gives the same plan for the same seed, and the plan stays the same after JSON", () => {
    const spec: DiskSpec = { within: { step: 500 }, draws: 12 };
    const plan = diskPlan(spec, "power-cut");
    expect(diskPlan(spec, "power-cut")).toEqual(plan);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(plan).toMatchObject({ format: DISK_PLAN_FORMAT, seed: "power-cut" });
    expect(plan.faults).toHaveLength(15);
    expect(diskPlan(spec, "other").faults).not.toEqual(plan.faults);
    expect(checkDiskPlan(plan)).toEqual([]);
  });

  it("puts the faults at the points of the stop plan of the same spec and seed, with lose-unsynced as the default kind", () => {
    for (const within of [{ step: 500 }, { ms: 30_000 }, { step: 4 }]) {
      const faults = diskPlan({ within, draws: 12 }, 7).faults;
      expect(faults.map((fault) => fault.at)).toEqual(stopPlan({ within, draws: 12 }, 7).stops.map((stop) => stop.at));
      expect(new Set(faults.map((fault) => fault.kind))).toEqual(new Set(["lose-unsynced"]));
    }
  });

  it("gives each point when the limit has fewer points than the edges and the draws", () => {
    expect(diskPlan({ within: { step: 5 }, draws: 16 }, 1).faults.map((fault) => fault.at)).toEqual([0, 1, 2, 3, 4].map((step) => ({ step })));
    expect(diskPlan({ within: { ms: 1 }, draws: 0 }, 1).faults).toEqual([{ kind: "lose-unsynced", at: { ms: 0 } }]);
  });

  it("throws a RangeError for a spec with problems", () => {
    expect(() => diskPlan({ within: { step: 0 }, draws: 1 }, 1)).toThrow(RangeError);
    expect(() => diskPlan({ within: { step: 10 }, draws: -1 }, 1)).toThrow(/diskPlan: .*draws/);
    expect(() => diskPlan({ within: { step: 10 }, draws: 1, kinds: ["torn" as never] }, 1)).toThrow(/kinds/);
  });
});

describe("the checks of a disk plan", () => {
  it("finds each problem of a spec", () => {
    expect(checkDiskSpec({ within: { step: 10 }, draws: 2 })).toEqual([]);
    expect(checkDiskSpec({ within: { step: 10 }, draws: 2, kinds: ["lose-unsynced"] })).toEqual([]);
    expect(checkDiskSpec({ within: { ms: 1.5 }, draws: 2 })).toHaveLength(1);
    expect(checkDiskSpec({ within: { frame: 10 } as never, draws: 2 })).toHaveLength(1);
    expect(checkDiskSpec({ within: { step: 10 }, draws: 2.5 })).toHaveLength(1);
    expect(checkDiskSpec({ within: { step: 10 }, draws: 2, kinds: [] })).toEqual([expect.stringMatching(/^The kinds are a list/)]);
    expect(checkDiskSpec({ within: { step: 10 }, draws: 2, kinds: ["fsync-error" as never] })).toHaveLength(1);
    expect(checkDiskSpec({ within: { step: 10 }, draws: 2, kinds: ["lose-unsynced", "lose-unsynced"] })).toEqual([expect.stringContaining("Each kind occurs one time")]);
  });

  it("finds each problem of a fault", () => {
    expect(checkDiskFault({ kind: "lose-unsynced", at: { step: 3 } })).toEqual([]);
    expect(checkDiskFault({ kind: "lose-unsynced", at: { ms: 12.5 } })).toEqual([]);
    expect(checkDiskFault({ kind: "lose-unsynced", at: { step: 1.5 } })).toHaveLength(1);
    expect(checkDiskFault({ kind: "lose-unsynced", at: { step: 1, ms: 1 } as never })).toHaveLength(1);
    expect(checkDiskFault({ kind: "SIGKILL" as never, at: { step: 1 } })).toEqual([expect.stringMatching(/^The kind is one of lose-unsynced/)]);
    expect(checkDiskFault({ kind: "torn" as never, at: { step: -1 } })).toHaveLength(2);
    expect(checkDiskFault(null as never)).toEqual(["A disk fault is an object."]);
  });

  it("finds each problem of a plan from a record", () => {
    expect(checkDiskPlan({ format: "rigor-stops/1" as never, seed: null, faults: [] })).toHaveLength(1);
    expect(checkDiskPlan({ format: DISK_PLAN_FORMAT, seed: null, faults: {} as never })).toEqual(["The faults are a list."]);
    for (const plan of [null, undefined, 7, "rigor-disk/1"]) expect(checkDiskPlan(plan as never)).toEqual(["A disk plan is an object."]);
    for (const seed of [7, "power-cut", null]) expect(checkDiskPlan({ format: DISK_PLAN_FORMAT, seed, faults: [] })).toEqual([]);
    for (const seed of [undefined, true, Number.NaN, { value: 7 }]) {
      expect(checkDiskPlan({ format: DISK_PLAN_FORMAT, seed: seed as never, faults: [] })).toEqual([expect.stringMatching(/^The seed is /)]);
    }
    const plan: DiskPlan = {
      format: DISK_PLAN_FORMAT,
      seed: 1,
      faults: [
        { kind: "lose-unsynced", at: { step: 0 } },
        { kind: "lose-unsynced", at: { ms: -1 } },
      ],
    };
    expect(checkDiskPlan(plan)).toEqual([expect.stringMatching(/^The fault 1: The point has one key/)]);
  });
});

describe("a disk plan that a person wrote", () => {
  it("keeps the order of the faults, and has no seed", () => {
    const faults: DiskFault[] = [
      { kind: "lose-unsynced", at: { ms: 1500 } },
      { kind: "lose-unsynced", at: { step: 2 } },
    ];
    expect(diskPlanOf(faults)).toEqual({ format: DISK_PLAN_FORMAT, seed: null, faults });
  });

  it("throws a RangeError for a fault with problems", () => {
    expect(() => diskPlanOf([{ kind: "lose-unsynced", at: { step: 0 } }, { kind: "lose-unsynced", at: { step: 0.5 } }])).toThrow(/diskPlanOf: The fault 1: /);
  });

  it("has the kinds of the family", () => {
    expect(DISK_FAULT_KINDS).toEqual(["lose-unsynced"]);
  });
});
