import { describe, expect, it } from "vitest";
import { sweepPoints } from "./faults.ts";
import { STOP_PLAN_FORMAT, STOP_SIGNALS, type Stop, type StopPlan, type StopSpec, checkStop, checkStopPlan, checkStopSpec, stopPlan, stopPlanOf, stopTriggerOf } from "./stops.ts";

describe("a stop plan from a spec", () => {
  it("gives the same plan for the same seed, and the plan stays the same after JSON", () => {
    const spec: StopSpec = { within: { step: 500 }, draws: 12 };
    const plan = stopPlan(spec, "crash");
    expect(stopPlan(spec, "crash")).toEqual(plan);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(plan).toMatchObject({ format: STOP_PLAN_FORMAT, seed: "crash" });
    expect(plan.stops).toHaveLength(15);
    expect(stopPlan(spec, "other").stops).not.toEqual(plan.stops);
    expect(checkStopPlan(plan)).toEqual([]);
  });

  it("puts the stops at the points of a sweep, with SIGKILL as the default signal", () => {
    const plan = stopPlan({ within: { step: 500 }, draws: 12 }, 7);
    expect(plan.stops.map((stop) => (stop.at as { step: number }).step)).toEqual(sweepPoints(500, 12, 7));
    expect(new Set(plan.stops.map((stop) => stop.signal))).toEqual(new Set(["SIGKILL"]));
  });

  it("gives one stop for each point and each signal, in the order of the points, then of the signals", () => {
    const plan = stopPlan({ within: { ms: 2000 }, draws: 4, signals: ["SIGTERM", "SIGKILL"] }, "both");
    const points = sweepPoints(2000, 4, "both");
    expect(plan.stops).toEqual(points.flatMap((point) => [{ at: { ms: point }, signal: "SIGTERM" }, { at: { ms: point }, signal: "SIGKILL" }]));
  });

  it("gives each point when the limit has fewer points than the edges and the draws", () => {
    expect(stopPlan({ within: { step: 5 }, draws: 16 }, 1).stops.map((stop) => stop.at)).toEqual([0, 1, 2, 3, 4].map((step) => ({ step })));
    expect(stopPlan({ within: { step: 1 }, draws: 0 }, 1).stops).toEqual([{ at: { step: 0 }, signal: "SIGKILL" }]);
    expect(stopPlan({ within: { step: 3 }, draws: 0 }, 1).stops.map((stop) => stop.at)).toEqual([{ step: 0 }, { step: 1 }, { step: 2 }]);
  });

  it("throws a RangeError for a spec with problems", () => {
    expect(() => stopPlan({ within: { step: 0 }, draws: 1 }, 1)).toThrow(RangeError);
    expect(() => stopPlan({ within: { step: 10 }, draws: -1 }, 1)).toThrow(/draws/);
  });
});

describe("the checks of a stop plan", () => {
  it("finds each problem of a spec", () => {
    expect(checkStopSpec({ within: { step: 10 }, draws: 2 })).toEqual([]);
    expect(checkStopSpec({ within: { ms: 1.5 }, draws: 2 })).toHaveLength(1);
    expect(checkStopSpec({ within: { byte: 10 } as never, draws: 2 })).toHaveLength(1);
    expect(checkStopSpec({ within: { step: 10 }, draws: 2.5 })).toHaveLength(1);
    expect(checkStopSpec({ within: { step: 10 }, draws: 2, signals: [] })).toHaveLength(1);
    expect(checkStopSpec({ within: { step: 10 }, draws: 2, signals: ["SIGINT" as never] })).toHaveLength(1);
    expect(checkStopSpec({ within: { step: 10 }, draws: 2, signals: ["SIGKILL", "SIGKILL"] })).toEqual([expect.stringContaining("one time")]);
  });

  it("finds each problem of a stop", () => {
    expect(checkStop({ at: { step: 3 }, signal: "SIGKILL" })).toEqual([]);
    expect(checkStop({ at: { ms: 12.5 }, signal: "SIGTERM" })).toEqual([]);
    expect(checkStop({ at: { step: 1.5 }, signal: "SIGKILL" })).toHaveLength(1);
    expect(checkStop({ at: { step: -1 }, signal: "SIGKILL" })).toHaveLength(1);
    expect(checkStop({ at: { step: 1, ms: 1 } as never, signal: "SIGKILL" })).toHaveLength(1);
    expect(checkStop({ at: { step: 1 }, signal: "SIGHUP" as never })).toHaveLength(1);
    expect(checkStop(null as never)).toEqual(["A stop is an object."]);
  });

  it("finds each problem of a plan from a record", () => {
    expect(checkStopPlan({ format: "rigor-stops/2" as never, seed: null, stops: [] })).toHaveLength(1);
    expect(checkStopPlan({ format: STOP_PLAN_FORMAT, seed: null, stops: {} as never })).toEqual(["The stops are a list."]);
    for (const plan of [null, undefined, 7, "rigor-stops/1"]) expect(checkStopPlan(plan as never)).toEqual(["A stop plan is an object."]);
    for (const seed of [7, "crash", null]) expect(checkStopPlan({ format: STOP_PLAN_FORMAT, seed, stops: [] })).toEqual([]);
    for (const seed of [undefined, true, Number.NaN, { value: 7 }]) {
      expect(checkStopPlan({ format: STOP_PLAN_FORMAT, seed: seed as never, stops: [] })).toEqual([expect.stringMatching(/^The seed is /)]);
    }
    const plan: StopPlan = { format: STOP_PLAN_FORMAT, seed: 1, stops: [{ at: { step: 0 }, signal: "SIGKILL" }, { at: { ms: -1 }, signal: "SIGKILL" }] };
    expect(checkStopPlan(plan)).toEqual([expect.stringMatching(/^The stop 1: /)]);
  });

  it("gives the measure and the value of a point", () => {
    expect(stopTriggerOf({ step: 4 })).toEqual({ measure: "step", value: 4 });
    expect(stopTriggerOf({ ms: 0.5 })).toEqual({ measure: "ms", value: 0.5 });
    expect(stopTriggerOf({ step: Number.NaN })).toBeUndefined();
    expect(stopTriggerOf({ ms: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(stopTriggerOf(null as never)).toBeUndefined();
  });
});

describe("a stop plan that a person wrote", () => {
  it("keeps the order of the stops, and has no seed", () => {
    const stops: Stop[] = [
      { at: { step: 9 }, signal: "SIGTERM" },
      { at: { step: 2 }, signal: "SIGKILL" },
    ];
    expect(stopPlanOf(stops)).toEqual({ format: STOP_PLAN_FORMAT, seed: null, stops });
  });

  it("throws a RangeError for a stop with problems", () => {
    expect(() => stopPlanOf([{ at: { step: 0 }, signal: "SIGKILL" }, { at: { step: 0.5 }, signal: "SIGKILL" }])).toThrow(/stopPlanOf: The stop 1: /);
  });

  it("has the two signals", () => {
    expect(STOP_SIGNALS).toEqual(["SIGKILL", "SIGTERM"]);
  });
});
