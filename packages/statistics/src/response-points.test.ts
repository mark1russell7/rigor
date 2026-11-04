import { createHash } from "node:crypto";
import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import {
  type ResponseData,
  type ResponseDimension,
  type ResponseMeasure,
  type ResponsePoint,
  type ResponseRecord,
  type RidgeResponseModel,
  RESPONSE_RECORDS_SCHEMA,
  fitResponse,
  heldOutError,
  heldOutErrorAt,
  parseResponseRecord,
  sliceResponse,
  surfaceResponse,
} from "./index.ts";

/* ---------- Helpers ---------- */

const Y: ResponseMeasure = { id: "y", label: "Y", unit: "", direction: "lower" };
const X: ResponseDimension = { id: "x", label: "X", kind: "continuous", range: [0, 10], unit: "" };
const ARM: ResponseDimension = { id: "arm", label: "Arm", kind: "categorical", levels: ["plain", "tuned"], unit: "" };

// The relative tolerance between the pooled fold error and the error from the stored predictions. The sums differ only by rounding.
const POOL_TOLERANCE = 1e-12;
// The largest difference between the fold errors of the expansion and of its seen terms. A term with no point has the weight 0.
const SEEN_TOLERANCE = 1e-9;

// The cell RMSE with the shift is more than this multiple of the cell RMSE with no shift, at each seed.
const SHIFT_RATIO = 1.5;

const seeds = Array.from({ length: 24 }, (_, i) => i + 1);

const data = (dimensions: readonly ResponseDimension[], points: readonly ResponsePoint[], measures: readonly ResponseMeasure[] = [Y]): ResponseData => ({
  schema: RESPONSE_RECORDS_SCHEMA,
  name: "test",
  dimensions,
  measures,
  points,
});

function good(record: unknown): ResponseRecord {
  const parsed = parseResponseRecord(JSON.parse(JSON.stringify(record)));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.faults));
  return parsed.record;
}

const faults = (record: unknown): string[] => {
  const parsed = parseResponseRecord(record);
  return parsed.ok ? [] : parsed.faults.map((f) => `${f.path}: ${f.message}`);
};

// No function of Math goes into this data, so its bytes are equal in each JavaScript engine.
function golden(): ResponseData {
  const points = Array.from({ length: 40 }, (_, i): ResponsePoint => {
    const x = i % 7;
    const arm = i % 3 === 0 ? "plain" : "tuned";
    return { id: `p${i}`, group: `g${i % 11}`, values: { x, arm }, measures: { y: i % 9 === 0 ? null : 3 + 2 * x + (arm === "tuned" ? 1 : 0) + ((i * 7919) % 13) / 100 } };
  });
  return { ...data([X, ARM], points), name: "golden" };
}

function noisy(seed: number, n = 120): ResponseData {
  const r = random(`points ${seed}`);
  const points = Array.from({ length: n }, (_, i): ResponsePoint => {
    const x = r.range(0, 10);
    const arm = r.chance(0.5) ? "plain" : "tuned";
    const y = r.chance(0.1) ? null : 1 + 10 ** (x / 5) + (arm === "tuned" ? 2 : 0) + r.normal(0, 0.05);
    return { id: `p${i}`, group: `g${i % 30}`, values: { x, arm }, measures: { y } };
  });
  return data([X, ARM], points);
}

const allIds = (record: ResponseRecord): readonly string[] => record.points.map((p) => p.id);

const relative = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);

const inCell = (p: ResponsePoint): boolean => p.values["arm"] === "tuned" && (p.values["x"] as number) > 8;

// The draws of one seed are the same for each shift, so the two fits differ only by the shift of the cell.
function shiftedCell(seed: number, shift: number): ResponseRecord {
  const r = random(`cell ${seed}`);
  const points = Array.from({ length: 200 }, (_, i): ResponsePoint => {
    const x = r.range(0, 10);
    const arm = i % 2 === 0 ? "plain" : "tuned";
    const shifted = arm === "tuned" && x > 8;
    return { id: `p${i}`, values: { x, arm }, measures: { y: x + (shifted ? shift : 0) + r.normal(0, 0.05) } };
  });
  return good(fitResponse(data([X, ARM], points), { seed, degree: 1, outOfFold: true }));
}

