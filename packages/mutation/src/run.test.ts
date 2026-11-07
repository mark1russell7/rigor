import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./run.ts";

let root = "";
let out = "";
let err = "";
const run = (...argv: string[]): number =>
  runCli(argv, {
    cwd: root,
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
  });
const put = (file: string, text: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};
/** This function gives a report with `killed` killed mutants, then `survived` survived mutants. */
const mutants = (killed: number, survived: number) => ({
  files: {
    "src/a.ts": {
      mutants: [...Array<string>(killed).fill("Killed"), ...Array<string>(survived).fill("Survived")].map((status, i) => ({ status, mutatorName: "BooleanLiteral", location: { start: { line: i + 1 } } })),
    },
  },
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rigor-mutation-"));
  out = "";
  err = "";
  const lib = { dir: "packages/lib", mutate: ["src/**/*.ts", "!src/**/*.test.ts"], gate: 80, parts: { core: ["src/core/**/*.ts"], rest: ["src/*.ts"] } };
  put("mutation.json", JSON.stringify({ packages: { lib, app: { dir: "packages/app", mutate: ["src/**/*.ts"] } } }));
  put("packages/lib/src/a.ts", "// Stryker disable next-line all: an equivalent mutant\nexport const a = 1;\n");
  put("packages/lib/src/a.test.ts", "// Stryker disable next-line all\n");
  put("packages/lib/src/core/c.ts", "export const c = 3;\n");
  put("packages/lib/node_modules/x/index.ts", "// Stryker disable next-line all\n");
  put("packages/app/src/b.ts", "export const b = 2;\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("rigor-mutation", () => {
  it("lists the selections and gives the folder of one", () => {
    expect(run("list")).toBe(0);
    expect(out).toBe("lib\nlib.core\nlib.rest\napp\n");
    out = "";
    expect(run("list", "--runs")).toBe(0);
    expect(out).toBe("lib.core\nlib.rest\napp\n");
    out = "";
    expect(run("dir", "lib.core")).toBe(0);
    expect(out).toBe("packages/lib\n");
  });

  it("writes the Stryker config of a selection", () => {
    expect(run("config", "lib.core", "--out", "tmp/stryker.json", "--concurrency", "3")).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "tmp/stryker.json"), "utf8"))).toMatchObject({ mutate: ["src/core/**/*.ts", "!src/**/*.test.ts"], concurrency: 3 });
    expect(() => run("config", "lib", "--concurrency", "0")).toThrow(/--concurrency/);
    expect(() => run("config")).toThrow(/takes one selection/);
  });

  // The flip of the CLI: a report under the gate exits with 1 and names the package, and the summary has its row.
  it("fails the gate of a package under it and names the package", () => {
    put("packages/lib/reports/mutation/mutation.json", JSON.stringify(mutants(7, 3)));
    put("packages/app/reports/mutation/mutation.json", JSON.stringify(mutants(1, 9)));
    expect(run("scores", "lib", "app", "--summary", "summary.md")).toBe(1);
    expect(out).toContain("lib: 70.00 % (7 of 10, 3 survived), gate 80 %: FAIL");
    expect(out).toContain("  survived: src/a.ts:8 BooleanLiteral");
    expect(out).toContain("app: 10.00 % (1 of 10, 9 survived), no gate: pass");
    expect(err).toBe("The gate failed for lib.\n");
    expect(readFileSync(join(root, "summary.md"), "utf8")).toContain("| lib | 70.00 % | 7 | 10 | 3 | 0 | 70.00 % | 80 % | fail:");
  });

  it("passes a package at its gate, and fails a selection with no report", () => {
    put("tmp/r.json", JSON.stringify(mutants(8, 2)));
    expect(run("scores", "lib", "--report", "tmp/r.json")).toBe(0);
    expect(run("scores", "app")).toBe(1);
    expect(out).toMatch(/app: .*the report packages[\\/]app[\\/]reports[\\/]mutation[\\/]mutation\.json does not exist/);
  });

  it("checks the disables of the sources against the list, and writes the list", () => {
    expect(run("disables")).toBe(1);
    expect(err).toContain("not in the list: packages/lib/src/a.ts: // Stryker disable next-line all: an equivalent mutant");
    expect(run("disables", "--write")).toBe(0);
    err = "";
    out = "";
    expect(run("disables")).toBe(0);
    expect(out).toBe("disables: 1 in 1 files\n  packages/lib/src/a.ts: 1\n");
    put("packages/app/src/b.ts", "// Stryker disable next-line all: a new one\n");
    expect(run("disables")).toBe(1);
    expect(err).toContain("not in the list: packages/app/src/b.ts");
  });

  // rigor#110: a file in no part is not mutated by a full run, so the commands of a full run refuse the lane.
  it("refuses the runs and the parts of a package when a file is in no part, and names the file", () => {
    put("packages/lib/src/util/u.ts", "export const u = 4;\n");
    expect(() => run("list", "--runs")).toThrow(/lib: the file src\/util\/u\.ts is in no part/);
    expect(() => run("config", "lib.core")).toThrow(/src\/util\/u\.ts is in no part/);
    expect(() => run("scores", "lib.rest")).toThrow(/src\/util\/u\.ts is in no part/);
    expect(run("config", "lib")).toBe(0);
    expect(run("list")).toBe(0);
  });

  it("gives the help, and refuses an unknown command", () => {
    expect(run("--help")).toBe(0);
    expect(out).toContain("rigor-mutation list");
    expect(run("nope")).toBe(1);
    expect(err).toContain('unknown command "nope"');
  });
});
