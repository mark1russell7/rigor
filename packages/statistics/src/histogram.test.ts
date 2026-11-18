import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import {
  HISTOGRAM_RELATIVE_ERROR,
  addAllToHistogram,
  addToHistogram,
  emptyHistogram,
  histogramOf,
  histogramQuantile,
  mergeHistograms,
  quantileSorted,
  sorted,
} from "./index.ts";

// Values over many scales, with both signs and 0, so that the buckets of both signs and the zero count are tested.
const magnitude = uniformDouble({ min: 1e-3, max: 1e6 });
const value = fc.oneof(magnitude, magnitude.map((x) => -x), fc.constant(0));
const values = (minLength: number) => fc.array(value, { minLength, maxLength: 80 });
const share = uniformDouble({ min: 0, max: 1 });
// The bound of a quantile, with a tolerance for the rounding of the logarithm at the edge of a bucket.
const within = (estimate: number, exact: number, alpha: number) => Math.abs(estimate - exact) <= alpha * Math.abs(exact) * (1 + 1e-9) + 1e-12;

describe("the histogram", () => {
  it("gives each quantile within the relative error of the nearest-rank quantile", () => {
    fc.assert(
      fc.property(values(1), share, fc.constantFrom(0.001, 0.01, 0.05), (xs, p, alpha) => {
        const exact = quantileSorted(sorted(xs), p, "nearest-rank");
        expect(within(histogramQuantile(histogramOf(xs, alpha), p), exact, alpha)).toBe(true);
      }),
    );
  });

  it("gives the exact extremes at p = 0 and p = 1, and the count, the sum and the zeros", () => {
    const h = histogramOf([3, -1, 0, 4, 1, 5, 0]);
    expect(histogramQuantile(h, 0)).toBe(-1);
    expect(histogramQuantile(h, 1)).toBe(5);
    expect(h).toMatchObject({ n: 7, sum: 12, min: -1, max: 5, zeros: 2, relativeError: HISTOGRAM_RELATIVE_ERROR });
    expect(histogramQuantile(histogramOf([0, 0, 0, 7]), 0.5)).toBe(0);
  });

  it("keeps a quantile inside the range of the values", () => {
    fc.assert(
      fc.property(values(1), share, (xs, p) => {
        const q = histogramQuantile(histogramOf(xs), p);
        expect(q).toBeGreaterThanOrEqual(Math.min(...xs));
        expect(q).toBeLessThanOrEqual(Math.max(...xs));
      }),
    );
  });

  it("merges two histograms into the histogram of the two lists", () => {
    fc.assert(
      fc.property(values(0), values(0), (xs, ys) => {
        const merged = mergeHistograms(histogramOf(xs), histogramOf(ys));
        const whole = histogramOf([...xs, ...ys]);
        expect({ ...merged, sum: 0 }).toEqual({ ...whole, sum: 0 });
        expect(Math.abs(merged.sum - whole.sum)).toBeLessThanOrEqual(1e-6 * (1 + Math.abs(whole.sum)));
      }),
    );
  });

  it("gives the same histogram one value at a time and in one batch", () => {
    fc.assert(
      fc.property(values(0), (xs) => {
        const folded = xs.reduce((h, x) => addToHistogram(h, x), emptyHistogram());
        expect(folded).toEqual(addAllToHistogram(emptyHistogram(), xs));
      }),
    );
  });

  it("does not change the histogram that it adds to", () => {
    const h = histogramOf([1, 2, 3]);
    const copy = structuredClone(h);
    addToHistogram(h, 100);
    addAllToHistogram(h, [-5, 0]);
    mergeHistograms(h, histogramOf([9]));
    expect(h).toEqual(copy);
    expect(addAllToHistogram(h, [])).toBe(h);
  });

  it("keeps the extremes of an empty histogram that went through JSON", () => {
    const saved = JSON.parse(JSON.stringify(emptyHistogram())) as ReturnType<typeof emptyHistogram>;
    expect(addToHistogram(saved, 5)).toMatchObject({ n: 1, min: 5, max: 5 });
    expect(addToHistogram(saved, -5)).toMatchObject({ n: 1, min: -5, max: -5 });
    expect(histogramQuantile(addAllToHistogram(saved, [-5, -3]), 0)).toBe(-5);
  });

  it("uses a count of buckets that grows with the logarithm of the range", () => {
    const h = histogramOf(Array.from({ length: 100_000 }, (_, i) => 10_000 ** (i / 99_999)));
    expect(h.positive.length).toBe(462);
    expect(h.positive.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(100_000);
  });

  it("refuses a bad relative error, a value that is not finite, a bad p, an empty histogram and a merge of two errors", () => {
    expect(() => emptyHistogram(0)).toThrow(RangeError);
    expect(() => emptyHistogram(1)).toThrow(RangeError);
    expect(() => emptyHistogram(Number.NaN)).toThrow(RangeError);
    expect(() => addToHistogram(emptyHistogram(), Number.NaN)).toThrow(/addToHistogram/);
    expect(() => addAllToHistogram(emptyHistogram(), [1, Infinity])).toThrow(/addAllToHistogram/);
    expect(() => histogramQuantile(emptyHistogram(), 0.5)).toThrow(/empty/);
    expect(() => histogramQuantile(histogramOf([1]), 1.5)).toThrow(RangeError);
    expect(() => mergeHistograms(emptyHistogram(0.01), emptyHistogram(0.02))).toThrow(/relative errors differ/);
  });
});
