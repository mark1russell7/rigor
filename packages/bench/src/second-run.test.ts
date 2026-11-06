import { describe, expect, it } from "vitest";
import {
  type TimedCase,
  firstAgainstSecond,
  firstAgainstSecondLine,
  overLimit,
  runMethod,
  sameResult,
  sentinelCases,
} from "./second-run.ts";

describe("overLimit", () => {
  it("is false with no limit, and false at the limit", () => {
    expect(overLimit(1e9)).toBe(false);
    expect(overLimit(60_000, 60_000)).toBe(false);
    expect(overLimit(60_001, 60_000)).toBe(true);
  });

  it("refuses a bad time and a bad limit", () => {
    expect(() => overLimit(-1, 10)).toThrow(RangeError);
    expect(() => overLimit(Number.NaN)).toThrow(RangeError);
    expect(() => overLimit(5, 0)).toThrow(RangeError);
    expect(() => overLimit(5, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("runMethod and sameResult", () => {
  it("gives each method", () => {
    expect(runMethod(50, { limitMs: 100 })).toBe("two runs");
    expect(runMethod(150, { limitMs: 100 })).toBe("one run");
    expect(runMethod(150, { limitMs: 100, sentinel: true })).toBe("sentinel");
    expect(runMethod(150)).toBe("two runs");
  });

  it("makes no claim for one run, and compares the hashes for two runs", () => {
    expect(sameResult("one run", "h")).toBeNull();
    expect(sameResult("two runs", "h", "h")).toBe(true);
    expect(sameResult("sentinel", "h", "g")).toBe(false);
    expect(() => sameResult("one run", "h", "h")).toThrow(RangeError);
    expect(() => sameResult("two runs", "h")).toThrow(RangeError);
  });
});

describe("sentinelCases", () => {
  const cases: TimedCase[] = [
    { key: "a1", group: "a", ms: 50 },
    { key: "a2", group: "a", ms: 130 },
    { key: "a3", group: "a", ms: 120 },
    { key: "a4", group: "a", ms: 400 },
    { key: "b1", group: "b", ms: 200 },
    { key: "b2", group: "b", ms: 90 },
    { key: "c1", group: "c", ms: 80 },
  ];

  it("picks the smallest case over the limit, and one other case of each group", () => {
    const out = sentinelCases(cases, { limitMs: 100, seed: "2026-11-05" });
    expect(out[0]).toEqual({ key: "a3", group: "a", reason: "smallest" });
    expect(out.slice(1).map((s) => [s.group, s.reason])).toEqual([
      ["a", "rotating"],
      ["b", "rotating"],
    ]);
    expect(["a2", "a4"]).toContain(out[1]!.key);
    expect(out[2]!.key).toBe("b1");
  });

  it("gives no rotating sentinel to a group that has only the smallest case", () => {
    const out = sentinelCases([{ key: "x", group: "g", ms: 300 }, { key: "y", group: "h", ms: 500 }], { limitMs: 100, seed: 1 });
    expect(out).toEqual([
      { key: "x", group: "g", reason: "smallest" },
      { key: "y", group: "h", reason: "rotating" },
    ]);
  });

  it("does not depend on the order of the list, and turns with the seed", () => {
    const one = sentinelCases(cases, { limitMs: 100, seed: 7 });
    expect(sentinelCases([...cases].reverse(), { limitMs: 100, seed: 7 })).toEqual(one);
    const picks = new Set<string>();
    for (let night = 0; night < 40; night++) picks.add(sentinelCases(cases, { limitMs: 100, seed: `night ${night}` })[1]!.key);
    expect([...picks].sort()).toEqual(["a2", "a4"]);
  });

  it("gives no sentinel with no limit or with no case over it", () => {
    expect(sentinelCases(cases, { seed: 1 })).toEqual([]);
    expect(sentinelCases(cases, { limitMs: 1000, seed: 1 })).toEqual([]);
  });

  it("refuses a key that occurs twice", () => {
    expect(() => sentinelCases([cases[0]!, cases[0]!], { limitMs: 10, seed: 1 })).toThrow(RangeError);
  });
});

describe("firstAgainstSecond", () => {
  it("gives the ratios of each group in the order of the names", () => {
    const out = firstAgainstSecond([
      { group: "b", firstMs: 100, secondMs: 80 },
      { group: "a", firstMs: 100, secondMs: 90 },
      { group: "b", firstMs: 200, secondMs: 200 },
      { group: "b", firstMs: 100, secondMs: 70 },
    ]);
    expect(out).toEqual([
      { group: "a", n: 1, median: 0.9, low: 0.9, high: 0.9 },
      { group: "b", n: 3, median: 0.8, low: 0.7, high: 1 },
    ]);
    expect(firstAgainstSecondLine(out)).toBe(
      "First against second, the time of the second run over the first: a 1 case, median 0.90 (0.90 to 0.90); b 3 cases, median 0.80 (0.70 to 1.00).",
    );
  });

  it("states that no case has two runs, and refuses a first time of 0", () => {
    expect(firstAgainstSecondLine(firstAgainstSecond([]))).toBe("First against second: no case has two runs.");
    expect(() => firstAgainstSecond([{ group: "a", firstMs: 0, secondMs: 5 }])).toThrow(RangeError);
  });
});
