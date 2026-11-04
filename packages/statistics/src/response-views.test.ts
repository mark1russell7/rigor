import { readFileSync } from "node:fs";
import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import {
  type ResponseData,
  type ResponseDimension,
  type ResponseInputValue,
  type ResponseMeasure,
  type ResponsePoint,
  type ResponseRecord,
  type RidgeResponseModel,
  RESPONSE_RECORDS_SCHEMA,
  fitResponse,
  heldOutError,
  parseResponseRecord,
  predictResponse,
  sliceResponse,
  surfaceResponse,
} from "./index.ts";

/* ---------- Helpers ---------- */

type Values = Readonly<Record<string, ResponseInputValue>>;

const Y: ResponseMeasure = { id: "y", label: "Y", unit: "", direction: "lower" };
const X: ResponseDimension = { id: "x", label: "X", kind: "continuous", range: [0, 10], unit: "" };
const ARM: ResponseDimension = { id: "arm", label: "Arm", kind: "categorical", levels: ["plain", "tuned"], unit: "" };
const DEPTH: ResponseDimension = { id: "depth", label: "Depth", kind: "continuous", range: [0, 10], unit: "", when: { dimension: "arm", levels: ["tuned"] } };

// The standard deviation of the noise of each generated point, and the held-out limit of each recovery over the seeds.
const NOISE = 0.05;
const LIMIT = 1.4 * NOISE;
// The model skill is the true-function skill less this margin, or more. The true function has the same noise and the same held-out points.
const CEILING_MARGIN = 0.02;
// A noiseless power law on log scales, and the fit of degree 1 of the quadratic, in held-out RMSE.
const POWER_LIMIT = 1e-3;
const DEGREE_ONE_FLOOR = 1;

const num = (v: ResponseInputValue | undefined): number => v as number;

const data = (dimensions: readonly ResponseDimension[], points: readonly ResponsePoint[]): ResponseData => ({
  schema: RESPONSE_RECORDS_SCHEMA,
  name: "test",
  dimensions,
  measures: [Y],
  points,
});

function good(record: ResponseRecord): ResponseRecord {
  const parsed = parseResponseRecord(JSON.parse(JSON.stringify(record)));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.faults));
  return parsed.record;
}

const faults = (record: unknown): string[] => {
  const parsed = parseResponseRecord(record);
  return parsed.ok ? [] : parsed.faults.map((f) => `${f.path}: ${f.message}`);
};

// The arm "plain" has the fixed value 3. The arm "tuned" has a quadratic in its own parameter.
const armTruth = (v: Values): number => (v["arm"] === "plain" ? 3 : 1 + (num(v["depth"]) - 4) ** 2 / 4);

// One arm of 3 has a parameter, so the most common level of the parent is outside the condition.
function arms(n: number, seed: string): ResponseData {
  const r = random(seed);
  const points = Array.from({ length: n }, (_, i): ResponsePoint => {
    const arm = i % 3 === 0 ? "tuned" : "plain";
    const values = { arm, depth: arm === "tuned" ? r.range(0, 10) : null, x: r.range(0, 10) };
    return { id: `p${i}`, values, measures: { y: armTruth(values) + r.normal(0, NOISE) } };
  });
  return data([ARM, DEPTH, X], points);
}

// The skill of the true function: its error at the held-out points, against the same baseline as the model.
function ceilingOf(record: ResponseRecord, truth: (v: Values) => number): number {
  const byId = new Map(record.points.map((p) => [p.id, p]));
  const held = record.folds.flatMap((f) => f.heldOut).map((id) => byId.get(id) as ResponsePoint);
  const mae = held.reduce((sum, p) => sum + Math.abs((p.measures["y"] as number) - truth(p.values)), 0) / held.length;
  return 1 - mae / heldOutError(record, "y").baselineMae;
}

/* ---------- Conditional dimensions ---------- */

