import { describe, expect, it } from "vitest";
import { failureWindows, latencyWindows } from "./fault-schedule.ts";
import { WINDOW_PLAN_FORMAT, checkFaultPlan, faultPlanOf } from "./faults.ts";
import { constant, ramp, schedule, steps } from "./schedule.ts";

describe("latencyWindows", () => {
  it("gives one delay window for each step, with the mean delay of the step", () => {
    const windows = latencyWindows(ramp(0, 100, 1000), { stepMs: 250 });
    expect(windows).toEqual([
      { window: { from: 0, to: 250 }, direction: "down", at: { ms: 0 }, kind: "delay", ms: 12.5, forMs: 250 },
      { window: { from: 250, to: 500 }, direction: "down", at: { ms: 0 }, kind: "delay", ms: 37.5, forMs: 250 },
      { window: { from: 500, to: 750 }, direction: "down", at: { ms: 0 }, kind: "delay", ms: 62.5, forMs: 250 },
      { window: { from: 750, to: 1000 }, direction: "down", at: { ms: 0 }, kind: "delay", ms: 87.5, forMs: 250 },
    ]);
    const plan = faultPlanOf([], windows);
    expect(plan.format).toBe(WINDOW_PLAN_FORMAT);
    expect(checkFaultPlan(plan)).toEqual([]);
  });

  it("gives no window to a step with no delay, and one window to each step with a delay", () => {
    const windows = latencyWindows(steps([0, 50, 0], 100), { stepMs: 50, direction: "up" });
    expect(windows).toEqual([
      { window: { from: 100, to: 150 }, direction: "up", at: { ms: 0 }, kind: "delay", ms: 50, forMs: 50 },
      { window: { from: 150, to: 200 }, direction: "up", at: { ms: 0 }, kind: "delay", ms: 50, forMs: 50 },
    ]);
  });

  it("takes the mean over a step that crosses two phases, and ends the last step at the end of the profile", () => {
    const windows = latencyWindows(steps([10, 30], 100), { stepMs: 150 });
    expect(windows.map((w) => w.window)).toEqual([
      { from: 0, to: 150 },
      { from: 150, to: 200 },
    ]);
    expect(windows[0]!.kind === "delay" && windows[0]!.ms).toBeCloseTo(2500 / 150, 12);
    expect(windows[1]).toMatchObject({ kind: "delay", ms: 30, forMs: 50 });
  });

  it("refuses a bad profile, a bad step, a bad direction and too many steps", () => {
    for (const stepMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => latencyWindows(constant(10, 100), { stepMs }), String(stepMs)).toThrow(RangeError);
    expect(() => latencyWindows([], { stepMs: 10 })).toThrow(/no phases/);
    expect(() => latencyWindows(constant(-1, 100), { stepMs: 10 })).toThrow(RangeError);
    expect(() => latencyWindows(constant(10, 100), { stepMs: 10, direction: "left" as "up" })).toThrow(/up or down/);
    expect(() => latencyWindows(constant(10, 1e9), { stepMs: 1e-3 })).toThrow(/Make the step longer/);
  });
});

describe("failureWindows", () => {
  const reset = { kind: "reset" } as const;

  it("starts a failure at each Poisson time of the profile, with the same windows for the same seed", () => {
    const profile = constant(2, 10_000);
    const windows = failureWindows(profile, { action: reset, widthMs: 100, seed: "drill" });
    const { times } = schedule(profile, { arrivals: "poisson", seed: "drill" });
    expect(times.length).toBeGreaterThan(5);
    for (const fault of windows) {
      expect(fault).toMatchObject({ kind: "reset", direction: "up", at: { ms: 0 } });
      expect(times).toContain(fault.window.from);
      expect(fault.window.to - fault.window.from).toBeGreaterThanOrEqual(100);
    }
    for (const time of times) expect(windows.some((f) => f.window.from <= time && time < f.window.to)).toBe(true);
    for (let i = 1; i < windows.length; i++) expect(windows[i]!.window.from).toBeGreaterThan(windows[i - 1]!.window.to);
    expect(failureWindows(profile, { action: reset, widthMs: 100, seed: "drill" })).toEqual(windows);
    expect(failureWindows(profile, { action: reset, widthMs: 100, seed: "other" })).not.toEqual(windows);
    expect(checkFaultPlan(faultPlanOf([], windows))).toEqual([]);
  });

  it("makes one window of failures that overlap", () => {
    const profile = constant(100, 1000);
    const windows = failureWindows(profile, { action: reset, widthMs: 50, seed: 7 });
    const { times } = schedule(profile, { arrivals: "poisson", seed: 7 });
    expect(windows.length).toBeLessThan(times.length);
    const last = times.at(-1)!;
    expect(windows.at(-1)!.window.to).toBe(last + 50);
  });

  it("follows a rate that changes, and gives no window for a rate of 0", () => {
    const windows = failureWindows(steps([0, 5, 0], 10_000), { action: { kind: "stall", ms: 2000 }, widthMs: 10, seed: "burst" });
    expect(windows.length).toBeGreaterThan(10);
    for (const fault of windows) {
      expect(fault.window.from).toBeGreaterThanOrEqual(10_000);
      expect(fault.window.from).toBeLessThan(20_000);
    }
    expect(failureWindows(constant(0, 1000), { action: reset, widthMs: 10, seed: 1 })).toEqual([]);
  });

  it("takes any fault, a direction and a point", () => {
    const answer = { kind: "answer", status: 503, body: "busy" } as const;
    const windows = failureWindows(constant(1, 10_000), { action: answer, widthMs: 500, seed: 3, direction: "down", at: { frame: 0 } });
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]).toMatchObject({ kind: "answer", status: 503, body: "busy", direction: "down", at: { frame: 0 } });
    expect(checkFaultPlan(faultPlanOf([], windows))).toEqual([]);
  });

  it("refuses a bad profile, a bad width, a bad fault and a bad direction", () => {
    for (const widthMs of [0, -5, Number.NaN]) expect(() => failureWindows(constant(1, 1000), { action: reset, widthMs, seed: 1 }), String(widthMs)).toThrow(RangeError);
    expect(() => failureWindows([], { action: reset, widthMs: 10, seed: 1 })).toThrow(/no phases/);
    expect(() => failureWindows(constant(1, 1000), { action: { kind: "stall", ms: -1 }, widthMs: 10, seed: 1 })).toThrow(/stall field ms/);
    expect(() => failureWindows(constant(1, 1000), { action: reset, widthMs: 10, seed: 1, at: { ms: -1 } })).toThrow(RangeError);
    expect(() => failureWindows(constant(1, 1000), { action: reset, widthMs: 10, seed: 1, direction: "left" as "up" })).toThrow(/up or down/);
  });
});
