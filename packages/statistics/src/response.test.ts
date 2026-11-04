import { readFileSync } from "node:fs";
import { random } from "@mark1russell7/rigor-generators";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RidgeResponseModel,
  type ResponseData,
  type ResponseDimension,
  type ResponseFitOptions,
  type ResponseMeasure,
  type ResponsePoint,
  type ResponseRecord,
  type TableResponseModel,
  RESPONSE_MAX_TERMS,
  RESPONSE_RECORDS_SCHEMA,
  fitResponse,
  heldOutError,
  leastSquares,
  parseResponseRecord,
  predictResponse,
  sliceResponse,
  surfaceResponse,
} from "./index.ts";

/* ---------- Helpers ---------- */

const X: ResponseDimension = { id: "x", label: "X", kind: "continuous", range: [0, 10], unit: "mm" };
const U: ResponseDimension = { id: "u", label: "U", kind: "continuous", range: [-1, 1], unit: "" };
const ARM: ResponseDimension = { id: "arm", label: "Arm", kind: "categorical", levels: ["a", "b", "c"], unit: "" };
const Y: ResponseMeasure = { id: "y", label: "Y", unit: "s", direction: "lower" };

// The standard deviation of the noise of each generated point. Each stated held-out limit below is 1.4 times this.
const NOISE = 0.05;
const NOISE_LIMIT = 1.4 * NOISE;

function data(dimensions: readonly ResponseDimension[], points: readonly ResponsePoint[], measures: readonly ResponseMeasure[] = [Y]): ResponseData {
  return { schema: RESPONSE_RECORDS_SCHEMA, name: "test", dimensions, measures, points };
}

// Each point gets one uniform draw of each continuous dimension and one draw of each level, then seeded normal noise.
function generate(dimensions: readonly ResponseDimension[], n: number, seed: string, f: (v: Record<string, number | string>) => number, noise = NOISE): ResponseData {
  const r = random(seed);
  const points: ResponsePoint[] = [];
  for (let i = 0; i < n; i++) {
    const values: Record<string, number | string> = {};
    for (const d of dimensions) {
      if (d.kind === "continuous") values[d.id] = d.log === true ? 10 ** r.range(Math.log10(d.range[0]), Math.log10(d.range[1])) : r.range(d.range[0], d.range[1]);
      else values[d.id] = r.pick(d.levels as readonly (number | string)[]);
    }
    points.push({ id: `p${i}`, values, measures: { y: f(values) + r.normal(0, noise) } });
  }
  return data(dimensions, points);
}

const num = (v: number | string | null | undefined): number => v as number;

function good(record: ResponseRecord): ResponseRecord {
  const parsed = parseResponseRecord(record);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.faults));
  return parsed.record;
}

const ridgeOf = (record: ResponseRecord): RidgeResponseModel => record.models[0] as RidgeResponseModel;

/* ---------- Recovery of known functions ---------- */

describe("fitResponse recovers known functions", () => {
  it("recovers a linear response within 1.4 noise sd of held-out error", () => {
    const truth = (v: Record<string, number | string>): number => 3 + 2 * num(v["x"]) - 0.5 * num(v["u"]);
    const record = good(fitResponse(generate([X, U], 200, "linear", truth)));
    const error = heldOutError(record, "y");
    expect(error.n).toBe(200);
    expect(error.folds).toBe(5);
    expect(error.rmse).toBeLessThan(NOISE_LIMIT);
    expect(error.skill).toBeGreaterThan(0.99);
    const model = ridgeOf(record);
    const check = random("linear check");
    for (let i = 0; i < 50; i++) {
      const at = { x: check.range(0, 10), u: check.range(-1, 1) };
      expect(Math.abs(predictResponse(model, at) - truth(at))).toBeLessThan(NOISE_LIMIT);
    }
  });

  it("recovers a quadratic response, and a degree of 1 does not", () => {
    const truth = (v: Record<string, number | string>): number => 1 + (num(v["x"]) - 2) ** 2 / 4;
    const points = generate([X], 200, "quadratic", truth);
    const record = good(fitResponse(points));
    expect(heldOutError(record, "y").rmse).toBeLessThan(NOISE_LIMIT);
    expect(heldOutError(good(fitResponse(points, { degree: 1 })), "y").rmse).toBeGreaterThan(1);
    expect(Math.abs(predictResponse(ridgeOf(record), { x: 2 }) - 1)).toBeLessThan(NOISE_LIMIT);
  });

  it("recovers a power law on log scales, with no noise", () => {
    const size: ResponseDimension = { id: "size", label: "Size", kind: "continuous", range: [1, 1000], unit: "", log: true };
    const truth = (v: Record<string, number | string>): number => 5 * num(v["size"]) ** 1.5;
    const record = good(fitResponse(generate([size], 60, "power", truth, 0), { log: ["y"], degree: 1 }));
    const model = ridgeOf(record);
    expect(model.scale).toBe("log");
    expect(heldOutError(record, "y").rmse).toBeLessThan(1e-3);
    expect(predictResponse(model, { size: 100 }) / 5000).toBeCloseTo(1, 2);
  });

  it("recovers a level offset and a slope of each level with one-hot columns", () => {
    const offset = { a: 0, b: 2, c: -1 } as const;
    const slope = { a: 1, b: -1, c: 0.5 } as const;
    const truth = (v: Record<string, number | string>): number => offset[v["arm"] as "a"] + slope[v["arm"] as "a"] * num(v["x"]);
    const record = good(fitResponse(generate([X, ARM], 300, "arms", truth)));
    expect(heldOutError(record, "y").rmse).toBeLessThan(NOISE_LIMIT);
    for (const arm of ["a", "b", "c"]) expect(Math.abs(predictResponse(ridgeOf(record), { x: 5, arm }) - truth({ x: 5, arm }))).toBeLessThan(NOISE_LIMIT);
    const levels = ridgeOf(record).terms.flatMap((t) => t.factors.flatMap((f) => ("level" in f ? [f.level] : [])));
    expect(new Set(levels)).toEqual(new Set(["a", "b", "c"]));
  });

  it("reads an ordinal text dimension as its position", () => {
    const tier: ResponseDimension = { id: "tier", label: "Tier", kind: "ordinal", levels: ["low", "mid", "high"], unit: "" };
    const truth = (v: Record<string, number | string>): number => 3 * ["low", "mid", "high"].indexOf(v["tier"] as string);
    const record = good(fitResponse(generate([tier], 90, "tier", truth), { degree: 1 }));
    expect(ridgeOf(record).inputs[0]?.kind).toBe("rank");
    expect(heldOutError(record, "y").rmse).toBeLessThan(NOISE_LIMIT);
    expect(Math.abs(predictResponse(ridgeOf(record), { tier: "high" }) - 6)).toBeLessThan(NOISE_LIMIT);
  });

  it("reads an ordinal number dimension at its values, on a log scale when stated", () => {
    const count: ResponseDimension = { id: "n", label: "Count", kind: "ordinal", levels: [10, 100, 1000], unit: "", log: true };
    const truth = (v: Record<string, number | string>): number => Math.log10(num(v["n"]));
    const record = good(fitResponse(generate([count], 60, "count", truth, 0), { degree: 1 }));
    expect(ridgeOf(record).inputs[0]).toEqual({ kind: "number", dimension: "n", center: 2, spread: 1, log: true });
    expect(predictResponse(ridgeOf(record), { n: 100 })).toBeCloseTo(2, 3);
  });

  it("gives the least-squares weights when the penalty is very small", () => {
    const points = generate([X, U], 80, "ols", (v) => 1 + num(v["x"]) * num(v["u"]));
    const record = good(fitResponse(points, { lambdas: [1e-9] }));
    const model = ridgeOf(record);
    const z = (p: ResponsePoint): number[] => {
      const x = (num(p.values["x"]) - 5) / 5;
      const u = num(p.values["u"]);
      return [x, x * x, u, u * u, x * u];
    };
    const fit = leastSquares(points.points.map(z), points.points.map((p) => p.measures["y"] as number));
    expect(model.intercept).toBeCloseTo(fit.coefficients[0]!, 5);
    model.terms.forEach((term, i) => expect(term.weight).toBeCloseTo(fit.coefficients[i + 1]!, 5));
  });

  it("fits a stated expansion", () => {
    const points = generate([X, U], 100, "stated", (v) => 2 * num(v["x"]) ** 3);
    const terms = [[{ dimension: "x", power: 3 }], [{ dimension: "x", power: 1 }]];
    const record = good(fitResponse(points, { terms }));
    expect(ridgeOf(record).terms.map((t) => t.factors)).toEqual(terms);
    expect(ridgeOf(record).inputs.map((i) => i.dimension)).toEqual(["x"]);
  });
});

