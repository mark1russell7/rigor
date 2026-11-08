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
  /** This field marks a partial score: a time limit stopped Stryker, and the score reads only the mutants that ran. */
  readonly partial?: PartialCosts;
}

/** The costs of a run that a time limit stopped. */
export interface PartialCosts {
  /** The mutants that Stryker tested before the stop. */
  readonly tested: number;
  /** The mutants of the plan. It is undefined when the run stopped before the plan. */
  readonly planned: number | undefined;
  /** The minutes from the start of Stryker to the last line of the file. */
  readonly minutes: number;
  /** The minutes for all the mutants of the plan, at the rate of the mutants that ran. Early results do not count. It is undefined with no rate. */
  readonly estimate: number | undefined;
}

/** The read of `partial.jsonl`: a report of the mutants that ran, and the costs of the run. */
export interface PartialRun extends PartialCosts {
  readonly report: MutationReport;
  /** This field tells if Stryker wrote its last line. Then the run did not stop. */
  readonly done: boolean;
}

/**
 * This function reads the lines of the reporter `rigor-partial`. A stop of the process can cut the last line, so the
 * function ignores a last line that is not JSON.
 *
 * @throws Error when a line before the last one is not JSON, or when the file has no start line
 */
export function parsePartial(text: string): PartialRun {
  const raw = text.split("\n").filter((line) => line.trim() !== "");
  const lines = raw.flatMap((line, i): Record<string, unknown>[] => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch (error) {
      if (i === raw.length - 1) return [];
      throw new Error(`the line ${String(i + 1)} of the partial file is not JSON`, { cause: error });
    }
  });
  const at = (l: Record<string, unknown> | undefined): number => (typeof l?.["at"] === "number" ? l["at"] : 0);
  const start = lines.find((l) => l["event"] === "start");
  if (start === undefined) throw new Error(`the partial file has no start line`);
  const plan = lines.find((l) => l["event"] === "plan");
  const mutants = lines.filter((l) => l["event"] === "mutant");
  const files: Record<string, { mutants: Mutant[] }> = {};
  for (const m of mutants) {
    const reason = typeof m["statusReason"] === "string" ? { statusReason: m["statusReason"] } : {};
    (files[String(m["file"])] ??= { mutants: [] }).mutants.push({ status: String(m["status"]), ...reason, mutatorName: String(m["mutatorName"]), location: { start: { line: Number(m["line"]) } } });
  }
  const minutes = (to: number, from: number): number => (to - from) / 60_000;
  const last = at(lines.at(-1));
  const planned = typeof plan?.["mutants"] === "number" ? plan["mutants"] : undefined;
  const run = typeof plan?.["run"] === "number" ? plan["run"] : undefined;
  // Stryker reports the mutants with an early result (no coverage, ignored, from the cache) just after the plan, and
  // they take no time. So the rate reads only the tested mutants that ran: the lines of all the mutants less the early ones.
  const lastMutant = at(mutants.at(-1));
  const ran = planned === undefined || run === undefined ? 0 : mutants.length - (planned - run);
  const estimate =
    run === undefined || ran <= 0 || lastMutant <= at(plan)
      ? undefined
      : minutes(at(plan), at(start)) + (minutes(lastMutant, at(plan)) * run) / ran;
  return { report: { files }, tested: mutants.length, planned, minutes: minutes(last, at(start)), estimate, done: lines.some((l) => l["event"] === "done") };
}

/**
 * This function gives the score of a run that a time limit stopped. The score reads only the mutants that ran, so it
 * is a no read with the mark `partial`. The reason gives the costs, for the size of the next parts.
 */
export function partialScore(run: PartialRun, selection: { readonly name: string; readonly gate: number | undefined }): Score {
  const score = scoreReport(run.report, selection);
  const of = run.planned === undefined ? "an unknown count of" : String(run.planned);
  const estimate = run.estimate === undefined ? "" : ` All the mutants need an estimated ${run.estimate.toFixed(0)} minutes.`;
  const reason = `partial: Stryker stopped after ${run.minutes.toFixed(1)} minutes and tested ${String(run.tested)} of ${of} mutants. The score of the mutants that ran is ${score.percent.toFixed(2)} %.${estimate}`;
  const { tested, planned, minutes } = run;
  return { ...score, pass: false, reason, outcome: "no read", partial: { tested, planned, minutes, estimate: run.estimate } };
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
  const read = readTestFiles([report], dir);
  return onDisk.filter((f) => !read.has(f) && notRead[f] === undefined);
}

