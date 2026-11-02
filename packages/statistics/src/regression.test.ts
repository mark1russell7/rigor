import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import { type Interval, bootstrap, bootstrapLeastSquares, leastSquares } from "./index.ts";

/* ---------- Helpers ---------- */

function bits(x: number): string {
  return new BigUint64Array(new Float64Array([x]).buffer)[0]!.toString(16);
}

function interval(i: Interval): string[] {
  return [bits(i.estimate), bits(i.low), bits(i.high), bits(i.level), String(i.runs), String(i.finite), String(i.seed)];
}

// The normal equations X'X b = X'y, solved by Gauss elimination with partial pivots. Only a reference for the tests.
function normalEquations(x: readonly (readonly number[])[], y: readonly number[]): number[] {
  const rows = x.map((r) => [1, ...r]);
  const k = rows[0]!.length;
  const m = Array.from({ length: k }, (_, a) => [
    ...Array.from({ length: k }, (_, b) => rows.reduce((s, r) => s + r[a]! * r[b]!, 0)),
    rows.reduce((s, r, i) => s + r[a]! * y[i]!, 0),
  ]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= k; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row, c) => row[k]! / row[c]!);
}

// A request time model: a fixed part, a part per byte in and a part per byte out, with seeded normal noise.
const TRUE = [1.5, 0.002, 0.0005];
function requests(n: number, noise: number, seed: string): { x: number[][]; y: number[] } {
  const r = random(seed);
  const x: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const bytesIn = r.int(100, 5000);
    const bytesOut = r.int(100, 20_000);
    x.push([bytesIn, bytesOut]);
    y.push(TRUE[0]! + TRUE[1]! * bytesIn + TRUE[2]! * bytesOut + r.normal(0, noise));
  }
  return { x, y };
}

/* ---------- leastSquares ---------- */

