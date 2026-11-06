import { describe, expect, it } from "vitest";
import { strykerConfig } from "./config.ts";
import { parseLane, runSelections, select, selectionNames } from "./lane.ts";

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

  it("names the Vitest config of a package that has one", () => {
    expect(strykerConfig(select(lane, "small"))).toMatchObject({ vitest: { configFile: "vitest.unit.ts" }, thresholds: { low: 60, high: 90 }, concurrency: 2 });
  });
});
