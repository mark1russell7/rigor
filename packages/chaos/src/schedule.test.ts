import { describe, expect, it } from "vitest";
import { SCHEDULE_FORMAT, checkProfile, constant, expectedArrivals, ramp, schedule, spike, steps } from "./schedule.ts";

const countIn = (times: readonly number[], low: number, high: number): number => times.filter((t) => t >= low && t < high).length;

describe("a profile", () => {
  it("states each problem", () => {
    expect(checkProfile(constant(10, 1000))).toEqual([]);
    expect(checkProfile([])).toEqual(["The profile has no phases."]);
    expect(checkProfile(constant(10, 0))[0]).toContain("length");
    expect(checkProfile(constant(-1, 1000))[0]).toContain("rate");
    expect(checkProfile(ramp(0, Number.NaN, 1000))[0]).toContain("rate");
    expect(() => schedule(constant(10, 0), { arrivals: "uniform" })).toThrow(RangeError);
  });

  it("has the area under its rate as its arrivals", () => {
    expect(expectedArrivals(constant(10, 2000))).toBe(20);
    expect(expectedArrivals(ramp(0, 100, 2000))).toBe(100);
    expect(expectedArrivals(steps([1, 2, 3], 1000))).toBe(6);
    expect(expectedArrivals(spike(10, 100, { before: 1000, width: 500, after: 1000 }))).toBe(70);
  });
});

describe("a uniform schedule", () => {
  it("has an exact count and equal gaps at a fixed rate", () => {
    const plan = schedule(constant(10, 1000), { arrivals: "uniform" });
    expect(plan).toMatchObject({ format: SCHEDULE_FORMAT, arrivals: "uniform", seed: null });
    expect(plan.times).toHaveLength(10);
    plan.times.forEach((time, index) => expect(time).toBeCloseTo(50 + index * 100, 6));
  });

  it("follows a ramp: the second half of a rising ramp has three times the arrivals of the first", () => {
    const { times } = schedule(ramp(0, 1000, 10_000), { arrivals: "uniform" });
    expect(times).toHaveLength(5000);
    expect(countIn(times, 5000, 10_000) / countIn(times, 0, 5000)).toBeCloseTo(3, 2);
  });

  it("gives a falling ramp the same times from the other end", () => {
    const up = schedule(ramp(0, 100, 10_000), { arrivals: "uniform" }).times;
    const down = schedule(ramp(100, 0, 10_000), { arrivals: "uniform" }).times;
    expect(down).toHaveLength(up.length);
    down.forEach((time, index) => expect(time).toBeCloseTo(10_000 - (up[up.length - 1 - index] as number), 6));
  });

  it("skips a phase of rate 0", () => {
    const { times } = schedule([...constant(10, 1000), ...constant(0, 5000), ...constant(10, 1000)], { arrivals: "uniform" });
    expect(times).toHaveLength(20);
    expect(countIn(times, 1000, 6000)).toBe(0);
    expect(times.at(-1)).toBeLessThan(7000);
  });

  it("gives a time to an arrival at the exact start of a ramp from 0", () => {
    const { times } = schedule([...constant(1, 500), ...ramp(0, 10, 1000)], { arrivals: "uniform" });
    expect(times[0]).toBe(500);
    for (const time of times) expect(Number.isFinite(time)).toBe(true);
  });

  it("has a finite time for each arrival of a falling ramp to 0, at each size", () => {
    for (const rate of [3, 7, 11, 101, 997]) {
      const { times } = schedule(ramp(rate, 0, 3700), { arrivals: "uniform" });
      expect(times.every((time) => Number.isFinite(time) && time <= 3700)).toBe(true);
    }
  });

  it("puts a spike in its interval", () => {
    const { times } = schedule(spike(10, 1000, { before: 1000, width: 100, after: 1000 }), { arrivals: "uniform" });
    expect(countIn(times, 1000, 1100)).toBe(100);
  });
});

describe("a Poisson schedule", () => {
  const plan = schedule(constant(1000, 100_000), { arrivals: "poisson", seed: "law" });

  it("gives the same times for the same seed, and other times for another seed", () => {
    expect(schedule(constant(100, 1000), { arrivals: "poisson", seed: 7 }).times).toEqual(schedule(constant(100, 1000), { arrivals: "poisson", seed: 7 }).times);
    expect(schedule(constant(100, 1000), { arrivals: "poisson", seed: 8 }).times).not.toEqual(schedule(constant(100, 1000), { arrivals: "poisson", seed: 7 }).times);
    expect(plan.seed).toBe("law");
  });

  it("has times in order and inside the profile", () => {
    for (let index = 1; index < plan.times.length; index += 1) expect(plan.times[index]).toBeGreaterThan(plan.times[index - 1] as number);
    expect(plan.times.at(-1)).toBeLessThan(100_000);
  });

  it("has a count within 4 standard deviations of the rate", () => {
    expect(Math.abs(plan.times.length - 100_000)).toBeLessThan(4 * Math.sqrt(100_000));
  });

  it("has exponential gaps: the share of gaps under the mean is 1 less 1/e", () => {
    const gaps = plan.times.slice(1).map((time, index) => time - (plan.times[index] as number));
    expect(gaps.filter((gap) => gap < 1).length / gaps.length).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it("follows the rate of each phase", () => {
    const { times } = schedule(steps([100, 1000], 50_000), { arrivals: "poisson", seed: 3 });
    expect(countIn(times, 0, 50_000) / 5000).toBeCloseTo(1, 1);
    expect(countIn(times, 50_000, 100_000) / 50_000).toBeCloseTo(1, 1);
  });
});