/** The largest relative difference between the pooled fold error and the error of all the points. */
function poolGap(record: ResponseRecord, measure: string): number {
  const pooled = heldOutError(record, measure);
  const chosen = heldOutErrorAt(record, measure, allIds(record));
  expect(chosen.n).toBe(pooled.n);
  expect(chosen.folds).toBe(pooled.folds);
  return Math.max(relative(chosen.mae, pooled.mae), relative(chosen.rmse, pooled.rmse), relative(chosen.baselineMae, pooled.baselineMae));
}

/* ---------- Out-of-fold predictions ---------- */

describe("the option outOfFold", () => {
  it("keeps the bytes of a record with no option", () => {
    const bytes = JSON.stringify(fitResponse(golden()));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("00aa7883d824a7f31debf05be569b3fdab4afa50dd704ba2718389f4234c3ef1");
    expect(JSON.stringify(fitResponse(golden(), { outOfFold: false }))).toBe(bytes);
  });

  it("adds only the field predictions", () => {
    const record = JSON.parse(JSON.stringify(fitResponse(golden(), { outOfFold: true }))) as { folds: { predictions?: unknown }[] };
    for (const fold of record.folds) {
      expect(fold.predictions).toBeDefined();
      delete fold.predictions;
    }
    expect(JSON.stringify(record)).toBe(JSON.stringify(fitResponse(golden())));
  });

  it("stores a prediction of each held-out point with a value, and of no other point", () => {
    const record = good(fitResponse(golden(), { outOfFold: true }));
    const byId = new Map(record.points.map((p) => [p.id, p]));
    for (const fold of record.folds) {
      const want = fold.heldOut.filter((id) => byId.get(id)!.measures["y"] !== null);
      expect(Object.keys(fold.predictions!["y"]!).sort()).toEqual([...want].sort());
      expect(want).toHaveLength(fold.errors["y"]!.n);
    }
  });

  it("gives the same bytes for each order of the points", () => {
    const options = { outOfFold: true, seed: 3 };
    const forward = golden();
    const backward = { ...forward, points: [...forward.points].reverse() };
    expect(JSON.stringify(fitResponse(backward, options).folds)).toBe(JSON.stringify(fitResponse(forward, options).folds));
  });

  it("keeps a model of a table on the same footing", () => {
    const points = Array.from({ length: 24 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { arm: i % 2 === 0 ? "plain" : "tuned" }, measures: { y: i % 4 } }));
    const record = good(fitResponse(data([ARM], points), { outOfFold: true }));
    expect(record.models[0]!.kind).toBe("table");
    expect(poolGap(record, "y")).toBeLessThanOrEqual(POOL_TOLERANCE);
  });
});

