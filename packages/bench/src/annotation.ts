/**
 * The check line of a gate read. A GitHub annotation puts the outcome of a gate on the check of a pull request, and not
 * only in the log of a job. A "no read" is not a pass, so the check line names it, with its cases and the CPU models.
 */

import type { GateOutcome } from "./gate.ts";

/** The facts of one read of a gate that its check line shows. */
export interface GateNote {
  /** The name of the gate. The title of the annotation starts with it. */
  readonly gate: string;
  readonly outcome: GateOutcome;
  /** The reason of the outcome, as the gate gives it. */
  readonly reason: string;
  /** The cases with no read, or the cases that block. */
  readonly cases: readonly string[];
  /** The computers of the jobs, as `benchEnv` gives them. The note names each CPU model one time. */
  readonly envs: readonly { readonly cpu: string }[];
  /** The value is true when the outcome decides the check. A gate that only reports gives a warning, not an error. */
  readonly enforced: boolean;
}

// The escapes of a workflow command: the message escapes three characters, and a property escapes two more
const escapeData = (text: string): string => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const escapeProperty = (text: string): string => escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

/**
 * This function gives the workflow command of the annotation of a gate read, or `undefined` for a pass.
 *
 * - A "no read" or a block of an enforced gate is an error. A gate that only reports gives a warning.
 * - The title gives the gate, the outcome and the count of the cases.
 * - The message gives the reason, the cases and each CPU model of the jobs. Two models or more are a mixed pair.
 */
export function gateAnnotation(note: GateNote): string | undefined {
  if (note.outcome === "pass") return undefined;
  const level = note.enforced ? "error" : "warning";
  const cases = note.cases.length === 1 ? "1 case" : `${note.cases.length} cases`;
  const title = `${note.gate}: ${note.outcome}${note.enforced ? "" : " (report only)"}, ${cases}`;
  const cpus = [...new Set(note.envs.map((env) => env.cpu))].sort();
  const models = cpus.length === 0 ? "no CPU model" : cpus.length === 1 ? `CPU ${cpus[0]}` : `${cpus.length} CPU models (a mixed pair): ${cpus.join(" | ")}`;
  const listed = note.cases.length === 0 ? "" : ` Cases: ${note.cases.join(", ")}.`;
  return `::${level} title=${escapeProperty(title)}::${escapeData(`${note.reason}${listed} ${models}.`)}`;
}
