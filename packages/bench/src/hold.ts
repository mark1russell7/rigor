/**
 * The hold of a speed gate, and the records that accept its cost (mark1russell7/rigor#118).
 *
 * A gate blocks a merge when a case is slower. Before this file, a summary check of a repository could stay green under
 * that hold: the hold showed only as a line in the output. Thus the hold has its own outcome here:
 * - `pass`: the gate passes, and no case is slower.
 * - `held`: a case is slower, and no record accepts its cost. The summary check fails.
 * - `accepted`: each slower case has a record that accepts its cost. The summary check passes and names each record.
 * - `no read`: the gate has no read, or a record is not valid. This is not a pass.
 *
 * A record accepts the cost of one case on one head arm:
 *
 *   [{ "case": "<name of the case>", "head": "<hash of the head arm>", "cost": "<the measured change>",
 *      "reason": "<why the cost is accepted>", "owner": "<who accepts it>" }]
 *
 * The field `head` has 12 to 64 characters of the hash of the head arm, in lower case. A record matches only when each
 * run has the same head arm, and its hash starts with the hash of the record. Thus a record accepts nothing after the code changes, and a record on the
 * main branch stays only as the trail of the cost. The first form of this gate is K239 of coeval.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Gate } from "./gate.ts";
import type { GateVerdictWord } from "./gate-line.ts";

/** One record that accepts the slower time of one case on one head arm. */
export interface HoldAcceptance {
  readonly case: string;
  /** The first 12 to 64 characters of the hash of the head arm, in lower case. */
  readonly head: string;
  /** The measured cost, as a person writes it, for example "+8 % (interval +5 % to +11 %)". */
  readonly cost: string;
  readonly reason: string;
  readonly owner: string;
  /** The name of the file of the record. */
  readonly file: string;
}

/** The records of a list of files, and the faults of the files that are not correct. */
export interface HoldAcceptanceRead {
  readonly records: readonly HoldAcceptance[];
  readonly faults: readonly string[];
}

/** The fields of a record. Each one is a text that is not empty. */
const FIELDS = ["case", "head", "cost", "reason", "owner"] as const;

/** The field `head`: 12 to 64 characters of a hash, in lower case. */
const HEAD = /^[0-9a-f]{12,64}$/;

/**
 * This function reads the records of a list of files. A file that is not a list of correct records gives a fault, and
 * none of its records count. Thus one record with an empty field gives the hold the outcome `no read`.
 *
 * @param files - The name and the text of each file.
 * @returns The records and the faults.
 */
export function holdAcceptances(files: readonly { readonly name: string; readonly text: string }[]): HoldAcceptanceRead {
  const records: HoldAcceptance[] = [];
  const faults: string[] = [];
  for (const { name, text } of files) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      faults.push(`The file ${name} is not JSON.`);
      continue;
    }
    if (!Array.isArray(data) || data.length === 0) {
      faults.push(`The file ${name} is not a list of records.`);
      continue;
    }
    const own: HoldAcceptance[] = [];
    const bad: string[] = [];
    data.forEach((item: unknown, index) => {
      const record = typeof item === "object" && item !== null && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      const empty = FIELDS.filter((key) => typeof record[key] !== "string" || (record[key] as string).trim() === "");
      if (empty.length > 0) bad.push(`The record ${String(index + 1)} of ${name} has no ${empty.join(", ")}.`);
      else if (!HEAD.test(record["head"] as string)) bad.push(`The record ${String(index + 1)} of ${name} has a head that is not 12 to 64 characters of a hash in lower case.`);
      else own.push({ case: record["case"] as string, head: record["head"] as string, cost: record["cost"] as string, reason: record["reason"] as string, owner: record["owner"] as string, file: name });
    });
    if (bad.length > 0) faults.push(...bad);
    else records.push(...own);
  }
  return { records, faults };
}

