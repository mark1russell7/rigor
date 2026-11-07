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

/** The JSON report of Stryker: the mutants of each mutated file. */
export interface MutationReport {
  readonly files: Readonly<Record<string, { readonly mutants: readonly Mutant[] }>>;
}

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
  readonly pass: boolean;
  /** The reason of a failure. */
  readonly reason: string | undefined;
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
  const reason =
    valid === 0
      ? "the report has no mutants that count: Stryker found no files to mutate, or it did not start"
      : detected === 0
        ? `the tests detected none of the ${String(valid)} mutants: the test runner started no test on the mutants`
        : gate !== undefined && percent < gate
          ? `the score ${percent.toFixed(2)} % is under the gate ${String(gate)} %`
          : undefined;
  return { name, gate, detected, hitLimit, clockTimeouts, valid, survived, percent, percentWithClock, pass: reason === undefined, reason };
}

/** This function gives the time-outs of a score as text: the count of each kind, and the score that counts the clock time-outs as detected. */
const timeouts = (s: Score): string =>
  `time-outs: ${String(s.hitLimit)} hit limit, ${String(s.clockTimeouts)} clock (${s.percentWithClock.toFixed(2)} % with the clock time-outs as detected)`;

/** This function gives one line for a score, with the name of the selection and its result. The time-outs are in it when the report has some. */
export function formatScore(s: Score): string {
  const gate = s.gate === undefined ? "no gate" : `gate ${String(s.gate)} %`;
  const result = s.pass ? "pass" : `FAIL: ${s.reason ?? ""}`;
  const time = s.hitLimit + s.clockTimeouts === 0 ? "" : `, ${timeouts(s)}`;
  return `${s.name}: ${s.percent.toFixed(2)} % (${String(s.detected)} of ${String(s.valid)}, ${String(s.survived.length)} survived${time}), ${gate}: ${result}`;
}

/** This function gives a Markdown table of scores, for the summary of a CI job. */
export function summaryMarkdown(scores: readonly Score[]): string {
  const rows = scores.map(
    (s) =>
      `| ${s.name} | ${s.percent.toFixed(2)} % | ${String(s.detected)} | ${String(s.valid)} | ${String(s.survived.length)} | ${String(s.clockTimeouts)} | ${s.percentWithClock.toFixed(2)} % | ${s.gate === undefined ? "none" : `${String(s.gate)} %`} | ${s.pass ? "pass" : `fail: ${s.reason ?? ""}`} |`,
  );
  return [
    "| Selection | Score | Detected | Valid | Survived | Clock time-outs | Score with them | Gate | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}
