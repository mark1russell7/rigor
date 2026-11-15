import { describe, expect, it } from "vitest";
import { MODIFIED_Z_CUT, modifiedZ } from "./outlier.ts";

describe("modifiedZ", () => {
  it("gives the score 0.6745 * (value - median) / MAD and the outliers above the cut", () => {
    // The worst A/A spread of each of 6 jobs in one family: one job is far above the others.
    const spreads = [0.0279, 0.1478, 0.0388, 0.0213, 0.0443, 0.0205];
    const result = modifiedZ(spreads);
    expect(result.median).toBeCloseTo(0.03335, 10);
    expect(result.mad).toBeCloseTo(0.0115, 10);
    expect(result.scores[1]).toBeCloseTo((0.6745 * (0.1478 - 0.03335)) / 0.0115, 10);
    expect(result.outliers).toEqual([1]);
    expect(MODIFIED_Z_CUT).toBe(3.5);
  });

  it("keeps the side of an outlier", () => {
    const values = [-10, 1, 1.1, 0.9, 1.05, 0.95, 10];
    expect(modifiedZ(values).outliers).toEqual([0, 6]);
    expect(modifiedZ(values, { side: "high" }).outliers).toEqual([6]);
    expect(modifiedZ(values, { side: "low" }).outliers).toEqual([0]);
    expect(modifiedZ(values, { cut: 1000 }).outliers).toEqual([]);
  });

  it("uses the mean absolute deviation when the MAD is 0, and gives 0 for equal values", () => {
    const result = modifiedZ([1, 1, 1, 1, 2]);
    expect(result.mad).toBe(0);
    // The mean absolute deviation is 0.2, so the score of 2 is 1 / (1.253314 * 0.2).
    expect(result.scores[4]).toBeCloseTo(1 / (1.253314 * 0.2), 10);
    expect(result.outliers).toEqual([4]);
    expect(modifiedZ([3, 3, 3])).toEqual({ median: 3, mad: 0, scores: [0, 0, 0], outliers: [] });
  });

  it("refuses an empty list, a value that is not finite and a bad cut", () => {
    expect(() => modifiedZ([])).toThrow(/empty/);
    expect(() => modifiedZ([1, Number.NaN])).toThrow(/finite/);
    expect(() => modifiedZ([1, Infinity])).toThrow(/finite/);
    expect(() => modifiedZ([1, 2], { cut: 0 })).toThrow(/cut/);
  });
});