/**
 * This function reads the JSON files of a folder of records, in the order of their names. A folder that does not exist
 * has no records.
 *
 * @param dir - The folder, for example `bench/accepted` of the repository.
 * @returns The records and the faults.
 */
export function readHoldAcceptances(dir: string): HoldAcceptanceRead {
  if (!existsSync(dir)) return { records: [], faults: [] };
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return holdAcceptances(names.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") })));
}

/** The four outcomes of a hold. Only `pass` and `accepted` let the summary check pass. */
export type HoldOutcome = "pass" | "held" | "accepted" | "no read";

/** The hold of a gate, with the records that accept its cost. */
export interface HoldGate {
  readonly outcome: HoldOutcome;
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
  /** The record of each slower case that has one. */
  readonly accepted: readonly HoldAcceptance[];
  /** The slower cases that have no record. */
  readonly held: readonly string[];
  /** The line of each slower case, and of each fault of the records. */
  readonly lines: readonly string[];
}

/**
 * This function gives the hold of a gate. The slower cases are the blocks of the gate.
 * - A fault in the records, or a gate with no read, gives `no read`.
 * - A gate that passes gives `pass`.
 * - A gate that blocks gives `accepted` when each slower case has a record, and else `held`.
 *
 * A case has a record when the record has its name and the head arm of each run starts with the hash of the record. Runs
 * with different heads, a run with no hash and an empty list of runs accept nothing.
 *
 * @param gate - The gate, for example a `notSlowerVerdict` or the result of `gateOf`.
 * @param heads - The hash of the head arm of each run.
 * @param read - The records, from `holdAcceptances` or `readHoldAcceptances`.
 * @returns The hold.
 */
export function holdGate(gate: Gate, heads: readonly (string | undefined)[], read: HoldAcceptanceRead): HoldGate {
  if (read.faults.length > 0) {
    return { outcome: "no read", reason: `${read.faults.length} records of acceptance are not valid. The first: ${read.faults[0]}`, accepted: [], held: [...gate.blocks], lines: [...read.faults] };
  }
  if (gate.outcome === "no read") return { outcome: "no read", reason: gate.reason, accepted: [], held: [...gate.blocks], lines: [] };
  if (gate.outcome === "pass") return { outcome: "pass", reason: gate.reason, accepted: [], held: [], lines: [] };
  const first = heads[0];
  const head = first !== undefined && heads.every((item) => item === first) ? first : undefined;
  const accepted: HoldAcceptance[] = [];
  const held: string[] = [];
  const lines: string[] = [];
  for (const name of gate.blocks) {
    const record = head === undefined ? undefined : read.records.find((item) => item.case === name && head.startsWith(item.head));
    if (record === undefined) {
      held.push(name);
      lines.push(`Held: ${name} is slower, and no record accepts its cost on the head ${head === undefined ? "(the runs give no one head)" : head.slice(0, 12)}.`);
    } else {
      accepted.push(record);
      lines.push(`Accepted: ${name}, ${record.cost}, by ${record.owner}: ${record.reason} (${record.file}).`);
    }
  }
  if (held.length > 0) {
    return { outcome: "held", reason: `${held.length} of ${gate.blocks.length} slower cases have no record that accepts the cost. The first is ${JSON.stringify(held[0])}.`, accepted, held, lines };
  }
  return { outcome: "accepted", reason: `A record accepts the cost of each of the ${gate.blocks.length} slower cases.`, accepted, held, lines };
}

/** This function tells if a summary check passes with a hold outcome: only `pass` and `accepted` pass. */
export function holdPasses(outcome: HoldOutcome): boolean {
  return outcome === "pass" || outcome === "accepted";
}

/** This function gives the word of a hold outcome in the verdict file of a gate job: `accepted` is `pass`, and `held` is `block`. */
export function holdVerdictWord(outcome: HoldOutcome): GateVerdictWord {
  if (outcome === "no read") return "no-read";
  return holdPasses(outcome) ? "pass" : "block";
}
