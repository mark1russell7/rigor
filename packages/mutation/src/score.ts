/**
 * The score of a Stryker report, with the gate of the package. The score counts the detected mutants, out of the
 * mutants that a test covers or that survive. Compile errors, runtime errors and ignored mutants do not count.
 *
 * Stryker gives the status `Timeout` for two events. The hit limit stops a mutant with an endless loop: its
 * `statusReason` starts with `Hit limit`, and the mutant is detected. The clock stops a mutant that took too long. The
 * load of the runner can cause this. Thus the mutant is not detected for certain, and it counts as not detected.
 */

/** A mutant of the JSON report of Stryker (the schema of mutation-testing-elements). */
export interface Mutant {
  readonly status: string;
  readonly mutatorName: string;
  /** Stryker gives the reason of some statuses here. A `Timeout` of the hit limit has a reason that starts with `Hit limit`. */
  readonly statusReason?: string | undefined;
  readonly location: { readonly start: { readonly line: number } };
}

/** The JSON report of Stryker: the mutants of each mutated file, and the tests of each test file that the run read. */
export interface MutationReport {
  readonly files: Readonly<Record<string, { readonly mutants: readonly Mutant[] }>>;
  /** Stryker gives this field when the test runner tells the tests, as the Vitest runner does. */
  readonly testFiles?: Readonly<Record<string, { readonly tests: readonly { readonly name: string }[] }>> | undefined;
}

/**
 * The three reads of a score. A `block` is a score under its gate. A `no read` is a score that does not read the tests.
 * Its cause is no report, no mutant that counts, no detected mutant, or a run that did not read all the tests. A no read is not a pass.
 */
export type ScoreOutcome = "pass" | "block" | "no read";

/** The score of one selection. */
export interface Score {
  readonly name: string;
  readonly gate: number | undefined;
  /** The mutants with the status `Killed`, and the mutants that the hit limit stopped. */
  readonly detected: number;
  /** The mutants that the hit limit stopped. They are in `detected`. */
  readonly hitLimit: number;
  /** The mutants that the clock stopped. They count as not detected, and they are in `survived`. */
  readonly clockTimeouts: number;
  /** The mutants that count: detected, survived or with no coverage. */
  readonly valid: number;
  /** Each mutant that survived, had no coverage or was stopped by the clock, as `file:line Mutator`. */
  readonly survived: readonly string[];
  /** The score in percent. It is 0 when no mutant counts. */
  readonly percent: number;
  /** The score in percent with the clock time-outs counted as detected, as Stryker counts them. The gate does not read it. */
  readonly percentWithClock: number;
  /** The count of the tests that the run read, from `testFiles` of the report. It is undefined when the report has no `testFiles`. */
  readonly tests: number | undefined;
  readonly pass: boolean;
  /** The reason of a failure. */
  readonly reason: string | undefined;
  /** The read of the score. The functions of this package always give it. A score from an older version has no outcome. */
  readonly outcome?: ScoreOutcome;
}

const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/** This function tells if the hit limit of Stryker stopped a mutant. Then the mutant has an endless loop, and it is detected. */
export const isHitLimit = (m: Mutant): boolean => m.status === "Timeout" && (m.statusReason ?? "").startsWith("Hit limit");

/**
 * This function examines the JSON of a Stryker report and gives the report.
 *
 * @throws Error when the JSON has no files with mutants
 */
export function parseReport(json: unknown): MutationReport {
  const files = typeof json === "object" && json !== null ? (json as { files?: unknown }).files : undefined;
  if (typeof files !== "object" || files === null) throw new Error(`the report has no object "files"`);
  for (const [file, data] of Object.entries(files)) {
    if (!Array.isArray((data as { mutants?: unknown } | null)?.mutants)) throw new Error(`the report has no list "mutants" for ${file}`);
  }
  const testFiles = (json as { testFiles?: unknown }).testFiles;
  if (testFiles !== undefined) {
    if (typeof testFiles !== "object" || testFiles === null) throw new Error(`the field "testFiles" of the report is not an object`);
    for (const [file, data] of Object.entries(testFiles)) {
      if (!Array.isArray((data as { tests?: unknown } | null)?.tests)) throw new Error(`the report has no list "tests" for the test file ${file}`);
    }
  }
  return json as MutationReport;
}

/** This function gives the count of the tests of a report, or undefined when the report has no `testFiles`. */
export function testCount(report: MutationReport): number | undefined {
  if (report.testFiles === undefined) return undefined;
  return Object.values(report.testFiles).reduce((sum, f) => sum + f.tests.length, 0);
}

/**
 * This function compares a test count with the last good count. It gives the reason of a failure when the count fell
 * by more than `maxFall` percent, else undefined. A report that reads fewer tests is no read of the score.
 *
 * @param maxFall - the highest fall in percent that passes
 */
export function testFall(tests: number, last: number, maxFall: number): string | undefined {
  if (last <= 0 || tests >= last) return undefined;
  const fall = (100 * (last - tests)) / last;
  if (fall <= maxFall) return undefined;
  return `the run read ${String(tests)} tests, ${fall.toFixed(1)} % fewer than the last good count ${String(last)} (the limit is ${String(maxFall)} %), so the score is no read`;
}

