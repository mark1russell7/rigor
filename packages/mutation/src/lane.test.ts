import { describe, expect, it } from "vitest";
import { NO_TSCONFIG, PARTIAL_PLUGIN, rewritesTsconfig, strykerConfig } from "./config.ts";
import { changedFiles, globsSelect, packageRuns, parseLane, partErrors, runSelections, select, selectionNames } from "./lane.ts";

const LANE = {
  packages: {
    collections: { dir: "packages/collections", mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/index.ts"], gate: 70, parts: { impl: ["src/impl/**/*.ts"], core: ["src/core/**/*.ts"] } },
    small: { dir: "packages/small", mutate: ["src/**/*.ts"], vitestConfig: "vitest.unit.ts" },
  },
};

describe("parseLane", () => {
  it("accepts a valid lane", () => {
    expect(parseLane(LANE)).toBe(LANE);
  });

  it("accepts the limits of the cost plan", () => {
    const lane = { packages: { a: { dir: "a", mutate: ["x"], staticLimits: { "x.ts": 0, "*": 40 } } }, planPerClock: 7.2, targetMinutes: 90, stopMinutes: 120 };
    expect(parseLane(lane)).toBe(lane);
  });

  it.each([
    [{}, /no object "packages"/],
    [{ packages: {} }, /no packages/],
    [{ packages: { a: { dir: "", mutate: ["x"] } } }, /a: "dir" is not a folder name/],
    [{ packages: { a: { dir: "a", mutate: [] } } }, /a: "mutate" is not a list of globs/],
    [{ packages: { a: { dir: "a", mutate: ["!x"] } } }, /a: "mutate" has only "!" globs/],
    [{ packages: { a: { dir: "a", mutate: ["x"], gate: 101 } } }, /a: "gate" is not a percent/],
    [{ packages: { a: { dir: "a", mutate: ["x"], gate: "90" } } }, /a: "gate" is not a percent/],
    [{ packages: { a: { dir: "a", mutate: ["x"], parts: {} } } }, /a: "parts" is not an object with parts/],
    [{ packages: { a: { dir: "a", mutate: ["x"], parts: { p: ["!y"] } } } }, /a\.p: the part is not a list of globs without "!"/],
    [{ packages: { "a.b": { dir: "a", mutate: ["x"] } } }, /the package name "a\.b"/],
    [{ packages: { a: { dir: "a", mutate: ["x"] } }, disables: 3 }, /"disables" is not a file name/],
    [{ packages: { a: { dir: "a", mutate: ["x"], timeoutMS: 0 } } }, /a: "timeoutMS" is not a positive integer/],
    [{ packages: { a: { dir: "a", mutate: ["x"], dryRunTimeoutMinutes: 1.5 } } }, /a: "dryRunTimeoutMinutes" is not a positive integer/],
    [{ packages: { a: { dir: "a", mutate: ["x"], stryker: [] } } }, /a: "stryker" is not an object/],
    [{ packages: { a: { dir: "a", mutate: ["x"], stryker: { mutate: ["y"] } } } }, /a: "stryker" has "mutate", but the lane owns these keys/],
    [{ packages: { a: { dir: "a", mutate: ["x"], stryker: { thresholds: {}, jsonReporter: {} } } } }, /a: "stryker" has "thresholds", "jsonReporter"/],
    [{ packages: { a: { dir: "a", mutate: ["x"], staticLimits: { "x.ts": -1 } } } }, /a: "staticLimits" is not an object of files, each with a count/],
    [{ packages: { a: { dir: "a", mutate: ["x"], staticLimits: [] } } }, /a: "staticLimits" is not an object of files/],
    [{ packages: { a: { dir: "a", mutate: ["x"] } }, planPerClock: 0 }, /"planPerClock" is not a positive number/],
    [{ packages: { a: { dir: "a", mutate: ["x"] } }, targetMinutes: "100" }, /"targetMinutes" is not a positive number/],
    [{ packages: { a: { dir: "a", mutate: ["x"] } }, stopMinutes: -1 }, /"stopMinutes" is not a positive number/],
    [{ packages: { a: { dir: "a", mutate: ["x"] } }, stopMinutes: 90 }, /"stopMinutes" \(90\) is less than "targetMinutes" \(100\)/],
    [{ packages: { a: { dir: "a", mutate: ["x"] } }, targetMinutes: 150 }, /"stopMinutes" \(140\) is less than "targetMinutes" \(150\)/],
    [{ packages: { a: { dir: "a", mutate: ["x"], cuts: {} } } }, /a: "cuts" is not an object with groups/],
    [{ packages: { a: { dir: "a", mutate: ["x"], cuts: { "g.1": { files: ["x"], count: 2 } } } } }, /a: the group name "g\.1"/],
    [{ packages: { a: { dir: "a", mutate: ["x"], parts: { g: ["x"] }, cuts: { g: { files: ["y"], count: 2 } } } } }, /a: "g" is a part and a group of "cuts"/],
    [{ packages: { a: { dir: "a", mutate: ["x"], cuts: { g: { files: ["x:1-9"], count: 2 } } } } }, /a\.g: "files" is not a list of globs without "!" and without a line range/],
    [{ packages: { a: { dir: "a", mutate: ["x"], cuts: { g: { files: ["!x"], count: 2 } } } } }, /a\.g: "files" is not a list of globs/],
    [{ packages: { a: { dir: "a", mutate: ["x"], cuts: { g: { files: ["x"], count: 0 } } } } }, /a\.g: "count" is not a positive integer/],
    [{ packages: { a: { dir: "a", mutate: ["x"], cuts: { g: { files: ["x"], count: 1.5 } } } } }, /a\.g: "count" is not a positive integer/],
    [{ packages: { a: { dir: "a", mutate: ["x"] } }, costs: "" }, /"costs" is not a file name/],
  ])("refuses %j", (json, message) => {
    expect(() => parseLane(json)).toThrow(message);
  });
});

describe("select", () => {
  const lane = parseLane(LANE);

  it("names each package and each part", () => {
    expect(selectionNames(lane)).toEqual(["collections", "collections.impl", "collections.core", "small"]);
  });

  it("gives the parts of a package with parts for a full run, so no file is in two runs", () => {
    expect(runSelections(lane)).toEqual(["collections.impl", "collections.core", "small"]);
  });

  it("gives the globs of a package", () => {
    expect(select(lane, "collections")).toEqual({ name: "collections", pkg: "collections", dir: "packages/collections", mutate: LANE.packages.collections.mutate, gate: 70, vitestConfig: undefined });
  });

  it("puts the ! globs of the package after the globs of a part", () => {
    expect(select(lane, "collections.impl").mutate).toEqual(["src/impl/**/*.ts", "!src/**/*.test.ts", "!src/index.ts"]);
  });

  it.each(["nope", "collections.nope", "small.part", "collections.impl.x"])("refuses %s and names the selections", (name) => {
    expect(() => select(lane, name)).toThrow(/It has: collections, collections\.impl, collections\.core, small/);
  });
});

describe("the groups of cuts", () => {
  const lane = parseLane({
    packages: {
      lib: { dir: "lib", mutate: ["src/**/*.ts", "!src/**/*.test.ts"], gateOver: "package", parts: { core: ["src/core/*.ts"] }, cuts: { base: { files: ["src/base/*.ts"], count: 3 }, one: { files: ["src/one.ts"], count: 1 } } },
    },
    costs: "costs.json",
  });

  it("names each group and its numbered parts, and a full run reads the numbered parts", () => {
    expect(selectionNames(lane)).toEqual(["lib", "lib.core", "lib.base", "lib.base.1", "lib.base.2", "lib.base.3", "lib.one"]);
    expect(runSelections(lane)).toEqual(["lib.core", "lib.base.1", "lib.base.2", "lib.base.3", "lib.one"]);
    expect(packageRuns(lane, "lib")).toEqual(runSelections(lane));
    expect(packageRuns(lane, "nope")).toEqual([]);
  });

  it("gives a numbered part the entries of its cut, and its full group without a cut", () => {
    const seen: unknown[] = [];
    const cutOf = (pkg: string, cut: unknown, globs: readonly string[]): string[] => {
      seen.push([pkg, cut, globs]);
      return ["src/base/a.ts:10-20"];
    };
    expect(select(lane, "lib.base.2", cutOf)).toMatchObject({ name: "lib.base.2", pkg: "lib", mutate: ["src/base/a.ts:10-20", "!src/**/*.test.ts"], cut: { group: "base", count: 3, index: 1 } });
    expect(seen).toEqual([["lib", { group: "base", count: 3, index: 1 }, ["src/base/*.ts", "!src/**/*.test.ts"]]]);
    expect(select(lane, "lib.base.2").mutate).toEqual(["src/base/*.ts", "!src/**/*.test.ts"]);
    expect(select(lane, "lib.base", cutOf)).not.toHaveProperty("cut");
    expect(select(lane, "lib.base").mutate).toEqual(["src/base/*.ts", "!src/**/*.test.ts"]);
  });

  it.each(["lib.base.0", "lib.base.4", "lib.base.02", "lib.one.1", "lib.core.1", "lib.base.1.1"])("refuses %s", (name) => {
    expect(() => select(lane, name)).toThrow(/the lane has no selection/);
  });

  it("reads a group as a part for the cover of the files", () => {
    expect(partErrors(lane, "lib", ["src/core/c.ts", "src/base/a.ts", "src/base/b.ts", "src/one.ts"])).toEqual([]);
    expect(partErrors(lane, "lib", ["src/two.ts"])).toEqual(["lib: the file src/two.ts is in no part, so a full run does not mutate it"]);
  });
});

describe("globsSelect", () => {
  it("reads the globs in order, as Stryker does", () => {
    expect(globsSelect(["src/**/*.ts", "!src/**/*.test.ts"], "src/a/b.ts")).toBe(true);
    expect(globsSelect(["src/**/*.ts", "!src/**/*.test.ts"], "src/a/b.test.ts")).toBe(false);
    expect(globsSelect(["src/**/*.ts", "!src/gen/**", "src/gen/keep.ts"], "src/gen/keep.ts")).toBe(true);
    expect(globsSelect(["src/**/*.ts"], "scripts/x.ts")).toBe(false);
  });

  // rigor#137: Stryker reads "src/module.ts:1-300" as the lines 1 to 300 of src/module.ts.
  it("reads a glob with a line range as its file", () => {
    expect(globsSelect(["src/module.ts:1-300"], "src/module.ts")).toBe(true);
    expect(globsSelect(["src/**/*.ts:5:2-9:1"], "src/a/b.ts")).toBe(true);
    expect(globsSelect(["src/module.ts:1-300"], "src/module.tsx")).toBe(false);
    expect(globsSelect(["src/*.ts", "!src/module.ts:1-3"], "src/module.ts")).toBe(false);
  });
});

// rigor#110: the parts of a package must cover each file of "mutate" exactly one time.
describe("partErrors", () => {
  const lane = parseLane(LANE);
  const files = ["src/impl/a.ts", "src/core/b.ts", "src/index.ts", "src/impl/a.test.ts"];

  it("gives no errors when each file of mutate is in exactly one part", () => {
    expect(partErrors(lane, "collections", files)).toEqual([]);
    expect(partErrors(lane, "small", ["src/x.ts"])).toEqual([]);
  });

  it("names a file that is in no part", () => {
    expect(partErrors(lane, "collections", [...files, "src/util.ts"])).toEqual(["collections: the file src/util.ts is in no part, so a full run does not mutate it"]);
  });

  it("names a file that is in two parts, and a file of a part that is not in mutate", () => {
    const two = parseLane({ packages: { p: { dir: "p", mutate: ["src/**/*.ts"], parts: { a: ["src/**/*.ts"], b: ["src/b/**/*.ts", "scripts/*.ts"] } } } });
    expect(partErrors(two, "p", ["src/b/x.ts", "scripts/y.ts"])).toEqual([
      "p: the file src/b/x.ts is in more than one part: a, b",
      'p: the file scripts/y.ts is in the part b, but not in "mutate"',
    ]);
  });

  // rigor#137: the Vex lane cuts module.ts into parts by line ranges.
  describe("a file in line ranges", () => {
    const cut = (parts: Record<string, string[]>) => parseLane({ packages: { p: { dir: "p", mutate: ["src/**/*.ts"], parts: { rest: ["src/x.ts"], ...parts } } } });
    const lines = (file: string): number => (file === "src/m.ts" ? 300 : 10);

    it("gives no errors when the ranges cover each line one time", () => {
      const lane = cut({ a: ["src/m.ts:1-120"], b: ["src/m.ts:121-200", "src/m.ts:201-300"] });
      expect(partErrors(lane, "p", ["src/m.ts", "src/x.ts"], lines)).toEqual([]);
      // A range can end after the last line.
      expect(partErrors(cut({ a: ["src/m.ts:1-120"], b: ["src/m.ts:121-999"] }), "p", ["src/m.ts"], lines)).toEqual([]);
    });

    it("names a gap, an overlap and the lines after the last range", () => {
      const lane = cut({ a: ["src/m.ts:1-100", "src/m.ts:150-220"], b: ["src/m.ts:101-120", "src/m.ts:200-250"] });
      expect(partErrors(lane, "p", ["src/m.ts"], lines)).toEqual([
        "p: the lines 121-149 of src/m.ts are in no part",
        "p: the lines 200-220 of src/m.ts are in the parts a and b",
        "p: the lines 251-300 of src/m.ts are in no part",
      ]);
      // Without the number of lines, the function does not know the last line.
      expect(partErrors(lane, "p", ["src/m.ts"])).toHaveLength(2);
      expect(partErrors(cut({ a: ["src/m.ts:2-300"] }), "p", ["src/m.ts"], lines)).toEqual(["p: the lines 1-1 of src/m.ts are in no part"]);
    });

    it("names a range with columns or with no lines, and a range beside the whole file", () => {
      expect(partErrors(cut({ a: ["src/m.ts:1:1-300:1"] }), "p", ["src/m.ts"], lines)).toEqual([
        "p: the range src/m.ts:1:1-300:1 of the part a has columns. A part can cut a file only by lines",
      ]);
      expect(partErrors(cut({ a: ["src/m.ts:1-300", "src/m.ts:9-8"] }), "p", ["src/m.ts"], lines)).toEqual(["p: the range src/m.ts:9-8 of the part a has no lines"]);
      expect(partErrors(cut({ a: ["src/m.ts:1-300"], b: ["src/m.ts"] }), "p", ["src/m.ts"], lines)).toEqual(["p: the file src/m.ts is in more than one part: a, b"]);
    });
  });
});

describe("changedFiles", () => {
  const lane = parseLane(LANE);

  it("gives the changed files of a selection, from the folder of its package", () => {
    const changed = ["packages/collections/src/impl/a.ts", "packages/collections/src/core/b.ts", "packages/collections/src/impl/a.test.ts", "packages/small/src/x.ts", "README.md"];
    expect(changedFiles(select(lane, "collections.impl"), changed)).toEqual(["src/impl/a.ts"]);
    expect(changedFiles(select(lane, "collections"), changed)).toEqual(["src/impl/a.ts", "src/core/b.ts"]);
    expect(changedFiles(select(lane, "small"), ["packages\\small\\src\\x.ts"])).toEqual(["src/x.ts"]);
    expect(changedFiles(select(lane, "small"), ["packages/smaller/src/x.ts", "packages/small"])).toEqual([]);
  });

  // The MUTATIONREVIEW of Vex, item 7: a change of a test file changes what the run reads of its source file.
  it("gives the source file of a changed test file of the same name", () => {
    const tests = ["packages/collections/src/impl/a.test.ts", "packages/collections/src/core/b.test.ts"];
    expect(changedFiles(select(lane, "collections.impl"), tests)).toEqual(["src/impl/a.ts"]);
    expect(changedFiles(select(lane, "collections"), [...tests, "packages/collections/src/impl/a.ts"])).toEqual(["src/impl/a.ts", "src/core/b.ts"]);
    expect(changedFiles(select(lane, "collections"), tests, (f) => f !== "src/impl/a.ts")).toEqual(["src/core/b.ts"]);
    // The source of src/index.test.ts is src/index.ts, and mutate removes it.
    expect(changedFiles(select(lane, "collections"), ["packages/collections/src/index.test.ts"])).toEqual([]);
  });

  // rigor#137: a changed file that a part takes in line ranges keeps the ranges of that part.
  it("keeps the line ranges of a changed file", () => {
    const cut = parseLane({ packages: { p: { dir: "p", mutate: ["src/**/*.ts"], parts: { a: ["src/m.ts:1-120", "src/m.ts:200-300"], b: ["src/m.ts:121-199", "src/x.ts"] } } } });
    expect(changedFiles(select(cut, "p.a"), ["p/src/m.ts", "p/src/x.ts"])).toEqual(["src/m.ts:1-120", "src/m.ts:200-300"]);
    expect(changedFiles(select(cut, "p.b"), ["p/src/m.ts", "p/src/x.ts"])).toEqual(["src/m.ts:121-199", "src/x.ts"]);
    expect(changedFiles(select(cut, "p"), ["p/src/m.ts"])).toEqual(["src/m.ts"]);
  });
});

describe("strykerConfig", () => {
  const lane = parseLane(LANE);

  it("gives a Stryker config with the break off and the gate as the low threshold", () => {
    const config = strykerConfig(select(lane, "collections.core"), { concurrency: 4 });
    expect(config).toMatchObject({
      testRunner: "vitest",
      mutate: ["src/core/**/*.ts", "!src/**/*.test.ts", "!src/index.ts"],
      thresholds: { high: 90, low: 70, break: null },
      concurrency: 4,
      jsonReporter: { fileName: "reports/mutation/mutation.json" },
    });
    expect(config).not.toHaveProperty("vitest");
  });

  // Under pnpm the runner is not next to @stryker-mutator/core, so the default plugin glob of Stryker does not find it.
  // A config with no plugins starts no test (ireko nightly of 2026-11-06), so each config names the runner.
  it("names the Vitest runner plugin, so Stryker finds it under pnpm", () => {
    for (const name of selectionNames(lane)) {
      expect(strykerConfig(select(lane, name)).plugins).toEqual(["@stryker-mutator/vitest-runner", PARTIAL_PLUGIN]);
      expect(strykerConfig(select(lane, name)).reporters).toContain("rigor-partial");
    }
  });

  it("names the Vitest config of a package that has one", () => {
    expect(strykerConfig(select(lane, "small"))).toMatchObject({ vitest: { configFile: "vitest.unit.ts" }, thresholds: { low: 60, high: 90 }, concurrency: 2 });
  });

  it("adds the keys of the lane field stryker, and --concurrency replaces its concurrency", () => {
    const opts = parseLane({ packages: { s: { dir: "s", mutate: ["x"], stryker: { ignoreStatic: true, concurrency: 1, plugins: ["a", "b"] } } } });
    expect(strykerConfig(select(opts, "s"))).toMatchObject({ ignoreStatic: true, concurrency: 1, plugins: ["a", "b"], mutate: ["x"] });
    expect(strykerConfig(select(opts, "s"), { concurrency: 3 })).toMatchObject({ ignoreStatic: true, concurrency: 3 });
  });

  // Stryker 10.1 rewrites the tsconfig with parseConfigFileTextToJson, and TypeScript 7 does not have it.
  it("points tsconfigFile at no file when the rewrite is off, and only TypeScript 7 or later turns it off", () => {
    expect(strykerConfig(select(lane, "small"), { tsconfigRewrite: false })).toMatchObject({ tsconfigFile: NO_TSCONFIG });
    expect(strykerConfig(select(lane, "small"), { tsconfigRewrite: true })).not.toHaveProperty("tsconfigFile");
    expect(strykerConfig(select(lane, "small"))).not.toHaveProperty("tsconfigFile");
    expect([undefined, 5, 6, 7, 8].map(rewritesTsconfig)).toEqual([true, true, true, false, false]);
  });

  it("starts only the tests with dryRun, and does not stop at the first failed test", () => {
    expect(strykerConfig(select(lane, "small"), { dryRun: true })).toMatchObject({ dryRunOnly: true, disableBail: true });
    expect(strykerConfig(select(lane, "small"))).not.toHaveProperty("dryRunOnly");
  });

  // rigor#109: the clock of Stryker (5000 ms) stopped mutants on a loaded runner, so the default is longer.
  it("gives the clock times of 120000 ms and 15 minutes, and the times of the lane when it has them", () => {
    expect(strykerConfig(select(lane, "small"))).toMatchObject({ timeoutMS: 120_000, dryRunTimeoutMinutes: 15 });
    const slow = parseLane({ packages: { s: { dir: "s", mutate: ["x"], timeoutMS: 300_000, dryRunTimeoutMinutes: 40 } } });
    expect(strykerConfig(select(slow, "s"))).toMatchObject({ timeoutMS: 300_000, dryRunTimeoutMinutes: 40 });
  });
});

describe("the lane fields of the test checks", () => {
  it("accepts notRead, maxTestFall and plannedFalls, and refuses bad values", () => {
    const lane = { ...LANE, maxTestFall: 10, plannedFalls: { "collections.impl": "the old tests moved to rigor" } };
    expect(parseLane(lane)).toBe(lane);
    const notRead = { packages: { a: { dir: "a", mutate: ["src/*.ts"], notRead: { "bench/x.test.ts": "a bench" } } } };
    expect(parseLane(notRead)).toBe(notRead);
    expect(() => parseLane({ packages: { a: { dir: "a", mutate: ["src/*.ts"], notRead: { "x.test.ts": " " } } } })).toThrow(/a: "notRead" is not an object of files, each with a reason/);
    const computed = { packages: { a: { dir: "a", mutate: ["src/*.ts"], computedImports: { "src/all.test.ts": "it loads each op" } } } };
    expect(parseLane(computed)).toBe(computed);
    expect(() => parseLane({ packages: { a: { dir: "a", mutate: ["src/*.ts"], computedImports: ["src/all.test.ts"] } } })).toThrow(/a: "computedImports" is not an object of files, each with a reason/);
    expect(() => parseLane({ ...LANE, maxTestFall: 120 })).toThrow(/"maxTestFall" is not a percent/);
    expect(() => parseLane({ ...LANE, plannedFalls: { collections: "" } })).toThrow(/"plannedFalls" is not an object/);
    expect(() => parseLane({ ...LANE, plannedFalls: { "collections.nope": "a reason" } })).toThrow(/"plannedFalls" names no selection of the lane: collections\.nope/);
  });
});