describe("leastSquares", () => {
  it("fits y = 3 + 2x exactly", () => {
    const x = [[0], [1], [2], [3], [4], [5]];
    const fit = leastSquares(x, [3, 5, 7, 9, 11, 13]);
    expect(fit.coefficients[0]).toBeCloseTo(3, 12);
    expect(fit.coefficients[1]).toBeCloseTo(2, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.residualSd).toBeCloseTo(0, 12);
    expect([fit.n, fit.k, fit.coefficients.length]).toEqual([6, 2, 2]);
  });

  it("fits two predictors exactly", () => {
    const x = [
      [1, 0],
      [0, 1],
      [2, 3],
      [5, -1],
      [-2, 4],
      [3, 3],
    ];
    const y = x.map(([a, b]) => -1 + 0.5 * a! + 4 * b!);
    const fit = leastSquares(x, y);
    expect(fit.k).toBe(3);
    fit.coefficients.forEach((c, j) => expect(c).toBeCloseTo([-1, 0.5, 4][j]!, 12));
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.residualSd).toBeCloseTo(0, 12);
  });

  it("fits through the origin with intercept: false, and uses the total sum about 0", () => {
    const x = [
      [1, 2],
      [2, 1],
      [3, 5],
      [4, 0],
    ];
    const fit = leastSquares(
      x,
      x.map(([a, b]) => 2 * a! - b!),
      { intercept: false },
    );
    expect(fit.k).toBe(2);
    expect(fit.coefficients[0]).toBeCloseTo(2, 12);
    expect(fit.coefficients[1]).toBeCloseTo(-1, 12);
    // The line y = 2x through the origin: rss = 0.1 * 4 = 0.4 for the data below, and tss = 1 + 1.21 + 9.61 + 16.
    const one = leastSquares([[1], [2], [3], [4]], [2.1, 3.9, 6.1, 7.9], { intercept: false });
    const b = (2.1 + 7.8 + 18.3 + 31.6) / 30;
    expect(one.coefficients[0]).toBeCloseTo(b, 12);
    const rss = [2.1, 3.9, 6.1, 7.9].reduce((s, v, i) => s + (v - b * (i + 1)) ** 2, 0);
    expect(one.residualSd).toBeCloseTo(Math.sqrt(rss / 3), 12);
    expect(one.r2).toBeCloseTo(1 - rss / (2.1 ** 2 + 3.9 ** 2 + 6.1 ** 2 + 7.9 ** 2), 12);
  });

  it("gives the textbook fit of x = 1..5, y = 2, 4, 5, 4, 5 to 1e-9", () => {
    // The hand computation: slope 0.6, intercept 2.2, rss 2.4, tss 6, so r2 = 0.6 and residualSd = sqrt(2.4 / 3).
    const fit = leastSquares([[1], [2], [3], [4], [5]], [2, 4, 5, 4, 5]);
    expect(Math.abs(fit.coefficients[0]! - 2.2)).toBeLessThan(1e-9);
    expect(Math.abs(fit.coefficients[1]! - 0.6)).toBeLessThan(1e-9);
    expect(Math.abs(fit.r2 - 0.6)).toBeLessThan(1e-9);
    expect(Math.abs(fit.residualSd - Math.sqrt(0.8))).toBeLessThan(1e-9);
  });

  it("agrees with the normal equations on a noisy fit with two predictors", () => {
    const { x, y } = requests(60, 0.3, "normal equations");
    const fit = leastSquares(x, y);
    const want = normalEquations(x, y);
    fit.coefficients.forEach((c, j) => expect(Math.abs(c - want[j]!)).toBeLessThan(1e-9 * Math.max(1, Math.abs(want[j]!))));
    expect(fit.r2).toBeGreaterThan(0.99);
    expect(fit.residualSd).toBeGreaterThan(0.2);
    expect(fit.residualSd).toBeLessThan(0.4);
  });

  it("keeps a large offset of a predictor accurate", () => {
    // A design with a mean far from 0: the normal equations lose about 12 digits here, and QR does not.
    const x = Array.from({ length: 20 }, (_, i) => [1e6 + i]);
    const fit = leastSquares(
      x,
      x.map(([v]) => 7 + 0.25 * (v! - 1e6)),
    );
    expect(fit.coefficients[1]).toBeCloseTo(0.25, 9);
    expect(fit.coefficients[0]).toBeCloseTo(7 - 0.25e6, 3);
  });

  it("gives the mean for a fit with only an intercept", () => {
    const fit = leastSquares([[], [], [], []], [1, 2, 3, 6]);
    expect(fit.coefficients).toEqual([3]);
    expect(fit.k).toBe(1);
    expect(fit.r2).toBeCloseTo(0, 12);
  });

  it("gives NaN for a singular design and for n <= k, and does not throw", () => {
    const nan = (c: readonly number[]): boolean => c.every((v) => Number.isNaN(v));
    // A constant predictor is a copy of the intercept column.
    const constant = leastSquares([[2], [2], [2], [2]], [1, 2, 3, 4]);
    expect(nan(constant.coefficients) && Number.isNaN(constant.r2) && Number.isNaN(constant.residualSd)).toBe(true);
    expect(constant.coefficients).toHaveLength(2);
    // The second predictor is twice the first.
    expect(nan(leastSquares([[1, 2], [2, 4], [3, 6], [5, 10]], [1, 2, 3, 4]).coefficients)).toBe(true);
    // A column of zeros, without an intercept.
    expect(nan(leastSquares([[0, 1], [0, 2], [0, 3]], [1, 2, 3], { intercept: false }).coefficients)).toBe(true);
    // n = k and n < k.
    expect(nan(leastSquares([[1], [2]], [1, 2]).coefficients)).toBe(true);
    const few = leastSquares([[1, 2, 3]], [1]);
    expect(nan(few.coefficients) && few.k === 4 && few.n === 1).toBe(true);
  });

  it("gives r2 NaN when y is constant", () => {
    const fit = leastSquares([[1], [2], [3]], [4, 4, 4]);
    expect(fit.coefficients[0]).toBeCloseTo(4, 12);
    expect(fit.coefficients[1]).toBeCloseTo(0, 12);
    expect(Number.isNaN(fit.r2)).toBe(true);
  });

  it("throws a RangeError for a wrong shape, a value that is not finite or no coefficient", () => {
    expect(() => leastSquares([], [])).toThrow("leastSquares: x is empty.");
    expect(() => leastSquares([[1], [2]], [1])).toThrow("leastSquares: x has 2 rows and y has 1 values.");
    expect(() => leastSquares([[1], [2, 3], [4]], [1, 2, 3])).toThrow("leastSquares: row 1 of x has 2 values, and row 0 has 1.");
    expect(() => leastSquares([[1], [Number.NaN]], [1, 2])).toThrow("leastSquares: row 1 of x has a value that is not finite.");
    expect(() => leastSquares([[1], [2]], [1, Number.POSITIVE_INFINITY])).toThrow("leastSquares: value 1 of y is not finite.");
    expect(() => leastSquares([[], []], [1, 2], { intercept: false })).toThrow("leastSquares: the fit has no coefficient.");
    expect(() => leastSquares([[1]], [1, 2])).toThrow(RangeError);
  });
});