/**
 * This function gives each test file on the disk that the report does not read, and that `notRead` does not name.
 * The files of the report and of the disk are from the folder of the package.
 *
 * @param onDisk - the test files of the package, from its folder, with `/`
 * @param dir - the folder of the package, to make a full path of the report relative
 */
export function unreadTestFiles(report: MutationReport, onDisk: readonly string[], notRead: Readonly<Record<string, string>> = {}, dir = ""): string[] {
  const root = dir.replaceAll("\\", "/").replace(/\/?$/, "/");
  const read = new Set(
    Object.keys(report.testFiles ?? {}).map((f) => {
      const file = f.replaceAll("\\", "/");
      return dir !== "" && file.startsWith(root) ? file.slice(root.length) : file.replace(/^\.\//, "");
    }),
  );
  return onDisk.filter((f) => !read.has(f) && notRead[f] === undefined);
}

/**
 * This function gives a score that fails for a reason, with the outcome `no read`. A score that failed already keeps its
 * first reason, and gets the new one after it. A score under its gate with a second reason is also a no read.
 */
export function failScore(score: Score, reason: string): Score {
  return { ...score, pass: false, outcome: "no read", reason: score.reason === undefined ? reason : `${score.reason}. Also ${reason}` };
}

/**
 * This function gives the score of a report and applies the gate. A report with no mutants that count fails, also
 * without a gate: Stryker found no files. A report with mutants that count and none detected also fails: the test
 * runner started no test on the mutants. Stryker 10.0 with Vitest 5 gave this result.
 */
export function scoreReport(report: MutationReport, selection: { readonly name: string; readonly gate: number | undefined }): Score {
  let detected = 0;
  let valid = 0;
  let hitLimit = 0;
  let clockTimeouts = 0;
  const survived: string[] = [];
  for (const [file, data] of Object.entries(report.files)) {
    for (const m of data.mutants) {
      const at = `${file}:${String(m.location.start.line)} ${m.mutatorName}`;
      if (m.status === "Killed" || isHitLimit(m)) {
        detected++;
        valid++;
        if (m.status === "Timeout") hitLimit++;
      } else if (m.status === "Timeout") {
        clockTimeouts++;
        valid++;
        survived.push(`${at} (the clock stopped it)`);
      } else if (UNDETECTED.has(m.status)) {
        valid++;
        survived.push(at);
      }
    }
  }
  const percent = valid === 0 ? 0 : (100 * detected) / valid;
  const percentWithClock = valid === 0 ? 0 : (100 * (detected + clockTimeouts)) / valid;
  const { name, gate } = selection;
  const [outcome, reason]: [ScoreOutcome, string | undefined] =
    valid === 0
      ? ["no read", "the report has no mutants that count: Stryker found no files to mutate, or it did not start"]
      : detected === 0
        ? ["no read", `the tests detected none of the ${String(valid)} mutants: the test runner started no test on the mutants`]
        : gate !== undefined && percent < gate
          ? ["block", `the score ${percent.toFixed(2)} % is under the gate ${String(gate)} %`]
          : ["pass", undefined];
  return { name, gate, detected, hitLimit, clockTimeouts, valid, survived, percent, percentWithClock, tests: testCount(report), pass: reason === undefined, reason, outcome };
}

/** This function gives the time-outs of a score as text: the count of each kind, and the score that counts the clock time-outs as detected. */
const timeouts = (s: Score): string =>
  `time-outs: ${String(s.hitLimit)} hit limit, ${String(s.clockTimeouts)} clock (${s.percentWithClock.toFixed(2)} % with the clock time-outs as detected)`;

/** This function gives one line for a score, with the name of the selection and its result. The time-outs are in it when the report has some. */
export function formatScore(s: Score): string {
  const gate = s.gate === undefined ? "no gate" : `gate ${String(s.gate)} %`;
  const result = s.pass ? "pass" : `FAIL: ${s.reason ?? ""}`;
  const time = s.hitLimit + s.clockTimeouts === 0 ? "" : `, ${timeouts(s)}`;
  const tests = s.tests === undefined ? "" : `, ${String(s.tests)} tests`;
  return `${s.name}: ${s.percent.toFixed(2)} % (${String(s.detected)} of ${String(s.valid)}, ${String(s.survived.length)} survived${time}${tests}), ${gate}: ${result}`;
}

/** This function gives a Markdown table of scores, for the summary of a CI job. */
export function summaryMarkdown(scores: readonly Score[]): string {
  const rows = scores.map(
    (s) =>
      `| ${s.name} | ${s.percent.toFixed(2)} % | ${String(s.detected)} | ${String(s.valid)} | ${String(s.survived.length)} | ${String(s.clockTimeouts)} | ${s.percentWithClock.toFixed(2)} % | ${s.gate === undefined ? "none" : `${String(s.gate)} %`} | ${s.pass ? "pass" : `fail: ${s.reason ?? ""}`} | ${s.tests === undefined ? "?" : String(s.tests)} |`,
  );
  return [
    "| Selection | Score | Detected | Valid | Survived | Clock time-outs | Score with them | Gate | Result | Tests |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ...rows,
    "",
  ].join("\n");
}
