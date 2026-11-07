import { describe, expect, it } from "vitest";
import { closedLoopPlan, type LoopRequest } from "./closed.ts";
import { latencyQuantile, measureLoad, scheduleHeld, type Completion } from "./measure.ts";
import { constant, schedule } from "./schedule.ts";

// one arrival each 10 ms for 2 s: the first at 5 ms
const PLAN = schedule(constant(100, 2000), { arrivals: "uniform" });
const stall = (sent: number): number => (sent >= 500 && sent < 1500 ? 1500 : sent + 1);
const RUN = { interval: 10, end: 2000, tolerance: 1 };

/** This function gives the requests of a closed loop that sends each 10 ms and does not send faster after a stall. */
const closedLoop = (): LoopRequest[] => {
  const out: LoopRequest[] = [];
  for (let sent = 5; sent < 2000; ) {
    const done = stall(sent);
    out.push({ sent, done });
    sent = Math.max(sent + 10, done);
  }
  return out;
};

/** This function gives requests with a reply after 1 ms, sent at `times`. */
const fast = (times: readonly number[]): LoopRequest[] => times.map((sent) => ({ sent, done: sent + 1 }));

describe("the hidden sends of a closed loop", () => {
  it("gives the latencies of the open loop from the requests of the closed loop", () => {
    const run = closedLoopPlan(closedLoop(), RUN);
    // the stall holds the request at 505 to 1500, and it hides the sends at 515 to 1495
    expect(run).toMatchObject({ hidden: 99, driverGaps: 0, driverGapTotal: 0 });
    expect(run.plan.times).toHaveLength(200);
    const corrected = measureLoad(run.plan, run.completions, 2000);
    const open = measureLoad(
      PLAN,
      PLAN.times.map((sent, index): Completion => ({ index, sent, done: stall(sent) })),
      2000,
    );
    const sorted = (times: readonly number[]) => [...times].sort((a, b) => a - b);
    sorted(corrected.latency).forEach((time, index) => expect(time).toBeCloseTo(sorted(open.latency)[index] as number, 6));
    expect(latencyQuantile(corrected, 0.99)).toBeCloseTo(975, 6);
  });

  it("does not make a send after a stall late", () => {
    const run = closedLoopPlan(closedLoop(), RUN);
    const measure = measureLoad(run.plan, run.completions, 2000);
    const late = measure.lag.filter((lag) => lag > 0);
    // only the 99 hidden sends wait, and the first after the stall at 1500 is on its plan
    expect(late).toHaveLength(99);
    expect(scheduleHeld(measure, 1000).held).toBe(true);
    expect(measure.service.filter((time) => time > 1)).toHaveLength(1);
  });

  it("puts back the sends of a pause of the driver between two fast replies, and counts the pause", () => {
    // the reply at 21 is fast, and the driver sends again at 320, not at 30: a pause of 290 ms past the plan
    const requests = fast([0, 10, 20, 320, 330, 340]);
    const run = closedLoopPlan(requests, { interval: 10, end: 350, tolerance: 5 });
    expect(run).toMatchObject({ hidden: 29, driverGaps: 1, driverGapTotal: 290 });
    expect(run.plan.times).toEqual(Array.from({ length: 35 }, (_, index) => index * 10));
    const measure = measureLoad(run.plan, run.completions, 350);
    // the send planned at 30 waits for the real send at 320, and its reply comes at 321
    expect(latencyQuantile(measure, 1)).toBeCloseTo(291, 6);
    expect(scheduleHeld(measure, 5).held).toBe(false);
    // with no such count, the pause leaves no trace, and the record reads better than the open loop
    const blind = closedLoopPlan(requests, { interval: 10, end: 350, tolerance: 1000 });
    expect(blind).toMatchObject({ hidden: 0, driverGaps: 0 });
    expect(latencyQuantile(measureLoad(blind.plan, blind.completions, 350), 1)).toBeCloseTo(1, 6);
  });

  it("does not count a late send within the tolerance", () => {
    const run = closedLoopPlan(fast([0, 10, 23]), { interval: 10, end: 40, tolerance: 5 });
    expect(run).toMatchObject({ hidden: 0, driverGaps: 0, driverGapTotal: 0 });
  });

  it("hides nothing in a run with no reply later than the interval", () => {
    const requests: LoopRequest[] = [0, 10, 20].map((sent) => ({ sent, done: sent + 10 }));
    const run = closedLoopPlan(requests, { interval: 10, end: 40, tolerance: 0 });
    expect(run).toMatchObject({ hidden: 0, completions: [{ index: 0 }, { index: 1 }, { index: 2 }] });
    expect(run.plan.times).toEqual([0, 10, 20]);
  });

  it("gives the hidden sends after a request with no reply as not sent, with their age at the end", () => {
    const run = closedLoopPlan(
      [
        { sent: 0, done: 1 },
        { sent: 10, done: null },
      ],
      { interval: 10, end: 100, tolerance: 1 },
    );
    expect(run.hidden).toBe(8);
    const measure = measureLoad(run.plan, run.completions, 100);
    expect(measure).toMatchObject({ planned: 10, unsent: 8, unfinished: 1 });
    expect(measure.censored).toEqual([90, 80, 70, 60, 50, 40, 30, 20, 10]);
  });

  it("gives the sends of a pause before a request with no reply as not sent", () => {
    const run = closedLoopPlan(
      [
        { sent: 0, done: 1 },
        { sent: 40, done: null },
      ],
      { interval: 10, end: 50, tolerance: 1 },
    );
    expect(run).toMatchObject({ hidden: 3, driverGaps: 1, driverGapTotal: 30 });
    const measure = measureLoad(run.plan, run.completions, 50);
    expect(measure).toMatchObject({ planned: 5, unsent: 3, unfinished: 1 });
    expect(measure.censored).toEqual([40, 30, 20, 10]);
  });

  it("refuses a bad option, an early send, a missing reply before the last request and a time past the end", () => {
    const options = (interval: number, end: number, tolerance = 1) => ({ interval, end, tolerance });
    expect(() => closedLoopPlan([], options(0, 100))).toThrow("the interval is more than 0");
    expect(() => closedLoopPlan([], options(Number.NaN, 100))).toThrow("the interval is more than 0");
    expect(() => closedLoopPlan([], options(10, 0))).toThrow("the end is more than 0");
    expect(() => closedLoopPlan([], options(10, 100, -1))).toThrow("the tolerance is 0 or more");
    expect(() => closedLoopPlan([], options(10, 100, Number.POSITIVE_INFINITY))).toThrow("the tolerance is 0 or more");
    expect(() =>
      closedLoopPlan(
        [
          { sent: 0, done: 20 },
          { sent: 10, done: 21 },
        ],
        options(10, 100),
      ),
    ).toThrow("before the reply at 20");
    expect(() =>
      closedLoopPlan(
        [
          { sent: 0, done: null },
          { sent: 10, done: 11 },
        ],
        options(10, 100),
      ),
    ).toThrow("not the last request");
    expect(() => closedLoopPlan([{ sent: 0, done: 101 }], options(10, 100))).toThrow("stops at 100");
    expect(() => closedLoopPlan([{ sent: 5, done: 4 }], options(10, 100))).toThrow("a reply at 4");
  });
});