describe("heldOutErrorAt", () => {
  it("gives the pooled fold error for all the points, to the tolerance, at each seed", () => {
    const gaps = seeds.map((s) => poolGap(good(fitResponse(noisy(s), { seed: s, outOfFold: true })), "y"));
    const worst = Math.max(...gaps);
    expect(worst, `seed ${gaps.indexOf(worst) + 1}`).toBeLessThanOrEqual(POOL_TOLERANCE);
  });

  it("gives the pooled fold error on a log scale with a floor, to the tolerance, at each seed", () => {
    const logged = (seed: number): ResponseData => {
      const base = noisy(seed);
      return { ...base, points: base.points.map((p, i) => (i % 17 === 0 ? { ...p, measures: { y: 0 } } : p)) };
    };
    const gaps = seeds.map((s) => poolGap(good(fitResponse(logged(s), { seed: s, outOfFold: true, log: ["y"], logFloor: 0.5 })), "y"));
    const worst = Math.max(...gaps);
    expect(worst, `seed ${gaps.indexOf(worst) + 1}`).toBeLessThanOrEqual(POOL_TOLERANCE);
  });

  it("splits the pooled error between a cell and the other points, to the tolerance, at each seed", () => {
    const gaps = seeds.map((s) => {
      const record = shiftedCell(s, 2);
      const cell = heldOutErrorAt(record, "y", record.points.filter(inCell).map((p) => p.id));
      const rest = heldOutErrorAt(record, "y", record.points.filter((p) => !inCell(p)).map((p) => p.id));
      const pooled = heldOutError(record, "y");
      expect(cell.n + rest.n).toBe(pooled.n);
      const absolute = cell.n * cell.mae + rest.n * rest.mae;
      const square = cell.n * cell.rmse ** 2 + rest.n * rest.rmse ** 2;
      return Math.max(relative(absolute, pooled.n * pooled.mae), relative(square, pooled.n * pooled.rmse ** 2));
    });
    const worst = Math.max(...gaps);
    expect(worst, `seed ${gaps.indexOf(worst) + 1}`).toBeLessThanOrEqual(POOL_TOLERANCE);
  });

  it("finds a bad cell: a shift of the cell raises the error of the cell, at each seed", () => {
    const cellRmse = (seed: number, shift: number): number => {
      const record = shiftedCell(seed, shift);
      return heldOutErrorAt(record, "y", record.points.filter(inCell).map((p) => p.id)).rmse;
    };
    const ratios = seeds.map((s) => cellRmse(s, 2) / cellRmse(s, 0));
    const worst = Math.min(...ratios);
    expect(worst, `seed ${ratios.indexOf(worst) + 1}`).toBeGreaterThan(SHIFT_RATIO);
  });

  it("accepts a point with an id that is the name of a field of each object", () => {
    const input = golden();
    const points = input.points.map((p, i) => (i === 1 ? { ...p, id: "__proto__" } : p));
    const record = good(fitResponse({ ...input, points }, { outOfFold: true }));
    expect(poolGap(record, "y")).toBeLessThanOrEqual(POOL_TOLERANCE);
    expect(heldOutErrorAt(record, "y", ["__proto__"]).n).toBe(1);
  });

  it("gives the error of a hand calculation for two points", () => {
    const record = good(fitResponse(golden(), { outOfFold: true }));
    const fold = record.folds[0]!;
    const [a, b] = Object.keys(fold.predictions!["y"]!) as [string, string];
    const error = (id: string): number => (record.points.find((p) => p.id === id)!.measures["y"] as number) - fold.predictions!["y"]![id]!;
    const result = heldOutErrorAt(record, "y", [a, b]);
    expect(result.n).toBe(2);
    expect(result.folds).toBe(1);
    expect(result.mae).toBeCloseTo((Math.abs(error(a)) + Math.abs(error(b))) / 2, 12);
    expect(result.rmse).toBeCloseTo(Math.sqrt((error(a) ** 2 + error(b) ** 2) / 2), 12);
  });

  it("counts no point with null", () => {
    const record = good(fitResponse(golden(), { outOfFold: true }));
    const missing = record.points.find((p) => p.measures["y"] === null)!;
    const scored = record.points.find((p) => p.measures["y"] !== null)!;
    expect(heldOutErrorAt(record, "y", [missing.id, scored.id]).n).toBe(1);
  });

  it("gives a null skill when the baseline has no error", () => {
    const points = Array.from({ length: 12 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { x: i % 10 }, measures: { y: 3 } }));
    const record = good(fitResponse(data([X], points), { outOfFold: true }));
    expect(heldOutErrorAt(record, "y", allIds(record)).skill).toBeNull();
  });

  it("throws for each bad request", () => {
    const plain = fitResponse(golden());
    const record = fitResponse(golden(), { outOfFold: true });
    const missing = record.points.find((p) => p.measures["y"] === null)!.id;
    expect(() => heldOutErrorAt(record, "other", [])).toThrow(/no model of the measure "other"/);
    expect(() => heldOutErrorAt(plain, "y", allIds(plain))).toThrow(/no predictions of the measure "y"\. Fit it with the option outOfFold/);
    expect(() => heldOutErrorAt(record, "y", ["none"])).toThrow(/no point "none"/);
    expect(() => heldOutErrorAt(record, "y", ["p1", "p1"])).toThrow(/a repeated id/);
    expect(() => heldOutErrorAt(record, "y", [])).toThrow(/no chosen point has a prediction/);
    expect(() => heldOutErrorAt(record, "y", [missing])).toThrow(/no chosen point has a prediction/);
  });
});

