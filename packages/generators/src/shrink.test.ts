import { describe, expect, it } from "vitest";
import { type InputFamily, type Point, SHRINK_TOLERANCE, shrinkPoint, shrinkPointAsync, shrinkTarget } from "./index.ts";

const ints: InputFamily = {
  name: "ints",
  dimensions: [
    { name: "a", min: 0, max: 100, integer: true },
    { name: "b", min: 0, max: 100, integer: true },
  ],
};

describe("shrinkTarget", () => {
  it("gives the value of the range nearest to 0", () => {
    expect(shrinkTarget({ name: "x", min: 3, max: 9 })).toBe(3);
    expect(shrinkTarget({ name: "x", min: -9, max: -3 })).toBe(-3);
    expect(shrinkTarget({ name: "x", min: -9, max: 9 })).toBe(0);
    expect(shrinkTarget({ name: "x", min: 0, max: 9 })).toBe(0);
  });
});

describe("shrinkPoint", () => {
  it("moves each integer dimension to its target or to the edge of the failure", () => {
    const result = shrinkPoint(ints, { a: 50, b: 80 }, (p) => p["a"]! + p["b"]! >= 10);
    expect(result.point).toEqual({ a: 0, b: 10 });
    expect(result.steps).toEqual([
      { dimension: "a", from: 50, to: 0 },
      { dimension: "b", from: 80, to: 10 },
    ]);
    expect(result.exhausted).toBe(false);
  });

  it("counts each check, with the check of the first point", () => {
    let calls = 0;
    const result = shrinkPoint(ints, { a: 50, b: 80 }, (p) => {
      calls++;
      return p["a"]! + p["b"]! >= 10;
    });
    expect(result.checks).toBe(calls);
  });

  it("stops a bisection of a double within the tolerance of the edge", () => {
    const family: InputFamily = { name: "unit", dimensions: [{ name: "x", min: 0, max: 1 }] };
    const fails = (p: Point) => p["x"]! > 0.3;
    const result = shrinkPoint(family, { x: 0.9 }, fails);
    expect(fails(result.point)).toBe(true);
    expect(result.point["x"]! - 0.3).toBeLessThanOrEqual(SHRINK_TOLERANCE);
    // A second bisection moves the value by less than the tolerance, so the shrink ends before its budget.
    expect(result.exhausted).toBe(false);
    expect(result.checks).toBeLessThan(100);
  });

  it("halves a log dimension on the scale of its logarithm", () => {
    const family: InputFamily = { name: "log", dimensions: [{ name: "n", min: 1, max: 1e6, scale: "log" }] };
    const result = shrinkPoint(family, { n: 5e5 }, (p) => p["n"]! >= 1000);
    expect(result.point["n"]).toBeGreaterThanOrEqual(1000);
    expect(Math.log(result.point["n"]! / 1000)).toBeLessThanOrEqual(SHRINK_TOLERANCE * Math.log(1e6));
    expect(result.exhausted).toBe(false);
  });

  it("moves a negative range toward its largest value, and a range across 0 toward 0", () => {
    const negative: InputFamily = { name: "neg", dimensions: [{ name: "x", min: -100, max: -1, integer: true }] };
    expect(shrinkPoint(negative, { x: -90 }, (p) => p["x"]! <= -20).point).toEqual({ x: -20 });
    const across: InputFamily = { name: "across", dimensions: [{ name: "x", min: -50, max: 50, integer: true }] };
    expect(shrinkPoint(across, { x: -40 }, (p) => Math.abs(p["x"]!) >= 7).point).toEqual({ x: -7 });
  });

  it("keeps the keys of the first point that are not dimensions", () => {
    const result = shrinkPoint(ints, { a: 5, b: 5, seed: 42 }, (p) => p["a"]! >= 1);
    expect(result.point).toEqual({ a: 1, b: 0, seed: 42 });
  });

  it("gives the same result for the same point and the same function", () => {
    const fails = (p: Point) => p["a"]! * p["b"]! >= 300;
    expect(shrinkPoint(ints, { a: 70, b: 90 }, fails)).toEqual(shrinkPoint(ints, { a: 70, b: 90 }, fails));
  });

  it("stops at the budget of checks with a point that fails", () => {
    const fails = (p: Point) => p["a"]! + p["b"]! >= 10;
    const result = shrinkPoint(ints, { a: 50, b: 80 }, fails, { maxChecks: 4 });
    expect(result.checks).toBe(4);
    expect(result.exhausted).toBe(true);
    expect(fails(result.point)).toBe(true);
    const one = shrinkPoint(ints, { a: 50, b: 80 }, fails, { maxChecks: 1 });
    expect(one).toMatchObject({ point: { a: 50, b: 80 }, checks: 1, exhausted: true, steps: [] });
  });

  it("refuses a first point that does not fail, and bad values", () => {
    expect(() => shrinkPoint(ints, { a: 1, b: 1 }, () => false)).toThrow(/does not fail/);
    expect(() => shrinkPoint(ints, { a: 1 }, () => true)).toThrow(/not in the range/);
    expect(() => shrinkPoint(ints, { a: 1, b: 101 }, () => true)).toThrow(/not in the range/);
    expect(() => shrinkPoint(ints, { a: 1, b: 1.5 }, () => true)).toThrow(/not an integer/);
    expect(() => shrinkPoint(ints, { a: 1, b: 1 }, () => true, { maxChecks: 0 })).toThrow(RangeError);
    expect(() => shrinkPoint(ints, { a: 1, b: 1 }, () => true, { tolerance: 0 })).toThrow(RangeError);
    expect(() => shrinkPoint({ name: "none", dimensions: [] }, {}, () => true)).toThrow(/one dimension or more/);
  });
});

describe("shrinkPointAsync", () => {
  it("gives the result of shrinkPoint for a function that gives a promise", async () => {
    const fails = (p: Point) => p["a"]! * p["b"]! >= 300;
    const sync = shrinkPoint(ints, { a: 70, b: 90 }, fails);
    expect(await shrinkPointAsync(ints, { a: 70, b: 90 }, async (p) => fails(p))).toEqual(sync);
  });
});
