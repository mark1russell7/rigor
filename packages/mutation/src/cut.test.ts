import { describe, expect, it } from "vitest";
import { costMapOf, cutByCost, lineWeights, parseCostMaps, plannedMs, segmentsOf, weightedFiles, type WeightedFile } from "./cut.ts";

const TEXT = ["export function a() {", "  return 1;", "}", "export function a() {", "}", "const x = 1;", "// the end"].join("\n");

describe("segmentsOf", () => {
  it("ends a segment on each closing line, and keys it by its first declaration", () => {
    expect(segmentsOf(TEXT)).toEqual([
      { key: "a", start: 1, end: 3 },
      { key: "a#2", start: 4, end: 5 },
      { key: "x", start: 6, end: 7 },
    ]);
  });

  it("gives the key @n to a segment with no declaration, and a statement is not a declaration", () => {
    expect(segmentsOf("// c\n}\n")).toEqual([
      { key: "@1", start: 1, end: 2 },
      { key: "@2", start: 3, end: 3 },
    ]);
    expect(segmentsOf("if (x) {\n}\nfunction b() {\n}").map((s) => s.key)).toEqual(["@1", "b"]);
  });
});

describe("costMapOf and lineWeights", () => {
  it("adds the net time of the plan lines of each segment, and drops a line out of the text", () => {
    const lines = [[2, 1, 0, 10], [5, 2, 0, 4], [7, 1, 0, 6], [9, 1, 0, 100]] as const;
    expect(costMapOf(TEXT, "r1", lines)).toEqual({ run: "r1", segments: { a: 10, "a#2": 4, x: 6 } });
    expect(costMapOf(TEXT, "r1", [])).toEqual({ run: "r1", segments: { a: 0, "a#2": 0, x: 0 } });
  });

  // A new segment has a cost too: the mean cost of a line of the segments that the map names.
  it("spreads the cost of a segment over its lines, and gives a new segment the mean cost of a line", () => {
    expect(lineWeights(TEXT, { run: "r1", segments: { a: 30, x: 4 } })).toEqual([10, 10, 10, 6.8, 6.8, 2, 2]);
    expect(lineWeights(TEXT, { run: "r1", segments: {} })).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

describe("weightedFiles", () => {
  it("gives a file with no map the mean weight of a line of the files with a map, and 1 with no map", () => {
    const texts = [
      { path: "a.ts", text: "x\ny" },
      { path: "b.ts", text: "z" },
    ];
    expect(weightedFiles(texts, { "a.ts": { run: "r1", segments: { "@1": 8 } } })).toEqual([
      { path: "a.ts", lines: ["x", "y"], weights: [4, 4] },
      { path: "b.ts", lines: ["z"], weights: [4] },
    ]);
    expect(weightedFiles(texts).map((f) => f.weights)).toEqual([[1, 1], [1]]);
  });
});

describe("cutByCost", () => {
  const files = (last: number): WeightedFile[] => [
    { path: "a.ts", lines: ["function a() {", "  x;", "}", "function b() {", "}"], weights: [1, 1, 1, 1, 1] },
    { path: "b.ts", lines: ["const c = 1;"], weights: [last] },
  ];

  it("ends a part on a closing line or at the end of a file, with the smallest largest part", () => {
    expect(cutByCost(files(5), 2)).toEqual([["a.ts"], ["b.ts"]]);
    expect(cutByCost(files(1), 2)).toEqual([["a.ts:1-3"], ["a.ts:4-5", "b.ts"]]);
    expect(cutByCost(files(1), 3)).toEqual([["a.ts:1-3"], ["a.ts:4-5"], ["b.ts"]]);
    expect(cutByCost(files(1), 1)).toEqual([["a.ts", "b.ts"]]);
  });

  it("refuses a count of parts with too few closing lines", () => {
    expect(() => cutByCost(files(1), 4)).toThrow("the files have 3 places for the end of a part, and the cut needs 4");
  });
});

describe("plannedMs", () => {
  it("adds the weights of the lines of the entries", () => {
    const files = [
      { path: "a.ts", lines: ["", "", "", "", ""], weights: [1, 2, 3, 4, 5] },
      { path: "b.ts", lines: [""], weights: [10] },
    ];
    expect(plannedMs(["a.ts:2-4", "b.ts"], files)).toBe(19);
    expect(plannedMs(["a.ts", "c.ts"], files)).toBe(15);
  });
});

describe("parseCostMaps", () => {
  it("reads the cost maps, and refuses maps of another form", () => {
    const maps = { lib: { "src/a.ts": { run: "1", segments: { a: 2 } } } };
    expect(parseCostMaps(maps)).toBe(maps);
    for (const bad of [null, [], { lib: 1 }, { lib: { "a.ts": { run: 1, segments: {} } } }, { lib: { "a.ts": { run: "1", segments: { a: -1 } } } }]) {
      expect(() => parseCostMaps(bad)).toThrow(/the cost maps are not an object of packages/);
    }
  });
});
