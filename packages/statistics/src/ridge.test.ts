import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import { leastSquares, ridgeSolve } from "./index.ts";

/* ---------- Helpers ---------- */

// The matrix X'X in row order and the vector X'y, with a column of ones first.
function moments(x: readonly (readonly number[])[], y: readonly number[]): { gram: number[]; moment: number[] } {
  const rows = x.map((r) => [1, ...r]);
  const k = rows[0]!.length;
  const gram = new Array<number>(k * k).fill(0);
  const moment = new Array<number>(k).fill(0);
  rows.forEach((r, n) => {
    for (let a = 0; a < k; a++) {
      moment[a]! += r[a]! * y[n]!;
      for (let b = 0; b < k; b++) gram[a * k + b]! += r[a]! * r[b]!;
    }
  });
  return { gram, moment };
}

function data(n: number, seed: string): { x: number[][]; y: number[] } {
  const r = random(seed);
  const x = Array.from({ length: n }, () => [r.normal(), r.normal(), r.normal()]);
  const y = x.map((row) => 2 + 1.5 * row[0]! - 0.5 * row[1]! + 0.25 * row[2]! + r.normal(0, 0.1));
  return { x, y };
}

/* ---------- ridgeSolve ---------- */

describe("ridgeSolve", () => {
  it("gives the least-squares fit when lambda is 0", () => {
    const { x, y } = data(50, "ols");
    const { gram, moment } = moments(x, y);
    const beta = ridgeSolve(gram, moment, 0);
    const fit = leastSquares(x, y);
    beta.forEach((b, i) => expect(b).toBeCloseTo(fit.coefficients[i]!, 10));
  });

  it("gives the closed form of one centered predictor, with a free intercept", () => {
    const x = [-2, -1, 0, 1, 2];
    const y = [1, 2, 2, 4, 6];
    const { gram, moment } = moments(
      x.map((v) => [v]),
      y,
    );
    const lambda = 3;
    const [intercept, slope] = ridgeSolve(gram, moment, lambda, { free: [0] });
    const sxy = x.reduce((s, v, i) => s + v * y[i]!, 0);
    const sxx = x.reduce((s, v) => s + v * v, 0);
    expect(intercept).toBeCloseTo(3, 12);
    expect(slope).toBeCloseTo(sxy / (sxx + lambda), 12);
  });

  it("shrinks each penalized coefficient toward 0 as lambda grows", () => {
    const { x, y } = data(40, "shrink");
    const { gram, moment } = moments(x, y);
    const norm = (lambda: number): number =>
      ridgeSolve(gram, moment, lambda, { free: [0] })
        .slice(1)
        .reduce((s, b) => s + b * b, 0);
    expect(norm(1)).toBeLessThan(norm(0));
    expect(norm(100)).toBeLessThan(norm(1));
    expect(norm(1e9)).toBeLessThan(1e-12);
  });

  it("solves a singular design when each coefficient has a penalty", () => {
    const x = [
      [1, 2],
      [2, 4],
      [3, 6],
    ];
    const { gram, moment } = moments(x, [1, 2, 3]);
    expect(ridgeSolve(gram, moment, 0).every(Number.isNaN)).toBe(true);
    expect(ridgeSolve(gram, moment, 0.5, { free: [0] }).every(Number.isFinite)).toBe(true);
  });

  it("gives NaN coefficients for a matrix that is not positive definite", () => {
    expect(ridgeSolve([1, 2, 2, 1], [1, 1], 0)).toEqual([Number.NaN, Number.NaN]);
    expect(ridgeSolve([0, 0, 0, 0], [0, 0], 0, { free: [0, 1] })).toEqual([Number.NaN, Number.NaN]);
  });

  it("does not change its inputs", () => {
    const gram = [4, 1, 1, 3];
    const moment = [1, 2];
    ridgeSolve(gram, moment, 1);
    expect(gram).toEqual([4, 1, 1, 3]);
    expect(moment).toEqual([1, 2]);
  });

  it("reads typed arrays", () => {
    const [a, b] = ridgeSolve(new Float64Array([2, 0, 0, 4]), new Float64Array([2, 4]), 0);
    expect(a).toBeCloseTo(1, 14);
    expect(b).toBeCloseTo(1, 14);
  });

  it("refuses bad shapes, values, lambdas and free indexes", () => {
    expect(() => ridgeSolve([], [], 0)).toThrow(RangeError);
    expect(() => ridgeSolve([1, 0, 0], [1, 1], 0)).toThrow(/needs 4/);
    expect(() => ridgeSolve([1, 0, 0, Number.NaN], [1, 1], 0)).toThrow(/not finite/);
    expect(() => ridgeSolve([1, 0, 0, 1], [1, Number.POSITIVE_INFINITY], 0)).toThrow(/not finite/);
    expect(() => ridgeSolve([1, 0, 0, 1], [1, 1], -1)).toThrow(/lambda/);
    expect(() => ridgeSolve([1, 0, 0, 1], [1, 1], Number.NaN)).toThrow(/lambda/);
    expect(() => ridgeSolve([1, 0, 0, 1], [1, 1], 1, { free: [2] })).toThrow(/free index/);
    expect(() => ridgeSolve([1, 0, 0, 1], [1, 1], 1, { free: [0.5] })).toThrow(/free index/);
  });
});
