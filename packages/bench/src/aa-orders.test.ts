import { describe, expect, it } from "vitest";
import { type PairedTime, aaOrders } from "./index.ts";

/** The A/A records of one case: the ratio `b / a` is `aFirst` in the rounds where `a` starts first, and `bFirst` in the other rounds. */
function records(firsts: readonly ("a" | "b")[], aFirst: number, bFirst: number, id = "x"): PairedTime[] {
  return firsts.map((first, round) => ({ case: id, round, first, a: 10, b: 10 * (first === "a" ? aFirst : bFirst) * (1 + round / 1000) }));
}

describe("aaOrders", () => {
  it("shows a bias of order as two orders on the two sides of 1", () => {
    const [read] = aaOrders(records(["a", "b", "b", "a", "a", "b", "b", "a", "a", "b", "b", "a"], 1.05, 0.95));
    expect(read!.case).toBe("x");
    expect(read!.aFirst!.rounds).toBe(6);
    expect(read!.bFirst!.rounds).toBe(6);
    expect(read!.aFirst!.ratio).toBeGreaterThan(1.04);
    expect(read!.bFirst!.ratio).toBeLessThan(0.96);
    expect(read!.aFirst!.low).toBeGreaterThan(1);
    expect(read!.bFirst!.high).toBeLessThan(1);
    expect(read!.all.rounds).toBe(12);
    expect(read!.all.low).toBeLessThan(1);
    expect(read!.all.high).toBeGreaterThan(1);
  });

  it("accepts orders with different counts, the case of rounds that are not balanced", () => {
    const [read] = aaOrders(records(["a", "a", "a", "a", "a", "b"], 1.03, 0.99));
    expect(read!.aFirst!.rounds).toBe(5);
    expect(read!.bFirst!.rounds).toBe(1);
    expect(read!.all.ratio).toBeGreaterThan(1.02);
  });

  it("gives the range and a coverage below the level for 5 rounds or fewer", () => {
    const [read] = aaOrders(records(["a", "b", "a", "b"], 1.01, 0.99));
    expect(read!.aFirst!.coverage).toBeLessThan(0.9);
    expect(read!.all.coverage).toBeLessThan(0.9);
    // The lowest ratio is the one of round 1: 0.99 times 1.001.
    expect(read!.all.low).toBeCloseTo(0.99 * 1.001, 12);
  });

  it("leaves out an order with no round", () => {
    const [read] = aaOrders(records(["a", "a", "a"], 1, 1));
    expect(read!.aFirst).toBeDefined();
    expect(read!.bFirst).toBeUndefined();
  });

  it("gives the cases in the order of their first record", () => {
    const both = [...records(["a", "b"], 1, 1, "y"), ...records(["b", "a"], 1, 1, "x")];
    expect(aaOrders(both).map((r) => r.case)).toEqual(["y", "x"]);
  });

  it("refuses two records of one round, a bad record and a bad level", () => {
    expect(() => aaOrders([...records(["a"], 1, 1), ...records(["b"], 1, 1)])).toThrow(/2 records of the round 0/);
    expect(() => aaOrders([{ case: "x", round: 0, first: "a", a: 0, b: 1 }])).toThrow(RangeError);
    expect(() => aaOrders(records(["a"], 1, 1), 1)).toThrow(RangeError);
  });
});
