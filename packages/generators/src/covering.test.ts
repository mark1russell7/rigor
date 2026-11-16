import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { COVERING_LIMIT, coveringArray, coveringRows, tupleCoverage } from "./covering.ts";
import { random } from "./random.ts";

/** The rows of named dimensions from the level indices of `coveringArray`. */
const named = (levels: readonly number[], rows: readonly number[][]): { dims: Record<string, number[]>; rows: Record<string, number>[] } => ({
  dims: Object.fromEntries(levels.map((size, d) => [`d${d}`, [...Array(size).keys()]])),
  rows: rows.map((row) => Object.fromEntries(row.map((v, d) => [`d${d}`, v]))),
});

const shapes = fc.record({
  levels: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 0, maxLength: 6 }),
  strength: fc.integer({ min: 1, max: 4 }),
  candidates: fc.integer({ min: 1, max: 6 }),
  seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
});

describe("coveringArray", () => {
  it("covers each combination of each t dimensions, with levels in range, and the same seed gives the same rows", () => {
    fc.assert(
      fc.property(shapes, ({ levels, strength, candidates, seed }) => {
        const rows = coveringArray(levels, random(seed), { strength, candidates });
        expect(rows).toEqual(coveringArray(levels, random(seed), { strength, candidates }));
        for (const row of rows) {
          expect(row).toHaveLength(levels.length);
          row.forEach((v, d) => expect(v >= 0 && v < levels[d]!).toBe(true));
        }
        const { dims, rows: rowsByName } = named(levels, rows);
        expect(tupleCoverage(rowsByName, dims, strength).share).toBe(1);
        // A row holds one combination of each set of t dimensions, so the largest product of t levels is a lower bound.
        const t = Math.min(strength, levels.length);
        const largest = [...levels].sort((a, b) => b - a).slice(0, t).reduce((p, n) => p * n, 1);
        expect(rows.length).toBeGreaterThanOrEqual(largest);
      }),
      { numRuns: 150 },
    );
  });

  it("gives the full product when the strength is the count of dimensions or more", () => {
    const rows = coveringArray([2, 3, 2], random(4), { strength: 3 });
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((row) => row.join(""))).size).toBe(12);
    expect(coveringArray([3], random(1)).map((row) => row[0]).sort()).toEqual([0, 1, 2]);
    expect(coveringArray([], random(1))).toEqual([[]]);
  });

  it("closes the combinations with one candidate for each row, also when the greedy row misses each open combination", () => {
    for (let seed = 0; seed < 20; seed++) {
      const levels = [1, 2, 2, 3, 2];
      const { dims, rows } = named(levels, coveringArray(levels, random(seed), { strength: 4, candidates: 1 }));
      expect(tupleCoverage(rows, dims, 4).missing).toEqual([]);
    }
  });

  it("refuses a dimension with no level, bad options and too many combinations", () => {
    const r = random(1);
    expect(() => coveringArray([2, 0], r)).toThrow(RangeError);
    expect(() => coveringArray([2, 1.5], r)).toThrow(RangeError);
    expect(() => coveringArray([2, 2], r, { strength: 0 })).toThrow(RangeError);
    expect(() => coveringArray([2, 2], r, { strength: 1.5 })).toThrow(RangeError);
    expect(() => coveringArray([2, 2], r, { candidates: 0 })).toThrow(RangeError);
    expect(() => coveringArray([1000, 1000, 1000], r, { strength: 3 })).toThrow(/more than/);
    expect(COVERING_LIMIT).toBe(10_000_000);
  });
});

describe("coveringRows", () => {
  const dims = { size: ["s", "m", "l"], shape: ["rect", "circle", "polygon"], count: ["1", "10"], edges: ["none", "few", "many", "dense"] };

  it("keeps the rows of the pairwise copy in layout-contract, from the stream pairwise of the seed", () => {
    // The record comes from `pairwise(dims, 1)` of `packages/joint` in `layout-contract`.
    const record = ["l rect 10 few", "l polygon 1 many", "m circle 10 many", "s polygon 10 dense", "m rect 1 none", "s circle 1 few"];
    const more = ["l circle 1 dense", "l circle 10 none", "s rect 10 many", "m polygon 1 few", "s polygon 1 none", "m rect 10 dense"];
    const rows = coveringRows(dims, random(1).fork("pairwise"));
    expect(rows.map((row) => Object.values(row).join(" "))).toEqual([...record, ...more]);
    expect(Object.keys(rows[0]!)).toEqual(["size", "shape", "count", "edges"]);
  });

  it("gives the values of each dimension, with their type", () => {
    const rows = coveringRows({ on: [true, false], n: [1, 2, 3] }, random(2));
    expect(rows).toHaveLength(6);
    expect(tupleCoverage(rows, { on: [true, false], n: [1, 2, 3] }).share).toBe(1);
    expect(rows.every((row) => typeof row["on"] === "boolean" && typeof row["n"] === "number")).toBe(true);
  });
});

describe("tupleCoverage", () => {
  const dims = { a: ["x", "y"], b: [1, 2], c: ["p", "q"] };

  it("counts the pairs that the rows hold, and lists the others in the order of the dimensions", () => {
    const coverage = tupleCoverage([{ a: "x", b: 1, c: "p", extra: 9 }, { a: "y", b: "2", c: "q" }], dims);
    expect([coverage.tuples, coverage.covered, coverage.share]).toEqual([12, 6, 0.5]);
    expect(coverage.missing).toEqual(["a=x&b=2", "a=y&b=1", "a=x&c=q", "a=y&c=p", "b=1&c=q", "b=2&c=p"]);
  });

  it("counts the combinations of strength 3, and of all the dimensions when there are fewer", () => {
    expect(tupleCoverage([{ a: "x", b: 1, c: "p" }], dims, 3)).toEqual({ tuples: 8, covered: 1, share: 1 / 8, missing: expect.any(Array) });
    expect(tupleCoverage([{ a: "x" }], { a: ["x", "y"] }).missing).toEqual(["a=y"]);
    expect(tupleCoverage([], {})).toEqual({ tuples: 1, covered: 0, share: 0, missing: [""] });
    expect(tupleCoverage([{}], {}).share).toBe(1);
    expect(tupleCoverage([], { a: [], b: ["x"] })).toEqual({ tuples: 0, covered: 0, share: 1, missing: [] });
  });

  it("refuses a bad strength and too many combinations", () => {
    expect(() => tupleCoverage([], dims, 0)).toThrow(RangeError);
    const wide = { a: [...Array(4000).keys()], b: [...Array(4000).keys()] };
    expect(() => tupleCoverage([], wide)).toThrow(/more than/);
  });
});
