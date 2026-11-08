import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_TSCONFIG } from "./config.ts";
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
/** This function starts the CLI as a step of GitHub Actions starts it. */
const runInActions = (...argv: string[]): number =>
  runCli(argv, {
    cwd: root,
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
    env: { GITHUB_ACTIONS: "true" },
  });
const annotationsOf = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("::"));
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

  // rigor#137: parts that cut one file by line ranges cover it when the ranges cover each line of the file.
  it("takes parts that cut a file by line ranges, and names the lines in no part", () => {
    const lane = (to: number) => ({ packages: { lib: { dir: "packages/lib", mutate: ["src/**/*.ts", "!src/**/*.test.ts"], parts: { core: ["src/core/**/*.ts", "src/a.ts:1-1"], rest: [`src/a.ts:2-${String(to)}`] } } } });
    put("mutation.json", JSON.stringify(lane(2)));
    expect(run("list", "--runs")).toBe(0);
    expect(out).toBe("lib.core\nlib.rest\n");
    put("packages/lib/src/a.ts", "// a\nexport const a = 1;\nexport const b = 2;\n");
    expect(() => run("list", "--runs")).toThrow(/lib: the lines 3-3 of src\/a\.ts are in no part/);
    put("mutation.json", JSON.stringify(lane(3)));
    put("changed.txt", "packages/lib/src/a.ts\n");
    expect(run("config", "lib.rest", "--changed", "changed.txt", "--out", "tmp/s.json")).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "tmp/s.json"), "utf8"))).toMatchObject({ mutate: ["src/a.ts:2-3"] });
  });

  // The MUTATIONREVIEW of Vex, item 4: the gate reads the sum of the parts, in one command over all the parts.
  it("applies the gate of a package with gateOver package to the sum of its parts", () => {
    const lib = { dir: "packages/lib", mutate: ["src/**/*.ts", "!src/**/*.test.ts"], gate: 80, gateOver: "package", parts: { core: ["src/core/**/*.ts"], rest: ["src/*.ts"] } };
    put("mutation.json", JSON.stringify({ packages: { lib } }));
    put("reports/mutation-lib.core/mutation.json", JSON.stringify(mutants(10, 0)));
    put("reports/mutation-lib.rest/mutation.json", JSON.stringify(mutants(7, 3)));
    expect(run("scores", "lib.core", "lib.rest", "--reports", "reports")).toBe(0);
    expect(out.split("\n")).toEqual([
      "lib.core: 100.00 % (10 of 10, 0 survived), no gate: pass",
      "  the gate of lib reads all its parts together",
      "lib.rest: 70.00 % (7 of 10, 3 survived), no gate: pass",
      "  the gate of lib reads all its parts together",
      "lib: 85.00 % (17 of 20, 3 survived), gate 80 %: pass",
      "",
    ]);
    put("reports/mutation-lib.rest/mutation.json", JSON.stringify(mutants(5, 5)));
    out = "";
    expect(run("scores", "lib.core", "lib.rest", "--reports", "reports")).toBe(1);
    expect(out).toContain("lib: 75.00 % (15 of 20, 5 survived), gate 80 %: FAIL: the score 75.00 % of all the parts is under the gate 80 %");
    expect(err).toContain("The gate failed for lib.");
    out = "";
    expect(run("scores", "lib.core", "--reports", "reports")).toBe(1);
    expect(out).toContain("lib: 100.00 % (10 of 10, 0 survived), gate 80 %: FAIL: the read has no score of the parts lib.rest, so the sum does not count their mutants");
    // The job of one part: --alone gives no line for the package, and the part has no gate of its own.
    out = "";
    expect(run("scores", "lib.rest", "--reports", "reports", "--alone")).toBe(0);
    expect(out).toBe("lib.rest: 50.00 % (5 of 10, 5 survived), no gate: pass\n  the gate of lib reads all its parts together\n");
    // With "gateOver": "part", the default, --alone keeps the gate of each part.
    put("mutation.json", JSON.stringify({ packages: { lib: { ...lib, gateOver: undefined } } }));
    out = "";
    expect(run("scores", "lib.rest", "--reports", "reports", "--alone")).toBe(1);
    expect(out).toMatch(/^lib\.rest: 50\.00 % \(5 of 10, 5 survived\), gate 80 %: FAIL/);
    expect(out).not.toContain("reads all its parts together");
    put("mutation.json", JSON.stringify({ packages: { lib } }));
    // The MUTATIONREVIEW of Vex, item 2: a part that a time limit stopped has a partial score, and the package is a no read.
    rmSync(join(root, "reports/mutation-lib.rest/mutation.json"));
    const at = (minute: number) => minute * 60_000;
    put(
      "reports/mutation-lib.rest/partial.jsonl",
      [
        { event: "start", at: at(0) },
        { event: "plan", at: at(1), mutants: 10, run: 10 },
        { event: "mutant", at: at(2), file: "src/x.ts", status: "Killed", mutatorName: "BooleanLiteral", line: 1 },
        { event: "mutant", at: at(3), file: "src/x.ts", status: "Survived", mutatorName: "BooleanLiteral", line: 2 },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
    );
    out = "";
    expect(run("scores", "lib.core", "lib.rest", "--reports", "reports")).toBe(1);
    expect(out).toContain("lib.rest: 50.00 % (1 of 2, 1 survived), no gate: FAIL: partial: Stryker stopped after 3.0 minutes and tested 2 of 10 mutants.");
    expect(out).toContain("All the mutants need an estimated 11 minutes.");
    expect(out).toContain("lib: 91.67 % (11 of 12, 1 survived), gate 80 %: FAIL: the parts lib.rest fail, so the sum of the parts has no meaning");
    expect(() => run("scores", "lib.core", "--reports", "reports", "--report", "r.json")).toThrow(/--report or --reports/);
    put("mutation.json", JSON.stringify({ packages: { lib: { ...lib, parts: undefined } } }));
    expect(() => run("list")).toThrow(/"gateOver" is "package", but the package has no parts/);
  });

  it("gives only the runs with a changed file, and a config that mutates only the changed files", () => {
    put("changed.txt", "packages/lib/src/core/c.ts\nREADME.md\n\n");
    expect(run("list", "--runs", "--changed", "changed.txt")).toBe(0);
    expect(out).toBe("lib.core\n");
    expect(run("config", "lib.core", "--changed", "changed.txt", "--out", "tmp/s.json")).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "tmp/s.json"), "utf8"))).toMatchObject({ mutate: ["src/core/c.ts"] });
    expect(() => run("config", "lib.rest", "--changed", "changed.txt")).toThrow(/lib\.rest has no changed file/);
    expect(() => run("list", "--changed", "changed.txt")).toThrow(/takes --runs/);
    // A changed test file selects its source file, when the file exists.
    put("tests.txt", "packages/lib/src/a.test.ts\npackages/lib/src/core/gone.test.ts\n");
    out = "";
    expect(run("list", "--runs", "--changed", "tests.txt")).toBe(0);
    expect(out).toBe("lib.rest\n");
    out = "";
    put("none.txt", "docs/a.md\n");
    expect(run("list", "--runs", "--changed", "none.txt")).toBe(0);
    expect(out).toBe("");
  });

  it("turns off the tsconfig rewrite of Stryker only when the package resolves TypeScript 7 or later", () => {
    expect(run("config", "app")).toBe(0);
    expect(JSON.parse(out)).not.toHaveProperty("tsconfigFile");
    put("packages/app/node_modules/typescript/package.json", JSON.stringify({ name: "typescript", version: "6.0.3" }));
    out = "";
    expect(run("config", "app")).toBe(0);
    expect(JSON.parse(out)).not.toHaveProperty("tsconfigFile");
    put("packages/app/node_modules/typescript/package.json", JSON.stringify({ name: "typescript", version: "7.0.2" }));
    out = "";
    expect(run("config", "app")).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ tsconfigFile: NO_TSCONFIG });
    // The lane field "stryker" replaces the key
    put("mutation.json", JSON.stringify({ packages: { app: { dir: "packages/app", mutate: ["src/**/*.ts"], stryker: { tsconfigFile: "tsconfig.json" } } } }));
    out = "";
    expect(run("config", "app")).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ tsconfigFile: "tsconfig.json" });
  });

  it("writes a config for a dry run", () => {
    expect(run("config", "app", "--dry-run")).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ dryRunOnly: true, disableBail: true, mutate: ["src/**/*.ts"] });
  });

  it("writes a config that stops after the plan, and refuses --plan with --dry-run", () => {
    expect(run("config", "app", "--plan")).toBe(0);
    const config = JSON.parse(out) as Record<string, unknown>;
    expect(config).toMatchObject({ rigorPartial: { stopAfterPlan: true } });
    expect(config).not.toHaveProperty("dryRunOnly");
    expect(() => run("config", "app", "--plan", "--dry-run")).toThrow(/takes --dry-run or --plan, not both/);
  });

  // LANE.COST and LANE.STATIC of Vex: the estimate of each part against its target, and the static runs of each file.
  it("reads the plan of each selection, and fails a selection over its target, a file over its static limit and a missing plan", () => {
    const plan = (netMs: number, isStatic: number) => JSON.stringify({ files: { "src/a.ts": { mutants: 1, runs: 1, static: isStatic, netMs, limitMs: 0, lines: [] } }, tests: [] });
    put("mutation.json", JSON.stringify({ packages: { lib: { dir: "packages/lib", mutate: ["src/*.ts"], parts: { core: ["src/a.ts"] }, staticLimits: { "*": 4 } } }, targetMinutes: 50 }));
    put("packages/lib/reports/mutation/plan.json", plan(588_000 * 10, 4));
    expect(run("plan-check", "lib")).toBe(0);
    expect(out).toBe("lib: 1 runs, 4 of them static, with a planned net time of 1.6 h. The estimate is 10 minutes of the clock, and the target is 50.\nplan-check: each plan of 1 selections is in its limits\n");
    out = "";
    put("plans/mutation-lib.core/plan.json", plan(588_000 * 60, 5));
    expect(run("plan-check", "lib.core", "lib", "--reports", "plans")).toBe(1);
    expect(out).toContain("  FAIL: lib.core: the estimate of 60 minutes is over the target of 50. Cut the selection into more parts.\n");
    expect(out).toContain("  FAIL: src/a.ts: the plan has 5 static runs, and the limit is 4.");
    expect(out).toContain("lib: FAIL: there is no plan at plans/mutation-lib/plan.json.");
    expect(out).toContain("plan-check: 2 of 2 selections fail\n");
    expect(() => run("plan-check")).toThrow(/takes one or more selections/);
  });

  it("refuses a relative path that leaves the folder of a package, and passes a package with none", () => {
    expect(run("load-check")).toBe(0);
    expect(out).toBe("load-check lib: 3 files, no relative path leaves packages/lib\nload-check app: 1 files, no relative path leaves packages/app\n");
    put("packages/lib/src/core/c.test.ts", 'import { c } from "./c.ts";\nimport { fc } from "../../../testkit/src/fc.ts";\n');
    put("packages/lib/src/types.d.ts", 'import "../../outside.ts";\n');
    out = "";
    expect(run("load-check", "lib.core")).toBe(1);
    expect(out).toBe("");
    expect(err).toContain('packages/lib/src/core/c.test.ts:2: "../../../testkit/src/fc.ts" leaves the folder packages/lib.');
    expect(err).not.toContain("types.d.ts");
    expect(err).toContain("load-check: 1 packages have a relative path");
  });

  // The flip of LANE.TESTS (V-090 of Vex): a run that read 1029 of 1990 tests is no read, also above the gate.
  it("fails a fall of the test count against the last good count, unless the lane plans it, and writes the counts", () => {
    const withTests = (n: number) => ({ ...mutants(9, 1), testFiles: { "src/a.test.ts": { tests: Array.from({ length: n }, (_, i) => ({ name: `t${String(i)}` })) } } });
    put("packages/app/reports/mutation/mutation.json", JSON.stringify(withTests(1029)));
    put("last.json", JSON.stringify({ app: 1990, lib: 7 }));
    expect(run("scores", "app", "--last", "last.json")).toBe(1);
    expect(out).toContain("app: 90.00 % (9 of 10, 1 survived, 1029 tests), no gate: FAIL: the run read 1029 tests, 48.3 % fewer than the last good count 1990");
    expect(err).toBe("The gate failed for app.\n");

    const lane = JSON.parse(readFileSync(join(root, "mutation.json"), "utf8")) as Record<string, unknown>;
    put("mutation.json", JSON.stringify({ ...lane, plannedFalls: { app: "half of the tests moved to the package lib" } }));
    out = "";
    expect(run("scores", "app", "--last", "last.json", "--write-last", "last.json")).toBe(0);
    expect(out).toContain("app: 90.00 % (9 of 10, 1 survived, 1029 tests), no gate: pass\n  a planned fall: the run read 1029 tests, 48.3 % fewer");
    expect(out).toContain("The reason: half of the tests moved to the package lib");
    expect(JSON.parse(readFileSync(join(root, "last.json"), "utf8"))).toEqual({ app: 1029, lib: 7 });

    out = "";
    expect(run("scores", "app", "--last", "none.json")).toBe(0);
    expect(out).toContain("the file none.json does not exist, so no count is compared");
  });

  // A gate never shows a no read as a pass: each no read is a warning on the check line, also in a run that only reports.
  it("writes a warning annotation for each no read, each score under the gate and each planned fall in GitHub Actions", () => {
    put("packages/lib/reports/mutation/mutation.json", JSON.stringify(mutants(1, 9)));
    expect(runInActions("scores", "lib", "app")).toBe(1);
    expect(annotationsOf(out)).toEqual([
      `::warning title=Mutation gate%3A no read%2C 1 of 2 selections::app: the report ${join("packages", "app", "reports", "mutation", "mutation.json")} does not exist`,
      "::warning title=Mutation gate%3A under the gate::lib: the score 10.00 %25 is under the gate 80 %25",
    ]);

    out = "";
    put("packages/app/reports/mutation/mutation.json", JSON.stringify({ files: { "src/b.ts": { mutants: [] } } }));
    expect(runInActions("scores", "app")).toBe(1);
    expect(annotationsOf(out)).toEqual([
      "::warning title=Mutation gate%3A no read%2C 1 of 1 selections::app: the report has no mutants that count: Stryker found no files to mutate, or it did not start",
    ]);

    out = "";
    const withTests = (n: number) => ({ ...mutants(9, 1), testFiles: { "src/a.test.ts": { tests: Array.from({ length: n }, (_, i) => ({ name: `t${String(i)}` })) } } });
    put("packages/app/reports/mutation/mutation.json", JSON.stringify(withTests(10)));
    put("last.json", JSON.stringify({ app: 20 }));
    const lane = JSON.parse(readFileSync(join(root, "mutation.json"), "utf8")) as Record<string, unknown>;
    put("mutation.json", JSON.stringify({ ...lane, plannedFalls: { app: "100 % of the tests\nmoved" } }));
    expect(runInActions("scores", "app", "--last", "last.json")).toBe(0);
    expect(annotationsOf(out)).toEqual([
      "::warning title=Mutation gate%3A a planned fall of the tests::app: the run read 10 tests, 50.0 %25 fewer than the last good count 20 (the limit is 20 %25). The reason: 100 %25 of the tests%0Amoved",
    ]);

    out = "";
    expect(run("scores", "app", "--last", "last.json")).toBe(0);
    expect(annotationsOf(out)).toEqual([]);
  });

  // The flip of LANE.FILES: a test file that the run starts and that the report does not read fails, unless notRead names it.
  it("fails a test file that the run starts and that the report does not read, unless notRead gives its reason", () => {
    put("packages/app/src/b.test.ts", 'import { b } from "./b.ts";\n');
    put("packages/app/bench/e.test.ts", 'import { b } from "../src/b.ts";\n');
    put("packages/app/src/types.d.ts", "");
    put("packages/app/reports/mutation/mutation.json", JSON.stringify({ ...mutants(9, 1), testFiles: { "src/b.test.ts": { tests: [{ name: "b" }] } } }));
    expect(run("scores", "app", "--test-files")).toBe(1);
    expect(out).toContain("app: 90.00 % (9 of 10, 1 survived, 1 tests), no gate: FAIL: the report does not read 1 test files that the run starts");
    expect(out).toContain("  not read: packages/app/bench/e.test.ts\n");
    expect(out).not.toContain("types.d.ts");
    expect(run("scores", "app")).toBe(0);

    const lane = JSON.parse(readFileSync(join(root, "mutation.json"), "utf8")) as { packages: Record<string, Record<string, unknown>> };
    lane.packages["app"] = { ...lane.packages["app"], notRead: { "bench/e.test.ts": "a bench, CI starts it in its own job" } };
    put("mutation.json", JSON.stringify(lane));
    out = "";
    expect(run("scores", "app", "--test-files")).toBe(0);
    put("packages/app/reports/mutation/mutation.json", JSON.stringify(mutants(9, 1)));
    expect(run("scores", "app", "--test-files")).toBe(1);
    expect(out).toContain(`FAIL: the report has no "testFiles", so the test files that it read are not known`);
  });

  // The related mode of the Vitest runner starts only the test files that load a file of the selection (LANE.FILES).
  it("expects of a part only the test files that load a file of the part, and each test file with related false", () => {
    put("packages/lib/src/core/c.test.ts", 'import { c } from "./c.ts";\n');
    put("packages/lib/src/a.test.ts", 'import { a } from "./a.ts";\n');
    put("packages/lib/src/via.ts", 'export { c as via } from "./core/c.ts";\n');
    put("packages/lib/src/types.test.ts", 'import type {\n  c,\n} from "./core/c.ts";\n// import { c } from "./core/c.ts";\n');
    put("packages/lib/reports/mutation/mutation.json", JSON.stringify({ ...mutants(9, 1), testFiles: { "src/core/c.test.ts": { tests: [{ name: "c" }] } } }));
    expect(run("scores", "lib.core", "--test-files")).toBe(0);
    expect(out).not.toContain("not read");

    // A test file that loads the part through another file is related too.
    put("packages/lib/src/via.test.ts", 'import { via } from "./via.ts";\n');
    out = "";
    expect(run("scores", "lib.core", "--test-files")).toBe(1);
    expect(out).toContain("FAIL: the report does not read 1 test files that the run starts");
    expect(out).toContain("  not read: packages/lib/src/via.test.ts\n");

    // With related false, the run starts each test file, so each one that the report does not read fails.
    const lane = JSON.parse(readFileSync(join(root, "mutation.json"), "utf8")) as { packages: Record<string, Record<string, unknown>> };
    lane.packages["lib"] = { ...lane.packages["lib"], stryker: { vitest: { related: false } } };
    put("mutation.json", JSON.stringify(lane));
    out = "";
    expect(run("scores", "lib.core", "--test-files")).toBe(1);
    expect(out).toContain("FAIL: the report does not read 3 test files that the run starts");
    expect(out).toContain("  not read: packages/lib/src/types.test.ts\n");
  });

  // The flip of LANE.FILES over the parts: each part reads only its related test files. So only all the parts together
  // show a test file that no part reads, and a "notRead" entry that is not true.
  it("fails a test file that no selection of a package reads, and a stale entry of notRead, over all the parts", () => {
    put("packages/lib/src/core/c.test.ts", 'import { c } from "./c.ts";\n');
    put("packages/lib/src/a.test.ts", 'import { a } from "./a.ts";\n');
    put("packages/lib/test/docs.test.ts", 'import { readFileSync } from "node:fs";\n');
    const reads = (file: string): string => JSON.stringify({ ...mutants(9, 1), testFiles: { [file]: { tests: [{ name: "t" }] } } });
    put("reports/mutation-lib.core/mutation.json", reads("src/core/c.test.ts"));
    put("reports/mutation-lib.rest/mutation.json", reads("src/a.test.ts"));
    put("reports/mutation-app/mutation.json", JSON.stringify({ ...mutants(9, 1), testFiles: {} }));
    const all = ["lib.core", "lib.rest", "app", "--reports", "reports"];
    expect(run("scores", "lib.core", "--reports", "reports", "--test-files", "--alone")).toBe(0);
    expect(run("scores", "lib.rest", "--reports", "reports", "--test-files", "--alone")).toBe(0);
    expect(run("scores", ...all)).toBe(0);
    out = "";
    expect(run("scores", ...all, "--test-files")).toBe(1);
    expect(out).toMatch(/^lib\.core: .*FAIL: the test files of lib: no selection reads 1 test files, and "notRead" does not give their reason$/m);
    expect(out).toMatch(/^lib\.rest: .*FAIL: the test files of lib/m);
    expect(out).toContain("lib.rest: 90.00 % (9 of 10, 1 survived, 1 tests), gate 80 %: FAIL");
    expect(out).toContain("  read by no selection: packages/lib/test/docs.test.ts\n");
    expect(out).toMatch(/^app: .*: pass$/m);
    expect(err).toBe("The gate failed for lib.core, lib.rest.\n");

    const lane = JSON.parse(readFileSync(join(root, "mutation.json"), "utf8")) as { packages: Record<string, Record<string, unknown>> };
    const lib = lane.packages["lib"] ?? {};
    // An entry is stale when a report reads its file, or when the file is not on the disk.
    put("mutation.json", JSON.stringify({ ...lane, packages: { ...lane.packages, lib: { ...lib, notRead: { "test/docs.test.ts": "it reads the docs", "src/a.test.ts": "x", "src/gone.test.ts": "y" } } } }));
    out = "";
    expect(run("scores", ...all, "--test-files")).toBe(1);
    expect(out).toContain('FAIL: the test files of lib: 2 entries of "notRead" name a file that is not on the disk or that a report reads');
    expect(out).toContain('  "notRead" is not true: packages/lib/src/a.test.ts\n  "notRead" is not true: packages/lib/src/gone.test.ts\n');
    put("mutation.json", JSON.stringify({ ...lane, packages: { ...lane.packages, lib: { ...lib, notRead: { "test/docs.test.ts": "it reads the docs" } } } }));
    out = "";
    expect(run("scores", ...all, "--test-files")).toBe(0);

    // With "gateOver": "package", the fault fails the sum of the package, and the parts keep their reads.
    put("mutation.json", JSON.stringify({ ...lane, packages: { ...lane.packages, lib: { ...lib, gateOver: "package" } } }));
    out = "";
    err = "";
    expect(run("scores", ...all, "--test-files")).toBe(1);
    expect(out).toMatch(/^lib: .*FAIL: the test files of lib: no selection reads 1 test files/m);
    expect(out).not.toMatch(/^lib\.core: .*FAIL/m);
    expect(err).toBe("The gate failed for lib.\n");

    // A full report with no "testFiles" is a no read of its selection, so the sum is a no read, and a note tells why.
    put("reports/mutation-lib.rest/mutation.json", JSON.stringify(mutants(9, 1)));
    out = "";
    expect(run("scores", ...all, "--test-files")).toBe(1);
    expect(out).toContain('lib.rest: 90.00 % (9 of 10, 1 survived), no gate: FAIL: the report has no "testFiles", so the test files that it read are not known');
    expect(out).toMatch(/^lib: .*FAIL: the parts lib\.rest fail, so the sum of the parts has no meaning$/m);
    expect(out).toContain('  the test files of lib over all its selections are not known: the reports of lib.rest have no "testFiles"\n');
  });

  it("gives the help, and refuses an unknown command", () => {
    expect(run("--help")).toBe(0);
    expect(out).toContain("rigor-mutation list");
    expect(run("nope")).toBe(1);
    expect(err).toContain('unknown command "nope"');
  });
});