describe("a conditional dimension", () => {
  const record = good(fitResponse(arms(450, "arms")));

  it("gives a held-out skill within the margin of the true function, with one parameter of one arm", () => {
    expect(heldOutError(record, "y").skill).toBeGreaterThanOrEqual(ceilingOf(record, armTruth) - CEILING_MARGIN);
  });

  it("gives a held-out RMSE below 1.4 noise SD with one parameter of one arm", () => {
    expect(heldOutError(record, "y").rmse).toBeLessThan(LIMIT);
  });

  it("recovers the known curve of the parameter, and the parent takes the level inside the condition", () => {
    const slice = sliceResponse(record, "y", { vary: "depth", steps: 21 });
    expect(slice.held["arm"]).toBe("tuned");
    for (const c of slice.curve) expect(Math.abs(c.value - armTruth({ arm: "tuned", depth: c.at }))).toBeLessThan(LIMIT);
    expect(slice.points).toEqual([]);
    const wide = sliceResponse(record, "y", { vary: "depth", hold: { x: slice.held["x"] as number }, tolerance: 1 });
    expect(wide.points).toHaveLength(150);
  });

  it("carries the mean of the arm without the parameter in the columns of the arm", () => {
    const at = predictResponse(record.models[0]!, { arm: "plain", depth: null, x: 5 });
    expect(Math.abs(at - 3)).toBeLessThan(LIMIT);
    const terms = (record.models[0] as RidgeResponseModel).terms.map((t) => t.factors);
    expect(terms).toContainEqual([{ dimension: "arm", level: "plain" }]);
    expect(terms).toContainEqual([{ dimension: "arm", level: "tuned" }]);
    expect(terms).toContainEqual([{ dimension: "depth", power: 2 }]);
    expect(terms.filter((t) => t.some((f) => f.dimension === "depth") && t.some((f) => f.dimension === "arm"))).toEqual([]);
  });

  it("gives each level of the parent its own curve when two levels have the dimension", () => {
    const three: ResponseDimension = { id: "arm", label: "Arm", kind: "categorical", levels: ["a", "b", "c"], unit: "" };
    const depth: ResponseDimension = { ...DEPTH, when: { dimension: "arm", levels: ["a", "b"] } };
    const truth = (v: Values): number => (v["arm"] === "a" ? 2 * num(v["depth"]) : v["arm"] === "b" ? 20 - (num(v["depth"]) - 5) ** 2 : 7);
    const r = random("two levels");
    const points = Array.from({ length: 360 }, (_, i): ResponsePoint => {
      const arm = ["a", "b", "c"][i % 3] as string;
      const values = { arm, depth: arm === "c" ? null : r.range(0, 10) };
      return { id: `p${i}`, values, measures: { y: truth(values) + r.normal(0, NOISE) } };
    });
    const fit = good(fitResponse(data([three, depth], points)));
    expect(heldOutError(fit, "y").rmse).toBeLessThan(LIMIT);
    for (const arm of ["a", "b"]) {
      const slice = sliceResponse(fit, "y", { vary: "depth", hold: { arm }, steps: 11 });
      for (const c of slice.curve) expect(Math.abs(c.value - truth({ arm, depth: c.at }))).toBeLessThan(LIMIT);
    }
  });

  it("uses the columns of the levels of an ordinal parent", () => {
    const tier: ResponseDimension = { id: "tier", label: "Tier", kind: "ordinal", levels: [1, 2, 3], unit: "" };
    const gain: ResponseDimension = { ...DEPTH, id: "gain", when: { dimension: "tier", levels: [2, 3] } };
    const truth = (v: Values): number => (v["tier"] === 1 ? 4 : num(v["tier"]) + num(v["gain"]) * (v["tier"] === 2 ? 1 : -1));
    const r = random("ordinal parent");
    const points = Array.from({ length: 300 }, (_, i): ResponsePoint => {
      const t = (i % 3) + 1;
      const values = { tier: t, gain: t === 1 ? null : r.range(0, 10) };
      return { id: `p${i}`, values, measures: { y: truth(values) + r.normal(0, NOISE) } };
    });
    const fit = good(fitResponse(data([tier, gain], points)));
    expect(heldOutError(fit, "y").rmse).toBeLessThan(LIMIT);
    expect((fit.models[0] as RidgeResponseModel).terms.map((t) => t.factors)).toContainEqual([{ dimension: "tier", level: 2 }]);
    expect(Math.abs(predictResponse(fit.models[0]!, { tier: 3, gain: 5 }) - truth({ tier: 3, gain: 5 }))).toBeLessThan(LIMIT);
    expect(Math.abs(predictResponse(fit.models[0]!, { tier: 1, gain: null }) - 4)).toBeLessThan(LIMIT);
    // A tolerance can reach the next level, whose point has no value of the varied dimension.
    const near = sliceResponse(fit, "y", { vary: "gain", hold: { tier: 2 }, tolerance: 0.5 });
    expect(near.points.length).toBeGreaterThan(0);
    expect(near.points.every((p) => typeof p.at === "number")).toBe(true);
  });

  it("omits the structural products when interactions is false", () => {
    const three: ResponseDimension = { id: "arm", label: "Arm", kind: "categorical", levels: ["a", "b", "c"], unit: "" };
    const depth: ResponseDimension = { ...DEPTH, when: { dimension: "arm", levels: ["a", "b"] } };
    const points = Array.from({ length: 30 }, (_, i): ResponsePoint => {
      const arm = ["a", "b", "c"][i % 3] as string;
      return { id: `p${i}`, values: { arm, depth: arm === "c" ? null : i % 11 }, measures: { y: i } };
    });
    const model = fitResponse(data([three, depth], points), { interactions: false }).models[0] as RidgeResponseModel;
    expect(model.terms.every((t) => t.factors.length === 1)).toBe(true);
  });

  it("makes no product of two children with no common level", () => {
    const three: ResponseDimension = { id: "arm", label: "Arm", kind: "categorical", levels: ["a", "b", "c"], unit: "" };
    const p: ResponseDimension = { ...DEPTH, id: "p", when: { dimension: "arm", levels: ["a"] } };
    const q: ResponseDimension = { ...DEPTH, id: "q", when: { dimension: "arm", levels: ["b"] } };
    const r: ResponseDimension = { ...DEPTH, id: "r", when: { dimension: "arm", levels: ["a", "b"] } };
    const points = Array.from({ length: 30 }, (_, i): ResponsePoint => {
      const arm = ["a", "b", "c"][i % 3] as string;
      return { id: `p${i}`, values: { arm, p: arm === "a" ? i % 11 : null, q: arm === "b" ? i % 11 : null, r: arm === "c" ? null : i % 7 }, measures: { y: i } };
    });
    const fit = fitResponse(data([three, p, q, r], points), { degree: 2 });
    const pairs = (fit.models[0] as RidgeResponseModel).terms.map((t) => t.factors.map((f) => f.dimension).join("*"));
    expect(pairs).not.toContain("p*q");
    expect(pairs).toContain("p*r");
    expect(pairs).toContain("q*r");
    expect(() => surfaceResponse(fit, "y", { vary: ["p", "q"] })).toThrow(/needs "arm" at one of \[\]/);
    expect(surfaceResponse(fit, "y", { vary: ["p", "r"] }).held["arm"]).toBe("a");
  });

  it("refuses null at a dimension with no condition", () => {
    expect(() => predictResponse(record.models[0]!, { arm: "tuned", depth: 1, x: null })).toThrow(/"x" has no condition/);
    expect(() => predictResponse(record.models[0]!, { arm: null, depth: 1, x: 1 })).toThrow(/"arm" has no condition/);
  });

  it("keeps a prediction to the bit through a JSON round trip", () => {
    const fit = fitResponse(arms(90, "json"));
    const copy = JSON.parse(JSON.stringify(fit)) as ResponseRecord;
    for (const p of fit.points) expect(predictResponse(copy.models[0]!, p.values)).toBe(predictResponse(fit.models[0]!, p.values));
  });

  describe("in a table", () => {
    const mode: ResponseDimension = { id: "mode", label: "Mode", kind: "categorical", levels: ["fast", "slow"], unit: "", when: { dimension: "arm", levels: ["tuned"] } };
    const table = (): ResponseRecord => {
      const points = Array.from({ length: 30 }, (_, i): ResponsePoint => {
        const k = i % 3;
        const values = { arm: k === 0 ? "plain" : "tuned", mode: k === 0 ? null : k === 1 ? "fast" : "slow" };
        return { id: `p${i}`, values, measures: { y: k * 10 } };
      });
      return good(fitResponse(data([ARM, mode], points)));
    };

    it("keeps null as a level of its cells", () => {
      const fit = table();
      expect(fit.models[0]).toMatchObject({ kind: "table", cells: [{ at: ["plain", null], value: 0, n: 10 }, { at: ["tuned", "fast"], value: 10, n: 10 }, { at: ["tuned", "slow"], value: 20, n: 10 }] });
      expect(predictResponse(fit.models[0]!, { arm: "plain", mode: null })).toBe(0);
      expect(predictResponse(fit.models[0]!, { arm: "tuned", mode: "slow" })).toBe(20);
    });

    it("stores its conditional dimensions, and refuses null at another dimension", () => {
      const fit = table();
      expect(fit.models[0]).toMatchObject({ conditional: ["mode"] });
      expect(() => predictResponse(fit.models[0]!, { arm: null, mode: null })).toThrow(/"arm" has no condition/);
    });

    it("has no list of conditional dimensions when no dimension has a condition", () => {
      const points = Array.from({ length: 6 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { arm: i % 2 === 0 ? "plain" : "tuned" }, measures: { y: i } }));
      const fit = fitResponse(data([ARM], points));
      expect(Object.hasOwn(fit.models[0]!, "conditional")).toBe(false);
      expect(() => predictResponse(fit.models[0]!, { arm: null })).toThrow(/"arm" has no condition/);
    });

    it("gives a fault for a list that does not agree with the dimensions", () => {
      const fit = JSON.parse(JSON.stringify(table())) as { models: { conditional?: unknown }[] };
      fit.models[0]!.conditional = ["arm"];
      expect(faults(fit).join("\n")).toMatch(/models\[0\]\.conditional: this does not agree with the conditions/);
      delete fit.models[0]!.conditional;
      expect(faults(fit).join("\n")).toMatch(/models\[0\]\.conditional: this does not agree with the conditions/);
    });

    it("gives a fault for a list on a ridge model", () => {
      const fit = JSON.parse(JSON.stringify(fitResponse(arms(30, "ridge list")))) as { models: { conditional?: unknown }[] };
      fit.models[0]!.conditional = ["depth"];
      expect(faults(fit).join("\n")).toMatch(/models\[0\]\.conditional: .* has no such field/);
    });

    it("gives a fault for null at a dimension with no condition", () => {
      const fit = JSON.parse(JSON.stringify(table())) as { models: { cells: { at: unknown[] }[] }[] };
      fit.models[0]!.cells[0]!.at[0] = null;
      expect(faults(fit).join("\n")).toMatch(/cells\[0\]\.at\[0\]: the value null is not a level/);
    });
  });
});

