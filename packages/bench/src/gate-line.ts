/**
 * The check line of a gate read. A block or a no-read that shows only in a table of the summary is easy to miss, and a
 * no-read is not a pass. This file gives one line for the whole read: the blocks, the no-reads, the reason and the CPU
 * models. It writes the line where the check of the run shows it: an annotation of GitHub Actions and the step summary.
 */
import { appendFileSync } from "node:fs";
import { escapeWorkflowData as escapeData, escapeWorkflowProperty as escapeProperty } from "@mark1russell7/text";
import type { GateOutcome } from "./gate.ts";
import type { ArmModels } from "./model.ts";

/**
 * The outcome of one case of a read.
 * - The words `cannot decide` (of `timeVerdict`, `limitVerdict` and `budgetVerdict`) and `no read` (of `notSlowerVerdict`) are no-reads.
 * - The words `beyond` (of `limitVerdict` and `budgetVerdict`) and `slower` (of `notSlowerVerdict` and `timeVerdict`) are blocks.
 * - Each other word is a pass.
 */
export interface CaseRead {
  readonly case: string;
  readonly outcome: string;
}

/** The jobs of a read on one CPU model. A time budget takes its ratios inside one job, so it has this form of the models. */
export interface JobModel {
  readonly model: string;
  /** The count of the cores of the jobs on this model. Without it, the line names only the model. */
  readonly cores?: number;
  /** The count of the jobs on this model. */
  readonly jobs: number;
}

/** The computer of one job for `jobModels`, for example as `benchEnv` gives it. */
export interface JobEnv {
  readonly cpu: string;
  /** The count of the cores of the job. `jobModels` reads it only with the option `cores`. */
  readonly cores?: number;
}

/** The options of `jobModels`. */
export interface JobModelsOptions {
  /** The value is `true` to keep the count of the cores. Then each model and count of cores has an entry. The default is `false`. */
  readonly cores?: boolean;
}

