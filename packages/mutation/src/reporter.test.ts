import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLAN_FILE, type PlanOfMutant } from "./plan.ts";
import { PARTIAL_FILE, PartialReporter, strykerPlugins, strykerValidationSchema } from "./reporter.ts";
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
const mutant = (file: string, status: string, line: number, id?: string) => ({ ...(id === undefined ? {} : { id }), fileName: join(root, file), status, mutatorName: "ConditionalExpression", location: { start: { line } } });
/** This function gives a plan of Stryker for the mutant `id` in `src/a.ts`. Stryker counts the lines of a plan from 0. */
const plan = (kind: string, id: string, extra: Partial<PlanOfMutant> & { line?: number; static?: boolean } = {}): PlanOfMutant => {
  const { line, static: isStatic, ...rest } = extra;
  return { plan: kind, mutant: { id, fileName: join(root, "src/a.ts"), ...(isStatic === undefined ? {} : { static: isStatic }), ...(line === undefined ? {} : { location: { start: { line } } }) }, ...rest };
};

// The MUTATIONREVIEW of Vex, item 2: a time limit that stops Stryker keeps the score of the mutants that ran.
describe("PartialReporter", () => {
  it("writes the plan and each mutant at once, and parsePartial gives the costs", () => {
    const r = reporter(0, 60_000, 60_000, 120_000, 180_000);
    expect(r.file).toBe(join(root, "out", PARTIAL_FILE));
    r.onMutationTestingPlanReady({ mutantPlans: [plan("Run", "1"), plan("Run", "2"), plan("Run", "3"), plan("Run", "4"), plan("EarlyResult", "5")] });
    // Stryker reports the early result just after the plan.
    r.onMutantTested(mutant("src/a.ts", "NoCoverage", 1));
    r.onMutantTested(mutant("src/a.ts", "Killed", 3));
    r.onMutantTested(mutant("src/a.ts", "Survived", 7));
    const run = parsePartial(readFileSync(r.file, "utf8"));
    // 1 minute to the plan, then 2 mutants in 2 minutes: the 4 mutants that run need 4 minutes more.
    expect(run).toMatchObject({ tested: 3, planned: 5, minutes: 3, estimate: 5, done: false });
    expect(run.report.files["src/a.ts"]?.mutants.map((m) => m.status)).toEqual(["NoCoverage", "Killed", "Survived"]);
    const score = partialScore(run, { name: "lib.core", gate: 80 });
    expect(score).toMatchObject({ pass: false, outcome: "no read", partial: { tested: 3, planned: 5, minutes: 3, estimate: 5 } });
    expect(formatScore(score)).toContain(
      "FAIL: partial: Stryker stopped after 3.0 minutes and tested 3 of 5 mutants. The score of the mutants that ran is 33.33 %. All the mutants need an estimated 5 minutes.",
    );
  });

  // The example of the review of Vex: 400 early results at the plan, then 100 mutants of 600 in 30 minutes.
  it("leaves the early results out of the rate", () => {
    const line = (l: object): string => `${JSON.stringify(l)}\n`;
    const early = Array.from({ length: 400 }, (_, i) => line({ event: "mutant", at: 0, file: "src/a.ts", status: "NoCoverage", mutatorName: "M", line: i }));
    const ran = Array.from({ length: 100 }, (_, i) => line({ event: "mutant", at: (i + 1) * 18_000, file: "src/a.ts", status: "Killed", mutatorName: "M", line: i }));
    const text = line({ event: "start", at: 0 }) + line({ event: "plan", at: 0, mutants: 1000, run: 600 }) + early.join("") + ran.join("");
    expect(parsePartial(text)).toMatchObject({ tested: 500, planned: 1000, minutes: 30, estimate: 180 });
  });

  it("gives no estimate while only early results exist", () => {
    const text = [{ event: "start", at: 0 }, { event: "plan", at: 0, mutants: 3, run: 2 }, { event: "mutant", at: 1, file: "a", status: "Ignored", mutatorName: "M", line: 1 }]
      .map((l) => JSON.stringify(l))
      .join("\n");
    expect(parsePartial(text)).toMatchObject({ tested: 1, estimate: undefined });
  });

  it("ignores a cut last line, and marks a run that wrote its last line", () => {
    const r = reporter(0, 60_000, 120_000, 180_000);
    r.onMutationTestingPlanReady({ mutantPlans: [plan("Run", "1")] });
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

  it("declares the reporter rigor-partial as a Stryker plugin, with the schema of its option", () => {
    expect(strykerPlugins).toEqual([{ kind: "Reporter", name: "rigor-partial", injectableClass: PartialReporter }]);
    expect(PartialReporter.inject).toEqual(["options"]);
    expect(strykerValidationSchema.properties.rigorPartial.properties.stopAfterPlan.type).toBe("boolean");
  });

  // LANE.COST of Vex: the plan of each file and line, and the planned cost of each mutant that ended.
  it("writes the plan of each file, line and test, and the planned times of each mutant", () => {
    const r = reporter(0, 1, 2, 3);
    expect(r.planFile).toBe(join(root, "out", PLAN_FILE));
    r.onDryRunCompleted({ result: { tests: [{ id: "t1", name: "adds", fileName: join(root, "src/a.test.ts"), timeSpentMs: 10 }, { id: "t2", name: "signs", timeSpentMs: 2 }] } });
    r.onMutationTestingPlanReady({
      mutantPlans: [
        plan("Run", "1", { line: 2, netTime: 100, runOptions: { timeout: 5000, testFilter: ["t1"] } }),
        plan("Run", "2", { line: 2, static: true, netTime: 300.4, runOptions: { timeout: 9000 } }),
        plan("EarlyResult", "3", { line: 7 }),
      ],
    });
    const written = JSON.parse(readFileSync(r.planFile, "utf8")) as unknown;
    expect(written).toEqual({
      files: { "src/a.ts": { mutants: 3, runs: 2, static: 1, netMs: 400, limitMs: 14_000, lines: [[3, 2, 1, 400]] } },
      tests: [
        ["adds", "src/a.test.ts", 10, 2, 20],
        ["signs", "", 2, 1, 2],
      ],
      dryRun: { tests: 2, netMs: 12 },
    });
    r.onMutantTested({ ...mutant("src/a.ts", "Timeout", 3, "2"), statusReason: "Hit limit" });
    r.onMutantTested(mutant("src/a.ts", "NoCoverage", 8, "3"));
    const lines = readFileSync(r.file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[2]).toMatchObject({ event: "mutant", status: "Timeout", netMs: 300, limitMs: 9000, static: true });
    expect(lines[3]).not.toHaveProperty("netMs");
  });

  it("stops Stryker after the plan with stopAfterPlan, and not without it", () => {
    const exits: number[] = [];
    const make = (stopAfterPlan: boolean) => new PartialReporter({ jsonReporter: { fileName: "out/mutation.json" }, rigorPartial: { stopAfterPlan } }, () => 0, root, (code) => exits.push(code));
    make(false).onMutationTestingPlanReady({ mutantPlans: [plan("Run", "1")] });
    expect(exits).toEqual([]);
    const stopped = make(true);
    stopped.onMutationTestingPlanReady({ mutantPlans: [plan("Run", "1")] });
    expect(exits).toEqual([0]);
    expect(JSON.parse(readFileSync(stopped.planFile, "utf8"))).toMatchObject({ files: { "src/a.ts": { runs: 1 } } });
  });
});
