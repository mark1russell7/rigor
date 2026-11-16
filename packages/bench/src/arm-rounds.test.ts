import { describe, expect, it } from "vitest";
import { aaStats, armOrder, armVerdicts, caseRatios, timeArmRounds } from "./index.ts";

/**
 * A fake clock: each call of an arm moves the clock by the cost of the arm in milliseconds, and gives the value of the
 * arm. It keeps the count of calls of each batch of the base.
 */
function fake(costs: Readonly<Record<string, number>>) {
  let t = 0;
  let baseCalls = 0;
  const batches: number[] = [];
  const arm = (id: string, value: number) => ({
    id,
    run: () => {
      t += costs[id] ?? 0;
      if (id === "base") baseCalls++;
      return value;
    },
  });
  return {
    batches,
    arm,
    now: () => {
      if (baseCalls > 0) batches.push(baseCalls);
      baseCalls = 0;
      return t;
    },
  };
}

const COSTS = { base: 0.01, two: 0.02, three: 0.03 };

describe("timeArmRounds", () => {
  it("doubles the count until a batch of the base takes the target time", () => {
    const f = fake(COSTS);
    const result = timeArmRounds({ case: "x", base: f.arm("base", 1), candidates: [f.arm("two", 2)], rounds: 2, targetMs: 10, warmMs: 0, now: f.now });
    expect(result.count).toBe(1024);
    expect(f.batches.slice(0, 11)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]);
  });

  it("gives one record for each round of each pair, with the base batch of the round as arm a", () => {
    const f = fake(COSTS);
    const result = timeArmRounds({ case: "board-1", base: f.arm("base", 1), candidates: [f.arm("two", 2), f.arm("three", 3)], rounds: 5, targetMs: 10, warmMs: 0, now: f.now });
    expect(Object.keys(result.pairs)).toEqual(["two", "three", "base~aa"]);
    for (const [pair, ratio] of [["two", 2], ["three", 3], ["base~aa", 1]] as const) {
      const records = result.pairs[pair]!;
      expect(records.map((r) => [r.case, r.round])).toEqual([0, 1, 2, 3, 4].map((round) => ["board-1", round]));
      for (const r of records) expect(r.a).toBeCloseTo(10.24, 9);
      expect(caseRatios(records)[0]!.ratio).toBeCloseTo(ratio, 9);
    }
    // The base batch of each round is one time, shared by each pair.
    for (let round = 0; round < 5; round++) expect(result.pairs["two"]![round]!.a).toBe(result.pairs["base~aa"]![round]!.a);
    // The calibration has 11 base batches (1 + 2 + ... + 1024 calls). Each round has 2 base batches and one of each candidate.
    expect(result.sink).toBe(2047 + 5 * 1024 * (1 + 1 + 2 + 3));
  });

  it("runs the arms in the order of armOrder, turned by the offset", () => {
    const f = fake(COSTS);
    const result = timeArmRounds({ case: "x", base: f.arm("base", 1), candidates: [f.arm("two", 2), f.arm("three", 3)], rounds: 4, offset: 1, targetMs: 1, warmMs: 0, now: f.now });
    const turned = ["two", "three", "base~aa", "base"];
    expect(result.orders).toEqual([0, 1, 2, 3].map((round) => armOrder(turned, round)));
    expect(result.orders[0]![0]).toBe("two");
    const first = timeArmRounds({ case: "x", base: f.arm("base", 1), candidates: [f.arm("two", 2), f.arm("three", 3)], rounds: 1, offset: -1, targetMs: 1, warmMs: 0, now: f.now });
    expect(first.orders[0]![0]).toBe("base~aa");
  });

  it("gives the first arm of each pair from its order in the round", () => {
    const f = fake(COSTS);
    const result = timeArmRounds({ case: "x", base: f.arm("base", 1), candidates: [f.arm("two", 2), f.arm("three", 3)], rounds: 6, targetMs: 1, warmMs: 0, now: f.now });
    for (const [pair, records] of Object.entries(result.pairs)) {
      records.forEach((r, round) => {
        const order = result.orders[round]!;
        expect(r.first).toBe(order.indexOf("base") < order.indexOf(pair) ? "a" : "b");
      });
    }
  });

  it("keeps the two orders of each pair within 1 of each other, for each count of rounds and each offset", () => {
    const f = fake({ base: 0.01, c1: 0.01, c2: 0.01, c3: 0.01 });
    const candidates = [f.arm("c1", 1), f.arm("c2", 1), f.arm("c3", 1)];
    for (let rounds = 1; rounds <= 12; rounds++) {
      for (let offset = 0; offset < 5; offset++) {
        const result = timeArmRounds({ case: "x", base: f.arm("base", 1), candidates, rounds, offset, targetMs: 0.05, warmMs: 0, now: f.now });
        for (const records of Object.values(result.pairs)) expect(() => caseRatios(records)).not.toThrow();
      }
    }
  });

  it("gives records that armVerdicts and aaStats read", () => {
    const f = fake(COSTS);
    const result = timeArmRounds({ case: "x", base: f.arm("base", 1), candidates: [f.arm("two", 2)], rounds: 7, targetMs: 1, warmMs: 0, now: f.now });
    expect(Object.keys(armVerdicts(result, "base~aa"))).toEqual(["two"]);
    expect(aaStats(result.pairs["base~aa"]!)[0]).toMatchObject({ case: "x", rounds: 7 });
    expect(aaStats(result.pairs["base~aa"]!)[0]!.median).toBeCloseTo(0, 9);
  });

  it("has no A/A pair with aa false", () => {
    const f = fake(COSTS);
    const result = timeArmRounds({ case: "x", base: f.arm("base", 1), candidates: [f.arm("two", 2)], rounds: 2, aa: false, targetMs: 1, warmMs: 0, now: f.now });
    expect(Object.keys(result.pairs)).toEqual(["two"]);
    expect(result.orders.every((order) => order.length === 2)).toBe(true);
  });

  it("times a given A/A function as the second arm of the A/A pair", () => {
    const f = fake({ ...COSTS, copy: 0.011 });
    const copy = f.arm("copy", 1);
    const result = timeArmRounds({ case: "x", base: f.arm("base", 1), candidates: [f.arm("two", 2)], rounds: 6, aa: copy.run, targetMs: 10, warmMs: 0, now: f.now });
    expect(Object.keys(result.pairs)).toEqual(["two", "base~aa"]);
    expect(caseRatios(result.pairs["base~aa"]!)[0]!.ratio).toBeCloseTo(1.1, 9);
    expect(result.orders.every((order) => order.length === 3)).toBe(true);
    expect(Object.keys(armVerdicts(result, "base~aa"))).toEqual(["two"]);
    // The calibration has 11 base batches. Each round has one batch of the base, of the candidate and of the copy.
    expect(result.sink).toBe(2047 + 6 * 1024 * (1 + 2 + 1));
  });

  it("keeps the count of the warm-up, and grows it after the warm-up to the target", () => {
    const f = fake(COSTS);
    expect(timeArmRounds({ case: "x", base: f.arm("base", 1), candidates: [f.arm("two", 2)], rounds: 1, targetMs: 10, warmMs: 5, now: f.now }).count).toBe(1024);
  });

  it("refuses bad options", () => {
    const f = fake(COSTS);
    const run = (options: object) => () => timeArmRounds({ case: "x", base: f.arm("base", 1), candidates: [f.arm("two", 2)], rounds: 1, targetMs: 1, warmMs: 0, now: f.now, ...options });
    expect(run({ rounds: 0 })).toThrow(RangeError);
    expect(run({ rounds: 1.5 })).toThrow(RangeError);
    expect(run({ offset: 0.5 })).toThrow(RangeError);
    expect(run({ targetMs: 0 })).toThrow(RangeError);
    expect(run({ warmMs: -1 })).toThrow(RangeError);
    expect(run({ candidates: [], aa: false })).toThrow(/1 pair or more/);
    expect(run({ candidates: [f.arm("base", 1)] })).toThrow(/not unique/);
    expect(run({ candidates: [f.arm("base~aa", 1)] })).toThrow(/not unique/);
    expect(run({ candidates: [{ id: "", run: () => 1 }] })).toThrow(/not empty/);
    expect(run({ candidates: [{ id: "c" }] })).toThrow(/no run function/);
    expect(run({ aa: 1 })).toThrow(/true, false or a function/);
    expect(run({ aa: null })).toThrow(/true, false or a function/);
    expect(run({ candidates: [] })).not.toThrow();
  });
});
