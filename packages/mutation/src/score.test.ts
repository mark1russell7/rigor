import { describe, expect, it } from "vitest";
import { formatScore, parseReport, scoreReport, summaryMarkdown, type MutationReport } from "./score.ts";

const mutant = (status: string, line: number) =>
  status === "HitLimit"
    ? { status: "Timeout", statusReason: "Hit limit reached (601/600)", mutatorName: "ConditionalExpression", location: { start: { line } } }
    : { status, mutatorName: "ConditionalExpression", location: { start: { line } } };

/** This function gives a report with the statuses of one file. The status `HitLimit` gives a `Timeout` of the hit limit. */
const report = (...statuses: string[]): MutationReport => ({ files: { "src/a.ts": { mutants: statuses.map((s, i) => mutant(s, i + 1)) } } });

describe("scoreReport", () => {
  it("counts the killed mutants and the time-outs of the hit limit of the mutants that count", () => {
    const s = scoreReport(report("Killed", "Killed", "HitLimit", "Survived", "NoCoverage", "CompileError", "RuntimeError", "Ignored"), { name: "a", gate: 50 });
    expect(s).toMatchObject({ detected: 3, hitLimit: 1, clockTimeouts: 0, valid: 5, percent: 60, pass: true, reason: undefined });
    expect(s.survived).toEqual(["src/a.ts:4 ConditionalExpression", "src/a.ts:5 ConditionalExpression"]);
  });

  // rigor#109: Stryker gives Timeout for the hit limit (an endless loop, detected) and for the clock (no result).
  it("counts a time-out of the clock as not detected, and gives the score with it as detected", () => {
    const s = scoreReport(report("Killed", "Timeout", "HitLimit", "Survived"), { name: "a", gate: undefined });
    expect(s).toMatchObject({ detected: 2, hitLimit: 1, clockTimeouts: 1, valid: 4, percent: 50, percentWithClock: 75 });
    expect(s.survived).toEqual(["src/a.ts:2 ConditionalExpression (the clock stopped it)", "src/a.ts:4 ConditionalExpression"]);
    expect(formatScore(s)).toBe("a: 50.00 % (2 of 4, 2 survived, time-outs: 1 hit limit, 1 clock (75.00 % with the clock time-outs as detected)), no gate: pass");
  });

  // The flip of rigor#109: the same four time-outs fail the gate when the clock stopped them, and pass it when the hit limit did.
  it("fails a gate of 95 with 4 time-outs of the clock, and passes it with 4 time-outs of the hit limit", () => {
    const of = (timeout: string) => report(...Array<string>(92).fill("Killed"), ...Array<string>(4).fill(timeout), ...Array<string>(4).fill("Survived"));
    const clock = scoreReport(of("Timeout"), { name: "a", gate: 95 });
    expect(clock).toMatchObject({ percent: 92, percentWithClock: 96, pass: false });
    expect(clock.reason).toBe("the score 92.00 % is under the gate 95 %");
    expect(scoreReport(of("HitLimit"), { name: "a", gate: 95 })).toMatchObject({ percent: 96, hitLimit: 4, pass: true });
  });

  it("counts a Timeout with a reason that does not start with Hit limit as a time-out of the clock", () => {
    const r: MutationReport = { files: { "src/a.ts": { mutants: [{ status: "Timeout", statusReason: "Timed out after 5000 ms", mutatorName: "M", location: { start: { line: 1 } } }] } } };
    expect(scoreReport(r, { name: "a", gate: undefined })).toMatchObject({ detected: 0, clockTimeouts: 1, valid: 1 });
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
    expect(md).toContain("| a | 100.00 % | 1 | 1 | 0 | 0 | 100.00 % | 90 % | pass |");
    expect(md).toContain("| b | 50.00 % | 1 | 2 | 1 | 0 | 50.00 % | none | pass |");
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
