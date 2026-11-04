import { describe, expect, it } from "vitest";
import { type ControlRow, controlFactor } from "./control.ts";

const rows = (group: string, values: readonly number[]): ControlRow[] => values.map((value, i) => ({ group, key: `k${i}`, value }));

describe("controlFactor", () => {
  it("gives the median ratio of the shared keys over a base group", () => {
    const r = controlFactor([...rows("old", [10, 20, 30, 40, 50]), ...rows("new", [15, 30, 45, 60, 75])], { base: "old" });
    expect(r.base).toBe("old");
    expect(r.factors).toEqual([{ group: "new", factor: 1.5, pairs: 5, low: 1.5, high: 1.5, censored: 0 }]);
  });

  it("gives the spread of the ratios, so a load that one factor does not explain shows", () => {
    const f = controlFactor([...rows("old", [10, 10, 10, 10, 10]), ...rows("new", [10, 12, 14, 16, 18])], { base: "old" }).factors[0]!;
    expect(f.factor).toBeCloseTo(1.4);
    expect(f.low).toBeCloseTo(1.2);
    expect(f.high).toBeCloseTo(1.6);
  });

  it("reads only the keys of both groups", () => {
    const r = controlFactor([...rows("old", [10, 10, 10, 10, 10, 99]), ...rows("new", [20, 20, 20, 20, 20])], { base: "old" });
    expect(r.factors[0]!).toMatchObject({ factor: 2, pairs: 5 });
  });

  it("leaves out a censored time, and counts it", () => {
    const fresh = rows("new", [20, 20, 20, 20, 20]);
    const r = controlFactor([...rows("old", [10, 10, 10, 10, 10, 10]), ...fresh, { group: "new", key: "k5", value: 900, censored: true }], { base: "old" });
    expect(r.factors[0]!).toMatchObject({ factor: 2, pairs: 5, censored: 1 });
  });

  it("gives each shard of one run a factor over the median of the run", () => {
    const r = controlFactor([...rows("shard-0", [10, 10, 10, 10, 10]), ...rows("shard-1", [20, 20, 20, 20, 20]), ...rows("shard-2", [40, 40, 40, 40, 40])]);
    expect(r.base).toBeUndefined();
    expect(r.factors.map((f) => [f.group, f.factor])).toEqual([
      ["shard-0", 0.5],
      ["shard-1", 1],
      ["shard-2", 2],
    ]);
  });

  it("does not read a censored time in the median of a run", () => {
    const r = controlFactor([...rows("a", [10, 10, 10, 10, 10]), ...rows("b", [10, 10, 10, 10, 10]), { group: "b", key: "k9", value: 9000, censored: true }]);
    expect(r.factors.map((f) => f.factor)).toEqual([1, 1]);
    expect(r.factors[1]!.censored).toBe(1);
  });

  it("refuses too few keys, so a factor of a thin join is not a number", () => {
    expect(() => controlFactor([...rows("old", [10, 10]), ...rows("new", [20, 20])], { base: "old" })).toThrow(/2 usable keys/);
    expect(() => controlFactor([...rows("old", [10, 10]), ...rows("new", [20, 20])], { base: "old", minPairs: 2 })).not.toThrow();
  });

  it("refuses a value out of range, a key that comes twice and an unknown base", () => {
    expect(() => controlFactor([{ group: "a", key: "k", value: 0 }])).toThrow(RangeError);
    expect(() => controlFactor([{ group: "a", key: "k", value: Number.NaN }])).toThrow(RangeError);
    expect(() => controlFactor([{ group: "a", key: "k", value: 1 }, { group: "a", key: "k", value: 2 }])).toThrow(/twice/);
    expect(() => controlFactor(rows("a", [1, 1, 1, 1, 1]), { base: "b" })).toThrow(/not a group/);
    expect(() => controlFactor(rows("a", [1, 1, 1, 1, 1]), { minPairs: 0 })).toThrow(/minPairs/);
  });

  it("refuses rows with no time that is not censored", () => {
    expect(() => controlFactor([{ group: "a", key: "k", value: 1, censored: true }])).toThrow(/no time/);
  });
});
