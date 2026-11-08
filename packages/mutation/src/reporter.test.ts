import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARTIAL_FILE, PartialReporter, strykerPlugins } from "./reporter.ts";
import { formatScore, parsePartial, partialScore } from "./score.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rigor-partial-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** This function gives a reporter in the temporary folder, with a clock that gives each time of `times` in turn. */
const reporter = (...times: number[]): PartialReporter => {
  let i = 0;
  return new PartialReporter({ jsonReporter: { fileName: "out/mutation.json" } }, () => times[i++] ?? 0, root);
};
const mutant = (file: string, status: string, line: number) => ({ fileName: join(root, file), status, mutatorName: "ConditionalExpression", location: { start: { line } } });

// The MUTATIONREVIEW of Vex, item 2: a time limit that stops Stryker keeps the score of the mutants that ran.
describe("PartialReporter", () => {
  it("writes the plan and each mutant at once, and parsePartial gives the costs", () => {
    const r = reporter(0, 60_000, 120_000, 180_000);
    expect(r.file).toBe(join(root, "out", PARTIAL_FILE));
    r.onMutationTestingPlanReady({ mutantPlans: [{ plan: "Run" }, { plan: "Run" }, { plan: "Run" }, { plan: "Run" }, { plan: "EarlyResult" }] });
    r.onMutantTested(mutant("src/a.ts", "Killed", 3));
    r.onMutantTested(mutant("src/a.ts", "Survived", 7));
    const run = parsePartial(readFileSync(r.file, "utf8"));
    // 1 minute to the plan, then 2 mutants in 2 minutes: the 4 mutants that run need 4 minutes more.
    expect(run).toMatchObject({ tested: 2, planned: 5, minutes: 3, estimate: 5, done: false });
    expect(run.report.files["src/a.ts"]?.mutants.map((m) => m.status)).toEqual(["Killed", "Survived"]);
    const score = partialScore(run, { name: "lib.core", gate: 80 });
    expect(score).toMatchObject({ percent: 50, pass: false, outcome: "no read", partial: { tested: 2, planned: 5, minutes: 3, estimate: 5 } });
    expect(formatScore(score)).toContain(
      "FAIL: partial: Stryker stopped after 3.0 minutes and tested 2 of 5 mutants. The score of the mutants that ran is 50.00 %. All the mutants need an estimated 5 minutes.",
    );
  });

  it("ignores a cut last line, and marks a run that wrote its last line", () => {
    const r = reporter(0, 60_000, 120_000, 180_000);
    r.onMutationTestingPlanReady({ mutantPlans: [{ plan: "Run" }] });
    r.onMutantTested(mutant("src/b.ts", "Killed", 1));
    expect(parsePartial(`${readFileSync(r.file, "utf8")}{"event":"mut`)).toMatchObject({ tested: 1, done: false });
    r.onMutationTestReportReady();
    expect(parsePartial(readFileSync(r.file, "utf8"))).toMatchObject({ tested: 1, done: true });
  });

  it("refuses a line that is not JSON before the last line, and a file with no start line", () => {
    const r = reporter(0);
    appendFileSync(r.file, `not json\n{"event":"done","at":1}\n`);
    expect(() => parsePartial(readFileSync(r.file, "utf8"))).toThrow(/the line 2 of the partial file is not JSON/);
    expect(() => parsePartial(`{"event":"plan","at":0,"mutants":1,"run":1}\n`)).toThrow(/no start line/);
  });

  it("gives no estimate and an unknown count before the plan", () => {
    const run = parsePartial(readFileSync(reporter(0).file, "utf8"));
    expect(run).toMatchObject({ tested: 0, planned: undefined, estimate: undefined });
    expect(partialScore(run, { name: "a", gate: undefined }).reason).toBe("partial: Stryker stopped after 0.0 minutes and tested 0 of an unknown count of mutants. The score of the mutants that ran is 0.00 %.");
  });

  it("declares the reporter rigor-partial as a Stryker plugin", () => {
    expect(strykerPlugins).toEqual([{ kind: "Reporter", name: "rigor-partial", injectableClass: PartialReporter }]);
    expect(PartialReporter.inject).toEqual(["options"]);
  });
});