/* ---------- The table model ---------- */

describe("the table model", () => {
  it("gives the mean of each cell, and the fallback for a combination with no cell", () => {
    const side: ResponseDimension = { id: "side", label: "Side", kind: "categorical", levels: ["l", "r"], unit: "" };
    const points = (["a", "b", "c"] as const).flatMap((arm, i) =>
      [0, 1, 2].map((k) => ({ id: `${arm}${k}`, values: { arm, side: arm === "c" ? "l" : "r" }, measures: { y: i * 10 + k } })),
    );
    const record = good(fitResponse(data([ARM, side], points)));
    const model = record.models[0] as TableResponseModel;
    expect(model.kind).toBe("table");
    expect(predictResponse(model, { arm: "a", side: "r" })).toBe(1);
    expect(predictResponse(model, { arm: "b", side: "r" })).toBe(11);
    expect(predictResponse(model, { arm: "c", side: "l" })).toBe(21);
    expect(predictResponse(model, { arm: "a", side: "l" })).toBe(11);
    expect(model.cells.map((c) => c.n)).toEqual([3, 3, 3]);
  });

  it("gives the hand-computed held-out errors of three single points", () => {
    const one: ResponseDimension = { id: "k", label: "K", kind: "categorical", levels: ["only"], unit: "" };
    const points = [1, 2, 3].map((y) => ({ id: `p${y}`, values: { k: "only" }, measures: { y } }));
    const record = good(fitResponse(data([one], points), { folds: 3 }));
    // Each point is predicted by the mean of the other two: 2.5, 2 and 1.5, so the errors are -1.5, 0 and 1.5.
    const error = heldOutError(record, "y");
    expect(error.n).toBe(3);
    expect(error.mae).toBeCloseTo(1, 12);
    expect(error.rmse).toBeCloseTo(Math.sqrt(1.5), 12);
    expect(error.baselineMae).toBeCloseTo(1, 12);
    expect(error.skill).toBeCloseTo(0, 12);
  });

  it("accepts ordinal dimensions when asked, and refuses a continuous dimension", () => {
    const tier: ResponseDimension = { id: "t", label: "T", kind: "ordinal", levels: [1, 2, 3], unit: "" };
    const points = generate([tier], 30, "table", (v) => num(v["t"]) * 2);
    expect(good(fitResponse(points, { model: "table" })).models[0]?.kind).toBe("table");
    expect(good(fitResponse(points)).models[0]?.kind).toBe("ridge");
    expect(() => fitResponse(generate([X], 30, "table", () => 0), { model: "table" })).toThrow(/continuous dimension "x"/);
  });

  it("gives a ridge model of a pure categorical record when asked", () => {
    const points = generate([ARM], 60, "ridge arms", (v) => ["a", "b", "c"].indexOf(v["arm"] as string));
    expect(good(fitResponse(points, { model: "ridge" })).models[0]?.kind).toBe("ridge");
  });
});

/* ---------- The group split ---------- */

