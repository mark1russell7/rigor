import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EMPTY_RUNNING, addToRunning, mean, mergeRunning, runningMean, runningOf, runningSd, sd } from "./index.ts";

// Values of one scale. The tolerance of the spread is relative to the largest magnitude, the scale of the rounding.
const value = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
const values = (minLength: number) => fc.array(value, { minLength, maxLength: 60 });
const close = (a: number, b: number, scale: number) => Math.abs(a - b) <= 1e-9 * (1 + scale);
const scaleOf = (xs: readonly number[]) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe("the running summary", () => {
  it("gives the count, the sum and the extremes of the values", () => {
    expect(runningOf([3, -1, 4, 1, 5])).toEqual({ n: 5, sum: 12, min: -1, max: 5, m2: expect.any(Number) as number });
    expect(runningOf([])).toBe(EMPTY_RUNNING);
    expect(runningOf(new Set([2, 4]))).toMatchObject({ n: 2, sum: 6 });
  });

  it("gives exactly the mean of the list, and the sd of the list to a tolerance", () => {
    fc.assert(
      fc.property(values(1), (xs) => {
        const s = runningOf(xs);
        expect(runningMean(s)).toBe(mean(xs));
        expect([s.min, s.max]).toEqual([Math.min(...xs), Math.max(...xs)]);
        if (xs.length >= 2) expect(close(runningSd(s), sd(xs), scaleOf(xs))).toBe(true);
      }),
    );
  });

  it("gives an sd of exactly 0 for equal values, as sd does", () => {
    fc.assert(
      fc.property(value, fc.integer({ min: 2, max: 40 }), (x, n) => {
        expect(runningSd(runningOf(Array.from({ length: n }, () => x)))).toBe(0);
      }),
    );
  });

  it("merges two summaries into the summary of the two lists", () => {
    fc.assert(
      fc.property(values(0), values(0), (xs, ys) => {
        const merged = mergeRunning(runningOf(xs), runningOf(ys));
        const all = [...xs, ...ys];
        const folded = runningOf(all);
        expect([merged.n, merged.min, merged.max]).toEqual([folded.n, folded.min, folded.max]);
        expect(close(merged.sum, folded.sum, scaleOf(all) * all.length)).toBe(true);
        if (all.length >= 2) expect(close(runningSd(merged), sd(all), scaleOf(all))).toBe(true);
      }),
    );
  });

  it("has the empty summary as the unit of the merge", () => {
    fc.assert(
      fc.property(values(0), (xs) => {
        const s = runningOf(xs);
        expect(mergeRunning(EMPTY_RUNNING, s)).toBe(s);
        expect(mergeRunning(s, EMPTY_RUNNING)).toBe(s);
      }),
    );
  });

  it("keeps each step, because the record is immutable", () => {
    const one = addToRunning(EMPTY_RUNNING, 1);
    const two = addToRunning(one, 3);
    expect([one.n, two.n, runningMean(two)]).toEqual([1, 2, 2]);
    expect(Object.isFrozen(EMPTY_RUNNING)).toBe(true);
    expect(EMPTY_RUNNING).toEqual({ n: 0, sum: 0, min: Infinity, max: -Infinity, m2: 0 });
  });

  it("refuses a NaN, a mean of no value and an sd of less than 2 values", () => {
    expect(() => addToRunning(EMPTY_RUNNING, Number.NaN)).toThrow(new RangeError("addToRunning: the value is NaN."));
    expect(() => runningMean(EMPTY_RUNNING)).toThrow(new RangeError("runningMean: the summary is empty."));
    expect(() => runningSd(runningOf([1]))).toThrow(new RangeError("runningSd: the summary needs 2 values or more."));
  });
});
