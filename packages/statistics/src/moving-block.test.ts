import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import {
  type Interval,
  blockLength,
  bootstrap,
  bootstrapLeastSquares,
  bootstrapMovingBlock,
  bootstrapMovingBlockLeastSquares,
  leastSquares,
  mean,
  median,
  sd,
} from "./index.ts";

/** This function gives `n` readings of a stationary AR(1) series with the slope `phi` and unit noise. */
function ar1(seed: number, n: number, phi: number): number[] {
  const r = random(seed);
  const out: number[] = [];
  let v = r.normal() / Math.sqrt(1 - phi * phi);
  for (let i = 0; i < n; i++) {
    out.push(v);
    v = phi * v + r.normal();
  }
  return out;
}

const covers = (interval: Interval, truth: number): number => (interval.low <= truth && truth <= interval.high ? 1 : 0);
const width = (interval: Interval): number => interval.high - interval.low;

describe("bootstrapMovingBlock", () => {
  it("with block 1, gives the draws of bootstrap, in the two forms", () => {
    const data = ar1(7, 60, 0.5);
    const row = bootstrap(data, mean, { runs: 500, seed: 3 });
    for (const circular of [false, true]) {
      const block = bootstrapMovingBlock(data, mean, { runs: 500, seed: 3, block: 1, circular });
      expect({ ...block }).toEqual({ ...row, block: 1, circular });
    }
  });

  it("draws blocks of readings that follow each other, and a circular block wraps to the start", () => {
    const n = 40;
    const series = Array.from({ length: n }, (_, i) => i);
    for (const circular of [false, true]) {
      let wraps = 0;
      bootstrapMovingBlock(
        series,
        (sample) => {
          expect(sample).toHaveLength(n);
          for (let i = 0; i < n; i++) {
            if (i % 10 === 9 || i === n - 1) continue;
            const next = (sample[i] as number) + 1;
            expect(sample[i + 1]).toBe(circular ? next % n : next);
            if (next === n) wraps++;
          }
          return 0;
        },
        { runs: 200, seed: 5, block: 10, circular },
      );
      expect(wraps > 0).toBe(circular);
    }
  });

  it("gives each reading the same weight only in the circular form", () => {
    // Without the wrap, the reading 0 is only in the block that starts at 0, one start of 31. Each sample has 4 blocks.
    const n = 40;
    const series = Array.from({ length: n }, (_, i) => i);
    const runs = 4000;
    const counts = (circular: boolean): number[] => {
      const count = new Array<number>(n).fill(0);
      bootstrapMovingBlock(
        series,
        (sample) => {
          if (sample === series) return 0;
          for (const v of sample) count[v] = (count[v] ?? 0) + 1;
          return 0;
        },
        { runs, seed: 11, block: 10, circular },
      );
      return count.map((c) => c / runs);
    };
    const plain = counts(false);
    expect(plain[0]).toBeCloseTo(4 / 31, 1);
    expect(plain[n - 1]).toBeCloseTo(4 / 31, 1);
    expect(Math.abs((plain[20] as number) - 40 / 31)).toBeLessThan(0.05);
    for (const share of counts(true)) expect(Math.abs(share - 1)).toBeLessThan(0.08);
  });

  it("gives the same interval for the same seed, and the block length of blockLength by default", () => {
    const v = ar1(3, 80, 0.5);
    const a = bootstrapMovingBlock(v, mean, { runs: 300, seed: 9 });
    expect(bootstrapMovingBlock(v, mean, { runs: 300, seed: 9 })).toEqual(a);
    expect(bootstrapMovingBlock(v, mean, { runs: 300, seed: 10 })).not.toEqual(a);
    expect(a.block).toBe(blockLength(v));
    expect(a.circular).toBe(false);
    expect(a.estimate).toBe(mean(v));
    expect(a.finite).toBe(300);
  });

  it("refuses an empty series, a bad block, and a default block for items that are not numbers", () => {
    const v = ar1(3, 80, 0.5);
    expect(() => bootstrapMovingBlock([], mean)).toThrow(/the series is empty/);
    for (const block of [0, 81, 2.5, Number.NaN]) expect(() => bootstrapMovingBlock(v, mean, { block })).toThrow(RangeError);
    expect(() => bootstrapMovingBlock([{ a: 1 }, { a: 2 }], () => 0)).toThrow(/give block/);
    expect(bootstrapMovingBlock([{ a: 1 }, { a: 2 }], (s) => s.length, { block: 2, runs: 10 }).estimate).toBe(2);
    expect(bootstrapMovingBlock([5], mean, { runs: 10 })).toMatchObject({ estimate: 5, low: 5, high: 5, block: 1 });
  });

  it("on iid data, gives the width of the row bootstrap within the noise of two row bootstraps", () => {
    const r = random(31);
    const twoRows: number[] = [];
    const blockToRow: number[] = [];
    for (let k = 0; k < 30; k++) {
      const v = Array.from({ length: 200 }, () => r.normal());
      const row = width(bootstrap(v, mean, { runs: 1000, seed: k + 1 }));
      twoRows.push(width(bootstrap(v, mean, { runs: 1000, seed: k + 1001 })) / row);
      blockToRow.push(width(bootstrapMovingBlock(v, mean, { runs: 1000, seed: k + 1001 })) / row);
    }
    const floor = (4 * sd(twoRows)) / Math.sqrt(twoRows.length);
    expect(Math.abs(mean(blockToRow) - 1)).toBeLessThan(floor);
  });

  it("covers the mean of an AR(1) series much more often than the row bootstrap", () => {
    // The variance of the mean is (1 + 0.6) / (1 - 0.6) = 4 times the iid value, so the row bootstrap covers 0.645 here.
    // The block bootstrap covers 0.85 here, and about 0.93 at n = 800: the block length of a short series is too small.
    let row = 0;
    let block = 0;
    const series = 200;
    for (let k = 0; k < series; k++) {
      const v = ar1(1000 + k, 200, 0.6);
      row += covers(bootstrap(v, mean, { runs: 400, seed: k + 1 }), 0);
      block += covers(bootstrapMovingBlock(v, mean, { runs: 400, seed: k + 1 }), 0);
    }
    expect(row / series).toBeLessThan(0.78);
    expect(block / series).toBeGreaterThan(0.82);
    expect((block - row) / series).toBeGreaterThan(0.12);
  }, 60_000);
});

