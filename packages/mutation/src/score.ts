/**
 * The score of a Stryker report, with the gate of the package. The score counts the mutants with the status `Killed`
 * or `Timeout`, out of the mutants that a test covers or that survive. Compile errors, runtime errors and ignored
 * mutants do not count.
 */

/** A mutant of the JSON report of Stryker (the schema of mutation-testing-elements). */
export interface Mutant {
  readonly status: string;
  readonly mutatorName: string;
  readonly location: { readonly start: { readonly line: number } };
}

/** The JSON report of Stryker: the mutants of each mutated file. */
export interface MutationReport {
  readonly files: Readonly<Record<string, { readonly mutants: readonly Mutant[] }>>;
}

/** The score of one selection. */
export interface Score {
  readonly name: string;
  readonly gate: number | undefined;
  /** The mutants with the status `Killed` or `Timeout`. */
  readonly detected: number;
  /** The mutants that count: detected, survived or with no coverage. */
  readonly valid: number;
  /** Each mutant that survived or had no coverage, as `file:line Mutator`. */
  readonly survived: readonly string[];
  /** The score in percent. It is 0 when no mutant counts. */
  readonly percent: number;
  readonly pass: boolean;
  /** The reason of a failure. */
  readonly reason: string | undefined;
}

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

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
  return json as MutationReport;
}

/**
 * This function gives the score of a report and applies the gate. A report with no mutants that count fails, also
 * without a gate: Stryker found no files. A report with mutants that count and none detected also fails: the test
 * runner started no test on the mutants. Stryker 10.0 with Vitest 5 gave this result.
 */
export function scoreReport(report: MutationReport, selection: { readonly name: string; readonly gate: number | undefined }): Score {
  let detected = 0;
  let valid = 0;
  const survived: string[] = [];
  for (const [file, data] of Object.entries(report.files)) {
    for (const m of data.mutants) {
      if (DETECTED.has(m.status)) {
        detected++;
        valid++;
      } else if (UNDETECTED.has(m.status)) {
        valid++;
        survived.push(`${file}:${String(m.location.start.line)} ${m.mutatorName}`);
      }
    }
  }
  const percent = valid === 0 ? 0 : (100 * detected) / valid;
  const { name, gate } = selection;
  const reason =
    valid === 0
      ? "the report has no mutants that count: Stryker found no files to mutate, or it did not start"
      : detected === 0
        ? `the tests detected none of the ${String(valid)} mutants: the test runner started no test on the mutants`
        : gate !== undefined && percent < gate
          ? `the score ${percent.toFixed(2)} % is under the gate ${String(gate)} %`
          : undefined;
  return { name, gate, detected, valid, survived, percent, pass: reason === undefined, reason };
}

/** This function gives one line for a score, with the name of the selection and its result. */
export function formatScore(s: Score): string {
  const gate = s.gate === undefined ? "no gate" : `gate ${String(s.gate)} %`;
  const result = s.pass ? "pass" : `FAIL: ${s.reason ?? ""}`;
  return `${s.name}: ${s.percent.toFixed(2)} % (${String(s.detected)} of ${String(s.valid)}, ${String(s.survived.length)} survived), ${gate}: ${result}`;
}

/** This function gives a Markdown table of scores, for the summary of a CI job. */
export function summaryMarkdown(scores: readonly Score[]): string {
  const rows = scores.map(
    (s) =>
      `| ${s.name} | ${s.percent.toFixed(2)} % | ${String(s.detected)} | ${String(s.valid)} | ${String(s.survived.length)} | ${s.gate === undefined ? "none" : `${String(s.gate)} %`} | ${s.pass ? "pass" : `fail: ${s.reason ?? ""}`} |`,
  );
  return ["| Selection | Score | Detected | Valid | Survived | Gate | Result |", "| --- | ---: | ---: | ---: | ---: | ---: | --- |", ...rows, ""].join("\n");
}
