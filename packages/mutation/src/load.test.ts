import { describe, expect, it } from "vitest";
import { isConfigFile, leavingPaths, relatedTestFiles } from "./load.ts";

describe("leavingPaths", () => {
  it("refuses each loaded path of a test file that leaves the folder, with its line (V-072)", () => {
    const text = [
      'import { fc } from "../../testkit/src/fc-timeout.ts";',
      'import "../../pilots/src/setup.ts";',
      'const m = await import("../../pilots/src/m.ts");',
      'vi.mock("../../other/src/x.ts", () => ({}));',
      'const data = new URL("../../data/a.json", import.meta.url);',
      'export * from "../../shared/index.ts";',
    ].join("\n");
    expect(leavingPaths([{ file: "test/a.test.ts", text }])).toEqual([
      { file: "test/a.test.ts", line: 1, path: "../../testkit/src/fc-timeout.ts" },
      { file: "test/a.test.ts", line: 2, path: "../../pilots/src/setup.ts" },
      { file: "test/a.test.ts", line: 3, path: "../../pilots/src/m.ts" },
      { file: "test/a.test.ts", line: 4, path: "../../other/src/x.ts" },
      { file: "test/a.test.ts", line: 5, path: "../../data/a.json" },
      { file: "test/a.test.ts", line: 6, path: "../../shared/index.ts" },
    ]);
  });

  it("refuses a relative path string of a config file that leaves the folder", () => {
    const text = 'import { timeout } from "../testkit/src/fc-timeout.ts";\nexport default { test: { setupFiles: ["../testkit/src/fc-setup.ts", "./test/setup.ts"] } };\n';
    expect(leavingPaths([{ file: "vitest.config.ts", text }])).toEqual([
      { file: "vitest.config.ts", line: 1, path: "../testkit/src/fc-timeout.ts" },
      { file: "vitest.config.ts", line: 2, path: "../testkit/src/fc-setup.ts" },
    ]);
    const nested = 'export default { test: { setupFiles: ["../../testkit/setup.ts", "../test/setup.ts"] } };';
    expect(leavingPaths([{ file: "config/mutation.ts", text: nested }], "config/mutation.ts")).toEqual([{ file: "config/mutation.ts", line: 1, path: "../../testkit/setup.ts" }]);
  });

  it("passes the paths in the folder, the package imports, the comments and the type imports", () => {
    const text = [
      'import { a } from "./a.ts";',
      'import { b } from "../src/b.ts";',
      'import { vex } from "@mark1russell7/vex";',
      'import { readFileSync } from "node:fs";',
      '// import { old } from "../../old/src/old.ts";',
      'import type { T } from "../../types/src/t.ts";',
      'const p = import(`../../${name}.ts`);',
      'vi.stubEnv("NODE_ENV", "test");',
    ].join("\n");
    expect(leavingPaths([{ file: "test/a.test.ts", text }])).toEqual([]);
    expect(leavingPaths([{ file: "src/deep/x.test.ts", text: 'import { y } from "../../src/y.ts";' }])).toEqual([]);
  });

  it("reads a line with many spaces before a path in one pass, and still finds the path", () => {
    const spaces = " ".repeat(20000);
    expect(leavingPaths([{ file: "a.test.ts", text: `import${spaces}x` }])).toEqual([]);
    expect(leavingPaths([{ file: "a.test.ts", text: `await import(${spaces}"../b.ts")` }]).map((p) => p.path)).toEqual(["../b.ts"]);
  });

  it("refuses a path to the folder above, also from the top of the folder", () => {
    expect(leavingPaths([{ file: "a.test.ts", text: 'import x from "..";\nimport y from "../b.ts";' }]).map((p) => p.path)).toEqual(["..", "../b.ts"]);
  });

  it("reads each file that a test loads through the folder, and not the files that no test loads", () => {
    const files = [
      { file: "src/a.test.ts", text: 'import { a } from "./a.js";\nimport { h } from "../test/helpers";' },
      { file: "src/a.ts", text: 'export { b } from "../../shared/src/b.ts";' },
      { file: "test/helpers/index.ts", text: 'export { fc } from "../../../testkit/src/fc.ts";' },
      { file: "bench/gate.ts", text: 'import { measure } from "../../core/bench/measure.ts";' },
    ];
    expect(leavingPaths(files)).toEqual([
      { file: "src/a.ts", line: 1, path: "../../shared/src/b.ts" },
      { file: "test/helpers/index.ts", line: 1, path: "../../../testkit/src/fc.ts" },
    ]);
  });
});

describe("isConfigFile", () => {
  it("knows the config files of Vitest and Vite, and the vitestConfig of the lane", () => {
    expect(["vitest.config.ts", "vite.config.mjs", "test/vitest.workspace.ts", "vitest.config.cts"].map((f) => isConfigFile(f))).toEqual([true, true, true, true]);
    expect(["src/config.ts", "vitest.setup.ts", "my-vitest.config.ts"].map((f) => isConfigFile(f))).toEqual([false, false, false]);
    expect(isConfigFile("config/mutation.ts", "./config/mutation.ts")).toBe(true);
  });
});

describe("relatedTestFiles", () => {
  // The flip: each test file with a load of the part is related, and the test files with no such load are not.
  it("gives the test files that load a file of the selection, directly or through other files", () => {
    const files = [
      { file: "src/core/c.ts", text: "export const c = 1;" },
      { file: "src/core/c.test.ts", text: 'import { c } from "./c.ts";' },
      { file: "src/via.ts", text: 'export { c as via } from "./core/c.js";' },
      { file: "src/via.test.ts", text: 'import { via } from "./via";' },
      { file: "src/a.ts", text: "export const a = 2;" },
      { file: "src/a.test.ts", text: 'import { a } from "./a.ts";\n// import { c } from "./core/c.ts";' },
      { file: "src/types.test.ts", text: 'import type {\n  C,\n} from "./core/c.ts";\nexport type { D } from "./core/c.ts";' },
      { file: "src/mock.test.ts", text: 'vi.mock("./core/c.ts");' },
      { file: "src/loop.test.ts", text: 'import "./loop-a.ts";' },
      { file: "src/loop-a.ts", text: 'import "./loop-b.ts";' },
      { file: "src/loop-b.ts", text: 'import "./loop-a.ts";' },
    ];
    const core = (f: string): boolean => f.startsWith("src/core/");
    expect(relatedTestFiles(files, core)).toEqual(["src/core/c.test.ts", "src/via.test.ts", "src/mock.test.ts"]);
    expect(relatedTestFiles(files, (f) => f === "src/a.ts")).toEqual(["src/a.test.ts"]);
    expect(relatedTestFiles(files, () => false)).toEqual([]);
  });

  it("does not count a test file as a file of the selection", () => {
    const files = [
      { file: "src/x.test.ts", text: 'import { helper } from "./y.test.ts";' },
      { file: "src/y.test.ts", text: "export const helper = 1;" },
    ];
    expect(relatedTestFiles(files, () => true)).toEqual([]);
  });
});