describe("a view of a conditional dimension", () => {
  const record = good(fitResponse(arms(90, "views")));

  it("refuses a held parent outside the condition", () => {
    expect(() => sliceResponse(record, "y", { vary: "depth", hold: { arm: "plain" } })).toThrow(/needs "arm" at one of \["tuned"\], not "plain"/);
  });

  it("gives null to a held dimension whose parent is outside the condition, and the points that match have null", () => {
    const slice = sliceResponse(record, "y", { vary: "x", hold: { arm: "plain", depth: 5 }, tolerance: 1 });
    expect(slice.held).toEqual({ arm: "plain", depth: null });
    expect(slice.points).toHaveLength(60);
    expect(slice.curve.every((c) => Math.abs(c.value - 3) < 0.5)).toBe(true);
    expect(sliceResponse(record, "y", { vary: "x", hold: { arm: "plain", depth: null } }).held["depth"]).toBeNull();
  });

  it("reads each place of a varied parent by the condition", () => {
    const depth = record.points.find((p) => p.values["arm"] === "tuned")?.values["depth"] as number;
    const x = record.points.find((p) => p.values["depth"] === depth)?.values["x"] as number;
    const slice = sliceResponse(record, "y", { vary: "arm", hold: { depth, x } });
    expect(slice.held).toEqual({ depth, x });
    expect(slice.curve[0]?.value).toBe(predictResponse(record.models[0]!, { arm: "plain", depth: null, x }));
    expect(slice.curve[1]?.value).toBe(predictResponse(record.models[0]!, { arm: "tuned", depth, x }));
    expect(slice.curve[1]?.nearest).toBe(0);
    expect(slice.points).toHaveLength(1);
    const wide = sliceResponse(record, "y", { vary: "arm", hold: { depth, x }, tolerance: 1 });
    expect(wide.points).toHaveLength(90);
  });

  it("refuses a null hold where the parent needs a value", () => {
    expect(() => sliceResponse(record, "y", { vary: "x", hold: { arm: "tuned", depth: null } })).toThrow(/"depth" is null/);
    expect(() => sliceResponse(record, "y", { vary: "arm", hold: { depth: null } })).toThrow(/"depth" is null/);
    expect(() => sliceResponse(record, "y", { vary: "arm", hold: { x: null } })).toThrow(/held dimension "x"/);
  });

  it("refuses a surface in which a child varies with its parent", () => {
    expect(() => surfaceResponse(record, "y", { vary: ["depth", "arm"] })).toThrow(/so hold "arm"/);
    const surface = surfaceResponse(record, "y", { vary: ["depth", "x"], steps: 3 });
    expect(surface.held).toEqual({ arm: "tuned" });
  });

  it("takes the low end or the first level of a dimension with no measured value", () => {
    const three: ResponseDimension = { id: "arm", label: "Arm", kind: "categorical", levels: ["plain", "tuned"], unit: "" };
    const mode: ResponseDimension = { id: "mode", label: "Mode", kind: "categorical", levels: ["fast", "slow"], unit: "", when: { dimension: "arm", levels: ["tuned"] } };
    const points = Array.from({ length: 12 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { arm: "plain", depth: null, mode: null, x: i % 11 }, measures: { y: i } }));
    const fit = fitResponse(data([three, DEPTH, mode, X], points));
    const slice = sliceResponse(fit, "y", { vary: "arm" });
    expect(slice.held["depth"]).toBe(0);
    expect(slice.held["mode"]).toBe("fast");
  });
});

