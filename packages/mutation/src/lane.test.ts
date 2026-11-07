import { describe, expect, it } from "vitest";
import { strykerConfig } from "./config.ts";
import { globsSelect, parseLane, partErrors, runSelections, select, selectionNames } from "./lane.ts";

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

describe("globsSelect", () => {
  it("reads the globs in order, as Stryker does", () => {
    expect(globsSelect(["src/**/*.ts", "!src/**/*.test.ts"], "src/a/b.ts")).toBe(true);
    expect(globsSelect(["src/**/*.ts", "!src/**/*.test.ts"], "src/a/b.test.ts")).toBe(false);
    expect(globsSelect(["src/**/*.ts", "!src/gen/**", "src/gen/keep.ts"], "src/gen/keep.ts")).toBe(true);
    expect(globsSelect(["src/**/*.ts"], "scripts/x.ts")).toBe(false);
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
      expect(strykerConfig(select(lane, name)).plugins).toEqual(["@stryker-mutator/vitest-runner"]);
    }
  });

  it("names the Vitest config of a package that has one", () => {
    expect(strykerConfig(select(lane, "small"))).toMatchObject({ vitest: { configFile: "vitest.unit.ts" }, thresholds: { low: 60, high: 90 }, concurrency: 2 });
  });

  // rigor#109: the clock of Stryker (5000 ms) stopped mutants on a loaded runner, so the default is longer.
  it("gives the clock times of 120000 ms and 15 minutes, and the times of the lane when it has them", () => {
    expect(strykerConfig(select(lane, "small"))).toMatchObject({ timeoutMS: 120_000, dryRunTimeoutMinutes: 15 });
    const slow = parseLane({ packages: { s: { dir: "s", mutate: ["x"], timeoutMS: 300_000, dryRunTimeoutMinutes: 40 } } });
    expect(strykerConfig(select(slow, "s"))).toMatchObject({ timeoutMS: 300_000, dryRunTimeoutMinutes: 40 });
  });
});
