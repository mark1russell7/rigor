import { describe, expect, it } from "vitest";
import { type ResponseDimension, type RidgeResponseModel, type RidgeTerm, type TableResponseModel, sobolIndices } from "./index.ts";

/*
 * The expected indices are exact for the models below. The tolerance comes from a probe over 200 seeds: at N = 4096,
 * the root mean square error of an index was at most 0.020, and the largest error was 0.072. The error falls as
 * 1 / sqrt(N), so N = 16384 gives about 0.010. The tolerance 0.04 is four of these errors.
 */
const N = 16_384;
const TOLERANCE = 0.04;

const unit = (id: string): ResponseDimension => ({ id, label: id, unit: "", kind: "continuous", range: [-1, 1] });
const power = (dimension: string) => ({ dimension, power: 1 });
const ridge = (inputs: RidgeResponseModel["inputs"], terms: readonly RidgeTerm[], intercept = 0): RidgeResponseModel => ({
  measure: "y",
  scale: "linear",
  kind: "ridge",
  lambda: 0,
  inputs,
  intercept,
  terms,
});
const number = (dimension: string, conditional = false) => ({ dimension, kind: "number" as const, center: 0, spread: 1, ...(conditional ? { conditional } : {}) });

function indexOf(result: ReturnType<typeof sobolIndices>, dimension: string): { first: number; total: number } {
  const index = result.indices.find((i) => i.dimension === dimension);
  if (index === undefined) throw new Error(`no index of ${dimension}`);
  return index;
}