/* ---------- The distance to a measurement ---------- */

describe("nearest", () => {
  const grid = [0, 1, 2, 3, 7, 8, 9, 10];
  const gap = (): ResponseRecord => {
    const points = grid.flatMap((x) => [0, 1].map((k): ResponsePoint => ({ id: `${x}/${k}`, values: { x }, measures: { y: x } })));
    return good(fitResponse(data([X], points), { degree: 1 }));
  };

  it("is above 0 in a gap of the data, and 0 at measured places", () => {
    const slice = sliceResponse(gap(), "y", { vary: "x", steps: 11 });
    for (const c of slice.curve) {
      const near = Math.min(...grid.map((x) => Math.abs(x - (c.at as number)))) / 10;
      expect(c.nearest).toBeCloseTo(near, 12);
      if (grid.includes(c.at as number)) expect(c.nearest).toBe(0);
    }
    expect(slice.curve[5]?.nearest).toBeCloseTo(0.2, 12);
  });

  it("is above 0 at a table cell that uses the fallback, and 0 at a cell with points", () => {
    const left: ResponseDimension = { id: "side", label: "Side", kind: "categorical", levels: ["l", "r"], unit: "" };
    const points = Array.from({ length: 12 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { arm: i % 3 === 0 ? "plain" : "tuned", side: i % 3 === 0 ? "r" : "l" }, measures: { y: i } }));
    const fit = good(fitResponse(data([ARM, left], points)));
    const model = fit.models[0] as { readonly fallback: number };
    const missing = sliceResponse(fit, "y", { vary: "arm", hold: { side: "l" } }).curve[0];
    expect(missing?.value).toBe(model.fallback);
    expect(missing?.nearest).toBe(1);
    expect(sliceResponse(fit, "y", { vary: "arm", hold: { side: "l" } }).curve[1]?.nearest).toBe(0);
  });

  it("reads a log axis on the log scale, and the rank of a text level as a share", () => {
    const size: ResponseDimension = { id: "size", label: "Size", kind: "continuous", range: [1, 100], unit: "", log: true };
    const tier: ResponseDimension = { id: "tier", label: "Tier", kind: "ordinal", levels: ["low", "mid", "high"], unit: "" };
    const points = Array.from({ length: 12 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { size: i % 2 === 0 ? 1 : 100, tier: "low" }, measures: { y: i } }));
    const fit = fitResponse(data([size, tier], points), { degree: 1 });
    const curve = sliceResponse(fit, "y", { vary: "size", steps: 3 }).curve;
    expect(curve.map((c) => c.nearest)).toEqual([0, expect.closeTo(0.5, 12), 0]);
    expect(sliceResponse(fit, "y", { vary: "tier", hold: { size: 1 } }).curve.map((c) => c.nearest)).toEqual([0, 0.5, 1]);
  });

  it("gives 0 on an axis with one level", () => {
    const one: ResponseDimension = { id: "n", label: "N", kind: "ordinal", levels: [5], unit: "" };
    const text: ResponseDimension = { id: "t", label: "T", kind: "ordinal", levels: ["only"], unit: "" };
    const points = Array.from({ length: 12 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { n: 5, t: "only", x: i % 2 === 0 ? 0 : 10 }, measures: { y: i } }));
    const fit = fitResponse(data([one, text, X], points), { degree: 1 });
    expect(sliceResponse(fit, "y", { vary: "x", steps: 3 }).curve.map((c) => c.nearest)).toEqual([0, 0.5, 0]);
  });

  it("takes the largest count over the dimensions, and an absent value against a present value counts 1", () => {
    const record = good(fitResponse(arms(90, "nearest")));
    const held = record.points.find((p) => p.values["arm"] === "plain")?.values["x"] as number;
    expect(sliceResponse(record, "y", { vary: "arm", hold: { x: held } }).curve[0]?.nearest).toBe(0);
    const only = record.points.filter((p) => p.values["arm"] === "plain");
    const plain = good(fitResponse({ ...record, points: only }, { model: "ridge" }));
    expect(sliceResponse(plain, "y", { vary: "depth", hold: { x: held } }).curve.every((c) => c.nearest === 1)).toBe(true);
  });

  it("does not count a point with no value of the measure", () => {
    const other: ResponseMeasure = { id: "z", label: "Z", unit: "", direction: "none" };
    const points = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x): ResponsePoint => ({ id: `p${x}`, values: { x }, measures: { y: x, z: x > 5 ? null : x } }));
    const fit = fitResponse({ ...data([X], points), measures: [Y, other] }, { degree: 1 });
    const curve = sliceResponse(fit, "z", { vary: "x", steps: 11 }).curve;
    expect(curve[5]?.nearest).toBe(0);
    expect(curve[10]?.nearest).toBeCloseTo(0.5, 12);
  });

  it("gives a surface the same field, and the band keeps its one width", () => {
    const surface = surfaceResponse(good(fitResponse(arms(90, "surface"))), "y", { vary: ["depth", "x"], steps: 4, width: 2 });
    const widths = surface.cells.flat().map((c) => c.high - c.low);
    for (const width of widths) expect(width).toBeCloseTo(widths[0]!, 9);
    expect(surface.cells.flat().every((c) => c.nearest >= 0 && c.nearest <= 1)).toBe(true);
  });
});

