import { describe, expect, it } from "vitest";
import { type ControlRow, type MeasuredFactor, controlFactor } from "./control.ts";

const rows = (group: string, values: readonly number[]): ControlRow[] => values.map((value, i) => ({ group, key: `k${i}`, value }));

describe("controlFactor", () => {
  it("gives the median ratio of the shared keys over a base group", () => {
    const r = controlFactor([...rows("old", [10, 20, 30, 40, 50]), ...rows("new", [15, 30, 45, 60, 75])], { base: "old" });
    expect(r.base).toBe("old");
    expect(r.factors).toEqual([{ group: "new", factor: 1.5, pairs: 5, low: 1.5, high: 1.5, censored: 0, unshared: 0 }]);
  });

  it("gives the spread of the ratios, so a load that one factor does not explain shows", () => {
    const f = controlFactor([...rows("old", [10, 10, 10, 10, 10]), ...rows("new", [10, 12, 14, 16, 18])], { base: "old" }).factors[0] as MeasuredFactor;
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

  it("gives each shard of one run a factor over the median of each key", () => {
    const r = controlFactor([...rows("shard-0", [10, 20, 30, 40, 50]), ...rows("shard-1", [20, 40, 60, 80, 100]), ...rows("shard-2", [40, 80, 120, 160, 200])]);
    expect(r.base).toBeUndefined();
    expect(r.factors.map((f) => [f.group, f.factor])).toEqual([
      ["shard-0", 0.5],
      ["shard-1", 1],
      ["shard-2", 2],
    ]);
  });

  it("does not read a mix of work as load", () => {
    const row = (group: string, key: string, value: number): ControlRow => ({ group, key, value });
    const small = (group: string, keys: readonly string[]) => keys.map((k) => row(group, k, 10));
    const large = (group: string, keys: readonly string[]) => keys.map((k) => row(group, k, 1000));
    // The two shards have equal load. The second shard holds most of the large cases.
    const r = controlFactor(
      [...small("light", ["s0", "s1", "s2", "s3"]), ...large("light", ["l0"]), ...small("heavy", ["s0"]), ...large("heavy", ["l0", "l1", "l2", "l3"])],
      { minPairs: 2 },
    );
    expect(r.factors.map((f) => f.factor)).toEqual([1, 1]);
    expect(r.factors.map((f) => f.pairs)).toEqual([2, 2]);
  });

  it("leaves out a key of one group, because the key has nothing to compare with", () => {
    const r = controlFactor([...rows("a", [10, 10, 10, 10, 10]), ...rows("b", [20, 20, 20, 20, 20]), { group: "b", key: "only-b", value: 999 }]);
    expect(r.factors[1]).toMatchObject({ pairs: 5, unshared: 1 });
  });

  it("gives a thin group an entry with its reason, and keeps the other factors", () => {
    const r = controlFactor([...rows("a", [10, 10, 10, 10, 10]), ...rows("b", [20, 20, 20, 20, 20]), ...rows("c", [30, 30])]);
    expect(r.factors.map((f) => f.factor === undefined)).toEqual([false, false, true]);
    expect(r.factors[2]).toMatchObject({ group: "c", pairs: 2 });
    expect(r.factors[2]).toHaveProperty("reason", expect.stringMatching(/2 usable keys, and the least is 5/));
    const based = controlFactor([...rows("a", [10, 10, 10, 10, 10]), ...rows("b", [20, 20, 20, 20, 20]), ...rows("c", [30, 30])], { base: "a" });
    expect(based.factors.map((f) => f.factor)).toEqual([2, undefined]);
  });

  it("refuses a result with no factor, as keys that no group shares give", () => {
    const row = (group: string, key: string): ControlRow => ({ group, key, value: 10 });
    expect(() => controlFactor(["k0", "k1", "k2", "k3", "k4"].flatMap((k) => [row("a", `a-${k}`), row("b", `b-${k}`)]))).toThrow(/no group has a factor/);
  });

  it("does not read a censored time in the median of a key", () => {
    const r = controlFactor([...rows("a", [10, 10, 10, 10, 10, 10]), ...rows("b", [10, 10, 10, 10, 10]), { group: "b", key: "k5", value: 9000, censored: true }]);
    expect(r.factors.map((f) => f.factor)).toEqual([1, 1]);
    expect(r.factors[1]!.censored).toBe(1);
  });

  it("refuses rows with no group to compare", () => {
    expect(() => controlFactor([])).toThrow(/no group to compare/);
    expect(() => controlFactor(rows("old", [10, 10, 10, 10, 10]), { base: "old" })).toThrow(/no group to compare/);
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

  it("refuses a group with no usable time", () => {
    expect(() => controlFactor([{ group: "a", key: "k", value: 1, censored: true }])).toThrow(/0 usable keys/);
  });
});
