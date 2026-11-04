import { describe, expect, it } from "vitest";
import { latencyQuantile, measureLoad, scheduleHeld, type Completion } from "./measure.ts";
import { constant, schedule } from "./schedule.ts";

// one arrival each 10 ms for 2 s: the first at 5 ms
const PLAN = schedule(constant(100, 2000), { arrivals: "uniform" });

/** This function gives a run with a service of 1 ms and a stall of the target from `from` to `until`. */
const stalled = (from: number, until: number): Completion[] =>
  PLAN.times.map((planned, index) => {
    const sent = planned;
    return { index, sent, done: sent >= from && sent < until ? until : sent + 1 };
  });

describe("the measure of a run", () => {
  it("counts a stall in each arrival that it delayed", () => {
    const measure = measureLoad(PLAN, stalled(500, 1500), 2000);
    expect(measure).toMatchObject({ planned: 200, unsent: 0, unfinished: 0, censored: [] });
    expect(measure.latency).toHaveLength(200);
    // half of the arrivals met the stall: the waits are 5, 15, ... 995 ms, and the rank of p99 is the third from the top
    expect(latencyQuantile(measure, 0.75)).toBeGreaterThan(400);
    expect(latencyQuantile(measure, 0.99)).toBeCloseTo(975, 6);
  });

  it("shows what a closed-loop driver hides: one slow request and no others", () => {
    // the driver waits for each reply, thus it sends nothing in the stall
    let free = 0;
    const closed = PLAN.times.map((planned, index): Completion => {
      const sent = Math.max(planned, free);
      const done = sent >= 500 && sent < 1500 ? 1500 : sent + 1;
      free = done;
      return { index, sent, done };
    });
    const measure = measureLoad(PLAN, closed, 2000);
    expect(measure.service.filter((time) => time > 1)).toHaveLength(1);
    expect(measure.latency.filter((time) => time > 100).length).toBeGreaterThan(90);
    expect(scheduleHeld(measure, 10).held).toBe(false);
  });

  it("keeps an arrival with no reply at its age at the end, and a sent arrival apart from an unsent one", () => {
    const completions: Completion[] = PLAN.times.slice(0, 198).map((planned, index) => ({ index, sent: planned, done: planned + 1 }));
    const measure = measureLoad(PLAN, [...completions, { index: 198, sent: PLAN.times[198] as number, done: null }], 2000);
    expect(measure).toMatchObject({ unsent: 1, unfinished: 1 });
    expect(measure.censored).toHaveLength(2);
    expect(measure.censored[0]).toBeCloseTo(15, 6);
    expect(measure.lag).toHaveLength(199);
    expect(latencyQuantile(measure, 1)).toBeCloseTo(15, 6);
  });

  it("refuses a completion that is not in the schedule, a second one, a time past the end and a reply before its send", () => {
    expect(() => measureLoad(PLAN, [{ index: 200, sent: 0, done: 1 }], 2000)).toThrow("not in the schedule");
    expect(() => measureLoad(PLAN, [{ index: 0.5, sent: 0, done: 1 }], 2000)).toThrow("not in the schedule");
    expect(() =>
      measureLoad(
        PLAN,
        [
          { index: 0, sent: 5, done: 6 },
          { index: 0, sent: 5, done: 6 },
        ],
        2000,
      ),
    ).toThrow("two completions");
    expect(() => measureLoad(PLAN, [{ index: 0, sent: 5, done: 2001 }], 2000)).toThrow("stops at 2000");
    expect(() => measureLoad(PLAN, [{ index: 0, sent: 2001, done: null }], 2000)).toThrow("stops at 2000");
    expect(() => measureLoad(PLAN, [{ index: 0, sent: 5, done: 4 }], 2000)).toThrow("a reply at 4");
  });

  it("refuses a quantile of a run with no arrivals", () => {
    const empty = schedule(constant(0, 1000), { arrivals: "uniform" });
    expect(() => latencyQuantile(measureLoad(empty, [], 1000), 0.5)).toThrow(RangeError);
  });
});

describe("the check of a driver", () => {
  it("passes a driver that sent each arrival in time", () => {
    const check = scheduleHeld(measureLoad(PLAN, stalled(0, 0), 2000), 1);
    expect(check).toMatchObject({ held: true, worst: 0, late: 0 });
    expect(check.reason).toContain("kept the schedule");
  });

  it("reads a run larger than the argument limit of a call", () => {
    const large = schedule(constant(1000, 400_000), { arrivals: "uniform" });
    const sent = large.times.map((planned, index): Completion => ({ index, sent: planned, done: planned + 1 }));
    expect(scheduleHeld(measureLoad(large, sent, 400_001), 1)).toMatchObject({ held: true, worst: 0 });
  });

  it("has no worst lag with no send", () => {
    expect(scheduleHeld(measureLoad(PLAN, [], 2000), 1)).toMatchObject({ held: false, worst: null });
  });

  it("fails a late send, an early send and an unsent arrival", () => {
    const shifted = (by: number): Completion[] => PLAN.times.map((planned, index) => ({ index, sent: planned + by, done: planned + by + 1 }));
    expect(scheduleHeld(measureLoad(PLAN, shifted(2), 2100), 1)).toMatchObject({ held: false, late: 200, worst: 2 });
    expect(scheduleHeld(measureLoad(PLAN, shifted(-2), 2100), 1)).toMatchObject({ held: false, late: 200 });
    const missing = shifted(0).slice(1);
    const check = scheduleHeld(measureLoad(PLAN, missing, 2100), 1);
    expect(check).toMatchObject({ held: false, late: 0 });
    expect(check.reason).toContain("1 not sent");
  });
});
