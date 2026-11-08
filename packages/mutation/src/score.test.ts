import { describe, expect, it } from "vitest";
import { failScore, formatScore, packageScore, parseReport, scoreReport, summaryMarkdown, testCount, testFall, testFileFaults, unreadTestFiles, type MutationReport } from "./score.ts";

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
    expect(scoreReport(r, { name: "collections", gate: 60 })).toMatchObject({ pass: true, outcome: "pass" });
    const s = scoreReport(r, { name: "collections", gate: 61 });
    expect(s).toMatchObject({ pass: false, outcome: "block" });
    expect(formatScore(s)).toBe("collections: 60.00 % (3 of 5, 2 survived), gate 61 %: FAIL: the score 60.00 % is under the gate 61 %");
  });

  it("passes any score with no gate", () => {
    expect(scoreReport(report("Killed", "Survived", "Survived"), { name: "a", gate: undefined })).toMatchObject({ pass: true });
  });

  it("fails a report with no mutants that count, also with no gate", () => {
    expect(scoreReport({ files: {} }, { name: "a", gate: undefined })).toMatchObject({ pass: false, outcome: "no read", reason: expect.stringMatching(/no mutants that count/) as unknown });
    expect(scoreReport(report("CompileError"), { name: "a", gate: undefined }).pass).toBe(false);
  });

  // Stryker 10.0 with Vitest 5 started no test on the mutants, so each covered mutant survived (stryker-js 6210).
  it("fails a report where the tests detected no mutant, also with no gate", () => {
    const s = scoreReport(report("Survived", "Survived", "NoCoverage"), { name: "a", gate: undefined });
    expect(s).toMatchObject({ pass: false, outcome: "no read", reason: "the tests detected none of the 3 mutants: the test runner started no test on the mutants" });
  });

  it("gives a table for the summary of a job", () => {
    const md = summaryMarkdown([scoreReport(report("Killed"), { name: "a", gate: 90 }), scoreReport(report("Survived", "Killed"), { name: "b", gate: undefined })]);
    expect(md).toContain("| a | 100.00 % | 1 | 1 | 0 | 0 | 100.00 % | 90 % | pass |");
    expect(md).toContain("| b | 50.00 % | 1 | 2 | 1 | 0 | 50.00 % | none | pass |");
  });
});

