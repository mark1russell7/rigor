/**
 * The check line of a gate read. A block or a no-read that shows only in a table of the summary is easy to miss, and a
 * no-read is not a pass. This file gives one line for the whole read: the blocks, the no-reads, the reason and the CPU
 * models. It writes the line where the check of the run shows it: an annotation of GitHub Actions and the step summary.
 */
import { appendFileSync } from "node:fs";
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
  /** The count of the jobs on this model. */
  readonly jobs: number;
}

/**
 * This function gives the count of the jobs on each CPU model, sorted by the name of the model. The order of the names
 * is the order of their code units, so it does not change with the locale.
 *
 * @param envs - The computer of each job, for example as `benchEnv` gives it.
 */
export function jobModels(envs: readonly { readonly cpu: string }[]): JobModel[] {
  const counts = new Map<string, number>();
  for (const env of envs) counts.set(env.cpu, (counts.get(env.cpu) ?? 0) + 1);
  return [...counts.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)).map((model) => ({ model, jobs: counts.get(model) ?? 0 }));
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
   */
  readonly models?: ArmModels | readonly JobModel[];
}

/** The level of a gate line: `error` for an enforced gate, `warning` for a read that only reports. */
export type GateLineLevel = "warning" | "error";

/** The cases of a gate line with one kind of outcome. */
export interface GateLineCases {
  readonly count: number;
  /** The name of each case, in the order of the input. */
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
  /** This value is `true` when the arms are not one known model, or when the jobs are on more than one model. */
  readonly mixed: boolean;
  /** The line: the title, the blocks, the no-reads, the reason and the CPU models. Each sentence after the title starts with a capital letter. */
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
    const each = models.map((m) => `${m.model} (${m.jobs} ${m.jobs === 1 ? "job" : "jobs"})`).join(", ");
    return { text: `Jobs on ${models.length} CPU ${models.length === 1 ? "model" : "models"}: ${each}`, mixed: models.length > 1 };
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
 * - The line names each block and each no-read, not only the first.
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
          blocks.length > 0 ? `block for ${blocks.length} of ${reads.length} cases: ${blocks.join(", ")}` : undefined,
          noReads.length > 0 ? `no read for ${noReads.length} of ${reads.length} cases: ${noReads.join(", ")}` : undefined,
        ];
  const parts = [...counts, reason, models?.text].filter((p): p is string => p !== undefined);
  const close = reads.length === 0 || noReads.length > 0 ? " A no read is not a pass." : "";
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
    text: `${options.title}: ${parts.map((p, i) => `${i === 0 ? p : sentence(p)}.`).join(" ")}${close}`,
  };
}

/** This function escapes the data of a workflow command of GitHub Actions. */
function escapeData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** This function escapes a property of a workflow command of GitHub Actions. */
function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** The outputs of `writeGateLine`. The defaults are the standard output and the file of `GITHUB_STEP_SUMMARY`. */
export interface GateLineOutputs {
  /** This function writes one line of the log. The default writes to the standard output. */
  readonly log?: (line: string) => void;
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
 * - The title gives the name, the outcome and the counts. A read that only reports says so in the title.
 *
 * @param line - The line of `gateLine`.
 * @param outputs - The log and the file of the step summary.
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
  const title = `${line.title}: ${line.outcome}${line.level === "error" ? "" : " (report only)"}, ${counts.join(" and ")}`;
  const annotation = `::${line.level} title=${escapeProperty(title)}::${escapeData(line.text)}`;
  const word = line.outcome === "block" ? "Block" : "No read";
  const summary = `> [!${line.level === "error" ? "CAUTION" : "WARNING"}]\n> **${word}.** ${line.text.replaceAll("\n", " ")}\n`;
  (outputs.log ?? ((s: string) => process.stdout.write(`${s}\n`)))(annotation);
  const file = "summary" in outputs ? outputs.summary : process.env["GITHUB_STEP_SUMMARY"];
  if (file !== undefined && file !== "") appendFileSync(file, `\n${summary}`);
  return { annotation, summary };
}