/** This function gives the test files that the reports read, from the folder of the package, with `/`. */
function readTestFiles(reports: readonly MutationReport[], dir: string): Set<string> {
  const root = dir.replaceAll("\\", "/").replace(/\/?$/, "/");
  return new Set(
    reports.flatMap((report) =>
      Object.keys(report.testFiles ?? {}).map((f) => {
        const file = f.replaceAll("\\", "/");
        return dir !== "" && file.startsWith(root) ? file.slice(root.length) : file.replace(/^\.\//, "");
      }),
    ),
  );
}

/** The faults of the test files of a package over the reports of all its selections (LANE.FILES). */
export interface TestFileFaults {
  /** These test files are on the disk, no report reads them, and `notRead` does not name them. */
  readonly unread: readonly string[];
  /** These entries of `notRead` are not true: the file is not on the disk, or a report reads it. */
  readonly stale: readonly string[];
}

/**
 * This function examines the test files of a package over the reports of all its selections (LANE.FILES). A part
 * starts only its related test files, so only all the parts together show a test file that no part reads.
 *
 * @param reports - the reports of all the selections of the package
 * @param onDisk - the test files of the package, from its folder, with `/`
 * @param dir - the folder of the package, to make a full path of a report relative
 */
export function testFileFaults(reports: readonly MutationReport[], onDisk: readonly string[], notRead: Readonly<Record<string, string>> = {}, dir = ""): TestFileFaults {
  return readFaults(readTestFiles(reports, dir), onDisk, notRead);
}

/**
 * This function examines the test files of a package against the test files that its selections read (LANE.FILES).
 * `load-check --collect` gives the files that the selections start. The reports give the files that they read.
 *
 * @param read - the test files that the selections read, from the folder of the package, with `/`
 * @param onDisk - the test files of the package, from its folder, with `/`
 */
export function readFaults(read: ReadonlySet<string>, onDisk: readonly string[], notRead: Readonly<Record<string, string>> = {}): TestFileFaults {
  const files = new Set(onDisk);
  return {
    unread: onDisk.filter((f) => !read.has(f) && notRead[f] === undefined),
    stale: Object.keys(notRead).filter((f) => !files.has(f) || read.has(f)),
  };
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

/**
 * This function gives the score of a package from the scores of its parts, and applies the gate of the package. It sums
 * the mutants of the parts. A part that fails makes the package a no read: a part has no gate of its own here.
 * A missing part also makes the package a no read, because the sum does not count its mutants.
 *
 * @param missing - the parts of the package that have no score in this read
 */
export function packageScore(name: string, gate: number | undefined, parts: readonly Score[], missing: readonly string[] = []): Score {
  const sum = (count: (s: Score) => number): number => parts.reduce((total, s) => total + count(s), 0);
  const detected = sum((s) => s.detected);
  const valid = sum((s) => s.valid);
  const clockTimeouts = sum((s) => s.clockTimeouts);
  const percent = valid === 0 ? 0 : (100 * detected) / valid;
  const percentWithClock = valid === 0 ? 0 : (100 * (detected + clockTimeouts)) / valid;
  const failed = parts.filter((s) => !s.pass).map((s) => s.name);
  const [outcome, reason]: [ScoreOutcome, string | undefined] =
    parts.length === 0
      ? ["no read", "the package has no scores of its parts"]
      : missing.length > 0
        ? ["no read", `the read has no score of the parts ${missing.join(", ")}, so the sum does not count their mutants`]
        : failed.length > 0
          ? ["no read", `the parts ${failed.join(", ")} fail, so the sum of the parts has no meaning`]
          : gate !== undefined && percent < gate
            ? ["block", `the score ${percent.toFixed(2)} % of all the parts is under the gate ${String(gate)} %`]
            : ["pass", undefined];
  const tests = parts.every((s) => s.tests !== undefined) ? sum((s) => s.tests ?? 0) : undefined;
  return { name, gate, detected, hitLimit: sum((s) => s.hitLimit), clockTimeouts, valid, survived: parts.flatMap((s) => s.survived), percent, percentWithClock, tests, pass: reason === undefined, reason, outcome };
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
