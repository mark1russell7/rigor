import { describe, expect, it } from "vitest";
import { caseRatios, timeRounds } from "./index.ts";

/** A fake clock: arm a takes 0.01 ms for each call and arm b 0.02 ms. It keeps the count of calls of each batch of arm a. */
function fake() {
  let t = 0;
  let calls = 0;
  const batches: number[] = [];
  return {
    batches,
    arms: { a: () => ((t += 0.01), calls++, 1), b: () => ((t += 0.02), 2) },
    now: () => {
      if (calls > 0) batches.push(calls);
      calls = 0;
      return t;
    },
  };
}

describe("timeRounds", () => {
  it("doubles the count until a batch of arm a takes the target time", () => {
    const f = fake();
    const result = timeRounds(f.arms, { case: "x", rounds: 2, targetMs: 10, warmMs: 0, now: f.now });
    expect(result.count).toBe(1024);
    expect(f.batches.slice(0, 11)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]);
    expect(f.batches.slice(11)).toEqual([1024, 1024]);
    const g = fake();
    expect(timeRounds(g.arms, { case: "x", rounds: 1, targetMs: 5, warmMs: 0, now: g.now }).count).toBe(512);
  });

  it("keeps the count of the warm-up, and grows it after the warm-up to the target", () => {
    const f = fake();
    expect(timeRounds(f.arms, { case: "x", rounds: 1, targetMs: 10, warmMs: 5, now: f.now }).count).toBe(1024);
  });

  it("alternates the first arm each round, and an odd offset starts with arm b", () => {
    const even = fake();
    const odd = fake();
    const first = (offset: number, f: ReturnType<typeof fake>) =>
      timeRounds(f.arms, { case: "x", rounds: 4, offset, targetMs: 10, warmMs: 0, now: f.now }).records.map((r) => r.first);
    expect(first(0, even)).toEqual(["a", "b", "a", "b"]);
    expect(first(1, odd)).toEqual(["b", "a", "b", "a"]);
  });

  it("gives one record for each round, with the time of one batch of each arm", () => {
    const f = fake();
    const result = timeRounds(f.arms, { case: "board-1", rounds: 5, offset: 1, targetMs: 10, warmMs: 0, now: f.now });
    expect(result.records.map((r) => [r.case, r.round])).toEqual([0, 1, 2, 3, 4].map((round) => ["board-1", round]));
    for (const r of result.records) {
      expect(r.a).toBeCloseTo(10.24, 9);
      expect(r.b).toBeCloseTo(20.48, 9);
    }
    expect(caseRatios(result.records)[0]!.ratio).toBeCloseTo(2, 9);
    expect(result.sink).toBe(1024 * 2 * 5 + 1024 * 5 + 2047);
  });

  it("refuses rounds that are not a whole number of 1 or more, a target time of 0 or less and a negative warm-up time or an offset that is not a whole number", () => {
    const run = (options: object) => () => {
      const f = fake();
      return timeRounds(f.arms, { case: "x", rounds: 1, warmMs: 0, now: f.now, ...options });
    };
    expect(run({ rounds: 0 })).toThrow(RangeError);
    expect(run({ rounds: 1.5 })).toThrow(RangeError);
    expect(run({ targetMs: 0 })).toThrow(RangeError);
    expect(run({ targetMs: Number.NaN })).toThrow(RangeError);
    expect(run({ warmMs: -1 })).toThrow(RangeError);
    expect(run({ offset: 0.5 })).toThrow(RangeError);
  });
});