/* ---------- Recovery over seeds ---------- */

describe("the recovery limits over 24 seeds", () => {
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1);

  // The worst value over the seeds, and its seed. The seed goes into the failure text of each limit.
  function worstOf(values: readonly number[], pick: (...v: number[]) => number): { readonly value: number; readonly seed: number } {
    const value = pick(...values);
    return { value, seed: values.indexOf(value) + 1 };
  }

  function noisy(seed: number, name: string, dimensions: readonly ResponseDimension[], truth: (v: Values) => number, noise = NOISE): ResponseData {
    const r = random(`${name} ${seed}`);
    const draw = (d: ResponseDimension): number => {
      if (d.kind !== "continuous") return 0;
      return d.log === true ? 10 ** r.range(Math.log10(d.range[0]), Math.log10(d.range[1])) : r.range(d.range[0], d.range[1]);
    };
    const points = Array.from({ length: 200 }, (_, i): ResponsePoint => {
      const values = Object.fromEntries(dimensions.map((d) => [d.id, draw(d)]));
      return { id: `p${i}`, values, measures: { y: truth(values) + r.normal(0, noise) } };
    });
    return data(dimensions, points);
  }

  it("keeps the worst held-out RMSE of a linear response below 1.4 noise SD", () => {
    const U: ResponseDimension = { id: "u", label: "U", kind: "continuous", range: [-1, 1], unit: "" };
    const rmse = seeds.map((s) => heldOutError(fitResponse(noisy(s, "linear", [X, U], (v) => 3 + 2 * num(v["x"]) - 0.5 * num(v["u"])), { seed: s }), "y").rmse);
    const worst = worstOf(rmse, Math.max);
    expect(worst.value, `linear, seed ${worst.seed}`).toBeLessThan(LIMIT);
  });

  it("keeps the worst held-out RMSE of a quadratic response below 1.4 noise SD", () => {
    const rmse = seeds.map((s) => heldOutError(fitResponse(noisy(s, "quadratic", [X], (v) => 1 + (num(v["x"]) - 2) ** 2 / 4), { seed: s }), "y").rmse);
    const worst = worstOf(rmse, Math.max);
    expect(worst.value, `quadratic, seed ${worst.seed}`).toBeLessThan(LIMIT);
  });

  it("keeps a degree of 1 of the quadratic above an RMSE of 1 at each seed", () => {
    const rmse = seeds.map((s) => heldOutError(fitResponse(noisy(s, "quadratic", [X], (v) => 1 + (num(v["x"]) - 2) ** 2 / 4), { seed: s, degree: 1 }), "y").rmse);
    const worst = worstOf(rmse, Math.min);
    expect(worst.value, `degree 1, seed ${worst.seed}`).toBeGreaterThan(DEGREE_ONE_FLOOR);
  });

  it("keeps the worst held-out RMSE of a noiseless power law below the limit", () => {
    const size: ResponseDimension = { id: "size", label: "Size", kind: "continuous", range: [1, 1000], unit: "", log: true };
    const truth = (v: Values): number => 5 * num(v["size"]) ** 1.5;
    const rmse = seeds.map((s) => heldOutError(fitResponse(noisy(s, "power", [size], truth, 0), { seed: s, log: ["y"], degree: 1 }), "y").rmse);
    const worst = worstOf(rmse, Math.max);
    expect(worst.value, `power law, seed ${worst.seed}`).toBeLessThan(POWER_LIMIT);
  });

  const conditional = seeds.map((s) => {
    const record = fitResponse(arms(450, `arms ${s}`), { seed: s });
    const error = heldOutError(record, "y");
    return { rmse: error.rmse, skill: error.skill as number, ceiling: ceilingOf(record, armTruth) };
  });

  it("keeps the worst held-out RMSE of the conditional response below 1.4 noise SD", () => {
    const worst = worstOf(conditional.map((c) => c.rmse), Math.max);
    expect(worst.value, `conditional, seed ${worst.seed}`).toBeLessThan(LIMIT);
  });

  it("keeps the skill of the conditional response within the margin of the true function at each seed", () => {
    const worst = worstOf(conditional.map((c) => c.ceiling - c.skill), Math.max);
    const at = conditional[worst.seed - 1];
    expect(worst.value, `gap, seed ${worst.seed}, skill ${at?.skill}, ceiling ${at?.ceiling}`).toBeLessThanOrEqual(CEILING_MARGIN);
  });
});

