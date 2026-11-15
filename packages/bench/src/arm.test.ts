import { describe, expect, it } from "vitest";
import { timeArm } from "./arm.ts";

/** A fake clock that moves `perCall` ms at each call of the arm. */
const fake = (perCall: number) => {
  const state = { t: 0, calls: 0 };
  return {
    state,
    now: () => state.t,
    run: () => {
      state.t += perCall;
      state.calls += 1;
      return state.calls;
    },
  };
};

describe("the timed samples of one arm", () => {
  it("calibrates the calls to the target time, and gives the median time of one call", () => {
    const clock = fake(0.25);
    const time = timeArm(clock.run, { samples: 5, warmMs: 0, now: clock.now });
    // 64 calls take 16 ms, the first count at or above 10 ms.
    expect(time.calls).toBe(64);
    expect(time.ms).toBe(0.25);
    expect(time.samples).toEqual([0.25, 0.25, 0.25, 0.25, 0.25]);
  });

  it("uses the calls of an earlier process, and does not calibrate", () => {
    const clock = fake(0.25);
    const time = timeArm(clock.run, { samples: 3, calls: 7, warmMs: 0, warmSamples: 2, now: clock.now });
    expect(time.calls).toBe(7);
    // 2 warm samples and 3 counted samples, each of 7 calls.
    expect(clock.state.calls).toBe(35);
  });

  it("runs the arm for the warm-up time before the calibration", () => {
    const clock = fake(0.5);
    timeArm(clock.run, { samples: 1, calls: 4, warmMs: 20, warmSamples: 0, now: clock.now });
    // The warm-up stops at the first sample that ends at or after 20 ms: 10 samples of 2 ms.
    expect(clock.state.calls).toBe(10 * 4 + 4);
  });

  it("gives the median, thus one slow sample does not move the time", () => {
    let t = 0;
    let call = 0;
    // The calls 22 and 23 are in the third sample.
    const slow = new Set([22, 23]);
    const time = timeArm(
      () => {
        call += 1;
        t += slow.has(call) ? 5 : 0.25;
        return call;
      },
      { samples: 5, calls: 10, warmMs: 0, warmSamples: 0, now: () => t },
    );
    expect(time.samples.filter((ms) => ms > 0.25)).toHaveLength(1);
    expect(time.ms).toBe(0.25);
  });

  it("gives the warm check: the median of the last half of the samples over the median of the first half", () => {
    let t = 0;
    let call = 0;
    // Each sample has 2 calls. The calls of the samples 0 and 1 take 1 ms, the calls of the samples 2 and 3 take 0.5 ms.
    const costs = [1, 1, 0.5, 0.5];
    const time = timeArm(
      () => {
        t += costs[Math.floor(call / 2)]!;
        call += 1;
        return call;
      },
      { samples: 4, calls: 2, warmMs: 0, warmSamples: 0, now: () => t },
    );
    expect(time.samples).toEqual([1, 1, 0.5, 0.5]);
    expect(time.warm).toBe(0.5);
    expect(time.ms).toBe(0.75);
    const one = fake(0.25);
    expect(timeArm(one.run, { samples: 1, calls: 1, warmMs: 0, now: one.now }).warm).toBeUndefined();
  });

  it("gives the bounds of the halves to mark, outside the timed part", () => {
    const clock = fake(0.25);
    const marks: number[] = [];
    const time = timeArm(clock.run, {
      samples: 5,
      calls: 4,
      warmMs: 0,
      now: clock.now,
      mark: (sample) => {
        marks.push(sample);
        // The time of a mark is not in a sample.
        clock.state.t += 100;
      },
    });
    expect(marks).toEqual([0, 2, 3, 5]);
    expect(time.samples).toEqual([0.25, 0.25, 0.25, 0.25, 0.25]);
  });

  it("waits in the timed part with a slowdown factor, as code that is slower by that factor", () => {
    let t = 0;
    // Each read of the clock takes 0.001 ms, and each call takes 0.25 ms.
    const now = (): number => (t += 0.001);
    const time = timeArm(() => (t += 0.25), { samples: 3, calls: 4, warmMs: 0, warmSamples: 0, slow: 3, now });
    expect(time.ms).toBeCloseTo(0.75, 2);
    expect(() => timeArm(() => 1, { samples: 1, slow: 0.5 })).toThrow(/slowdown factor/);
  });

  it("refuses options that are not valid", () => {
    const clock = fake(1);
    expect(() => timeArm(clock.run, { samples: 0 })).toThrow(RangeError);
    expect(() => timeArm(clock.run, { samples: 1, calls: 1.5 })).toThrow(/calls/);
    expect(() => timeArm(clock.run, { samples: 1, targetMs: 0 })).toThrow(/target time/);
    expect(() => timeArm(clock.run, { samples: 1, warmMs: Number.NaN })).toThrow(/warm-up/);
    expect(() => timeArm(clock.run, { samples: 1, warmSamples: -1 })).toThrow(/warm samples/);
  });
});
