/**
 * The command line of `rigor-gate-line`. A shell step of a workflow gives the reads and the options as JSON, and the
 * command writes the gate line with `writeGateLine`. The work is in this file, so a test can start the same command.
 */
import { type CaseRead, type GateLineOptions, type JobEnv, type JobModel, gateLine, jobModels, writeGateLine } from "./gate-line.ts";
import type { ArmModels } from "./model.ts";

/** The help text of `rigor-gate-line`. */
export const GATE_LINE_HELP: string = `rigor-gate-line: the check line of a gate read, as an annotation and a line of the step summary.

  rigor-gate-line [--from <file>] [--stream stdout|stderr] [--summary <file>]

  --from <file>      the JSON document. Without it, the command reads the standard input.
  --stream <name>    the stream of the annotation: stdout (the default) or stderr.
  --summary <file>   the file of the step summary. The default is the variable GITHUB_STEP_SUMMARY.
  --help             this text.

  The JSON document:
    { "reads": [{ "case": "read-1", "outcome": "beyond" }],
      "options": { "title": "store gate", "enforced": false, "reason": "too few rounds", "models": ... },
      "jobs": [{ "cpu": "AMD EPYC 7763", "cores": 4 }], "cores": true }
  "jobs" gives the models of jobModels when "options" has no "models". With "cores": true, the line names the cores.

  The exit code is 0 for a line and for no line. The step decides its own exit. A bad input gives the exit code 2.
`;

/** The inputs and outputs of `gateLineCli`. The bin gives the files and the streams of the process. */
export interface GateLineCliIo {
  /** This function gives the text of a file. */
  readonly readFile: (path: string) => string;
  /** This function gives the text of the standard input. */
  readonly readStdin: () => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** The environment. The command reads `GITHUB_STEP_SUMMARY` from it. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

interface CliFlags {
  from?: string;
  stream: "stdout" | "stderr";
  summary?: string;
  help: boolean;
}

function flags(argv: readonly string[]): CliFlags {
  const out: CliFlags = { stream: "stdout", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg : arg.slice(0, eq);
    if (name !== "--from" && name !== "--stream" && name !== "--summary") throw new Error(`unknown argument "${arg}"`);
    let value: string | undefined;
    if (eq >= 0) value = arg.slice(eq + 1);
    else {
      i += 1;
      value = argv[i];
    }
    if (value === undefined) throw new Error(`${name} needs a value`);
    if (name === "--from") out.from = value;
    else if (name === "--summary") out.summary = value;
    else if (value === "stdout" || value === "stderr") out.stream = value;
    else throw new Error(`--stream is stdout or stderr, not "${value}"`);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) throw new Error(`${name} is not a list of strings`);
  return value;
}

function caseReads(value: unknown): CaseRead[] {
  if (!Array.isArray(value)) throw new Error(`"reads" is not a list`);
  return value.map((r, i) => {
    if (!isRecord(r) || typeof r["case"] !== "string" || typeof r["outcome"] !== "string") throw new Error(`"reads"[${i}] has no string "case" and "outcome"`);
    return { case: r["case"], outcome: r["outcome"] };
  });
}

function models(value: unknown): ArmModels | JobModel[] {
  if (Array.isArray(value)) {
    return value.map((m, i) => {
      if (!isRecord(m) || typeof m["model"] !== "string" || !isCount(m["jobs"])) throw new Error(`"options.models"[${i}] has no string "model" and count "jobs"`);
      const cores = m["cores"];
      if (cores === undefined) return { model: m["model"], jobs: m["jobs"] };
      if (!isCount(cores)) throw new Error(`"options.models"[${i}].cores is not a count`);
      return { model: m["model"], cores, jobs: m["jobs"] };
    });
  }
  if (!isRecord(value) || typeof value["one"] !== "boolean") throw new Error(`"options.models" is not a list of job models or the models of two arms`);
  return { a: strings(value["a"], `"options.models.a"`), b: strings(value["b"], `"options.models.b"`), one: value["one"] };
}

function jobEnvs(value: unknown): JobEnv[] {
  if (!Array.isArray(value)) throw new Error(`"jobs" is not a list`);
  return value.map((j, i) => {
    if (!isRecord(j) || typeof j["cpu"] !== "string") throw new Error(`"jobs"[${i}] has no string "cpu"`);
    const cores = j["cores"];
    if (cores === undefined) return { cpu: j["cpu"] };
    if (!isCount(cores)) throw new Error(`"jobs"[${i}].cores is not a count`);
    return { cpu: j["cpu"], cores };
  });
}

/** This function reads the JSON document of the command: the reads and the options of `gateLine`. */
function document(text: string): { reads: CaseRead[]; options: GateLineOptions } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`the input is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new Error("the input is not a JSON object");
  const o = value["options"];
  if (!isRecord(o) || typeof o["title"] !== "string") throw new Error(`"options" has no string "title"`);
  if (o["enforced"] !== undefined && typeof o["enforced"] !== "boolean") throw new Error(`"options.enforced" is not a boolean`);
  if (o["reason"] !== undefined && typeof o["reason"] !== "string") throw new Error(`"options.reason" is not a string`);
  if (value["cores"] !== undefined && typeof value["cores"] !== "boolean") throw new Error(`"cores" is not a boolean`);
  if (o["models"] !== undefined && value["jobs"] !== undefined) throw new Error(`give "options.models" or "jobs", not both`);
  const from =
    o["models"] !== undefined ? models(o["models"]) : value["jobs"] !== undefined ? jobModels(jobEnvs(value["jobs"]), { cores: value["cores"] === true }) : undefined;
  const options: GateLineOptions = {
    title: o["title"],
    ...(o["enforced"] === undefined ? {} : { enforced: o["enforced"] }),
    ...(o["reason"] === undefined ? {} : { reason: o["reason"] }),
    ...(from === undefined ? {} : { models: from }),
  };
  return { reads: caseReads(value["reads"]), options };
}

/**
 * This function is the command `rigor-gate-line`. It reads the JSON document, and writes the line with `writeGateLine`.
 * - The exit code is 0 for a line and for no line, because the line informs. The step decides its own exit.
 * - A bad argument or a bad document gives the exit code 2, with the reason on the standard error.
 *
 * @param argv - The arguments after the name of the command.
 * @param io - The files, the streams and the environment.
 * @returns The exit code.
 */
export function gateLineCli(argv: readonly string[], io: GateLineCliIo): number {
  try {
    const f = flags(argv);
    if (f.help) {
      io.stdout(GATE_LINE_HELP);
      return 0;
    }
    const { reads, options } = document(f.from === undefined ? io.readStdin() : io.readFile(f.from));
    const write = f.stream === "stderr" ? io.stderr : io.stdout;
    writeGateLine(gateLine(reads, options), { log: (line) => write(`${line}\n`), summary: f.summary ?? io.env["GITHUB_STEP_SUMMARY"] });
    return 0;
  } catch (error) {
    io.stderr(`rigor-gate-line: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