describe("the group split", () => {
  // Each board has its own true value, and 3 repeats with a small noise. No dimension but the board tells the value.
  function boards(grouped: boolean): ResponseData {
    const r = random("boards");
    const ids = Array.from({ length: 40 }, (_, i) => `b${i}`);
    const board: ResponseDimension = { id: "board", label: "Board", kind: "categorical", levels: ids, unit: "" };
    const points = ids.flatMap((id) => {
      const truth = r.normal(0, 10);
      return [0, 1, 2].map((k) => ({ id: `${id}/${k}`, values: { board: id }, measures: { y: truth + r.normal(0, 0.1) }, ...(grouped ? { group: id } : {}) }));
    });
    return data([board], points);
  }

  it("puts no group on both sides, and each point in one fold", () => {
    const record = good(fitResponse(boards(true)));
    const seen = new Map<string, number>();
    record.folds.forEach((fold, f) => {
      for (const id of fold.heldOut) {
        const group = id.split("/")[0]!;
        expect(seen.get(group) ?? f).toBe(f);
        seen.set(group, f);
      }
    });
    expect(seen.size).toBe(40);
    expect(record.folds.flatMap((f) => f.heldOut)).toHaveLength(120);
    expect(new Set(record.folds.flatMap((f) => f.heldOut)).size).toBe(120);
  });

  it("shows no skill for an unseen group, where a split of points leaks the repeats", () => {
    const honest = heldOutError(good(fitResponse(boards(true))), "y");
    const leaked = heldOutError(good(fitResponse(boards(false))), "y");
    expect(honest.skill).toBeLessThan(0.05);
    expect(leaked.skill).toBeGreaterThan(0.9);
  });

  it("does not join a group with a point that has the id of the group", () => {
    const k: ResponseDimension = { id: "k", label: "K", kind: "categorical", levels: ["only"], unit: "" };
    const point = (id: string, group?: string): ResponsePoint => ({ id, values: { k: "only" }, measures: { y: 1 }, ...(group === undefined ? {} : { group }) });
    const record = good(fitResponse(data([k], [point("a"), point("b", "a"), point("c", "a"), point("d"), point("e")]), { folds: 3 }));
    expect(record.folds.flatMap((f) => f.heldOut).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(record.folds.some((f) => f.heldOut.includes("b") && f.heldOut.includes("c"))).toBe(true);
  });

  it("makes one fold of each group when the groups are fewer than the folds", () => {
    const k: ResponseDimension = { id: "k", label: "K", kind: "categorical", levels: ["only"], unit: "" };
    const points = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, group: `g${i % 3}`, values: { k: "only" }, measures: { y: i } }));
    expect(good(fitResponse(data([k], points))).folds).toHaveLength(3);
  });

  it("holds for each seed and each assignment of groups (property)", () => {
    const arbitrary = fc.record({
      seed: fc.integer({ min: 0, max: 2 ** 31 }),
      folds: fc.integer({ min: 3, max: 7 }),
      groups: fc.array(fc.option(fc.integer({ min: 0, max: 9 }), { nil: undefined }), { minLength: 12, maxLength: 40 }),
    });
    fc.assert(
      fc.property(arbitrary, ({ seed, folds, groups }) => {
        const points = groups.map((g, i) => ({ id: `p${i}`, values: { x: i % 11 }, measures: { y: i * 0.5 }, ...(g === undefined ? {} : { group: `g${g}` }) }));
        const distinct = new Set(groups.map((g, i) => (g === undefined ? `p${i}` : `g${g}`)));
        fc.pre(distinct.size >= 3);
        const record = good(fitResponse(data([X], points), { seed, folds, lambdas: [1e-3] }));
        const foldOf = new Map(record.folds.flatMap((fold, f) => fold.heldOut.map((id) => [id, f] as const)));
        expect(foldOf.size).toBe(points.length);
        const byGroup = new Map<string, number>();
        for (const p of points) {
          if (p.group === undefined) continue;
          expect(byGroup.get(p.group) ?? foldOf.get(p.id)).toBe(foldOf.get(p.id));
          byGroup.set(p.group, foldOf.get(p.id)!);
        }
      }),
      { numRuns: 40, seed: 7 },
    );
  });
});

/* ---------- Scales and missing values ---------- */

describe("measures", () => {
  it("skips a null value of a measure, and counts it in no error", () => {
    const base = generate([X], 50, "nulls", (v) => num(v["x"]));
    const other: ResponseMeasure = { id: "z", label: "Z", unit: "", direction: "none" };
    const points = base.points.map((p, i) => ({ ...p, measures: { ...p.measures, z: i % 5 === 0 ? null : 1 + num(p.values["x"]) } }));
    const record = good(fitResponse(data([X], points, [Y, other])));
    expect(heldOutError(record, "y").n).toBe(50);
    expect(heldOutError(record, "z").n).toBe(40);
  });

  it("uses the floor on a log scale, and refuses a value of 0 with no floor", () => {
    const points = generate([X], 40, "floor", (v) => num(v["x"]), 0).points.map((p, i) => (i === 0 ? { ...p, measures: { y: 0 } } : { ...p, measures: { y: 1 + (p.measures["y"] as number) } }));
    expect(() => fitResponse(data([X], points), { log: ["y"] })).toThrow(/point "p0" has the value 0.*logFloor/);
    const model = good(fitResponse(data([X], points), { log: ["y"], logFloor: 0.001 })).models[0]!;
    expect(model.floor).toBe(0.001);
  });

  it("refuses a measure with no value, and a measure with all its values in one fold", () => {
    const points = generate([X], 12, "empty", () => 1).points.map((p) => ({ ...p, measures: { y: null } }));
    expect(() => fitResponse(data([X], points))).toThrow(/no point has a value of the measure "y"/);
    const one = generate([X], 12, "one", () => 1, 0);
    const held = good(fitResponse(one, { folds: 3 })).folds[0]!.heldOut;
    const only = one.points.map((p) => (held.includes(p.id) ? p : { ...p, measures: { y: null } }));
    expect(() => fitResponse(data([X], only), { folds: 3 })).toThrow(/in one fold/);
  });
});

/* ---------- Slices and surfaces ---------- */