/* ---------- The README example ---------- */

describe("the README example", () => {
  it("compiles, starts, and has the text of the README", () => {
    const r = random("readme");
    const points = Array.from({ length: 60 }, (_, i): ResponsePoint => {
      const strategy = i % 2 === 0 ? "shelf" : "skyline";
      const boxes = i % 3 === 0 ? 1000 : Math.round(10 ** r.range(1, 4));
      const depth = strategy === "skyline" ? 1 + (i % 8) : null;
      return { id: `p${i}`, group: `input ${i % 20}/${i}`, values: { boxes, strategy, depth }, measures: { ms: boxes * (strategy === "shelf" ? 2 : 1 + (depth as number)) } };
    });

    // README begin
    const record = fitResponse(
      {
        schema: "response-records/1",
        name: "time of a placement",
        dimensions: [
          { id: "boxes", label: "Boxes", kind: "continuous", range: [10, 10000], unit: "", log: true },
          { id: "strategy", label: "Strategy", kind: "categorical", levels: ["shelf", "skyline"], unit: "" },
          // Only the arm "skyline" has this parameter. Each other point has null.
          { id: "depth", label: "Depth", kind: "continuous", range: [1, 8], unit: "", when: { dimension: "strategy", levels: ["skyline"] } },
        ],
        measures: [{ id: "ms", label: "Time", unit: "ms", direction: "lower" }],
        points, // { id, values, measures, group }: repeats of one input have one group
      },
      { log: ["ms"], logFloor: 0.001 },
    );

    // A server writes the text. A browser reads it, and it asks for one dimension with the other dimensions held.
    const text = JSON.stringify(record);
    const parsed = parseResponseRecord(JSON.parse(text));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.faults));
    const slice = sliceResponse(parsed.record, "ms", { vary: "depth", hold: { boxes: 1000 } });
    slice.curve; // { at, value, low, high, nearest } along the dimension
    slice.points; // the measured points with the held values
    slice.error; // the held-out error of the folds
    // README end

    expect(slice.held).toEqual({ boxes: 1000, strategy: "skyline" });
    expect(slice.curve).toHaveLength(33);
    expect(slice.points.length).toBeGreaterThan(0);
    expect(slice.error.n).toBe(60);

    const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    const self = readFileSync(new URL(import.meta.url), "utf8");
    const copy = lines(self.slice(self.indexOf("// README begin") + 15, self.indexOf("// README end")));
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const start = readme.indexOf("const record = fitResponse(");
    const fence = lines(readme.slice(start, readme.indexOf("```", start)));
    expect(fence).toEqual(copy);
  });
});

