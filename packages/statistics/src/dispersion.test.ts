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

describe("dispersionTest with the method exact", () => {
  /** The exact p by a sum over each vector of counts with the total: the check of the sum over the partitions. */
  const brute = (counts: readonly number[]): number => {
    const total = counts.reduce((sum, count) => sum + count, 0);
    const cells = counts.length;
    const pearson = (cellCounts: readonly number[]): number => cellCounts.reduce((sum, count) => sum + (count - total / cells) ** 2 / (total / cells), 0);
    const statistic = pearson(counts);
    const bar = statistic - 1e-9 * Math.max(1, statistic);
    let hit = 0;
    const place = (cell: number, left: number, chosen: number[]): void => {
      if (cell === cells - 1) {
        const all = [...chosen, left];
        if (pearson(all) >= bar) hit += Math.exp(logGamma(total + 1) - all.reduce((sum, count) => sum + logGamma(count + 1), 0) - total * Math.log(cells));
        return;
      }
      for (let count = 0; count <= left; count++) place(cell + 1, left - count, [...chosen, count]);
    };
    place(0, total, []);
    return hit;
  };

  it("gives the p of a sum over each vector of counts", () => {
    for (const counts of [[1, 0, 3], [5, 0, 0, 1], [2, 2, 2, 2], [7, 1, 0, 2, 3], [0, 9], [3, 3, 0, 1, 1, 4]]) {
      const test = dispersionTest(counts, { method: "exact" });
      expect(test.p, JSON.stringify(counts)).toBeCloseTo(brute(counts), 12);
      expect(test).toMatchObject({ exact: true, draws: 0, hits: 0 });
    }
  });

  it("gives the exact p values of the yearly counts of an example, with no draws and no seed", () => {
    // These are the yearly counts of an example from 2014 and from 2015. The two exact p values are 0.0447 and 0.3526.
    expect(dispersionTest([0, 4, 6, 6, 5, 8, 8, 7, 14, 8], { method: "exact" }).p).toBeCloseTo(0.0447, 4);
    expect(dispersionTest([4, 6, 6, 5, 8, 8, 7, 14, 8], { method: "exact" }).p).toBeCloseTo(0.3526, 4);
    expect(dispersionTest([4, 6, 6, 5, 8, 8, 7, 14, 8], { method: "exact", seed: 7 }).p).toBe(dispersionTest([4, 6, 6, 5, 8, 8, 7, 14, 8], { method: "exact" }).p);
  });

  it("gives a p near the p of the draws", () => {
    const counts = [4, 9, 2, 6, 1];
    const exact = dispersionTest(counts, { method: "exact" }).p;
    const drawn = dispersionTest(counts, { draws: 20_000, seed: "near" });
    expect(drawn.exact).toBe(false);
    expect(Math.abs(drawn.p - exact)).toBeLessThan(4 * Math.sqrt((exact * (1 - exact)) / 20_000) + 1e-4);
  });

  it("uses the draws with the method auto when the exact sum cannot run", () => {
    expect(dispersionTest([4, 9, 2], { method: "auto" }).exact).toBe(true);
    expect(dispersionTest([4, 9, 2], { method: "auto", exposures: [1, 2, 1] })).toMatchObject({ exact: false, draws: 10_000 });
    expect(dispersionTest([4, 9, 2], { method: "auto", maxPartitions: 3 })).toMatchObject({ exact: false, draws: 10_000 });
    expect(dispersionTest([4, 9, 2], { method: "auto", exposures: [2, 2, 2] }).exact).toBe(true);
  });

  it("refuses the method exact when the sum cannot run, and a bad option", () => {
    expect(() => dispersionTest([4, 9, 2], { method: "exact", exposures: [1, 2, 1] })).toThrow(/equal exposures/);
    expect(() => dispersionTest([4, 9, 2], { method: "exact", maxPartitions: 3 })).toThrow(/more than maxPartitions 3/);
    expect(() => dispersionTest([4, 9, 2], { method: "exact", maxPartitions: 0 })).toThrow(/maxPartitions is a whole number/);
    expect(() => dispersionTest([4, 9, 2], { method: "other" as "exact" })).toThrow(/draws, exact or auto/);
  });

  it("keeps the draws as the default method", () => {
    expect(dispersionTest([4, 9, 2])).toMatchObject({ exact: false, draws: 10_000 });
  });
});
