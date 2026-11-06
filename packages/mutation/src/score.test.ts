import { describe, expect, it } from "vitest";
import { formatScore, parseReport, scoreReport, summaryMarkdown, type MutationReport } from "./score.ts";

const mutant = (status: string, line: number) => ({ status, mutatorName: "ConditionalExpression", location: { start: { line } } });

/** This function gives a report with the statuses of one file. */
const report = (...statuses: string[]): MutationReport => ({ files: { "src/a.ts": { mutants: statuses.map((s, i) => mutant(s, i + 1)) } } });

describe("scoreReport", () => {
  it("counts the killed and the timed-out mutants of the mutants that count", () => {
    const s = scoreReport(report("Killed", "Killed", "Timeout", "Survived", "NoCoverage", "CompileError", "RuntimeError", "Ignored"), { name: "a", gate: 50 });
    expect(s).toMatchObject({ detected: 3, valid: 5, percent: 60, pass: true, reason: undefined });
    expect(s.survived).toEqual(["src/a.ts:4 ConditionalExpression", "src/a.ts:5 ConditionalExpression"]);
  });

  // The flip: the same report passes at the gate 60 and fails at the gate 61, and the failure names the package.
  it("fails a score under the gate, and the line names the package", () => {
    const r = report("Killed", "Killed", "Killed", "Survived", "Survived");
    expect(scoreReport(r, { name: "collections", gate: 60 }).pass).toBe(true);
    const s = scoreReport(r, { name: "collections", gate: 61 });
    expect(s.pass).toBe(false);
    expect(formatScore(s)).toBe("collections: 60.00 % (3 of 5, 2 survived), gate 61 %: FAIL: the score 60.00 % is under the gate 61 %");
  });

  it("passes any score with no gate", () => {
    expect(scoreReport(report("Killed", "Survived", "Survived"), { name: "a", gate: undefined })).toMatchObject({ pass: true });
  });

  it("fails a report with no mutants that count, also with no gate", () => {
    expect(scoreReport({ files: {} }, { name: "a", gate: undefined })).toMatchObject({ pass: false, reason: expect.stringMatching(/no mutants that count/) as unknown });
    expect(scoreReport(report("CompileError"), { name: "a", gate: undefined }).pass).toBe(false);
  });

  // Stryker 10.0 with Vitest 5 started no test on the mutants, so each covered mutant survived (stryker-js 6210).
  it("fails a report where the tests detected no mutant, also with no gate", () => {
    const s = scoreReport(report("Survived", "Survived", "NoCoverage"), { name: "a", gate: undefined });
    expect(s).toMatchObject({ pass: false, reason: "the tests detected none of the 3 mutants: the test runner started no test on the mutants" });
  });

  it("gives a table for the summary of a job", () => {
    const md = summaryMarkdown([scoreReport(report("Killed"), { name: "a", gate: 90 }), scoreReport(report("Survived", "Killed"), { name: "b", gate: undefined })]);
    expect(md).toContain("| a | 100.00 % | 1 | 1 | 0 | 90 % | pass |");
    expect(md).toContain("| b | 50.00 % | 1 | 2 | 1 | none | pass |");
  });
});

describe("parseReport", () => {
  it.each([[null], [{}], [{ files: { "a.ts": {} } }]])("refuses %j", (json) => {
    expect(() => parseReport(json)).toThrow(/the report has no/);
  });

  it("accepts a report", () => {
    const r = report("Killed");
    expect(parseReport(r)).toBe(r);
  });
});