describe("parseResponseRecord of predictions", () => {
  type Json = any;
  const base = (): Json => JSON.parse(JSON.stringify(fitResponse(golden(), { outOfFold: true })));
  const held = (r: Json, value: boolean): string => r.folds[0].heldOut.find((id: string) => (r.points.find((p: Json) => p.id === id).measures.y === null) !== value);
  const other = (r: Json): string => r.folds[1].heldOut[0];

  it("accepts the record of a fit", () => {
    expect(faults(base())).toEqual([]);
  });

  const cases: readonly (readonly [string, (r: Json) => void, RegExp])[] = [
    ["a value that is not an object", (r) => (r.folds[0].predictions = 1), /^folds\[0\]\.predictions: this is an object, not 1/],
    ["an unknown measure", (r) => (r.folds[0].predictions.other = {}), /^folds\[0\]\.predictions\.other: .* has no such field/],
    ["a measure that is not an object", (r) => (r.folds[0].predictions.y = 1), /^folds\[0\]\.predictions\.y: this is an object, not 1/],
    ["a point of another fold", (r) => (r.folds[0].predictions.y[other(r)] = 1), /^folds\[0\]\.predictions\.y\.p\d+: this fold has no held-out point/],
    ["an unknown point", (r) => (r.folds[0].predictions.y["none"] = 1), /^folds\[0\]\.predictions\.y\.none: this fold has no held-out point "none"/],
    ["a point with null", (r) => (r.folds[0].predictions.y[held(r, false)] = 1), /^folds\[0\]\.predictions\.y\.p\d+: this fold has no held-out point/],
    ["a value that is not finite", (r) => (r.folds[0].predictions.y[held(r, true)] = null), /^folds\[0\]\.predictions\.y\.p\d+: this is a finite number, not null/],
    ["an absent prediction", (r) => delete r.folds[0].predictions.y[held(r, true)], /^folds\[0\]\.predictions\.y\.p\d+: this held-out point has no prediction/],
    ["a prediction with no error", (r) => delete r.folds[0].errors.y, /^folds\[0\]\.predictions\.y: this fold has no error of this measure/],
    ["a fold with no predictions", (r) => delete r.folds[1].predictions, /^folds\[1\]\.predictions: another fold has predictions of the measure "y"/],
    ["a fold with no predictions of the measure", (r) => delete r.folds[1].predictions.y, /^folds\[1\]\.predictions: another fold has predictions of the measure "y"/],
  ];

  it.each(cases)("gives a fault for %s", (_name, change, want) => {
    const record = base();
    change(record);
    const found = faults(record);
    expect(found.some((f) => want.test(f)), found.join("\n")).toBe(true);
  });
});

/* ---------- Reasons ---------- */