function compareText(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * This function gives the count of the jobs on each CPU model, sorted by the name of the model. The order of the names
 * is the order of their code units, so it does not change with the locale.
 * - With the option `cores`, each model and count of cores has an entry. The entries of one model are sorted by the cores. An entry with no cores is first.
 * - Without the option, the function does not read the cores. Thus the entries are the same as before the option.
 *
 * @param envs - The computer of each job, for example as `benchEnv` gives it.
 * @param options - The option `cores` keeps the count of the cores.
 */
export function jobModels(envs: readonly JobEnv[], options: JobModelsOptions = {}): JobModel[] {
  const keep = options.cores === true;
  const entries = new Map<string, { model: string; cores: number | undefined; jobs: number }>();
  for (const env of envs) {
    const cores = keep ? env.cores : undefined;
    const key = JSON.stringify([env.cpu, cores ?? null]);
    const entry = entries.get(key);
    if (entry === undefined) entries.set(key, { model: env.cpu, cores, jobs: 1 });
    else entry.jobs += 1;
  }
  return [...entries.values()]
    .sort((x, y) => compareText(x.model, y.model) || (x.cores ?? -1) - (y.cores ?? -1))
    .map((e) => (e.cores === undefined ? { model: e.model, jobs: e.jobs } : { model: e.model, cores: e.cores, jobs: e.jobs }));
}

/** The most cases of each kind that the text of a gate line names. The line tells the count of the other cases. The data keeps each case. */
export const GATE_LINE_NAMES: number = 10;

/**
 * The most characters of the text of a gate line.
 * - The Checks API of GitHub limits the message of an annotation to 64 KB. The documents of the workflow commands give no limit.
 * - Thus this value is a conservative limit, much less than 64 KB, for the annotation and for the step summary.
 */
export const GATE_LINE_LIMIT: number = 4096;

/** The most characters of a case name in the text of a gate line. A longer name ends with an ellipsis. */
const NAME_LENGTH = 120;

/** The most characters of the title of an annotation. The Checks API of GitHub gives this limit. */
const TITLE_LIMIT = 255;

/** This function cuts a text to a count of characters, with an ellipsis at the end. It does not cut a surrogate pair. */
function cut(text: string, length: number): string {
  if (text.length <= length) return text;
  let end = Math.max(0, length - 1);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** This function names the first cases of a list, and tells the count of the other cases. */
function named(cases: readonly string[]): string {
  const shown = cases
    .slice(0, GATE_LINE_NAMES)
    .map((c) => cut(c, NAME_LENGTH))
    .join(", ");
  const more = cases.length - GATE_LINE_NAMES;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

/** The options of `gateLine`. */
export interface GateLineOptions {
  /** The name of the read in the line, for example the name of the bench or of the gate. */
  readonly title: string;
  /** The value is `true` when the gate decides the check. Then a block or a no-read is an error. The default is `false`: the read only reports. */
  readonly enforced?: boolean;
  /** The reason of the outcome, for example "a decision needs 3 jobs, not 2". The line puts it after the counts. */
  readonly reason?: string;
  /**
   * The CPU models of the read, in one of two forms.
   * - An `ArmModels` of `armModels` gives the models of the two arms. The line tells a mixed pair, because a ratio can then compare two computers.
   * - A list of `JobModel` gives the jobs on each model, when each ratio is inside one job. The line makes no claim about the ratios.
   * - The line names the cores of a `JobModel` with `cores`. An empty list gives the sentence "The jobs have no CPU model".
   */
  readonly models?: ArmModels | readonly JobModel[];
}

/** The level of a gate line: `error` for an enforced gate, `warning` for a read that only reports. */
export type GateLineLevel = "warning" | "error";

/** The cases of a gate line with one kind of outcome. */
export interface GateLineCases {
  readonly count: number;
  /** The name of each case, in the order of the input. This list has each case, also when the text names only the first cases. */
  readonly cases: readonly string[];
}

/** The check line of a gate read with a block or a no-read. */
export interface GateLine {
  readonly title: string;
  /** The outcome of the read, as `gateOf` gives it: a block decides before a no-read. */
  readonly outcome: Exclude<GateOutcome, "pass">;
  readonly level: GateLineLevel;
  /** The count of all the cases. */
  readonly total: number;
  readonly blocks: GateLineCases;
  readonly noReads: GateLineCases;
  /** The reason, or undefined without `reason`. */
  readonly reason: string | undefined;
  /** The CPU models as text, or undefined without `models`. */
  readonly cpu: string | undefined;
  /** This value is `true` when the arms are not one known model, or when the jobs have more than one entry of `JobModel`. */
  readonly mixed: boolean;
  /**
   * The line: the title, the blocks, the no-reads, the reason and the CPU models. Each sentence after the title starts with a capital letter.
   * - The line names at most `GATE_LINE_NAMES` cases of each kind, and then tells the count of the other cases. The counts are exact.
   * - The line has at most `GATE_LINE_LIMIT` characters.
   */
  readonly text: string;
}

/** This function tells if an outcome is a no-read: `cannot decide` or `no read`. */
export function isNoRead(outcome: string): boolean {
  return outcome === "cannot decide" || outcome === "no read";
}

/** This function tells if an outcome is a block: `beyond` or `slower`. */
export function isBlock(outcome: string): boolean {
  return outcome === "beyond" || outcome === "slower";
}

function isJobModels(models: ArmModels | readonly JobModel[]): models is readonly JobModel[] {
  return Array.isArray(models);
}

function cpuText(models: ArmModels | readonly JobModel[]): { text: string; mixed: boolean } {
  if (isJobModels(models)) {
    if (models.length === 0) return { text: "The jobs have no CPU model", mixed: false };
    const cores = (m: JobModel): string => (m.cores === undefined ? "" : ` with ${m.cores} ${m.cores === 1 ? "core" : "cores"}`);
    const each = models.map((m) => `${m.model}${cores(m)} (${m.jobs} ${m.jobs === 1 ? "job" : "jobs"})`).join(", ");
    const count = new Set(models.map((m) => m.model)).size;
    return { text: `Jobs on ${count} CPU ${count === 1 ? "model" : "models"}: ${each}`, mixed: models.length > 1 };
  }
  const side = (values: readonly string[]): string => values.join(" + ");
  const pair = `CPU a ${side(models.a)}, b ${side(models.b)}`;
  return { text: models.one ? pair : `${pair} (a mixed pair: a ratio can compare two computers)`, mixed: !models.one };
}

/** This function removes the full stop at the end of a part of the line, so the line has one full stop after it. */
function part(text: string): string {
  let end = text.trim();
  while (end.endsWith(".")) end = end.slice(0, -1);
  return end;
}

/** This function gives a part of the line with a capital first letter, because the part starts a sentence. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * This function gives the check line of a list of case outcomes.
 * - The result is undefined when each case passed.
 * - An empty list is a no-read, as in `gateOf`: the line tells that the read has no cases.
 * - The line names the blocks and the no-reads, not only the first. It names at most `GATE_LINE_NAMES` of each kind, and tells the count of the others.
 * - The text has at most `GATE_LINE_LIMIT` characters. A case name of more than 120 characters ends with an ellipsis in the text.
 * - The level is `error` for an enforced gate, and `warning` for a read that only reports.
 *
 * @param reads - The case outcomes, for example the cases of a gate or one entry for each `timeVerdict`.
 * @param options - The title, the enforcement, the reason and the CPU models.
 */
export function gateLine(reads: readonly CaseRead[], options: GateLineOptions): GateLine | undefined {
  const blocks = reads.filter((r) => isBlock(r.outcome)).map((r) => r.case);
  const noReads = reads.filter((r) => isNoRead(r.outcome)).map((r) => r.case);
  if (reads.length > 0 && blocks.length === 0 && noReads.length === 0) return undefined;
  const models = options.models === undefined ? undefined : cpuText(options.models);
  const reason = options.reason === undefined || part(options.reason) === "" ? undefined : part(options.reason);
  const counts =
    reads.length === 0
      ? ["no read: the read has no cases"]
      : [
          blocks.length > 0 ? `block for ${blocks.length} of ${reads.length} cases: ${named(blocks)}` : undefined,
          noReads.length > 0 ? `no read for ${noReads.length} of ${reads.length} cases: ${named(noReads)}` : undefined,
        ];
  const parts = [...counts, reason, models?.text].filter((p): p is string => p !== undefined);
  const close = reads.length === 0 || noReads.length > 0 ? " A no read is not a pass." : "";
  const body = `${options.title}: ${parts.map((p, i) => `${i === 0 ? p : sentence(p)}.`).join(" ")}`;
  return {
    title: options.title,
    outcome: blocks.length > 0 ? "block" : "no read",
    level: options.enforced === true ? "error" : "warning",
    total: reads.length,
    blocks: { count: blocks.length, cases: blocks },
    noReads: { count: noReads.length, cases: noReads },
    reason,
    cpu: models?.text,
    mixed: models?.mixed ?? false,
    text: `${cut(body, GATE_LINE_LIMIT - close.length)}${close}`,
  };
}

/** The outputs of `writeGateLine`. The defaults are the standard output and the file of `GITHUB_STEP_SUMMARY`. */
export interface GateLineOutputs {
  /** This function writes one line of the log. The default writes to the stream of `stream`. */
  readonly log?: (line: string) => void;
  /** The stream of the log when there is no `log`: `stdout` or `stderr`. The default is `stdout`. GitHub Actions reads workflow commands from the two streams. */
  readonly stream?: "stdout" | "stderr";
  /** The file of the step summary. The default is the variable `GITHUB_STEP_SUMMARY`. With no file, only the log gets the line. */
  readonly summary?: string | undefined;
}

/** The text that `writeGateLine` wrote. */
export interface GateLineWritten {
  /** The workflow command of GitHub Actions: a warning or an error. */
  readonly annotation: string;
  /** The line of the step summary. */
  readonly summary: string;
}

function countText(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * This function writes a gate line as an annotation and as a line of the step summary. A report-only run also writes it,
 * so its check shows the read. With no line, it writes nothing.
 * - The annotation has the level of the line: `error` for an enforced gate, `warning` for a read that only reports.
 * - The title gives the name, the outcome and the counts. A read that only reports says so in the title. The title has at most 255 characters.
 * - The log is the standard output. With `stream: "stderr"`, the log is the standard error.
 *
 * @param line - The line of `gateLine`.
 * @param outputs - The log, its stream and the file of the step summary.
 * @returns The written text, or undefined with no line.
 */
export function writeGateLine(line: GateLine | undefined, outputs: GateLineOutputs = {}): GateLineWritten | undefined {
  if (line === undefined) return undefined;
  const counts =
    line.total === 0
      ? ["no cases"]
      : [
          line.blocks.count > 0 ? countText(line.blocks.count, "block", "blocks") : undefined,
          line.noReads.count > 0 ? countText(line.noReads.count, "no read", "no reads") : undefined,
        ].filter((c): c is string => c !== undefined);
  const title = cut(`${line.title}: ${line.outcome}${line.level === "error" ? "" : " (report only)"}, ${counts.join(" and ")}`, TITLE_LIMIT);
  const annotation = `::${line.level} title=${escapeProperty(title)}::${escapeData(line.text)}`;
  const word = line.outcome === "block" ? "Block" : "No read";
  const summary = `> [!${line.level === "error" ? "CAUTION" : "WARNING"}]\n> **${word}.** ${line.text.replaceAll("\n", " ")}\n`;
  const stream = outputs.stream === "stderr" ? process.stderr : process.stdout;
  (outputs.log ?? ((s: string) => stream.write(`${s}\n`)))(annotation);
  const file = "summary" in outputs ? outputs.summary : process.env["GITHUB_STEP_SUMMARY"];
  if (file !== undefined && file !== "") appendFileSync(file, `\n${summary}`);
  return { annotation, summary };
}
