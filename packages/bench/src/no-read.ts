/**
 * The no-read line of a run. A case that a verdict cannot read is not a pass, so a run that shows it only in a table is a
 * silent pass. This file gives one line with the count, the cases and the CPU pair. It writes the line where the check
 * of the run shows it: a warning annotation of GitHub Actions and a line of the step summary.
 */
import { appendFileSync } from "node:fs";
import type { ArmModels } from "./model.ts";

/**
 * The outcome of one case of a read. The words `cannot decide` (of `timeVerdict`, `limitVerdict` and `budgetVerdict`) and
 * `no read` (of `gateOf` and `notSlowerVerdict`) are no-reads. Each other word is a read.
 */
export interface CaseRead {
  readonly case: string;
  readonly outcome: string;
}

/** The jobs of a read on one CPU model. A time budget takes its ratios inside one job, so it has this form of the models. */
export interface JobModel {
  readonly model: string;
  /** The count of the jobs on this model. */
  readonly jobs: number;
}

/** The options of `noReadLine`. */
export interface NoReadOptions {
  /** The name of the read in the line, for example the name of the bench or of the gate. */
  readonly title: string;
  /** The reason of the no-reads, for example "a decision needs 3 jobs, not 2". The line puts it after the counts. */
  readonly reason?: string;
  /**
   * The CPU models of the read, in one of two forms.
   * - An `ArmModels` of `armModels` gives the models of the two arms. The line tells a mixed pair, because a ratio can then compare two computers.
   * - A list of `JobModel` gives the jobs on each model, when each ratio is inside one job. The line makes no claim about the ratios.
   */
  readonly models?: ArmModels | readonly JobModel[];
}

/** The no-read line of a read. */
export interface NoReadLine {
  readonly title: string;
  /** The count of the cases with no read. */
  readonly count: number;
  /** The count of all the cases. */
  readonly total: number;
  /** The name of each case with no read, in the order of the input. */
  readonly cases: readonly string[];
  /** The CPU pair as text, or undefined without `models`. */
  readonly cpu: string | undefined;
  /** The reason, or undefined without `reason`. */
  readonly reason: string | undefined;
  /** This value is `true` when the arms are not one known model, or when the jobs are on more than one model. */
  readonly mixed: boolean;
  /** The line: the title, the counts, each case and the CPU pair. */
  readonly text: string;
}

/** This function tells if an outcome is a no-read: `cannot decide` or `no read`. */
export function isNoRead(outcome: string): boolean {
  return outcome === "cannot decide" || outcome === "no read";
}

function isJobModels(models: ArmModels | readonly JobModel[]): models is readonly JobModel[] {
  return Array.isArray(models);
}

function cpuText(models: ArmModels | readonly JobModel[]): { text: string; mixed: boolean } {
  if (isJobModels(models)) {
    const each = models.map((m) => `${m.model} (${m.jobs} ${m.jobs === 1 ? "job" : "jobs"})`).join(", ");
    return { text: `jobs on ${models.length} CPU ${models.length === 1 ? "model" : "models"}: ${each}`, mixed: models.length > 1 };
  }
  const side = (values: readonly string[]): string => values.join(" + ");
  const pair = `CPU a ${side(models.a)}, b ${side(models.b)}`;
  return { text: models.one ? pair : `${pair} (a mixed pair: a ratio can compare two computers)`, mixed: !models.one };
}

/** This function removes the full stop at the end of a part of the line, so the line has one full stop after it. */
function part(text: string): string {
  return text.trim().replace(/\.+$/u, "");
}

/**
 * This function gives the no-read line of a list of case outcomes.
 * - The result is undefined when each case has a read.
 * - An empty list is a no-read, as in `gateOf`: the line tells that the read has no cases.
 * - The line names each case with no read, not only the first.
 *
 * @param reads - The case outcomes, for example the cases of a gate or one entry for each `timeVerdict`.
 * @param options - The title and the CPU models.
 */
export function noReadLine(reads: readonly CaseRead[], options: NoReadOptions): NoReadLine | undefined {
  const cases = reads.filter((r) => isNoRead(r.outcome)).map((r) => r.case);
  if (reads.length > 0 && cases.length === 0) return undefined;
  const models = options.models === undefined ? undefined : cpuText(options.models);
  const cpu = models?.text;
  const mixed = models?.mixed ?? false;
  const reason = options.reason === undefined || part(options.reason) === "" ? undefined : part(options.reason);
  const counts = reads.length === 0 ? "no read: the read has no cases" : `no read for ${cases.length} of ${reads.length} cases: ${cases.join(", ")}`;
  const parts = [counts, reason, cpu].filter((p): p is string => p !== undefined);
  const text = `${options.title}: ${parts.map((p) => `${p}.`).join(" ")} A no read is not a pass.`;
  return { title: options.title, count: cases.length, total: reads.length, cases, cpu, reason, mixed, text };
}

/** This function escapes the data of a workflow command of GitHub Actions. */
function escapeData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** This function escapes a property of a workflow command of GitHub Actions. */
function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** The level of a no-read annotation: `error` for an enforced gate, `warning` for a read that only reports. */
export type NoReadLevel = "warning" | "error";

/** The outputs of `writeNoRead`. The defaults are the standard output and the file of `GITHUB_STEP_SUMMARY`. */
export interface NoReadOutputs {
  /**
   * The level of the annotation. Use `error` for a gate that decides the check, and `warning` for a read that only reports.
   * The default is `warning`.
   */
  readonly level?: NoReadLevel;
  /** This function writes one line of the log. The default writes to the standard output. */
  readonly log?: (line: string) => void;
  /** The file of the step summary. The default is the variable `GITHUB_STEP_SUMMARY`. With no file, only the log gets the line. */
  readonly summary?: string | undefined;
}

/** The text that `writeNoRead` wrote. */
export interface NoReadWritten {
  /** The level of the annotation. */
  readonly level: NoReadLevel;
  /** The workflow command of GitHub Actions: a warning or an error. */
  readonly annotation: string;
  /** The line of the step summary. */
  readonly summary: string;
}

/**
 * This function writes a no-read line as an annotation and as a line of the step summary. A report-only run also writes
 * it, so its check shows the no-read. With no line, it writes nothing.
 * - The level `error` is for an enforced gate. The default level `warning` is for a read that only reports.
 *
 * @param line - The line of `noReadLine`.
 * @param outputs - The log and the file of the step summary.
 * @returns The written text, or undefined with no line.
 */
export function writeNoRead(line: NoReadLine | undefined, outputs: NoReadOutputs = {}): NoReadWritten | undefined {
  if (line === undefined) return undefined;
  const level = outputs.level ?? "warning";
  const annotation = `::${level} title=${escapeProperty(`No read: ${line.title}`)}::${escapeData(line.text)}`;
  const summary = `> [!${level === "error" ? "CAUTION" : "WARNING"}]\n> **No read.** ${line.text.replaceAll("\n", " ")}\n`;
  (outputs.log ?? ((s: string) => process.stdout.write(`${s}\n`)))(annotation);
  const file = "summary" in outputs ? outputs.summary : process.env["GITHUB_STEP_SUMMARY"];
  if (file !== undefined && file !== "") appendFileSync(file, `\n${summary}`);
  return { level, annotation, summary };
}