describe("the reason that a measure is absent", () => {
  const reasons = [
    { id: "infeasible", label: "Infeasible" },
    { id: "budget", label: "Out of budget" },
  ];

  function withReasons(): ResponseData {
    const base = golden();
    const reasonAt = (i: number): string | undefined => (i % 18 === 0 ? "infeasible" : i % 9 === 0 && i % 2 === 1 ? "budget" : undefined);
    const points = base.points.map((p, i): ResponsePoint => {
      const reason = reasonAt(i);
      return reason === undefined ? p : { ...p, absent: { y: reason } };
    });
    return { ...base, reasons, points };
  }

  it("keeps the models and the folds of the same data with no reasons", () => {
    const stated = fitResponse(withReasons());
    const plain = fitResponse(golden());
    expect(JSON.stringify(stated.models)).toBe(JSON.stringify(plain.models));
    expect(JSON.stringify(stated.folds)).toBe(JSON.stringify(plain.folds));
  });

  it("keeps the reasons in the record, and the record is good", () => {
    const record = good(fitResponse(withReasons()));
    expect(record.reasons).toEqual(reasons);
    expect(record.points.filter((p) => p.absent !== undefined)).toHaveLength(5);
  });

  it("accepts null with no reason, and a record with a list of no reasons", () => {
    const record = JSON.parse(JSON.stringify(fitResponse(golden())));
    expect(faults(record)).toEqual([]);
    record.reasons = [];
    expect(faults(record)).toEqual([]);
  });

  it("gives each absent point of a slice its reason, and gives null for no stated reason", () => {
    const base = withReasons();
    const points = base.points.map((p, i) => (i === 0 ? { ...p, values: { ...p.values, x: 3 } } : p));
    const record = good(fitResponse({ ...base, points }));
    const slice = sliceResponse(record, "y", { vary: "x", hold: { arm: "plain" } });
    const want = record.points.filter((p) => p.measures["y"] === null && p.values["arm"] === "plain");
    expect(want.length).toBeGreaterThan(0);
    expect(slice.absent.map((p) => [p.id, p.at, p.reason, p.group])).toEqual(want.map((p) => [p.id, p.values["x"], p.absent?.["y"] ?? null, p.group]));
    expect(slice.points.every((p) => typeof p.value === "number")).toBe(true);
  });

  it("draws a reason apart from no reason", () => {
    const points = golden().points.map((p, i) => (i === 0 ? { ...p, absent: { y: "budget" } } : p));
    const record = good(fitResponse({ ...golden(), reasons, points }));
    const slice = sliceResponse(record, "y", { vary: "x", hold: { arm: "plain" } });
    expect(new Set(slice.absent.map((p) => p.reason))).toEqual(new Set(["budget", null]));
  });

  it("gives each absent point of a surface its reason", () => {
    const B: ResponseDimension = { id: "b", label: "B", kind: "ordinal", levels: [1, 2, 3], unit: "" };
    const points = Array.from({ length: 30 }, (_, i): ResponsePoint => {
      const empty = i % 5 === 0;
      return { id: `p${i}`, values: { x: i % 9, b: 1 + (i % 3) }, measures: { y: empty ? null : i }, ...(empty ? { absent: { y: "budget" } } : {}) };
    });
    const surface = surfaceResponse(good(fitResponse({ ...data([X, B], points), reasons })), "y", { vary: ["x", "b"] });
    expect(surface.absent).toHaveLength(6);
    expect(surface.absent[0]).toEqual({ id: "p0", at: [0, 1], reason: "budget" });
  });

  it("leaves out of a slice a point that does not match the held values", () => {
    const record = good(fitResponse(withReasons()));
    const tuned = sliceResponse(record, "y", { vary: "x", hold: { arm: "tuned" } });
    expect(tuned.absent.every((p) => record.points.find((q) => q.id === p.id)!.values["arm"] === "tuned")).toBe(true);
  });

  type Json = any;
  const base = (): Json => JSON.parse(JSON.stringify(fitResponse(withReasons())));
  const stated = (r: Json): number => r.points.findIndex((p: Json) => p.absent !== undefined);
  const measured = (r: Json): number => r.points.findIndex((p: Json) => p.measures.y !== null);

  const cases: readonly (readonly [string, (r: Json) => void, RegExp])[] = [
    ["a reason on a measure with a number", (r) => (r.points[measured(r)].absent = { y: "budget" }), /^points\[\d+\]\.absent\.y: this measure has a number/],
    ["an id with no declaration", (r) => (r.points[stated(r)].absent = { y: "other" }), /^points\[\d+\]\.absent\.y: the record declares no reason "other"/],
    ["a reason with no list of reasons", (r) => delete r.reasons, /^points\[\d+\]\.absent\.y: the record declares no reason/],
    ["a reason of an unknown measure", (r) => (r.points[stated(r)].absent = { other: "budget" }), /^points\[\d+\]\.absent\.other: .* has no such field/],
    ["a reason map that is not an object", (r) => (r.points[stated(r)].absent = 1), /^points\[\d+\]\.absent: this is an object, not 1/],
    ["a reason id that is not text", (r) => (r.points[stated(r)].absent = { y: 1 }), /^points\[\d+\]\.absent\.y: the record declares no reason 1/],
    ["a list that is not a list", (r) => (r.reasons = 1), /^reasons: this is a list, not 1/],
    ["a declaration that is not an object", (r) => (r.reasons[0] = 1), /^reasons\[0\]: this is an object, not 1/],
    ["a declaration with no id", (r) => delete r.reasons[0].id, /^reasons\[0\]\.id: this field is missing/],
    ["an empty id", (r) => (r.reasons[0].id = ""), /^reasons\[0\]\.id: this is text with one character or more/],
    ["a label that is not text", (r) => (r.reasons[0].label = 1), /^reasons\[0\]\.label: this is text, not 1/],
    ["a repeated id", (r) => (r.reasons[1].id = r.reasons[0].id), /^reasons\[1\]\.id: an earlier item has the id/],
    ["an unknown field", (r) => (r.reasons[0].other = 1), /^reasons\[0\]\.other: .* has no such field/],
    ["a status of a whole point", (r) => (r.points[0].status = "failed"), /^points\[0\]\.status: .* has no such field/],
    ["a meta field", (r) => (r.meta = {}), /^meta: .* has no such field/],
  ];

  it.each(cases)("gives a fault for %s", (_name, change, want) => {
    const record = base();
    change(record);
    const found = faults(record);
    expect(found.some((f) => want.test(f)), found.join("\n")).toBe(true);
  });
});

