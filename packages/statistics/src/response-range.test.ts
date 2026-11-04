import { describe, expect, it } from "vitest";
import {
  type ResponseData,
  type ResponseDimension,
  type ResponseMeasure,
  type ResponsePoint,
  type ResponseRecord,
  RESPONSE_RECORDS_SCHEMA,
  fitResponse,
  parseResponseRecord,
  predictResponse,
  responseCells,
  sliceResponse,
  surfaceResponse,
  whenHolds,
} from "./index.ts";

const SHARE: ResponseMeasure = { id: "share", label: "Share", unit: "", direction: "higher" };
const X: ResponseDimension = { id: "x", label: "X", kind: "continuous", range: [0, 10], unit: "" };
const Z: ResponseDimension = { id: "z", label: "Z", kind: "continuous", range: [0, 10], unit: "" };
const ARM: ResponseDimension = { id: "arm", label: "Arm", kind: "categorical", levels: ["plain", "tuned", "deep"], unit: "" };
const DEPTH: ResponseDimension = { id: "depth", label: "Depth", kind: "continuous", range: [1, 4], unit: "", when: { dimension: "arm", levels: ["deep"] } };

/** A share that grows with `x`, with a small noise from a fixed pattern. */
const points: ResponsePoint[] = Array.from({ length: 11 }, (_, x) =>
  Array.from({ length: 11 }, (_, z): ResponsePoint => ({ id: `p${x}.${z}`, values: { x, z }, measures: { share: Math.min(1, Math.max(0, x / 10 + (((x * 3 + z * 5) % 7) - 3) * 0.002)) } })),
).flat();

const data: ResponseData = { schema: RESPONSE_RECORDS_SCHEMA, name: "test", dimensions: [X, Z], measures: [SHARE], points };
const fit = fitResponse(data);
/** The same fit, with a range that the fitted values pass at each end. Only a view reads it, so the points can be outside. */
const tight: ResponseRecord = { ...fit, measures: [{ ...SHARE, range: [0.2, 0.8] }] };

describe("the range of a measure", () => {
  it("moves each place of a slice inside the range, and it says so", () => {
    const open = sliceResponse(fit, "share", { vary: "x" });
    const closed = sliceResponse(tight, "share", { vary: "x" });
    expect(open.clipped).toBe(0);
    expect(open.curve.every((c) => c.clipped === undefined)).toBe(true);
    expect(closed.clipped).toBeGreaterThan(0);
    closed.curve.forEach((c, i) => {
      const raw = open.curve[i]!;
      expect([c.low, c.value, c.high].every((v) => v >= 0.2 && v <= 0.8)).toBe(true);
      expect(c.low).toBeLessThanOrEqual(c.value);
      expect(c.value).toBeLessThanOrEqual(c.high);
      const moved = raw.low < 0.2 || raw.high > 0.8;
      expect(c.clipped === true).toBe(moved);
      if (!moved) expect(c).toEqual(raw);
    });
    expect(closed.clipped).toBe(closed.curve.filter((c) => c.clipped === true).length);
  });

  it("clips a place of a surface in the same way", () => {
    const closed = surfaceResponse(tight, "share", { vary: ["x", "z"], steps: 5 });
    const cells = closed.cells.flat();
    expect(closed.clipped).toBeGreaterThan(0);
    expect(closed.clipped).toBe(cells.filter((c) => c.clipped === true).length);
    expect(cells.every((c) => c.low >= 0.2 && c.high <= 0.8)).toBe(true);
  });

  it("is not in the fit, and predictResponse gives the fitted value", () => {
    const ranged = fitResponse({ ...data, measures: [{ ...SHARE, range: [0, 1] }] });
    expect(ranged.models).toEqual(fit.models);
    expect(ranged.folds).toEqual(fit.folds);
    const model = tight.models[0]!;
    const at = { x: 10, z: 5 };
    expect(predictResponse(model, at)).toBeGreaterThan(0.8);
    expect(sliceResponse(tight, "share", { vary: "x", hold: { z: 5 } }).curve.at(-1)?.value).toBe(0.8);
  });

  it("stays in a record that parses, and the views use it", () => {
    const ranged = fitResponse({ ...data, measures: [{ ...SHARE, range: [0, 1] }] });
    const parsed = parseResponseRecord(JSON.parse(JSON.stringify(ranged)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.measures[0]?.range).toEqual([0, 1]);
    expect(sliceResponse(parsed.record, "share", { vary: "x" }).curve.every((c) => c.high <= 1 && c.low >= 0)).toBe(true);
  });

  it("refuses a bad range, and a measured value outside it", () => {
    const paths = (measure: unknown): string[] => {
      const parsed = parseResponseRecord(JSON.parse(JSON.stringify({ ...fit, measures: [measure] })));
      return parsed.ok ? [] : parsed.faults.map((f) => f.path);
    };
    expect(paths({ ...SHARE, range: [1, 0] })).toEqual(["measures[0].range"]);
    expect(paths({ ...SHARE, range: [0] })).toEqual(["measures[0].range"]);
    expect(paths({ ...SHARE, range: [0, "1"] })).toEqual(["measures[0].range"]);
    const outside = paths({ ...SHARE, range: [0, 0.5] });
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.every((path) => path.endsWith(".measures.share"))).toBe(true);
  });

  it("does not ask a value of null to be in the range", () => {
    const withNull: ResponsePoint[] = [...points.slice(1), { id: "p0.0", values: { x: 0, z: 0 }, measures: { share: null } }];
    const ranged = fitResponse({ ...data, points: withNull, measures: [{ ...SHARE, range: [0, 1] }] });
    expect(parseResponseRecord(JSON.parse(JSON.stringify(ranged))).ok).toBe(true);
  });
});

describe("responseCells", () => {
  const record = { dimensions: [X, Z, ARM, DEPTH] };

  it("counts a continuous axis by steps and a level axis by its levels", () => {
    expect(responseCells(record, "x")).toBe(33);
    expect(responseCells(record, "x", 5)).toBe(5);
    expect(responseCells(record, "arm", 5)).toBe(3);
    expect(responseCells(record, ["x", "z"], 5)).toBe(25);
    expect(responseCells(record, ["x", "arm"], 5)).toBe(15);
  });

  it("gives the size of the view", () => {
    const slice = sliceResponse(fit, "share", { vary: "x", steps: 7 });
    const surface = surfaceResponse(fit, "share", { vary: ["x", "z"], steps: 4 });
    expect(responseCells(fit, "x", 7)).toBe(slice.curve.length);
    expect(responseCells(fit, ["x", "z"], 4)).toBe(surface.cells.flat().length);
  });

  it("refuses an unknown dimension, one dimension named two times, and a bad steps", () => {
    expect(() => responseCells(record, "nothing")).toThrow(RangeError);
    expect(() => responseCells(record, ["x", "x"])).toThrow(RangeError);
    expect(() => responseCells(record, "x", 1)).toThrow(RangeError);
    expect(() => responseCells(record, "x", 2.5)).toThrow(RangeError);
  });
});

describe("whenHolds", () => {
  it("is the rule of a conditional dimension", () => {
    expect(whenHolds(DEPTH, { arm: "deep" })).toBe(true);
    expect(whenHolds(DEPTH, { arm: "plain" })).toBe(false);
    expect(whenHolds(DEPTH, {})).toBe(false);
    expect(whenHolds(X, {})).toBe(true);
  });
});