/* ---------- Faults of a condition ---------- */

describe("parseResponseRecord of a condition", () => {
  type Json = any;
  const base = (): Json => JSON.parse(JSON.stringify(fitResponse(arms(30, "base"))));
  const firstOf = (r: Json, arm: string): number => r.points.findIndex((p: Json) => p.values.arm === arm);

  it("accepts a record with a condition", () => {
    expect(faults(base())).toEqual([]);
  });

  const cases: readonly (readonly [string, (r: Json) => void, RegExp])[] = [
    ["a condition that is not an object", (r) => (r.dimensions[1].when = 1), /^dimensions\[1\]\.when: this is an object, not 1/],
    ["an unknown field", (r) => (r.dimensions[1].when.other = 1), /^dimensions\[1\]\.when\.other: .* has no such field/],
    ["a missing dimension", (r) => delete r.dimensions[1].when.dimension, /^dimensions\[1\]\.when\.dimension: this field is missing/],
    ["missing levels", (r) => delete r.dimensions[1].when.levels, /^dimensions\[1\]\.when\.levels: this field is missing/],
    ["no levels", (r) => (r.dimensions[1].when.levels = []), /^dimensions\[1\]\.when\.levels: this list has 0 items/],
    ["duplicate levels", (r) => (r.dimensions[1].when.levels = ["tuned", "tuned"]), /^dimensions\[1\]\.when\.levels: these levels have a duplicate/],
    ["an unknown parent", (r) => (r.dimensions[1].when.dimension = "q"), /^dimensions\[1\]\.when\.dimension: the record has no dimension "q"/],
    ["a continuous parent", (r) => (r.dimensions[1].when = { dimension: "x", levels: [1] }), /^dimensions\[1\]\.when\.dimension: the parent "x" is "continuous", and a parent is categorical or ordinal/],
    [
      "a conditional parent",
      (r) => {
        r.dimensions.push({ id: "m", label: "M", kind: "categorical", levels: ["a"], unit: "", when: { dimension: "arm", levels: ["tuned"] } });
        r.dimensions[1].when = { dimension: "m", levels: ["a"] };
      },
      /^dimensions\[1\]\.when\.dimension: the parent "m" is itself conditional/,
    ],
    ["a level that the parent does not have", (r) => (r.dimensions[1].when.levels = ["q"]), /^dimensions\[1\]\.when\.levels\[0\]: the dimension "arm" has no level "q"/],
    ["null inside the condition", (r) => (r.points[firstOf(r, "tuned")].values.depth = null), /^points\[\d+\]\.values\.depth: this needs a value when the dimension "arm" is "tuned"/],
    ["a value outside the condition", (r) => (r.points[firstOf(r, "plain")].values.depth = 1), /^points\[\d+\]\.values\.depth: this is null when the dimension "arm" is "plain"/],
    ["a bad value inside the condition", (r) => (r.points[firstOf(r, "tuned")].values.depth = 99), /^points\[\d+\]\.values\.depth: the value 99 is outside the range/],
    ["null at a dimension with no condition", (r) => (r.points[0].values.x = null), /^points\[0\]\.values\.x: the value null is not a finite number/],
    ["an input with no flag", (r) => delete r.models[0].inputs[1].conditional, /^models\[0\]\.inputs\[1\]\.conditional: this does not agree with the condition of the dimension "depth"/],
    ["a flag at a dimension with no condition", (r) => (r.models[0].inputs[2].conditional = true), /^models\[0\]\.inputs\[2\]\.conditional: this does not agree/],
    ["a flag that is not true or false", (r) => (r.models[0].inputs[1].conditional = 1), /^models\[0\]\.inputs\[1\]\.conditional: this is true or false, not 1/],
  ];

  it.each(cases)("gives a precise fault for %s", (_, change, want) => {
    const record = base();
    change(record);
    const found = faults(record);
    expect(found.some((f) => want.test(f)), found.join("\n")).toBe(true);
  });
});