/* ---------- Seen terms ---------- */

describe("the option interactions: seen", () => {
  const levels = (id: string, n: number): ResponseDimension => ({ id, label: id, kind: "categorical", levels: Array.from({ length: n }, (_, i) => `${id}${i}`), unit: "" });

  // Each level of `a` has rows at one or two levels of `b`, so most products have no point.
  function sparse(seed: number, sizeA: number, sizeB: number): ResponseData {
    const r = random(`sparse ${seed}`);
    const dimensions = [levels("a", sizeA), levels("b", sizeB), X];
    const points = Array.from({ length: sizeA * 6 }, (_, i): ResponsePoint => {
      const a = i % sizeA;
      const b = (a * 3 + (i % 2)) % sizeB;
      return { id: `p${i}`, group: `g${i % 12}`, values: { a: `a${a}`, b: `b${b}`, x: r.range(0, 10) }, measures: { y: a / sizeA + b / sizeB + r.normal(0, 0.05) } };
    });
    return data(dimensions, points);
  }

  const pairs = (record: ResponseRecord): readonly string[] =>
    (record.models[0] as RidgeResponseModel).terms.filter((t) => t.factors.length === 2 && t.factors.every((f) => "level" in f)).map((t) => t.factors.map((f) => ("level" in f ? f.level : "")).join(" "));

  it("keeps each pair of levels with a point, and no other pair", () => {
    const input = sparse(1, 8, 6);
    const record = fitResponse(input, { model: "ridge", interactions: "seen" });
    const want = new Set(input.points.map((p) => `${p.values["a"]} ${p.values["b"]}`));
    expect(new Set(pairs(record))).toEqual(want);
    expect(pairs(record)).toHaveLength(want.size);
  });

  it("gives the fold errors of the full expansion, to the tolerance, at each seed", () => {
    const gaps = seeds.map((s) => {
      const input = sparse(s, 8, 6);
      const seen = heldOutError(fitResponse(input, { model: "ridge", seed: s, interactions: "seen" }), "y");
      const full = heldOutError(fitResponse(input, { model: "ridge", seed: s, interactions: true }), "y");
      return Math.max(Math.abs(seen.rmse - full.rmse), Math.abs(seen.mae - full.mae));
    });
    const worst = Math.max(...gaps);
    expect(worst, `seed ${gaps.indexOf(worst) + 1}`).toBeLessThanOrEqual(SEEN_TOLERANCE);
  });

  it("fits a sparse shape that the full expansion cannot", () => {
    const input = sparse(1, 40, 33);
    expect(() => fitResponse(input, { model: "ridge" })).toThrow(/Set interactions to false or "seen"/);
    const record = good(fitResponse(input, { model: "ridge", interactions: "seen", lambdas: [1] }));
    expect((record.models[0] as RidgeResponseModel).terms.length).toBeLessThan(1024);
  });

  it("applies the limit after the choice", () => {
    const dimensions = [levels("a", 76), levels("b", 33)];
    const points = dimensions[0]!.kind === "categorical" ? Array.from({ length: 76 * 33 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { a: `a${Math.floor(i / 33)}`, b: `b${i % 33}` }, measures: { y: i } })) : [];
    expect(() => fitResponse(data(dimensions, points), { model: "ridge", interactions: "seen" })).toThrow(/the expansion has 2617 terms, and the limit is 1023/);
  });

  it("keeps the order of the expansion", () => {
    const input = sparse(2, 4, 3);
    const seen = (fitResponse(input, { model: "ridge", interactions: "seen" }).models[0] as RidgeResponseModel).terms.map((t) => JSON.stringify(t.factors));
    const full = (fitResponse(input, { model: "ridge", interactions: true }).models[0] as RidgeResponseModel).terms.map((t) => JSON.stringify(t.factors));
    expect(seen).toEqual(full.filter((term) => seen.includes(term)));
    expect(seen.length).toBeLessThan(full.length);
  });

  it("leaves stated terms as they are, and removes each product of two dimensions when false", () => {
    const input = sparse(3, 4, 3);
    const terms = [[{ dimension: "x", power: 1 }], [{ dimension: "a", level: "a0" }, { dimension: "b", level: "b2" }]];
    const stated = fitResponse(input, { model: "ridge", interactions: "seen", terms }).models[0] as RidgeResponseModel;
    expect(stated.terms.map((t) => t.factors)).toEqual(terms);
    const none = fitResponse(input, { model: "ridge", interactions: false }).models[0] as RidgeResponseModel;
    expect(none.terms.every((t) => t.factors.length === 1)).toBe(true);
  });

  it("changes no table", () => {
    const input = data([levels("a", 4), levels("b", 3)], Array.from({ length: 24 }, (_, i): ResponsePoint => ({ id: `p${i}`, values: { a: `a${i % 4}`, b: `b${i % 3}` }, measures: { y: i } })));
    expect(JSON.stringify(fitResponse(input, { interactions: "seen" }))).toBe(JSON.stringify(fitResponse(input)));
  });

  it("keeps the products of a conditional dimension with the levels of its parent that have points", () => {
    const three: ResponseDimension = { id: "arm", label: "Arm", kind: "categorical", levels: ["plain", "tuned", "wide", "unused"], unit: "" };
    const depth: ResponseDimension = { id: "depth", label: "Depth", kind: "continuous", range: [0, 10], unit: "", when: { dimension: "arm", levels: ["tuned", "wide", "unused"] } };
    const points = Array.from({ length: 60 }, (_, i): ResponsePoint => {
      const arm = ["plain", "tuned", "wide"][i % 3] as string;
      return { id: `p${i}`, values: { arm, depth: arm === "plain" ? null : i % 11 }, measures: { y: i % 7 } };
    });
    const model = fitResponse(data([three, depth], points), { interactions: "seen" }).models[0] as RidgeResponseModel;
    const used = model.terms.flatMap((t) => t.factors.flatMap((f) => ("level" in f ? [f.level] : [])));
    expect(used).toContain("tuned");
    expect(used).not.toContain("unused");
  });
});
