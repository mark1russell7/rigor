/**
 * The rows that accept a changed result of a bench case. A bench compares two arms, and two arms with different results do not do the same work.
 * So a difference stops the merge. A pull request can change a result on purpose, and without a stated path its author edits the case, and no gate reads that edit.
 * A row is that stated path. It names the case and the hash of the exact pair of results, and it gives a reason.
 *
 * Three rules stop the reuse of a row. The hash binds the row to one pair in one order. A row counts only if it is new: the rows of the base are spent.
 * A new row that accepts nothing is a fault. These rules read results only, so the time of an accepted case stays with the time verdict of the bench.
 *
 * This entry uses `node:crypto`, so it is for Node only.
 */
import { createHash } from "node:crypto";

/** One row: a statement that the result of one case changes on purpose. */
export interface ResultRow {
  readonly case: string;
  /** The hash of the two results, from `resultPair`. */
  readonly pair: string;
  /** The reason for the change, in plain words. The verdict prints it. */
  readonly reason: string;
}

/** The results of one case in the two arms. */
export interface CaseResults {
  readonly case: string;
  readonly base: string;
  readonly head: string;
}

/** The rows of the base and of the head. A row of the head that the base also has is spent. */
export interface ResultRows {
  readonly base: readonly ResultRow[];
  readonly head: readonly ResultRow[];
}

/** The read of one case with two different results. */
export interface ResultRead extends CaseResults {
  readonly pair: string;
  readonly outcome: "accepted" | "refused";
  /** The line that the check prints. A refused line gives the path through. */
  readonly line: string;
}

/** The read of one row that accepted nothing. */
export interface RowRead {
  readonly row: ResultRow;
  readonly line: string;
}

/** A verdict over the results of a run and the rows. */
export interface ResultVerdict {
  /** The value "fail" means a refused case or a new row that accepted nothing. */
  readonly outcome: "pass" | "fail";
  /** The cases with two different results. */
  readonly cases: readonly ResultRead[];
  /** The new rows that accepted nothing. Each one fails the verdict. */
  readonly unused: readonly RowRead[];
  /** The rows of the base that the head keeps. They accept nothing, and they do not fail the verdict. */
  readonly spent: readonly RowRead[];
  /** All the lines, in the order of `cases`, `unused` and `spent`. */
  readonly lines: readonly string[];
}

/** This function gives the hash of a pair of results. The pair has an order, so a change and its revert have different hashes. */
export function resultPair(base: string, head: string): string {
  return createHash("sha256")
    .update(JSON.stringify([base, head]))
    .digest("hex");
}

const PAIR = /^[0-9a-f]{64}$/;

const keyOf = (name: string, pair: string): string => JSON.stringify([name, pair]);

/** This function checks the parsed content of a file of rows. A row with no reason or with a bad hash, or the same row two times, stops the read with an error. */
export function resultRows(content: unknown): ResultRow[] {
  if (!Array.isArray(content)) throw new Error("resultRows: the rows are an array.");
  const known = new Set<string>();
  return content.map((item: unknown, index) => {
    const row = (typeof item === "object" && item !== null ? item : {}) as Partial<Record<keyof ResultRow, unknown>>;
    const where = `resultRows: row ${String(index)}`;
    const { case: name, pair, reason } = row;
    if (typeof name !== "string" || name === "") throw new Error(`${where} has no case.`);
    if (typeof pair !== "string" || !PAIR.test(pair)) throw new Error(`${where} has no pair from resultPair.`);
    if (typeof reason !== "string" || reason.trim() === "") throw new Error(`${where} has no reason.`);
    const key = keyOf(name, pair);
    if (known.has(key)) throw new Error(`${where} repeats the case ${JSON.stringify(name)} with the same pair.`);
    known.add(key);
    return { case: name, pair, reason };
  });
}

/** This function gives the line of a case that no row accepts. */
function refusal(name: string, pair: string, rows: readonly ResultRow[], spent: ReadonlySet<string>): string {
  const start = `The case ${JSON.stringify(name)} gives two different results`;
  if (spent.has(keyOf(name, pair))) return `${start}, and the base already has the row of this pair, so that row is spent. Delete that row in its own pull request, then add the row again.`;
  const others = rows.filter((row) => row.case === name).map((row) => row.pair);
  if (others.length > 0) return `${start}, with the pair ${pair}. The rows of this case accept only ${others.join(" and ")}.`;
  const row = JSON.stringify({ case: name, pair, reason: "the reason for the change" });
  return `${start}, and no row accepts them. To accept this change, add the row ${row} in this pull request.`;
}

/**
 * This function gives the verdict over the results of a run. A case with two different results passes only with a new row of its exact pair.
 * The verdict reads results only, so an accepted case still needs its time verdict.
 */
export function resultVerdict(results: readonly CaseResults[], rows: ResultRows): ResultVerdict {
  const spentKeys = new Set(rows.base.map((row) => keyOf(row.case, row.pair)));
  const live = rows.head.filter((row) => !spentKeys.has(keyOf(row.case, row.pair)));
  const used = new Set<string>();
  const cases = results
    .filter((item) => item.base !== item.head)
    .map((item): ResultRead => {
      const pair = resultPair(item.base, item.head);
      const row = live.find((other) => other.case === item.case && other.pair === pair);
      if (row === undefined) return { ...item, pair, outcome: "refused", line: refusal(item.case, pair, live, spentKeys) };
      used.add(keyOf(row.case, row.pair));
      return { ...item, pair, outcome: "accepted", line: `The case ${JSON.stringify(item.case)} changes its result, and a row accepts the pair ${pair}: ${row.reason}` };
    });
  const unused = live
    .filter((row) => !used.has(keyOf(row.case, row.pair)))
    .map((row) => ({ row, line: `The new row of the case ${JSON.stringify(row.case)} with the pair ${row.pair} accepts no change of this run. Delete or correct the row.` }));
  const spent = rows.head
    .filter((row) => spentKeys.has(keyOf(row.case, row.pair)))
    .map((row) => ({ row, line: `The row of the case ${JSON.stringify(row.case)} with the pair ${row.pair} is spent: the base has it, so it accepts nothing.` }));
  const fails = cases.some((item) => item.outcome === "refused") || unused.length > 0;
  return { outcome: fails ? "fail" : "pass", cases, unused, spent, lines: [...cases, ...unused, ...spent].map((item) => item.line) };
}
