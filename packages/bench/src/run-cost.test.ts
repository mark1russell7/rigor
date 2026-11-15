import { describe, expect, it } from "vitest";
import { type CostCells, type CostProbe, runCost } from "./run-cost.ts";

/** This function gives the probes of one job on one model, from pairs of size and time in ms. */
function probes(job: string, model: string, points: readonly (readonly [number, number])[]): CostProbe[] {
  return points.map(([size, ms]) => ({ job, size, model, ms }));
}

describe("runCost", () => {
  it("adds the cells times the calls times the time of one call, at each size", () => {
    const cells: CostCells[] = [
      { job: "shelf", size: 10, cells: 3 },
      { job: "shelf", size: 100, cells: 2 },
    ];
    const cost = runCost(cells, probes("shelf", "cpu-a", [[10, 10], [100, 100]]), { calls: 7 });
    const job = cost.models[0]?.jobs[0];
    // 3 cells x 7 calls x 10 ms, and 2 cells x 7 calls x 100 ms
    expect(job?.callMinutes).toBeCloseTo((3 * 7 * 10 + 2 * 7 * 100) / 60_000, 12);
    expect(job?.minutes).toBeCloseTo(job?.callMinutes ?? Number.NaN, 12);
    expect(job?.cells).toBe(5);
    expect(job?.stopsAt).toBeUndefined();
    expect(job?.extrapolated).toEqual([]);
    expect(cost.low).toBeCloseTo(cost.high ?? Number.NaN, 12);
  });

  it("gives a size between two probes a time on the line of the log scales", () => {
    const cost = runCost([{ job: "skyline", size: 100, cells: 1 }], probes("skyline", "cpu-a", [[10, 1], [1000, 100]]), { calls: 1 });
    // The time grows as the size, so 100 items take 10 ms
    expect(cost.models[0]?.jobs[0]?.callMinutes).toBeCloseTo(10 / 60_000, 12);
    expect(cost.models[0]?.jobs[0]?.extrapolated).toEqual([]);
  });

  it("names the sizes outside the probe sizes, and extends the nearest line to them", () => {
    const cells: CostCells[] = [
      { job: "skyline", size: 1, cells: 1 },
      { job: "skyline", size: 100, cells: 1 },
      { job: "skyline", size: 10_000, cells: 1 },
    ];
    // The time grows as the size squared from 10 to 100, and as the size from 100 to 1,000
    const cost = runCost(cells, probes("skyline", "cpu-a", [[10, 1], [100, 100], [1000, 1000]]), { calls: 1 });
    const job = cost.models[0]?.jobs[0];
    expect(job?.extrapolated).toEqual([1, 10_000]);
    expect(job?.callMinutes).toBeCloseTo((0.01 + 100 + 10_000) / 60_000, 9);
  });

  it("gives the mean of more probes of one size, and one probe size its time at each size", () => {
    const points: CostProbe[] = [...probes("guillotine", "cpu-a", [[50, 4], [50, 6], [50, 110]])];
    const cost = runCost([{ job: "guillotine", size: 500, cells: 2 }], points, { calls: 1 });
    // The mean is 40 ms. The median of 6 ms is too low for a sum over skewed inputs.
    expect(cost.models[0]?.jobs[0]?.callMinutes).toBeCloseTo((2 * 40) / 60_000, 12);
    expect(cost.models[0]?.jobs[0]?.extrapolated).toEqual([500]);
  });

  it("gives a slow cell its own count of calls", () => {
    const cells: CostCells[] = [
      { job: "rects", size: 10, cells: 1 },
      { job: "rects", size: 100, cells: 1 },
    ];
    const cost = runCost(cells, probes("rects", "cpu-a", [[10, 100], [100, 1000]]), { calls: 7, slow: { ms: 500, calls: 3 } });
    expect(cost.models[0]?.jobs[0]?.callMinutes).toBeCloseTo((7 * 100 + 3 * 1000) / 60_000, 12);
  });

  it("stops a job at the first size with a cell over its budget, and adds the budget of the overruns", () => {
    const cells: CostCells[] = [
      { job: "rects", size: 10, cells: 4 },
      { job: "rects", size: 100, cells: 5 },
      { job: "rects", size: 1000, cells: 5 },
    ];
    const budgets = [{ upTo: 100, ms: 2000 }, { upTo: 10_000, ms: 9000 }];
    const cost = runCost(cells, probes("rects", "cpu-a", [[10, 10], [100, 1000], [1000, 100_000]]), { calls: 7, budgets });
    const job = cost.models[0]?.jobs[0];
    // 7 x 1,000 ms is more than the budget of 2,000 ms at the size 100: 2 overruns cost 2 budgets
    expect(job?.stopsAt).toBe(100);
    expect(job?.cells).toBe(4);
    expect(job?.overruns).toBe(2);
    expect(job?.callMinutes).toBeCloseTo((4 * 7 * 10 + 2 * 2000) / 60_000, 12);
    const one = runCost(cells, probes("rects", "cpu-a", [[10, 10], [100, 1000], [1000, 100_000]]), { calls: 7, budgets, overruns: 1 });
    expect(one.models[0]?.jobs[0]?.callMinutes).toBeCloseTo((4 * 7 * 10 + 2000) / 60_000, 12);
  });

  it("gives a share of the cells over budget from the spread of the probes", () => {
    const spread = probes("rects", "cpu-a", [[100, 10], [100, 10], [100, 10], [100, 1000]]);
    const budgets = [{ upTo: 1000, ms: 500 }];
    // A quarter of the cells is over budget: 4 cells give 1 expected overrun, fewer than 2, so the job goes on
    const few = runCost([{ job: "rects", size: 100, cells: 4 }], spread, { calls: 1, budgets }).models[0]?.jobs[0];
    expect(few?.callMinutes).toBeCloseTo((3 * 10 + 500) / 60_000, 12);
    expect(few?.cells).toBeCloseTo(3, 12);
    expect(few?.overruns).toBeCloseTo(1, 12);
    expect(few?.stopsAt).toBeUndefined();
    // 40 cells give 10 expected overruns: the second overrun comes after 8 cells, and the job stops
    const many = runCost([{ job: "rects", size: 100, cells: 40 }, { job: "rects", size: 1000, cells: 40 }], spread, { calls: 1, budgets }).models[0]?.jobs[0];
    expect(many?.callMinutes).toBeCloseTo((6 * 10 + 2 * 500) / 60_000, 12);
    expect(many?.cells).toBeCloseTo(6, 12);
    expect(many?.overruns).toBe(2);
    expect(many?.stopsAt).toBe(100);
  });

  it("scales the spread of the nearest probe size to the time on the line", () => {
    const all = [...probes("rects", "cpu-a", [[10, 1], [10, 1], [10, 1], [10, 100]]), ...probes("rects", "cpu-a", [[1000, 100], [1000, 100], [1000, 100], [1000, 10_000]])];
    // The time on the line at 100 is 10 times the mean at 10, so the spread at 10 times 10 gives 10, 10, 10 and 1,000 ms
    const job = runCost([{ job: "rects", size: 100, cells: 4 }], all, { calls: 1, budgets: [{ upTo: 1000, ms: 500 }] }).models[0]?.jobs[0];
    expect(job?.callMinutes).toBeCloseTo((3 * 10 + 500) / 60_000, 12);
    expect(job?.overruns).toBeCloseTo(1, 12);
  });

  it("does not stop at a size that no budget covers", () => {
    const cost = runCost([{ job: "rects", size: 1000, cells: 1 }], probes("rects", "cpu-a", [[1000, 5000]]), { calls: 1, budgets: [{ upTo: 100, ms: 10 }] });
    expect(cost.models[0]?.jobs[0]?.stopsAt).toBeUndefined();
    expect(cost.models[0]?.jobs[0]?.callMinutes).toBeCloseTo(5000 / 60_000, 12);
  });

  it("does not count a size with 0 cells, also outside the probe sizes", () => {
    const cost = runCost([{ job: "shelf", size: 1, cells: 0 }, { job: "shelf", size: 10, cells: 1 }], probes("shelf", "cpu-a", [[10, 60]]), { calls: 1 });
    expect(cost.models[0]?.jobs[0]?.extrapolated).toEqual([]);
    expect(cost.models[0]?.jobs[0]?.callMinutes).toBeCloseTo(0.001, 12);
  });

  it("gives the size 0 the time of a probe at 0, else of the smallest probe size", () => {
    const cells: CostCells[] = [
      { job: "shelf", size: 0, cells: 1 },
      { job: "shelf", size: 100, cells: 1 },
    ];
    const at = runCost(cells, probes("shelf", "cpu-a", [[0, 6], [10, 60], [1000, 6000]]), { calls: 1 });
    // The probe at 0 is not on the line: the size 100 gets 600 ms from the probes at 10 and 1,000
    expect(at.models[0]?.jobs[0]?.callMinutes).toBeCloseTo((6 + 600) / 60_000, 12);
    expect(at.models[0]?.jobs[0]?.extrapolated).toEqual([]);
    const without = runCost(cells, probes("shelf", "cpu-a", [[10, 60], [1000, 6000]]), { calls: 1 });
    expect(without.models[0]?.jobs[0]?.callMinutes).toBeCloseTo((60 + 600) / 60_000, 12);
    expect(without.models[0]?.jobs[0]?.extrapolated).toEqual([0]);
    const only = runCost(cells, probes("shelf", "cpu-a", [[0, 6]]), { calls: 1 });
    expect(only.models[0]?.jobs[0]?.extrapolated).toEqual([100]);
  });

  it("adds the overhead and the minutes of each job", () => {
    const cells: CostCells[] = [
      { job: "a", size: 10, cells: 10 },
      { job: "b", size: 10, cells: 10 },
    ];
    const all = [...probes("a", "cpu-a", [[10, 600]]), ...probes("b", "cpu-a", [[10, 600]])];
    const cost = runCost(cells, all, { calls: 1, overhead: 1.5, jobMinutes: 2 });
    // Each job: 10 x 600 ms = 0.1 min of calls, x 1.5, + 2
    for (const job of cost.models[0]?.jobs ?? []) expect(job.minutes).toBeCloseTo(0.15 + 2, 12);
    expect(cost.models[0]?.minutes).toBeCloseTo(4.3, 12);
  });

  it("gives each CPU model its cost, and the range over the models with no missing job", () => {
    const cells: CostCells[] = [
      { job: "a", size: 10, cells: 1 },
      { job: "b", size: 10, cells: 1 },
    ];
    const all = [
      ...probes("a", "cpu-b", [[10, 120]]),
      ...probes("b", "cpu-b", [[10, 120]]),
      ...probes("a", "cpu-a", [[10, 60]]),
      ...probes("b", "cpu-a", [[10, 60]]),
      ...probes("a", "cpu-c", [[10, 6000]]),
    ];
    const cost = runCost(cells, all, { calls: 1 });
    expect(cost.models.map((model) => model.model)).toEqual(["cpu-a", "cpu-b", "cpu-c"]);
    expect(cost.models[2]?.missing).toEqual(["b"]);
    expect(cost.models[2]?.jobs.map((job) => job.job)).toEqual(["a"]);
    expect(cost.low).toBeCloseTo(0.002, 12);
    expect(cost.high).toBeCloseTo(0.004, 12);
  });

  it("gives no range when each model has a missing job", () => {
    const cost = runCost([{ job: "a", size: 10, cells: 1 }, { job: "b", size: 10, cells: 1 }], probes("a", "cpu-a", [[10, 60]]), { calls: 1 });
    expect(cost.models[0]?.missing).toEqual(["b"]);
    expect(cost.low).toBeUndefined();
    expect(cost.high).toBeUndefined();
  });

  it("refuses values out of their range", () => {
    const one: CostCells[] = [{ job: "a", size: 10, cells: 1 }];
    const probe = probes("a", "cpu-a", [[10, 1]]);
    expect(() => runCost(one, probe, { calls: 0 })).toThrow(RangeError);
    expect(() => runCost(one, probe, { calls: 1.5 })).toThrow(RangeError);
    expect(() => runCost(one, probe, { calls: 1, slow: { ms: 0, calls: 1 } })).toThrow(RangeError);
    expect(() => runCost(one, probe, { calls: 1, slow: { ms: 1, calls: 0 } })).toThrow(RangeError);
    expect(() => runCost(one, probe, { calls: 1, overruns: 0 })).toThrow(RangeError);
    expect(() => runCost(one, probe, { calls: 1, overhead: 0 })).toThrow(RangeError);
    expect(() => runCost(one, probe, { calls: 1, jobMinutes: -1 })).toThrow(RangeError);
    expect(() => runCost(one, probe, { calls: 1, budgets: [{ upTo: Number.NaN, ms: 1 }] })).toThrow(RangeError);
    expect(() => runCost([{ job: "a", size: -1, cells: 1 }], probe, { calls: 1 })).toThrow(RangeError);
    expect(() => runCost([{ job: "a", size: 10, cells: -1 }], probe, { calls: 1 })).toThrow(RangeError);
    expect(() => runCost([...one, ...one], probe, { calls: 1 })).toThrow(/two entries/);
    expect(() => runCost(one, probes("a", "cpu-a", [[10, Number.POSITIVE_INFINITY]]), { calls: 1 })).toThrow(RangeError);
    expect(() => runCost(one, probes("a", "cpu-a", [[-1, 1]]), { calls: 1 })).toThrow(RangeError);
  });

  it("gives no models and no range with no probes", () => {
    expect(runCost([{ job: "a", size: 10, cells: 1 }], [], { calls: 1 })).toEqual({ models: [], low: undefined, high: undefined });
  });
});
