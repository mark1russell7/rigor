import { describe, expect, it } from "vitest";
import { dispersionTest } from "./dispersion.ts";
import { logGamma } from "@mark1russell7/rigor-generators";

/** The exact p value of the Pearson statistic: a sum over each split of the total into the cells, with its multinomial chance. */
function exactP(counts: readonly number[], shares: readonly number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const expected = shares.map((share) => share * total);
  const pearson = (cells: readonly number[]): number => cells.reduce((sum, count, index) => sum + (count - (expected[index] ?? 0)) ** 2 / (expected[index] ?? 1), 0);
  const bar = pearson(counts) - 1e-9;
  let p = 0;
  const walk = (cells: number[], left: number): void => {
    if (cells.length === shares.length - 1) {
      const all = [...cells, left];
      if (pearson(all) < bar) return;
      const log = logGamma(total + 1) + all.reduce((sum, count, index) => sum + count * Math.log(shares[index] ?? 0) - logGamma(count + 1), 0);
      p += Math.exp(log);
      return;
    }
    for (let count = 0; count <= left; count++) walk([...cells, count], left - count);
  };
  walk([], total);
  return p;
}

describe("dispersionTest", () => {
  it("gives a p value near the exact p value of the multinomial law, within 4 standard errors of the draws", () => {
    const draws = 20_000;
    for (const [counts, exposures] of [
      [[0, 3], [1, 1]],
      [[1, 4, 7], [1, 1, 1]],
      [[3, 3, 9, 2], [1, 1, 2, 1]],
      [[12, 30, 21, 8, 15], [1, 1, 1, 1, 1]],
    ] as const) {
      const weight = exposures.reduce((sum: number, exposure: number) => sum + exposure, 0);
      const exact = exactP(counts, exposures.map((exposure: number) => exposure / weight));
      const result = dispersionTest(counts, { exposures, draws, seed: 7 });
      const error = Math.sqrt((exact * (1 - exact)) / draws);
      expect(Math.abs(result.p - exact), JSON.stringify(counts)).toBeLessThan(4 * error + 1 / draws);
    }
    // The split [0, 3] of 3 events into 2 equal cells: 2 of the 8 orders are as far from equal.
    expect(exactP([0, 3], [0.5, 0.5])).toBeCloseTo(0.25, 12);
  });

  it("gives the p value 1 to counts that are equal to the expected counts, and a small p value to counts in one cell", () => {
    const even = dispersionTest([2, 8], { exposures: [1, 4], draws: 500 });
    expect(even).toMatchObject({ statistic: 0, p: 1, hits: 500, draws: 500, total: 10 });
    const one = dispersionTest([0, 0, 0, 30], { draws: 999 });
    expect(one.statistic).toBe(90);
    expect(one.hits).toBe(0);
    expect(one.p).toBe(1 / 1000);
  });

  it("needs no draw for a total of 0 or for one cell", () => {
    expect(dispersionTest([0, 0, 0])).toMatchObject({ statistic: 0, p: 1, hits: 0, draws: 0, total: 0 });
    expect(dispersionTest([5])).toMatchObject({ statistic: 0, p: 1, draws: 0, total: 5 });
  });

  it("gives the same result for the same seed, and tells the seed", () => {
    const a = dispersionTest([4, 9, 2, 6], { draws: 2000, seed: "years" });
    expect(dispersionTest([4, 9, 2, 6], { draws: 2000, seed: "years" })).toEqual(a);
    expect(a.seed).toBe(dispersionTest([1, 1], { draws: 1, seed: "years" }).seed);
    expect(dispersionTest([4, 9, 2, 6], { draws: 2000 }).seed).not.toBe(a.seed);
  });

  it("refuses counts that are not whole, no counts, bad exposures and bad draws", () => {
    expect(() => dispersionTest([])).toThrow(RangeError);
    expect(() => dispersionTest([1, 2.5])).toThrow(/whole number/u);
    expect(() => dispersionTest([1, -1])).toThrow(RangeError);
    expect(() => dispersionTest([1, 2], { exposures: [1] })).toThrow(/2 counts/u);
    expect(() => dispersionTest([1, 2], { exposures: [1, 0] })).toThrow(/more than 0/u);
    expect(() => dispersionTest([1, 2], { exposures: [1, Number.POSITIVE_INFINITY] })).toThrow(RangeError);
    expect(() => dispersionTest([1, 2], { draws: 0 })).toThrow(/draws/u);
    expect(() => dispersionTest([1, 2], { draws: 1.5 })).toThrow(/draws/u);
  });

  it("refuses more steps than maxWork before the work starts, and needs no check of the work for a total of 0", () => {
    // 1000 draws of 30 events: 30000 uniform draws, for each number of cells.
    expect(() => dispersionTest([10, 10, 10], { draws: 1000, maxWork: 29_999 })).toThrow(/maxWork/u);
    expect(dispersionTest([10, 10, 10], { draws: 1000, maxWork: 30_000 }).draws).toBe(1000);
    expect(dispersionTest([15, 15], { draws: 1000, maxWork: 30_000 }).draws).toBe(1000);
    expect(() => dispersionTest(new Array<number>(10).fill(100_000))).toThrow(RangeError);
    expect(() => dispersionTest([1, 2], { maxWork: 0 })).toThrow(/maxWork/u);
    expect(dispersionTest([0, 0], { maxWork: 1 }).p).toBe(1);
  });
});
