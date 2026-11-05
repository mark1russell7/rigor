/**
 * The rows that accept a changed result of a bench case. A bench compares two arms, and two arms with different results do not do the same work.
 * So a difference stops the merge. A pull request can change a result on purpose, and without a stated path its author edits the case, and no gate reads that edit.
 * A row is that stated path. It names the case and the hash of each result, and it gives a reason. A reviewer can read the row against the run.
 *
 * Three rules stop the reuse of a row. The fields `base` and `head` bind the row to one change in one direction. A row counts only if it is new: the rows of the base are spent.
 * A new row that accepts nothing is a fault. These rules read results only, so the time of an accepted case stays with the time verdict of the bench.
 */

/** One row: a statement that the result of one case changes on purpose. */
export interface ResultRow {
  readonly case: string;
  /** The hash of the result of the base arm. The caller makes the hash, so a large result stays out of the file of rows. */
  readonly base: string;
  /** The hash of the result of the head arm. */
  readonly head: string;
  /** The reason for the change, in plain words. The verdict prints it. */
  readonly reason: string;
}

/** The hash of the result of one case in each arm. The hashes come from the same function as the hashes of the rows. */
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
  readonly outcome: "accepted" | "refused";
  /** The line that the check prints. A refused line gives the path through. */
  readonly line: string;
}

/** The read of one new row that accepted nothing. */
export interface RowRead {
  readonly row: ResultRow;
  readonly line: string;
}

/** A verdict over the results of a run and the rows. */
export interface ResultVerdict {
  /** The value "fail" means a refused case, or a new row that accepted nothing. */
  readonly outcome: "pass" | "fail";
  /** The cases with two different results. */
  readonly cases: readonly ResultRead[];
  /** The new rows of a case with one result, or with another change. Each one fails the verdict. */
  readonly unused: readonly RowRead[];
  /** The new rows of a case with no result in this run. The case can be skipped or filtered out. A missing read is no pass, so each one fails the verdict. */
  readonly absent: readonly RowRead[];
  /** The rows of the base that the head keeps. They accept nothing, and they do not fail the verdict. */
  readonly spent: readonly ResultRow[];
  /** The lines of `cases`, `unused` and `absent`, then one line with the count of `spent`. */
  readonly lines: readonly string[];
}

const keyOf = (row: CaseResults): string => JSON.stringify([row.case, row.base, row.head]);

/** This function checks the parsed content of a file of rows. A row with an empty field, or the same row two times, stops the read with an error. */
export function resultRows(content: unknown): ResultRow[] {
  if (!Array.isArray(content)) throw new Error("resultRows: the rows are an array.");
  const known = new Set<string>();
  return content.map((item: unknown, index) => {
    const row = (typeof item === "object" && item !== null ? item : {}) as Partial<Record<keyof ResultRow, unknown>>;
    const where = `resultRows: row ${String(index)}`;
    const { case: name, base, head, reason } = row;
    if (typeof name !== "string" || name === "") throw new Error(`${where} has no case.`);
    if (typeof base !== "string" || base === "") throw new Error(`${where} has no hash of the base.`);
    if (typeof head !== "string" || head === "") throw new Error(`${where} has no hash of the head.`);
    if (typeof reason !== "string" || reason.trim() === "") throw new Error(`${where} has no reason.`);
    const key = keyOf({ case: name, base, head });
    if (known.has(key)) throw new Error(`${where} repeats the case ${JSON.stringify(name)} with the same hashes.`);
    known.add(key);
    return { case: name, base, head, reason };
  });
}

/** This function tells which side of a run differs from a row. */
function moved(item: CaseResults, row: ResultRow): string {
  if (item.base !== row.base && item.head !== row.head) return "both sides moved";
  return item.base !== row.base ? "the base moved" : "the head moved";
}

/** This function gives the line of a case that no row accepts. */
function refusal(item: CaseResults, live: readonly ResultRow[], spent: ReadonlySet<string>): string {
  const start = `The case ${JSON.stringify(item.case)} gives two different results`;
  if (spent.has(keyOf(item))) return `${start}, and the base already has the row of this change, so that row is spent. Delete that row in its own pull request, then add the row again.`;
  const others = live.filter((row) => row.case === item.case);
  const read = `base ${item.base} and head ${item.head}`;
  if (others.length > 0) return `${start}: ${read}. ${others.map((row) => `A row accepts base ${row.base} and head ${row.head}, so ${moved(item, row)}.`).join(" ")}`;
  const row = JSON.stringify({ case: item.case, base: item.base, head: item.head, reason: "the reason for the change" });
  return `${start}, and no row accepts them. To accept this change, add the row ${row} in this pull request.`;
}

/**
 * This function gives the verdict over the results of a run. A case with two different results passes only with a new row of its exact hashes.
 * The verdict reads results only, so an accepted case still needs its time verdict.
 */
export function resultVerdict(results: readonly CaseResults[], rows: ResultRows): ResultVerdict {
  const spentKeys = new Set(rows.base.map(keyOf));
  const live = rows.head.filter((row) => !spentKeys.has(keyOf(row)));
  const used = new Set<string>();
  const cases = results
    .filter((item) => item.base !== item.head)
    .map((item): ResultRead => {
      const row = live.find((other) => keyOf(other) === keyOf(item));
      if (row === undefined) return { case: item.case, base: item.base, head: item.head, outcome: "refused", line: refusal(item, live, spentKeys) };
      used.add(keyOf(row));
      return { case: item.case, base: item.base, head: item.head, outcome: "accepted", line: `The case ${JSON.stringify(item.case)} changes its result from ${item.base} to ${item.head}, and a row accepts this: ${row.reason}` };
    });
  const named = new Set(results.map((item) => item.case));
  const idle = live.filter((row) => !used.has(keyOf(row)));
  const unused = idle
    .filter((row) => named.has(row.case))
    .map((row) => ({ row, line: `The new row of the case ${JSON.stringify(row.case)} accepts no change of this run. Delete or correct the row.` }));
  const absent = idle
    .filter((row) => !named.has(row.case))
    .map((row) => ({ row, line: `The new row of the case ${JSON.stringify(row.case)} has no read: the case has no result in this run.` }));
  const spent = rows.head.filter((row) => spentKeys.has(keyOf(row)));
  const fails = cases.some((item) => item.outcome === "refused") || unused.length > 0 || absent.length > 0;
  const count = spent.length > 0 ? [`The spent rows: ${String(spent.length)}. The base has them, so they accept nothing.`] : [];
  return { outcome: fails ? "fail" : "pass", cases, unused, absent, spent, lines: [...[...cases, ...unused, ...absent].map((item) => item.line), ...count] };
}