describe("bootstrapMovingBlockLeastSquares", () => {
  it("with block 1, gives the intervals of bootstrapLeastSquares", () => {
    const y = ar1(7, 60, 0.5);
    const x = y.map((_, i) => [i]);
    const row = bootstrapLeastSquares(x, y, { runs: 300, seed: 5 });
    const block = bootstrapMovingBlockLeastSquares(x, y, { runs: 300, seed: 5, block: 1 });
    expect(block).toEqual(row.map((interval) => ({ ...interval, block: 1, circular: false })));
  });

  it("takes the default block from the residuals of the fit of all the rows", () => {
    const xs = ar1(5, 300, 0.7);
    const es = ar1(6, 300, 0.7);
    const x = xs.map((v) => [v]);
    const y = xs.map((v, i) => 1 + 2 * v + (es[i] as number));
    const fit = bootstrapMovingBlockLeastSquares(x, y, { runs: 200, seed: 1 });
    const [a, b] = leastSquares(x, y).coefficients as [number, number];
    expect(fit).toHaveLength(2);
    expect(fit[0]?.block).toBe(fit[1]?.block);
    expect(fit[0]?.block).toBe(blockLength(y.map((v, i) => v - (a + b * (xs[i] as number)))));
    expect(fit[1]?.block).toBeGreaterThan(1);
    expect(fit[1]?.estimate).toBe(b);
    expect(() => bootstrapMovingBlockLeastSquares(x, y, { block: 301 })).toThrow(RangeError);
  });

  it("covers the slope of a regression with AR(1) rows and AR(1) errors much more often than the row bootstrap", () => {
    // With x and the error both AR(1) of slope 0.7, the variance of the slope is (1 + 0.49) / (1 - 0.49) = 2.9 times the iid value.
    // Here the row bootstrap covers 0.725, and the block bootstrap 0.88.
    let row = 0;
    let block = 0;
    const series = 200;
    for (let k = 0; k < series; k++) {
      const xs = ar1(5000 + k, 200, 0.7);
      const es = ar1(9000 + k, 200, 0.7);
      const x = xs.map((v) => [v]);
      const y = xs.map((v, i) => 1 + 2 * v + (es[i] as number));
      row += covers(bootstrapLeastSquares(x, y, { runs: 400, seed: k + 1 })[1] as Interval, 2);
      block += covers(bootstrapMovingBlockLeastSquares(x, y, { runs: 400, seed: k + 1 })[1] as Interval, 2);
    }
    expect(row / series).toBeLessThan(0.8);
    expect(block / series).toBeGreaterThan(0.82);
    expect((block - row) / series).toBeGreaterThan(0.1);
  }, 60_000);
});

describe("blockLength", () => {
  it("gives 1 for a series with no spread and for iid data", () => {
    expect(blockLength([2, 2, 2, 2, 2])).toBe(1);
    const r = random(21);
    for (let k = 0; k < 20; k++) expect(blockLength(Array.from({ length: 500 }, () => r.normal()))).toBeLessThanOrEqual(4);
  });

  it("is near the optimal length of an AR(1) series", () => {
    // For AR(1), G / g = 2 phi / (1 - phi^2), and the optimal length is (3/2 (G / g)^2)^(1/3) n^(1/3): 39.0 at phi 0.8 and n 2000.
    const phi = 0.8;
    const n = 2000;
    const optimal = Math.cbrt(1.5 * ((2 * phi) / (1 - phi * phi)) ** 2) * Math.cbrt(n);
    const lengths = Array.from({ length: 20 }, (_, k) => blockLength(ar1(200 + k, n, phi)));
    expect(Math.abs(median(lengths) / optimal - 1)).toBeLessThan(0.25);
  });

  it("is at most ceil(min(3 sqrt(n), n / 3))", () => {
    // A step has an autocorrelation near 1 at each lag of the window, so its length reaches the cap.
    const n = 40_000;
    expect(blockLength(Array.from({ length: n }, (_, i) => (i < n / 2 ? 0 : 1)))).toBe(600);
    for (const short of [2, 3, 4, 5, 6, 9, 12, 30, 100]) {
      const most = Math.max(1, Math.ceil(Math.min(3 * Math.sqrt(short), short / 3)));
      expect(blockLength(Array.from({ length: short }, (_, i) => i))).toBeLessThanOrEqual(most);
    }
  });

  it("refuses a series of fewer than 2 values and a value that is not finite", () => {
    expect(() => blockLength([1])).toThrow(/2 values or more/);
    expect(() => blockLength([1, Number.NaN])).toThrow(/finite/);
  });
});