describe("sliceResponse", () => {
  const grid = (): ResponseData => {
    const points = [0, 2.5, 5, 7.5, 10].flatMap((x) =>
      [0, 1, 2].flatMap((k) => (["a", "b"] as const).map((arm) => ({ id: `${x}/${k}/${arm}`, group: `${x}/${k}`, values: { x, arm }, measures: { y: x * x + (arm === "b" ? 3 : 0) + k * 0.1 } }))),
    );
    return data([X, ARM], points);
  };

  it("gives the curve, the matching points and the band", () => {
    const record = good(fitResponse(grid()));
    const slice = sliceResponse(record, "y", { vary: "x", hold: { arm: "b" }, steps: 5, width: 2 });
    expect(slice.curve.map((c) => c.at)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(slice.held).toEqual({ arm: "b" });
    expect(slice.points).toHaveLength(15);
    expect(slice.points.every((p) => p.group !== undefined && p.id.endsWith("/b"))).toBe(true);
    const { rmse } = slice.error;
    expect(rmse).toBeGreaterThan(0);
    for (const c of slice.curve) {
      expect(c.value).toBe(predictResponse(record.models[0]!, { x: c.at, arm: "b" }));
      expect(c.high - c.value).toBeCloseTo(2 * rmse, 9);
      expect(c.value - c.low).toBeCloseTo(2 * rmse, 9);
    }
  });

  it("gives each level of a varied categorical dimension", () => {
    const record = good(fitResponse(grid()));
    const slice = sliceResponse(record, "y", { vary: "arm", hold: { x: 5 } });
    expect(slice.curve.map((c) => c.at)).toEqual(["a", "b", "c"]);
    expect(slice.points).toHaveLength(6);
    expect(new Set(slice.points.map((p) => p.at))).toEqual(new Set(["a", "b"]));
  });

  it("gives a curve and no point when the held values match no measured point", () => {
    const record = good(fitResponse(grid()));
    const slice = sliceResponse(record, "y", { vary: "arm", hold: { x: 3 } });
    expect(slice.points).toEqual([]);
    expect(slice.curve).toHaveLength(3);
    expect(slice.curve.every((c) => Number.isFinite(c.value))).toBe(true);
    const level = sliceResponse(record, "y", { vary: "x", hold: { arm: "c" } });
    expect(level.points).toEqual([]);
    expect(level.curve).toHaveLength(33);
  });

  it("matches near points with a tolerance", () => {
    const record = good(fitResponse(grid()));
    expect(sliceResponse(record, "y", { vary: "arm", hold: { x: 3 }, tolerance: 0.06 }).points).toHaveLength(6);
    expect(sliceResponse(record, "y", { vary: "arm", hold: { x: 3 }, tolerance: 0.04 }).points).toHaveLength(0);
  });

  it("holds each dimension without a value at a measured median or the most common level", () => {
    const points = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, values: { x: i, u: 0, arm: i === 0 ? "a" : "b" }, measures: { y: i } }));
    const record = good(fitResponse(data([X, U, ARM], points), { folds: 3 }));
    const slice = sliceResponse(record, "y", { vary: "x" });
    expect(slice.held).toEqual({ u: 0, arm: "b" });
    const held = sliceResponse(record, "y", { vary: "arm" }).held;
    expect(held["x"]).toBe(2);
  });

  it("gives a ratio band on a log scale, and spaces a log axis by ratios", () => {
    const size: ResponseDimension = { id: "size", label: "Size", kind: "continuous", range: [1, 100], unit: "", log: true };
    const record = good(fitResponse(generate([size], 60, "band", (v) => 1 + 2 * Math.log10(num(v["size"]))), { log: ["y"] }));
    const slice = sliceResponse(record, "y", { vary: "size", steps: 3 });
    expect(slice.curve.map((c) => c.at)).toEqual([1, expect.closeTo(10, 9), 100]);
    const ratio = 10 ** slice.error.rmse;
    for (const c of slice.curve) {
      expect(c.high / c.value).toBeCloseTo(ratio, 9);
      expect(c.value / c.low).toBeCloseTo(ratio, 9);
    }
  });

  it("refuses bad requests with a clear message", () => {
    const record = good(fitResponse(grid()));
    expect(() => sliceResponse(record, "no", { vary: "x" })).toThrow(/no model of the measure "no"/);
    expect(() => sliceResponse(record, "y", { vary: "no" })).toThrow(/no dimension "no"/);
    expect(() => sliceResponse(record, "y", { vary: "x", hold: { no: 1 } })).toThrow(/no dimension "no"/);
    expect(() => sliceResponse(record, "y", { vary: "x", hold: { x: 1 } })).toThrow(/both varied and held/);
    expect(() => sliceResponse(record, "y", { vary: "x", hold: { arm: "z" } })).toThrow(/not a level/);
    expect(() => sliceResponse(record, "y", { vary: "arm", hold: { x: 99 } })).toThrow(/outside the range/);
    expect(() => sliceResponse(record, "y", { vary: "x", steps: 1 })).toThrow(/steps/);
    expect(() => sliceResponse(record, "y", { vary: "x", tolerance: -1 })).toThrow(/tolerance/);
    expect(() => sliceResponse(record, "y", { vary: "x", width: Number.NaN })).toThrow(/width/);
  });
});

describe("surfaceResponse", () => {
  it("gives one row for each y value, and the matching points", () => {
    const points = generate([X, U, ARM], 150, "surface", (v) => num(v["x"]) * num(v["u"]));
    const record = good(fitResponse(points));
    const surface = surfaceResponse(record, "y", { vary: ["x", "u"], hold: { arm: "a" }, steps: 4 });
    expect(surface.x).toHaveLength(4);
    expect(surface.y).toHaveLength(4);
    expect(surface.cells).toHaveLength(4);
    surface.cells.forEach((row, j) =>
      row.forEach((cell, i) => {
        expect(cell.value).toBe(predictResponse(record.models[0]!, { x: surface.x[i]!, u: surface.y[j]!, arm: "a" }));
        expect(cell.low).toBeLessThan(cell.value);
      }),
    );
    expect(surface.points.length).toBe(points.points.filter((p) => p.values["arm"] === "a").length);
    expect(surface.points[0]?.at).toHaveLength(2);
  });

  it("refuses one dimension two times", () => {
    const record = good(fitResponse(generate([X, U], 30, "same", () => 0)));
    expect(() => surfaceResponse(record, "y", { vary: ["x", "x"] })).toThrow(/one dimension/);
  });
});

/* ---------- predictResponse ---------- */