// The MUTATIONREVIEW of Vex, item 4: a gate of 95 % over the sum of the parts of a package.
describe("packageScore", () => {
  const part = (name: string, killed: number, survived: number) =>
    scoreReport(report(...Array<string>(killed).fill("Killed"), ...Array<string>(survived).fill("Survived")), { name, gate: undefined });

  it("sums the mutants of the parts and applies the gate of the package to the sum", () => {
    const s = packageScore("p", 95, [part("p.a", 100, 0), part("p.b", 92, 8)]);
    expect(s).toMatchObject({ name: "p", gate: 95, detected: 192, valid: 200, percent: 96, pass: true, outcome: "pass" });
    expect(s.survived).toHaveLength(8);
    expect(formatScore(s)).toBe("p: 96.00 % (192 of 200, 8 survived), gate 95 %: pass");
    expect(packageScore("p", 97, [part("p.a", 100, 0), part("p.b", 92, 8)])).toMatchObject({
      pass: false,
      outcome: "block",
      reason: "the score 96.00 % of all the parts is under the gate 97 %",
    });
  });

  it("is a no read when a part fails, or with no parts", () => {
    const none = scoreReport(report("Survived"), { name: "p.b", gate: undefined });
    expect(packageScore("p", 50, [part("p.a", 9, 1), none])).toMatchObject({ pass: false, outcome: "no read", reason: "the parts p.b fail, so the sum of the parts has no meaning" });
    expect(packageScore("p", 50, [])).toMatchObject({ pass: false, outcome: "no read" });
  });

  // The review of Vex on rigor#139: the sum of 2 of 3 parts does not count the mutants of the third part.
  it("is a no read when a part has no score, also when each part read is over the gate", () => {
    expect(packageScore("p", 90, [part("p.a", 10, 0), part("p.b", 10, 0)], ["p.c"])).toMatchObject({
      percent: 100,
      pass: false,
      outcome: "no read",
      reason: "the read has no score of the parts p.c, so the sum does not count their mutants",
    });
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

/** This function gives the `testFiles` of a report: each file with its count of tests. */
const tests = (counts: Record<string, number>): MutationReport["testFiles"] =>
  Object.fromEntries(Object.entries(counts).map(([file, n]) => [file, { tests: Array.from({ length: n }, (_, i) => ({ name: `t${String(i)}` })) }]));

describe("the tests of a report (LANE.TESTS and LANE.FILES of Vex)", () => {
  it("counts the tests of testFiles, and prints the count", () => {
    const r = { ...report("Killed", "Survived"), testFiles: tests({ "src/a.test.ts": 3, "src/b.test.ts": 2 }) };
    expect(testCount(parseReport(r))).toBe(5);
    expect(testCount(report("Killed"))).toBeUndefined();
    const s = scoreReport(r, { name: "lib", gate: undefined });
    expect(s.tests).toBe(5);
    expect(formatScore(s)).toBe("lib: 50.00 % (1 of 2, 1 survived, 5 tests), no gate: pass");
    expect(summaryMarkdown([s])).toContain("| no gate | pass | 5 |".replace("no gate", "none"));
    expect(() => parseReport({ ...report("Killed"), testFiles: { "a.test.ts": {} } })).toThrow(/no list "tests" for the test file a\.test\.ts/);
  });

  // The flip of V-090: compiler.rest read 1029 of 1990 tests, and the printer read 69.13 %. That is no read.
  it("fails a fall of more than the limit against the last good count, and passes a fall at the limit", () => {
    expect(testFall(1029, 1990, 20)).toBe("the run read 1029 tests, 48.3 % fewer than the last good count 1990 (the limit is 20 %), so the score is no read");
    expect(testFall(1592, 1990, 20)).toBeUndefined();
    expect(testFall(1591, 1990, 20)).toMatch(/20\.1 % fewer/);
    expect(testFall(2500, 1990, 20)).toBeUndefined();
    expect(testFall(0, 0, 20)).toBeUndefined();
  });

  it("gives each test file on the disk that the report does not read, except the files of notRead", () => {
    const r = { ...report("Killed"), testFiles: tests({ "src/a.test.ts": 1, "D:/repo/pkg/src/b.test.ts": 1, "./src/c.test.ts": 1 }) };
    const onDisk = ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts", "src/d.test.ts", "bench/e.test.ts"];
    expect(unreadTestFiles(r, onDisk, {}, String.raw`D:\repo\pkg`)).toEqual(["src/d.test.ts", "bench/e.test.ts"]);
    expect(unreadTestFiles(r, onDisk, { "bench/e.test.ts": "a bench, CI starts it in its own job" }, "D:/repo/pkg/")).toEqual(["src/d.test.ts"]);
  });

  it("gives over all the reports each test file that no report reads, and each notRead entry that is not true", () => {
    const a = { ...report("Killed"), testFiles: tests({ "D:/repo/pkg/src/a.test.ts": 1 }) };
    const b = { ...report("Killed"), testFiles: tests({ "./src/b.test.ts": 1 }) };
    const onDisk = ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts", "bench/e.test.ts"];
    expect(testFileFaults([a, b], onDisk, {}, "D:/repo/pkg")).toEqual({ unread: ["src/c.test.ts", "bench/e.test.ts"], stale: [] });
    const notRead = { "bench/e.test.ts": "a bench", "src/b.test.ts": "read", "src/gone.test.ts": "not on the disk" };
    expect(testFileFaults([a, b], onDisk, notRead, "D:/repo/pkg")).toEqual({ unread: ["src/c.test.ts"], stale: ["src/b.test.ts", "src/gone.test.ts"] });
    expect(testFileFaults([a], onDisk, notRead, "D:/repo/pkg").stale).toEqual(["src/gone.test.ts"]);
  });

  it("keeps the first reason of a score that failed already", () => {
    const failed = scoreReport(report("Survived", "Killed"), { name: "lib", gate: 80 });
    expect(failScore(failed, "the run read no test")).toMatchObject({ outcome: "no read" });
    expect(failScore(failed, "the run read no test").reason).toBe("the score 50.00 % is under the gate 80 %. Also the run read no test");
    expect(failScore(scoreReport(report("Killed"), { name: "lib", gate: 80 }), "x")).toMatchObject({ pass: false, reason: "x" });
  });
});