describe("parseResponseRecord of each remaining fault", () => {
  type Json = any;
  const ridge = (): Json => JSON.parse(JSON.stringify(fitResponse(arms(30, "faults"))));
  const table = (): Json => {
    const points = Array.from({ length: 6 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { arm: i % 2 === 0 ? "plain" : "tuned" }, measures: { y: i } }));
    return JSON.parse(JSON.stringify(fitResponse(data([ARM], points))));
  };
  // Each object from JSON.parse has plain fields, so only an array with an added field reaches these two checks.
  const listWith = (kind: string): unknown => Object.assign([], { kind });

  const cases: readonly (readonly [string, () => Json, (r: Json) => void, RegExp])[] = [
    ["a long value in the message", ridge, (r) => (r.dimensions[0].kind = "x".repeat(80)), /^dimensions\[0\]\.kind: .* not "x{59}\.{4}$/],
    ["a value that JSON cannot write", ridge, (r) => (r.name = (): number => 1), /^name: this is text with one character or more, not \(\) => 1\.$/],
    ["a dimension with no kind", ridge, (r) => delete r.dimensions[0].kind, /^dimensions\[0\]\.kind: this field is missing/],
    ["a record with no dimensions", ridge, (r) => delete r.dimensions, /^dimensions: this field is missing/],
    ["a record with no measures", ridge, (r) => delete r.measures, /^measures: this field is missing/],
    ["a record with no points", ridge, (r) => delete r.points, /^points: this field is missing/],
    ["a measure that is not an object", ridge, (r) => (r.measures[0] = 1), /^measures\[0\]: this is an object, not 1/],
    ["a point that is not an object", ridge, (r) => (r.points[0] = 1), /^points\[0\]: this is an object, not 1/],
    ["a point with no values", ridge, (r) => delete r.points[0].values, /^points\[0\]\.values: this field is missing/],
    ["a point with no measures", ridge, (r) => delete r.points[0].measures, /^points\[0\]\.measures: this field is missing/],
    ["point measures that are not an object", ridge, (r) => (r.points[0].measures = 1), /^points\[0\]\.measures: this is an object, not 1/],
    ["a list as a model", ridge, (r) => (r.models[0] = listWith("ridge")), /^models\[0\]: this is an object, not/],
    ["a list as an input", ridge, (r) => (r.models[0].inputs[0] = listWith("number")), /^models\[0\]\.inputs\[0\]: this is an object, not/],
    ["an input with no dimension", ridge, (r) => delete r.models[0].inputs[0].dimension, /^models\[0\]\.inputs\[0\]\.dimension: this field is missing/],
    ["a ridge model with no inputs", ridge, (r) => delete r.models[0].inputs, /^models\[0\]\.inputs: this field is missing/],
    ["a ridge model with no terms", ridge, (r) => delete r.models[0].terms, /^models\[0\]\.terms: this field is missing/],
    ["a term that is not an object", ridge, (r) => (r.models[0].terms[0] = 1), /^models\[0\]\.terms\[0\]: this is an object, not 1/],
    ["a term with no factors", ridge, (r) => delete r.models[0].terms[0].factors, /^models\[0\]\.terms\[0\]\.factors: this field is missing/],
    ["a factor that is not an object", ridge, (r) => (r.models[0].terms[0].factors[0] = 1), /^models\[0\]\.terms\[0\]\.factors\[0\]: this is an object, not 1/],
    ["a table with no dimensions", table, (r) => delete r.models[0].dimensions, /^models\[0\]\.dimensions: this field is missing/],
    ["a table with no cells", table, (r) => delete r.models[0].cells, /^models\[0\]\.cells: this field is missing/],
    ["a cell that is not an object", table, (r) => (r.models[0].cells[0] = 1), /^models\[0\]\.cells\[0\]: this is an object, not 1/],
    ["a cell with no place", table, (r) => delete r.models[0].cells[0].at, /^models\[0\]\.cells\[0\]\.at: this field is missing/],
    ["a fold that is not an object", ridge, (r) => (r.folds[0] = 1), /^folds\[0\]: this is an object, not 1/],
    ["a fold with no held-out list", ridge, (r) => delete r.folds[0].heldOut, /^folds\[0\]\.heldOut: this field is missing/],
    ["a fold with no errors", ridge, (r) => delete r.folds[0].errors, /^folds\[0\]\.errors: this field is missing/],
    ["fold errors that are not an object", ridge, (r) => (r.folds[0].errors = 1), /^folds\[0\]\.errors: this is an object, not 1/],
    ["a fold error that is not an object", ridge, (r) => (r.folds[0].errors.y = 1), /^folds\[0\]\.errors\.y: this is an object, not 1/],
  ];

  it.each(cases)("gives a fault for %s", (_name, make, change, want) => {
    const record = make();
    change(record);
    const found = faults(record);
    expect(found.some((f) => want.test(f)), found.join("\n")).toBe(true);
  });

  it("accepts a fold with no value of a measure, when another fold has a value", () => {
    const record = ridge();
    const held = new Set(record.folds[0].heldOut);
    for (const p of record.points) if (held.has(p.id)) p.measures.y = null;
    record.folds[0].errors.y.n = 0;
    expect(faults(record)).toEqual([]);
  });
});

describe("heldOutError at its limits", () => {
  it("throws for a measure that no fold has", () => {
    const record = fitResponse(arms(30, "unknown measure"));
    expect(() => heldOutError(record, "other")).toThrow(/no fold has an error of the measure "other"/);
  });

  it("gives a null skill for a measure with one value, because the baseline has no error", () => {
    const points = Array.from({ length: 12 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { x: i % 10 }, measures: { y: 3 } }));
    expect(heldOutError(fitResponse(data([X], points)), "y").skill).toBeNull();
  });
});