describe("predictResponse", () => {
  const record = good(fitResponse(generate([X, ARM], 60, "predict", (v) => num(v["x"]))));
  const size: ResponseDimension = { id: "size", label: "Size", kind: "continuous", range: [1, 10], unit: "", log: true };

  it("extrapolates a number outside the range", () => {
    expect(Number.isFinite(predictResponse(record.models[0]!, { x: 1000, arm: "a" }))).toBe(true);
  });

  it("refuses a missing input, a bad value and a value that the log scale cannot read", () => {
    expect(() => predictResponse(record.models[0]!, { x: 1 })).toThrow(/no value of the dimension "arm"/);
    expect(() => predictResponse(record.models[0]!, { x: "1", arm: "a" })).toThrow(/not a finite number/);
    expect(() => predictResponse(record.models[0]!, { x: Number.NaN, arm: "a" })).toThrow(/not a finite number/);
    expect(() => predictResponse(record.models[0]!, { x: 1, arm: "z" })).toThrow(/not a level/);
    const log = good(fitResponse(generate([size], 30, "log", () => 1)));
    expect(() => predictResponse(log.models[0]!, { size: 0 })).toThrow(/log scale/);
  });

  it("reads no value from the prototype of the inputs", () => {
    const odd: ResponseDimension = { id: "toString", label: "T", kind: "continuous", range: [0, 1], unit: "" };
    const model = good(fitResponse(generate([odd], 30, "proto", () => 1))).models[0]!;
    expect(() => predictResponse(model, {})).toThrow(/no value of the dimension "toString"/);
  });

  it("handles a dimension with the id __proto__ through JSON", () => {
    const text = JSON.stringify({ id: "p", values: { __proto__x: 1 }, measures: { y: 1 } }).replaceAll("__proto__x", "__proto__");
    const proto: ResponseDimension = { id: "__proto__", label: "P", kind: "continuous", range: [0, 40], unit: "" };
    const points = Array.from({ length: 30 }, (_, i) => {
      const point = JSON.parse(text.replace('"p"', `"p${i}"`).replace('"__proto__":1', `"__proto__":${i}`)) as ResponsePoint;
      return { ...point, measures: { y: 2 * i } };
    });
    const record = good(JSON.parse(JSON.stringify(fitResponse(data([proto], points), { degree: 1 }))) as ResponseRecord);
    const slice = sliceResponse(record, "y", { vary: "__proto__", steps: 3 });
    expect(slice.curve[1]?.value).toBeCloseTo(40, 3);
  });
});

/* ---------- JSON and determinism ---------- */