describe("sobolIndices", () => {
  it("gives a squared weight share for each term of a linear model, with total equal to first", () => {
    // y = 10 + 2 x1 + x2 on [-1, 1]: S1 = 4 / 5, S2 = 1 / 5, and the variance is 5 / 3.
    const model = ridge([number("x1"), number("x2")], [{ factors: [power("x1")], weight: 2 }, { factors: [power("x2")], weight: 1 }], 10);
    const result = sobolIndices({ dimensions: [unit("x1"), unit("x2")], models: [model] }, "y", { n: N });
    expect(result.evaluations).toBe(N * 4);
    expect(result.variance).toBeCloseTo(5 / 3, 1);
    expect(result.mean).toBeCloseTo(10, 1);
    expect(Math.abs(indexOf(result, "x1").first - 0.8)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "x1").total - 0.8)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "x2").first - 0.2)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "x2").total - 0.2)).toBeLessThan(TOLERANCE);
  });

  it("puts a pure product term in the total index and not in the first-order index", () => {
    // y = x1 + x2 + 2 x1 x2: V = 2 / 3 + 4 / 9 = 10 / 9, S_i = 0.3, ST_i = 0.7.
    const model = ridge(
      [number("x1"), number("x2")],
      [{ factors: [power("x1")], weight: 1 }, { factors: [power("x2")], weight: 1 }, { factors: [power("x1"), power("x2")], weight: 2 }],
    );
    const result = sobolIndices({ dimensions: [unit("x1"), unit("x2")], models: [model] }, "y", { n: N });
    expect(Math.abs(result.variance - 10 / 9)).toBeLessThan(0.05);
    for (const id of ["x1", "x2"]) {
      const index = indexOf(result, id);
      expect(Math.abs(index.first - 0.3)).toBeLessThan(TOLERANCE);
      expect(Math.abs(index.total - 0.7)).toBeLessThan(TOLERANCE);
      expect(index.total - index.first).toBeGreaterThan(0.3);
    }
  });

  it("draws a categorical dimension uniformly over its levels", () => {
    // The levels add 0, 1, 2 and 3 (variance 1.25), and 1.5 x adds 0.75. Thus S_kind = 0.625 and S_x = 0.375.
    const kind: ResponseDimension = { id: "kind", label: "Kind", unit: "", kind: "categorical", levels: ["p", "q", "r", "s"] };
    const model = ridge(
      [{ dimension: "kind", kind: "level", levels: ["p", "q", "r", "s"] }, number("x")],
      [
        { factors: [{ dimension: "kind", level: "q" }], weight: 1 },
        { factors: [{ dimension: "kind", level: "r" }], weight: 2 },
        { factors: [{ dimension: "kind", level: "s" }], weight: 3 },
        { factors: [power("x")], weight: 1.5 },
      ],
    );
    const result = sobolIndices({ dimensions: [kind, unit("x")], models: [model] }, "y", { n: N });
    expect(Math.abs(indexOf(result, "kind").first - 0.625)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "kind").total - 0.625)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "x").first - 0.375)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "x").total - 0.375)).toBeLessThan(TOLERANCE);
  });

  it("gives the same indices for a table model of the same levels", () => {
    const kind: ResponseDimension = { id: "kind", label: "Kind", unit: "", kind: "categorical", levels: ["p", "q"] };
    const other: ResponseDimension = { id: "other", label: "Other", unit: "", kind: "ordinal", levels: [1, 2, 3] };
    const table: TableResponseModel = {
      measure: "y",
      scale: "linear",
      kind: "table",
      dimensions: ["kind"],
      cells: [
        { at: ["p"], value: 0, n: 1 },
        { at: ["q"], value: 4, n: 1 },
      ],
      fallback: 2,
    };
    const result = sobolIndices({ dimensions: [kind, other], models: [table] }, "y", { n: 4096 });
    expect(Math.abs(result.variance - 4)).toBeLessThan(0.2);
    expect(Math.abs(indexOf(result, "kind").first - 1)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "kind").total - 1)).toBeLessThan(TOLERANCE);
    expect(indexOf(result, "other")).toEqual({ dimension: "other", first: 0, total: 0 });
  });

  it("draws a log dimension uniformly in log space", () => {
    // log10(size) is uniform on [0, 2], so the coordinate (log10(size) - 1) / 1 is uniform on [-1, 1].
    const size: ResponseDimension = { id: "size", label: "Size", unit: "", kind: "continuous", range: [1, 100], log: true };
    const model = ridge(
      [{ dimension: "size", kind: "number", center: 1, spread: 1, log: true }, number("x")],
      [{ factors: [power("size")], weight: 2 }, { factors: [power("x")], weight: 1 }],
    );
    const result = sobolIndices({ dimensions: [size, unit("x")], models: [model] }, "y", { n: N });
    expect(Math.abs(indexOf(result, "size").first - 0.8)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "x").first - 0.2)).toBeLessThan(TOLERANCE);
  });

  it("passes null for a conditional child where its condition fails", () => {
    // y = x when mode is on, and 0 when x is absent. With I = 1 for on: V = 1 / 6, S_x = 1 / 2, ST_x = 1,
    // S_mode = 0 and ST_mode = 1 / 2.
    const mode: ResponseDimension = { id: "mode", label: "Mode", unit: "", kind: "categorical", levels: ["on", "off"] };
    const child: ResponseDimension = { ...unit("x"), when: { dimension: "mode", levels: ["on"] } };
    const model = ridge([{ dimension: "mode", kind: "level", levels: ["on", "off"] }, number("x", true)], [{ factors: [power("x")], weight: 1 }]);
    const result = sobolIndices({ dimensions: [mode, child], models: [model] }, "y", { n: N });
    expect(Math.abs(result.variance - 1 / 6)).toBeLessThan(0.01);
    expect(Math.abs(indexOf(result, "x").first - 0.5)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "x").total - 1)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "mode").first)).toBeLessThan(TOLERANCE);
    expect(Math.abs(indexOf(result, "mode").total - 0.5)).toBeLessThan(TOLERANCE);
  });

  it("gives 0 and no NaN for a constant model", () => {
    const model = ridge([number("x")], [], 3);
    const result = sobolIndices({ dimensions: [unit("x"), unit("z")], models: [model] }, "y", { n: 64 });
    expect(result.variance).toBe(0);
    expect(result.mean).toBe(3);
    expect(result.indices).toEqual([
      { dimension: "x", first: 0, total: 0 },
      { dimension: "z", first: 0, total: 0 },
    ]);
  });

  it("gives exactly 0 for a dimension that the model does not read", () => {
    const model = ridge([number("x")], [{ factors: [power("x")], weight: 1 }]);
    const result = sobolIndices({ dimensions: [unit("x"), unit("unused")], models: [model] }, "y", { n: 1024 });
    expect(indexOf(result, "unused")).toEqual({ first: 0, total: 0, dimension: "unused" });
    expect(Math.abs(indexOf(result, "x").total - 1)).toBeLessThan(0.1);
  });

  it("gives the same result for the same seed, and a different result for a different seed", () => {
    const model = ridge([number("x1"), number("x2")], [{ factors: [power("x1")], weight: 1 }, { factors: [power("x1"), power("x2")], weight: 1 }]);
    const record = { dimensions: [unit("x1"), unit("x2")], models: [model] };
    const one = sobolIndices(record, "y", { n: 512, seed: "case" });
    expect(sobolIndices(record, "y", { n: 512, seed: "case" })).toEqual(one);
    expect(sobolIndices(record, "y", { n: 512, seed: 7 }).indices).not.toEqual(one.indices);
  });

  it("uses the scale of the model with the option scale", () => {
    // On the model scale, y = 2 x1 + x2. On the measure scale, 10 ** y has a different variance.
    const model: RidgeResponseModel = { ...ridge([number("x1"), number("x2")], [{ factors: [power("x1")], weight: 2 }, { factors: [power("x2")], weight: 1 }]), scale: "log" };
    const record = { dimensions: [unit("x1"), unit("x2")], models: [model] };
    const scaled = sobolIndices(record, "y", { n: N, scale: "model" });
    expect(scaled.scale).toBe("model");
    expect(Math.abs(scaled.variance - 5 / 3)).toBeLessThan(0.05);
    expect(Math.abs(indexOf(scaled, "x1").first - 0.8)).toBeLessThan(TOLERANCE);
    expect(sobolIndices(record, "y", { n: N }).variance).toBeGreaterThan(100);
  });

  it("gives a bootstrap interval of each index with the option interval", () => {
    const model = ridge([number("x1"), number("x2")], [{ factors: [power("x1")], weight: 2 }, { factors: [power("x2")], weight: 1 }]);
    const result = sobolIndices({ dimensions: [unit("x1"), unit("x2")], models: [model] }, "y", { n: 2048, interval: { runs: 200, seed: 3 } });
    for (const index of result.indices) {
      const first = index.firstInterval;
      const total = index.totalInterval;
      if (first === undefined || total === undefined) throw new Error("no interval");
      expect(first.estimate).toBe(index.first);
      expect(total.estimate).toBe(index.total);
      expect(first.low).toBeLessThanOrEqual(index.first);
      expect(first.high).toBeGreaterThanOrEqual(index.first);
      expect(first.runs).toBe(200);
    }
    const x1 = result.indices[0]?.firstInterval;
    expect(x1?.low).toBeLessThan(0.8);
    expect(x1?.high).toBeGreaterThan(0.8);
  });

  it("refuses a measure with no model and a bad n", () => {
    const record = { dimensions: [unit("x")], models: [ridge([number("x")], [])] };
    expect(() => sobolIndices(record, "missing")).toThrow(/no model of the measure "missing"/);
    expect(() => sobolIndices(record, "y", { n: 1 })).toThrow(RangeError);
    expect(() => sobolIndices(record, "y", { n: 2.5 })).toThrow(RangeError);
  });
});
