import { describe, expect, it } from "vitest";
import { mergeCaseModules, moduleListGaps } from "./index.ts";

describe("mergeCaseModules", () => {
  it("merges the cases of the modules in their order, and names the module of each case", () => {
    const merged = mergeCaseModules({ "b.ts": { "b.one": 1, "b.two": 2 }, "a.ts": { "a.one": 3 } });
    expect(Object.keys(merged.cases)).toEqual(["b.one", "b.two", "a.one"]);
    expect(merged.cases).toEqual({ "b.one": 1, "b.two": 2, "a.one": 3 });
    expect(merged.moduleOf).toEqual({ "b.one": "b.ts", "b.two": "b.ts", "a.one": "a.ts" });
  });

  it("refuses two cases with one name, and names the two modules", () => {
    expect(() => mergeCaseModules({ "a.ts": { same: 1 }, "b.ts": { same: 2 } })).toThrow(/"same" is in the modules "a.ts" and "b.ts"/);
  });

  it("keeps a module with no case, so the folder check still finds it in the list", () => {
    expect(mergeCaseModules({ "a.ts": { x: 1 }, "empty.ts": {} }).cases).toEqual({ x: 1 });
  });

  it("makes an own key of each case name, also of __proto__", () => {
    const module = JSON.parse('{"__proto__": 7}') as Record<string, number>;
    const merged = mergeCaseModules({ "a.ts": module });
    expect(Object.hasOwn(merged.cases, "__proto__")).toBe(true);
    expect(Object.keys(merged.moduleOf)).toEqual(["__proto__"]);
  });

  it("refuses an empty list, a module that is not a record and an empty case name", () => {
    expect(() => mergeCaseModules({})).toThrow(RangeError);
    expect(() => mergeCaseModules({ "a.ts": [1] as unknown as Record<string, number> })).toThrow(RangeError);
    expect(() => mergeCaseModules({ "a.ts": { "": 1 } })).toThrow(/empty name/);
  });
});

describe("moduleListGaps", () => {
  it("gives the modules of the folder that are not in the list, and the listed modules that are not in the folder", () => {
    expect(moduleListGaps(["c.ts", "a.ts", "b.ts"], ["b.ts", "a.ts", "z.ts"])).toEqual({ unlisted: ["c.ts"], missing: ["z.ts"] });
  });

  it("gives no gap for the same modules in another order", () => {
    expect(moduleListGaps(["a.ts", "b.ts"], ["b.ts", "a.ts", "a.ts"])).toEqual({ unlisted: [], missing: [] });
  });

  it("refuses a name that is not a string or is empty", () => {
    expect(() => moduleListGaps([""], [])).toThrow(RangeError);
    expect(() => moduleListGaps([], [1 as unknown as string])).toThrow(RangeError);
  });
});