describe("JSON and determinism", () => {
  const fixture = (): { readonly points: ResponseData; readonly options: ResponseFitOptions } => {
    const size: ResponseDimension = { id: "size", label: "Size", kind: "continuous", range: [1, 100], unit: "", log: true };
    const tier: ResponseDimension = { id: "tier", label: "Tier", kind: "ordinal", levels: ["low", "mid", "high"], unit: "" };
    const points = generate([X, size, tier, ARM], 120, "json", (v) => 1 + num(v["x"]) + Math.log10(num(v["size"])) + (v["arm"] === "a" ? 1 : 0));
    return { points, options: { log: ["y"], logFloor: 0.01, seed: "json" } };
  };

  it("keeps each prediction to the bit through a JSON round trip", () => {
    const { points, options } = fixture();
    const record = good(fitResponse(points, options));
    const copy = good(JSON.parse(JSON.stringify(record)) as ResponseRecord);
    expect(copy).toEqual(record);
    for (const p of record.points) expect(predictResponse(copy.models[0]!, p.values)).toBe(predictResponse(record.models[0]!, p.values));
    expect(JSON.stringify(sliceResponse(copy, "y", { vary: "x" }))).toBe(JSON.stringify(sliceResponse(record, "y", { vary: "x" })));
  });

  it("keeps a table model through a JSON round trip", () => {
    const record = good(fitResponse(generate([ARM], 30, "table json", (v) => (v["arm"] === "a" ? 1 : 2))));
    const copy = good(JSON.parse(JSON.stringify(record)) as ResponseRecord);
    for (const arm of ["a", "b", "c"]) expect(predictResponse(copy.models[0]!, { arm })).toBe(predictResponse(record.models[0]!, { arm }));
  });

  it("gives the same bytes for the same input", () => {
    const { points, options } = fixture();
    expect(JSON.stringify(fitResponse(points, options))).toBe(JSON.stringify(fitResponse(fixture().points, options)));
  });

  it("gives the same models and folds for each order of the points", () => {
    const { points, options } = fixture();
    const shuffled = { ...points, points: random("order").shuffle(points.points) };
    const a = fitResponse(points, options);
    const b = fitResponse(shuffled, options);
    expect(JSON.stringify(b.models)).toBe(JSON.stringify(a.models));
    expect(JSON.stringify(b.folds)).toBe(JSON.stringify(a.folds));
  });

  it("gives another split for another seed", () => {
    const { points } = fixture();
    expect(fitResponse(points, { seed: 1 }).folds[0]?.heldOut).not.toEqual(fitResponse(points, { seed: 2 }).folds[0]?.heldOut);
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls no clock and no Math.random", () => {
    const stop = (): never => {
      throw new Error("a call that the module must not make");
    };
    vi.spyOn(Math, "random").mockImplementation(stop);
    vi.spyOn(Date, "now").mockImplementation(stop);
    vi.spyOn(performance, "now").mockImplementation(stop);
    const { points, options } = fixture();
    const record = good(fitResponse(points, options));
    expect(sliceResponse(record, "y", { vary: "x" }).curve).toHaveLength(33);
  });

  it("has no Node import, no clock and no Math.random in its source", () => {
    for (const file of ["response.ts", "response-parse.ts", "response-fit.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "");
      expect(source).not.toMatch(/from "node:|require\(|process\.|Math\.random\(|Date\.|new Date|performance\./);
    }
  });

  it("does not change its input", () => {
    const { points, options } = fixture();
    const before = JSON.stringify(points);
    const frozen = structuredClone(points);
    fitResponse(frozen, options);
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

/* ---------- fitResponse refusals ---------- */

describe("fitResponse refusals", () => {
  const points = generate([X, ARM], 20, "refuse", (v) => num(v["x"]));

  it("refuses bad data with the path of the first fault", () => {
    expect(() => fitResponse({ ...points, name: "" })).toThrow(/fitResponse: name: this is text/);
    expect(() => fitResponse(null as unknown as ResponseData)).toThrow(/the data: this is an object/);
  });

  it("refuses bad options", () => {
    expect(() => fitResponse(points, { folds: 2 })).toThrow(/folds/);
    expect(() => fitResponse(points, { degree: 0 })).toThrow(/degree/);
    expect(() => fitResponse(points, { degree: 9 })).toThrow(/degree/);
    expect(() => fitResponse(points, { lambdas: [] })).toThrow(/lambdas/);
    expect(() => fitResponse(points, { lambdas: [0] })).toThrow(/lambdas/);
    expect(() => fitResponse(points, { logFloor: 0 })).toThrow(/logFloor/);
    expect(() => fitResponse(points, { log: ["no"] })).toThrow(/unknown measure "no"/);
  });

  it("refuses bad terms", () => {
    expect(() => fitResponse(points, { terms: [[{ dimension: "arm", power: 1 }]] })).toThrow(/takes a level/);
    expect(() => fitResponse(points, { terms: [[{ dimension: "arm", level: "z" }]] })).toThrow(/no level "z"/);
    expect(() => fitResponse(points, { terms: [[{ dimension: "x", power: 9 }]] })).toThrow(/whole number from 1 to 8/);
    expect(() => fitResponse(points, { terms: [[]] })).toThrow(/needs 1 or more/);
  });

  it("refuses an expansion over the limit, and tells the way out", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `l${i}`);
    const a: ResponseDimension = { id: "a", label: "A", kind: "categorical", levels: ids, unit: "" };
    const b: ResponseDimension = { id: "b", label: "B", kind: "categorical", levels: ids, unit: "" };
    const wide = data([X, a, b], [{ id: "p", values: { x: 1, a: "l0", b: "l0" }, measures: { y: 1 } }]);
    expect(RESPONSE_MAX_TERMS).toBe(1024);
    expect(() => fitResponse(wide)).toThrow(/Set interactions to false/);
  });

  it("refuses fewer than 3 groups", () => {
    expect(() => fitResponse({ ...points, points: points.points.map((p, i) => ({ ...p, group: `g${i % 2}` })) })).toThrow(/2 groups/);
  });
});

/* ---------- The validator ---------- */

describe("parseResponseRecord", () => {
  const ordinal: ResponseDimension = { id: "t", label: "T", kind: "ordinal", levels: ["l", "h"], unit: "" };
  const size: ResponseDimension = { id: "s", label: "S", kind: "continuous", range: [1, 10], unit: "", log: true };
  // A base that a test can change by paths: `generate` gives plain JSON, so a copy is safe to change.
  const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(fitResponse(generate([X, ARM, ordinal, size], 30, "base", (v) => num(v["x"]))))) as Record<string, unknown>;

  type Json = any;

  const faults = (r: unknown): string[] => {
    const parsed = parseResponseRecord(r);
    return parsed.ok ? [] : parsed.faults.map((f) => `${f.path}: ${f.message}`);
  };

  it("accepts a record of fitResponse", () => {
    expect(faults(base())).toEqual([]);
    const parsed = parseResponseRecord(base());
    expect(parsed.ok).toBe(true);
  });

  it.each([null, 1, "text", true, [], undefined])("refuses %j as a record, and does not throw", (value) => {
    expect(faults(value)).toEqual([expect.stringMatching(/^: this is an object/)]);
  });

  it("gives a fault for data with a loop, and does not throw", () => {
    const loop: Json = base();
    loop.points[0].values.x = loop;
    expect(faults(loop)[0]).toMatch(/the validator cannot read this data/);
  });

  // Each case: a change of a good record, then the path and the words of the fault that it must give.
  const cases: readonly (readonly [string, (r: Json) => void, RegExp])[] = [
    ["a wrong schema", (r) => (r.schema = "response-records/2"), /^schema: this is "response-records\/1", not "response-records\/2"/],
    ["an unknown top field", (r) => (r.extra = 1), /^extra: response-records\/1 has no such field/],
    ["a missing name", (r) => delete r.name, /^name: this field is missing/],
    ["an empty name", (r) => (r.name = ""), /^name: this is text/],
    ["a missing list", (r) => delete r.models, /^models: this field is missing/],
    ["dimensions that are not a list", (r) => (r.dimensions = {}), /^dimensions: this is a list/],
    ["no dimension", (r) => (r.dimensions = []), /^dimensions: this list has 0 items/],
    ["a dimension that is not an object", (r) => (r.dimensions[0] = 1), /^dimensions\[0\]: this is an object, not 1/],
    ["a duplicate dimension", (r) => (r.dimensions[1].id = "x"), /^dimensions\[1\]\.id: an earlier item has the id "x"/],
    ["a dimension with no id", (r) => (r.dimensions[0].id = ""), /^dimensions\[0\]\.id: this is text/],
    ["a label that is not text", (r) => (r.dimensions[0].label = 1), /^dimensions\[0\]\.label: this is text, not 1/],
    ["a unit that is not text", (r) => (r.dimensions[0].unit = null), /^dimensions\[0\]\.unit: this is text, not null/],
    ["a bad kind", (r) => (r.dimensions[0].kind = "circular"), /^dimensions\[0\]\.kind: this is "continuous", "ordinal" or "categorical", not "circular"/],
    ["a reversed range", (r) => (r.dimensions[0].range = [10, 0]), /^dimensions\[0\]\.range: this is a low and a high finite number/],
    ["a short range", (r) => (r.dimensions[0].range = [1]), /^dimensions\[0\]\.range: this is a low and a high/],
    ["a missing range", (r) => delete r.dimensions[0].range, /^dimensions\[0\]\.range: this field is missing/],
    ["levels on a continuous dimension", (r) => (r.dimensions[0].levels = ["a"]), /^dimensions\[0\]\.levels: a continuous dimension has a range/],
    ["a range on a categorical dimension", (r) => (r.dimensions[1].range = [0, 1]), /^dimensions\[1\]\.range: a dimension of the kind categorical has levels/],
    ["a log range that reaches 0", (r) => (r.dimensions[3].range = [0, 10]), /^dimensions\[3\]\.range: a log dimension has a range above 0/],
    ["a log flag that is not true or false", (r) => (r.dimensions[3].log = "yes"), /^dimensions\[3\]\.log: this is true or false, not "yes"/],
    ["a log flag on a categorical dimension", (r) => (r.dimensions[1].log = true), /^dimensions\[1\]\.log: a categorical dimension has no log scale/],
    ["missing levels", (r) => delete r.dimensions[1].levels, /^dimensions\[1\]\.levels: this field is missing/],
    ["no levels", (r) => (r.dimensions[1].levels = []), /^dimensions\[1\]\.levels: this list has 0 items/],
    ["duplicate levels", (r) => (r.dimensions[1].levels = ["a", "a"]), /^dimensions\[1\]\.levels: these levels have a duplicate/],
    ["number levels on a categorical dimension", (r) => (r.dimensions[1].levels = [1, 2]), /^dimensions\[1\]\.levels: these levels are all text/],
    ["mixed ordinal levels", (r) => (r.dimensions[2].levels = [1, "a"]), /^dimensions\[2\]\.levels: these levels are all text or all finite numbers/],
    ["number levels out of order", (r) => (r.dimensions[2].levels = [2, 1]), /^dimensions\[2\]\.levels: these number levels are not in ascending order/],
    ["a log flag on text levels", (r) => (r.dimensions[2].log = true), /^dimensions\[2\]\.levels: a log dimension has number levels above 0/],
    ["no measure", (r) => (r.measures = []), /^measures: this list has 0 items/],
    ["a duplicate measure", (r) => r.measures.push(r.measures[0]), /^measures\[1\]\.id: an earlier item has the id "y"/],
    ["a bad direction", (r) => (r.measures[0].direction = "up"), /^measures\[0\]\.direction: this is "higher", "lower" or "none", not "up"/],
    ["no point", (r) => (r.points = []), /^points: this list has 0 items/],
    ["a duplicate point", (r) => (r.points[1].id = r.points[0].id), /^points\[1\]\.id: an earlier item has the id "p0"/],
    ["a missing value", (r) => delete r.points[2].values.x, /^points\[2\]\.values\.x: this field is missing/],
    ["an unknown value", (r) => (r.points[2].values.q = 1), /^points\[2\]\.values\.q: .* has no such field/],
    ["a value outside the range", (r) => (r.points[2].values.x = 11), /^points\[2\]\.values\.x: the value 11 is outside the range 0 to 10/],
    ["a text value of a continuous dimension", (r) => (r.points[2].values.x = "1"), /^points\[2\]\.values\.x: the value "1" is not a finite number/],
    ["a null value of a continuous dimension", (r) => (r.points[2].values.x = null), /^points\[2\]\.values\.x: the value null is not a finite number/],
    ["an unknown level", (r) => (r.points[2].values.arm = "z"), /^points\[2\]\.values\.arm: the value "z" is not a level/],
    ["a missing measure", (r) => delete r.points[2].measures.y, /^points\[2\]\.measures\.y: this field is missing/],
    ["an unknown measure", (r) => (r.points[2].measures.q = 1), /^points\[2\]\.measures\.q: .* has no such field/],
    ["a text measure", (r) => (r.points[2].measures.y = "1"), /^points\[2\]\.measures\.y: this is a finite number or null, not "1"/],
    ["an empty group", (r) => (r.points[2].group = ""), /^points\[2\]\.group: this is text/],
    ["models that are not a list", (r) => (r.models = 1), /^models: this is a list/],
    ["no model of a measure", (r) => (r.models = []), /^models: no model has the measure "y"/],
    ["a second model of a measure", (r) => r.models.push(r.models[0]), /^models\[1\]\.measure: an earlier model has the measure "y"/],
    ["a bad model kind", (r) => (r.models[0].kind = "forest"), /^models\[0\]\.kind: this is "ridge" or "table", not "forest"/],
    ["a model of an unknown measure", (r) => (r.models[0].measure = "q"), /^models\[0\]\.measure: the record has no measure "q"/],
    ["a bad scale", (r) => (r.models[0].scale = "sqrt"), /^models\[0\]\.scale: this is "linear" or "log", not "sqrt"/],
    ["a floor on a linear scale", (r) => (r.models[0].floor = 1), /^models\[0\]\.floor: only a model with the scale log has a floor/],
    ["a floor of 0", (r) => ((r.models[0].scale = "log"), (r.models[0].floor = 0)), /^models\[0\]\.floor: this is a finite number above 0, not 0/],
    ["a bad lambda", (r) => (r.models[0].lambda = -1), /^models\[0\]\.lambda: this is a finite number of 0 or more, not -1/],
    ["a bad intercept", (r) => (r.models[0].intercept = null), /^models\[0\]\.intercept: this is a finite number, not null/],
    ["a missing field of a model", (r) => delete r.models[0].terms, /^models\[0\]\.terms: this field is missing/],
    ["a bad input kind", (r) => (r.models[0].inputs[0].kind = "x"), /^models\[0\]\.inputs\[0\]\.kind: this is "number", "rank" or "level", not "x"/],
    ["an input of an unknown dimension", (r) => (r.models[0].inputs[0].dimension = "q"), /^models\[0\]\.inputs\[0\]\.dimension: the record has no dimension "q"/],
    ["two inputs of one dimension", (r) => r.models[0].inputs.push(r.models[0].inputs[0]), /^models\[0\]\.inputs\[4\]\.dimension: an earlier input has the dimension "x"/],
    ["a spread of 0", (r) => (r.models[0].inputs[0].spread = 0), /^models\[0\]\.inputs\[0\]\.spread: this is a finite number above 0, not 0/],
    ["a bad center", (r) => (r.models[0].inputs[0].center = "c"), /^models\[0\]\.inputs\[0\]\.center: this is a finite number, not "c"/],
    ["an input of the wrong kind", (r) => (r.models[0].inputs[1] = { kind: "number", dimension: "arm", center: 0, spread: 1 }), /^models\[0\]\.inputs\[1\]\.kind: the dimension "arm" needs an input of the kind "level"/],
    ["other levels in an input", (r) => (r.models[0].inputs[1].levels = ["a"]), /^models\[0\]\.inputs\[1\]\.levels: these are not the levels of the dimension "arm"/],
    ["a log flag that differs from the dimension", (r) => (r.models[0].inputs[0].log = true), /^models\[0\]\.inputs\[0\]\.log: this does not agree with the log scale of the dimension "x"/],
    ["a term with no factor", (r) => (r.models[0].terms[0].factors = []), /^models\[0\]\.terms\[0\]\.factors: this list has 0 items/],
    ["a bad weight", (r) => (r.models[0].terms[0].weight = "w"), /^models\[0\]\.terms\[0\]\.weight: this is a finite number, not "w"/],
    ["a factor of an unknown input", (r) => (r.models[0].terms[0].factors[0].dimension = "q"), /^models\[0\]\.terms\[0\]\.factors\[0\]\.dimension: the model has no input "q"/],
    ["a bad power", (r) => (r.models[0].terms[0].factors[0].power = 0), /^models\[0\]\.terms\[0\]\.factors\[0\]\.power: this is a whole number from 1 to 8, not 0/],
    ["a power of a categorical input", (r) => (r.models[0].terms[0].factors[0] = { dimension: "arm", power: 1 }), /^models\[0\]\.terms\[0\]\.factors\[0\]: the categorical input "arm" takes a level/],
    ["a level of a number input", (r) => (r.models[0].terms[0].factors[0] = { dimension: "x", level: "a" }), /^models\[0\]\.terms\[0\]\.factors\[0\]\.level: the input "x" has no level "a"/],
    ["an unknown level of a factor", (r) => (r.models[0].terms[0].factors[0] = { dimension: "arm", level: "z" }), /^models\[0\]\.terms\[0\]\.factors\[0\]\.level: the input "arm" has no level "z"/],
    ["folds that are not a list", (r) => (r.folds = 1), /^folds: this is a list/],
    ["no fold", (r) => (r.folds = []), /^folds: this list has 0 items/],
    ["a fold of an unknown point", (r) => r.folds[0].heldOut.push("q"), /^folds\[0\]\.heldOut\[\d+\]: the record has no point "q"/],
    ["a point in two folds", (r) => r.folds[1].heldOut.push(r.folds[0].heldOut[0]), /^folds\[1\]\.heldOut\[\d+\]: the point "p\d+" is also in fold 0/],
    ["a wrong error count", (r) => (r.folds[0].errors.y.n += 1), /^folds\[0\]\.errors\.y\.n: this is \d+, the held-out points/],
    ["a bad error", (r) => (r.folds[0].errors.y.mae = -1), /^folds\[0\]\.errors\.y\.mae: this is a finite number of 0 or more, not -1/],
    ["a missing error field", (r) => delete r.folds[0].errors.y.rmse, /^folds\[0\]\.errors\.y\.rmse: this field is missing/],
    ["an error of an unknown measure", (r) => (r.folds[0].errors.q = {}), /^folds\[0\]\.errors\.q: .* has no such field/],
    ["no error of a measure", (r) => r.folds.forEach((f: Json) => delete f.errors.y), /^folds: no fold has a held-out error of the measure "y"/],
  ];

  it.each(cases)("gives a precise fault for %s", (_, change, want) => {
    const record: Json = base();
    change(record);
    const found = faults(record);
    expect(found.some((f) => want.test(f)), found.join("\n")).toBe(true);
  });

  it("gives the faults of a group on both sides of a split", () => {
    const record: Json = base();
    const index = (id: string): number => record.points.findIndex((p: Json) => p.id === id);
    record.points[index(record.folds[0].heldOut[0])].group = "g";
    record.points[index(record.folds[1].heldOut[0])].group = "g";
    expect(faults(record).join("\n")).toMatch(/the group "g" has 1 of its 2 points in this fold, so it is on both sides of the split/);
  });

  it("gives a fault for a group with one point in a fold and one point in none", () => {
    const record: Json = base();
    record.points[0].group = "g";
    record.points[1].group = "g";
    record.folds.forEach((f: Json) => {
      f.heldOut = f.heldOut.filter((id: string) => id !== "p1");
      if (f.errors.y !== undefined) f.errors.y.n = f.heldOut.length;
    });
    expect(faults(record).join("\n")).toMatch(/on both sides of the split/);
  });

  it("gives each fault of a record at once", () => {
    const record: Json = base();
    record.name = "";
    record.dimensions[0].unit = 1;
    record.measures[0].direction = "up";
    expect(faults(record)).toHaveLength(3);
  });

  describe("table models", () => {
    const table = (): Json => JSON.parse(JSON.stringify(fitResponse(generate([ARM], 30, "table base", () => 1))));
    const cases: readonly (readonly [string, (r: Json) => void, RegExp])[] = [
      ["a bad fallback", (r) => (r.models[0].fallback = null), /^models\[0\]\.fallback: this is a finite number, not null/],
      ["an unknown dimension", (r) => (r.models[0].dimensions = ["q"]), /^models\[0\]\.dimensions\[0\]: the record has no dimension "q"/],
      ["two times a dimension", (r) => (r.models[0].dimensions = ["arm", "arm"]), /^models\[0\]\.dimensions\[1\]: an earlier item is the dimension "arm"/],
      ["no cell", (r) => (r.models[0].cells = []), /^models\[0\]\.cells: this list has 0 items/],
      ["a bad value", (r) => (r.models[0].cells[0].value = "v"), /^models\[0\]\.cells\[0\]\.value: this is a finite number, not "v"/],
      ["a bad count", (r) => (r.models[0].cells[0].n = 0), /^models\[0\]\.cells\[0\]\.n: this is a whole number of 1 or more, not 0/],
      ["a short cell", (r) => (r.models[0].cells[0].at = []), /^models\[0\]\.cells\[0\]\.at: this list has 0 values, and the table has 1 dimensions/],
      ["a bad level", (r) => (r.models[0].cells[0].at = ["z"]), /^models\[0\]\.cells\[0\]\.at\[0\]: the value "z" is not a level/],
      ["two cells with the same values", (r) => r.models[0].cells.push(r.models[0].cells[0]), /^models\[0\]\.cells\[\d\]\.at: an earlier cell has the values \["a"\]/],
    ];

    it.each(cases)("gives a precise fault for %s", (_, change, want) => {
      const record = table();
      change(record);
      const found = faults(record);
      expect(found.some((f) => want.test(f)), found.join("\n")).toBe(true);
    });

    it("refuses a continuous dimension in a table", () => {
      const record: Json = JSON.parse(JSON.stringify(fitResponse(generate([ARM, X], 30, "mixed", () => 1))));
      record.models[0] = { kind: "table", measure: "y", scale: "linear", dimensions: ["x"], cells: [{ at: [1], value: 1, n: 1 }], fallback: 1 };
      expect(faults(record).join("\n")).toMatch(/a table cannot read the continuous dimension "x"/);
    });
  });
});