/* ---------- bootstrapLeastSquares ---------- */

describe("bootstrapLeastSquares", () => {
  const { x, y } = requests(80, 0.4, "bootstrap requests");

  it("gives the same intervals for the same seed, and different intervals for a different seed", () => {
    const one = bootstrapLeastSquares(x, y, { runs: 300, seed: 9 });
    expect(one.map(interval)).toEqual(bootstrapLeastSquares(x, y, { runs: 300, seed: 9 }).map(interval));
    const two = bootstrapLeastSquares(x, y, { runs: 300, seed: 10 });
    expect(two.map((i) => i.low)).not.toEqual(one.map((i) => i.low));
  });

  it("gives one interval for each coefficient, with the fit of all the data as estimate, inside the interval", () => {
    const fit = leastSquares(x, y);
    const intervals = bootstrapLeastSquares(x, y, { runs: 500, seed: "estimate" });
    expect(intervals).toHaveLength(3);
    intervals.forEach((i, j) => {
      expect(i.estimate).toBe(fit.coefficients[j]);
      expect(i.low).toBeLessThanOrEqual(i.estimate);
      expect(i.high).toBeGreaterThanOrEqual(i.estimate);
      expect([i.runs, i.finite, i.level]).toEqual([500, 500, 0.95]);
    });
    const origin = bootstrapLeastSquares(x, y, { runs: 200, intercept: false });
    expect(origin).toHaveLength(2);
    expect(origin[0]!.estimate).toBe(leastSquares(x, y, { intercept: false }).coefficients[0]);
  });

  it("uses the defaults of the other bootstraps: 10 000 runs, seed 1, level 0.95", () => {
    const small = requests(12, 0.4, "defaults");
    const intervals = bootstrapLeastSquares(small.x, small.y);
    for (const i of intervals) expect([i.runs, i.level, i.seed]).toEqual([10_000, 0.95, random(1).seed]);
    const explicit = bootstrapLeastSquares(small.x, small.y, { runs: 10_000, seed: 1, level: 0.95, method: "linear", intercept: true });
    expect(intervals.map(interval)).toEqual(explicit.map(interval));
  });

  it("draws the rows as bootstrap() draws the items, so each interval is the bootstrap of one coefficient", () => {
    const rows = x.map((row, i) => ({ row, y: y[i]! }));
    const intervals = bootstrapLeastSquares(x, y, { runs: 250, seed: "same draws", method: "nearest-rank" });
    for (let j = 0; j < 3; j++) {
      const one = bootstrap(
        rows,
        (s) =>
          leastSquares(
            s.map((r) => r.row),
            s.map((r) => r.y),
          ).coefficients[j]!,
        { runs: 250, seed: "same draws", method: "nearest-rank" },
      );
      expect(interval(intervals[j]!)).toEqual(interval(one));
    }
  });

  it("holds the true coefficients with seeded noise around them", () => {
    const data = requests(200, 0.5, "true coefficients");
    // One data set misses a 95 % interval in 1 of 20 seeds, by design. This data set misses the 95 % interval of
    // coefficient 2 (the high end is 0.0004986). Thus this check uses the 99.9 % level, and the loop below checks 95 %.
    const intervals = bootstrapLeastSquares(data.x, data.y, { runs: 2000, seed: "truth", level: 0.999 });
    intervals.forEach((i, j) => {
      expect(i.low).toBeLessThanOrEqual(TRUE[j]!);
      expect(i.high).toBeGreaterThanOrEqual(TRUE[j]!);
    });
    // Over 40 data sets, the 95 % intervals hold the true value about 95 % of the time.
    const held = [0, 0, 0];
    for (let t = 0; t < 40; t++) {
      const d = requests(40, 0.5, `coverage ${t}`);
      bootstrapLeastSquares(d.x, d.y, { runs: 400, seed: t }).forEach((i, j) => {
        if (i.low <= TRUE[j]! && TRUE[j]! <= i.high) held[j]!++;
      });
    }
    for (const h of held) expect(h).toBeGreaterThanOrEqual(33);
  });

  it("does not count a run with a singular draw, and still gives an interval", () => {
    // Only rows 4 and 5 have x different from 0. A draw without them has a constant predictor, so it is singular.
    const sx = [[0], [0], [0], [0], [1], [2]];
    const sy = [1, 1.2, 0.9, 1.1, 3, 5.1];
    const runs = 400;
    const intervals = bootstrapLeastSquares(sx, sy, { runs, seed: 3 });
    // The same draws, replayed: a run counts only when its draw has two different values of x.
    const r = random(3);
    let finite = 0;
    for (let run = 0; run < runs; run++) {
      const drawn = Array.from({ length: sx.length }, () => sx[r.below(sx.length)]![0]!);
      if (new Set(drawn).size > 1) finite++;
    }
    expect(finite).toBeGreaterThan(0);
    expect(finite).toBeLessThan(runs);
    for (const i of intervals) {
      expect(i.finite).toBe(finite);
      expect(Number.isFinite(i.low) && Number.isFinite(i.high)).toBe(true);
    }
    expect(intervals[1]!.low).toBeLessThanOrEqual(intervals[1]!.estimate);
    expect(intervals[1]!.high).toBeGreaterThanOrEqual(intervals[1]!.estimate);
  });

  it("gives the estimate as low and high when no run is finite", () => {
    // Two rows and two coefficients: n <= k in each run and in the fit of all the data.
    const intervals = bootstrapLeastSquares([[1], [2]], [1, 2], { runs: 20 });
    for (const i of intervals) {
      expect(i.finite).toBe(0);
      expect(Number.isNaN(i.estimate) && Number.isNaN(i.low) && Number.isNaN(i.high)).toBe(true);
    }
  });

  it("throws the shape errors with its own name, and the option errors of the other bootstraps", () => {
    expect(() => bootstrapLeastSquares([], [])).toThrow("bootstrapLeastSquares: x is empty.");
    expect(() => bootstrapLeastSquares([[1], [2, 3]], [1, 2])).toThrow("bootstrapLeastSquares: row 1 of x has 2 values");
    expect(() => bootstrapLeastSquares([[1]], [1, 2])).toThrow("bootstrapLeastSquares: x has 1 rows and y has 2 values.");
    expect(() => bootstrapLeastSquares(x, y, { runs: 0 })).toThrow("bootstrapLeastSquares: runs is a whole number of 1 or more, not 0.");
    expect(() => bootstrapLeastSquares(x, y, { ends: [0.6, 0.4] })).toThrow("bootstrapLeastSquares: the ends are");
    expect(() => bootstrapLeastSquares(x, y, { level: 1 })).toThrow("bootstrapLeastSquares: level is more than 0");
  });
});
