import { describe, expect, it } from "vitest";
import { classScores, cohenKappa, confusion, wilson, wilsonSampleSize } from "./index.ts";

describe("confusion and classScores", () => {
  const truth = ["a", "a", "a", "b", "b", "c"];
  const predicted = ["a", "a", "b", "b", "c", "c"];

  it("counts each pair of a true class and a predicted class", () => {
    const table = confusion(truth, predicted);
    expect(table.labels).toEqual(["a", "b", "c"]);
    expect(table.counts).toEqual([
      [2, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ]);
    expect(table.n).toBe(6);
    expect(table.correct).toBe(4);
    expect(table.correct / table.n).toBeCloseTo(cohenKappa(truth, predicted).observed);
  });

  it("gives the recall, the precision and the F1 score of each class", () => {
    const [a, b, c] = classScores(confusion(truth, predicted));
    expect(a).toMatchObject({ label: "a", support: 3, predicted: 2, hits: 2, precision: 1 });
    expect(a?.recall).toBeCloseTo(2 / 3);
    expect(a?.f1).toBeCloseTo(0.8);
    expect(b).toMatchObject({ support: 2, predicted: 2, hits: 1, recall: 0.5, precision: 0.5, f1: 0.5 });
    expect(c).toMatchObject({ support: 1, predicted: 2, hits: 1, recall: 1, precision: 0.5 });
    expect(c?.f1).toBeCloseTo(2 / 3);
    expect(a?.recallInterval).toEqual(wilson(2, 3));
  });

  it("keeps the order of the labels, and gives a row to a class with no items", () => {
    const table = confusion(truth, predicted, ["c", "b", "a", "d"]);
    expect(table.labels).toEqual(["c", "b", "a", "d"]);
    expect(table.counts[3]).toEqual([0, 0, 0, 0]);
    const d = classScores(table)[3];
    expect(d).toMatchObject({ label: "d", support: 0, predicted: 0, hits: 0, recall: undefined, precision: undefined, f1: undefined });
    expect(d?.recallInterval).toEqual({ low: 0, high: 1 });
  });

  it("gives an F1 score of 0 to a class with no hits, and adds the predicted classes that are not true classes", () => {
    const table = confusion(["x", "x"], ["y", "y"]);
    expect(table.labels).toEqual(["x", "y"]);
    const [x, y] = classScores(table);
    expect(x).toMatchObject({ recall: 0, precision: undefined, f1: undefined });
    expect(y).toMatchObject({ support: 0, predicted: 2, recall: undefined, precision: 0 });
    expect(classScores(confusion(["x", "y"], ["y", "x"]))[0]?.f1).toBe(0);
  });

  it("keeps the sums of the rows and the columns", () => {
    const long = Array.from({ length: 200 }, (_, i) => (i * 7) % 5);
    const guess = long.map((label, i) => (i % 3 === 0 ? (label + 1) % 5 : label));
    const table = confusion(long, guess);
    const scores = classScores(table);
    expect(scores.reduce((total, s) => total + s.support, 0)).toBe(200);
    expect(scores.reduce((total, s) => total + s.predicted, 0)).toBe(200);
    expect(scores.reduce((total, s) => total + s.hits, 0)).toBe(table.correct);
  });

  it("accepts no items, and refuses lists of two lengths and a label two times", () => {
    expect(confusion([], [], ["a"])).toEqual({ labels: ["a"], counts: [[0]], n: 0, correct: 0 });
    expect(() => confusion(["a"], [])).toThrow(RangeError);
    expect(() => confusion([], [], ["a", "a"])).toThrow(RangeError);
  });
});

describe("cohenKappa", () => {
  it("gives the kappa of the textbook table of two raters", () => {
    // 50 items: both yes 20, yes and no 5, no and yes 10, both no 15
    const a = [...Array(20).fill("yes"), ...Array(5).fill("yes"), ...Array(10).fill("no"), ...Array(15).fill("no")] as string[];
    const b = [...Array(20).fill("yes"), ...Array(5).fill("no"), ...Array(10).fill("yes"), ...Array(15).fill("no")] as string[];
    const result = cohenKappa(a, b);
    expect(result.n).toBe(50);
    expect(result.observed).toBeCloseTo(0.7);
    expect(result.chance).toBeCloseTo(0.5);
    expect(result.kappa).toBeCloseTo(0.4);
  });

  it("gives 1 for full agreement, and a value below 0 for agreement under chance", () => {
    expect(cohenKappa(["a", "b", "c", "a"], ["a", "b", "c", "a"]).kappa).toBe(1);
    expect(cohenKappa(["a", "b", "a", "b"], ["b", "a", "b", "a"]).kappa).toBeLessThan(0);
  });

  it("gives no kappa when one category takes all items, and refuses lists of two lengths", () => {
    expect(cohenKappa([1, 1, 1], [1, 1, 1]).kappa).toBeUndefined();
    expect(() => cohenKappa([1], [1, 2])).toThrow(RangeError);
    expect(() => cohenKappa([], [])).toThrow(RangeError);
  });
});

describe("wilsonSampleSize", () => {
  it("gives the smallest n at which the Wilson lower end reaches the target", () => {
    for (const [target, expected, size] of [
      [0.9, 0.95, 127],
      [0.9, 0.97, 69],
      [0.85, 0.92, 92],
      [0.8, 0.9, 54],
      [0.95, 0.98, 173],
    ] as const) {
      const n = wilsonSampleSize(target, expected);
      expect(n, `${target} at ${expected}`).toBe(size);
      expect(wilson(Math.round(expected * size), size).low).toBeGreaterThanOrEqual(target);
      expect(wilson(Math.round(expected * (size - 1)), size - 1).low).toBeLessThan(target);
    }
  });

  it("shows that 30 of 30 cannot reach a target of 0.90", () => {
    expect(wilson(30, 30).low).toBeLessThan(0.9);
    expect(wilsonSampleSize(0.9, 1)).toBeGreaterThan(30);
  });

  it("gives no size when the expected proportion is not above the target", () => {
    expect(wilsonSampleSize(0.9, 0.9)).toBeUndefined();
    expect(wilsonSampleSize(0.9, 0.8)).toBeUndefined();
    expect(wilsonSampleSize(0.9, 0.95, undefined, 10)).toBeUndefined();
    expect(() => wilsonSampleSize(1.2, 0.5)).toThrow(RangeError);
  });
});
