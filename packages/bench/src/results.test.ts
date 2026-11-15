import { describe, expect, it } from "vitest";
import { type ResultRow, resultRows, resultVerdict } from "./index.ts";

const row = (name: string, base: string, head: string): ResultRow => ({ case: name, base, head, reason: "the case reads one more field" });
const changed = { case: "x", base: "h1", head: "h2" };

describe("resultVerdict", () => {
  it("passes with no row when each case gives one result", () => {
    expect(resultVerdict([{ case: "x", base: "h1", head: "h1" }], { base: [], head: [] })).toEqual({ outcome: "pass", cases: [], unused: [], absent: [], spent: [], lines: [] });
  });

  it("refuses a change with no row, and prints the exact row to add", () => {
    const verdict = resultVerdict([changed], { base: [], head: [] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ case: "x", outcome: "refused", base: "h1", head: "h2" }]);
    expect(verdict.lines[0]).toContain('{"case":"x","base":"h1","head":"h2","reason":"the reason for the change"}');
  });

  // The flip: one row, two runs. The same row passes on its change and fails on one other result, for the stated reason.
  it("accepts a new row of the exact hashes, and prints the change and its reason", () => {
    const verdict = resultVerdict([changed], { base: [], head: [row("x", "h1", "h2")] });
    expect(verdict.outcome).toBe("pass");
    expect(verdict.cases).toMatchObject([{ case: "x", outcome: "accepted" }]);
    expect(verdict.lines).toEqual(['The case "x" changes its result from h1 to h2, and a row accepts this: the case reads one more field']);
  });

  it.each([
    ["the head moved", { case: "x", base: "h1", head: "h3" }],
    ["the base moved", { case: "x", base: "h3", head: "h2" }],
    ["both sides moved", { case: "x", base: "h3", head: "h4" }],
  ])("refuses the same row when %s, and says so", (side, results) => {
    const verdict = resultVerdict([results], { base: [], head: [row("x", "h1", "h2")] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ outcome: "refused" }]);
    expect(verdict.lines[0]).toBe(`The case "x" gives two different results: base ${results.base} and head ${results.head}. A row accepts base h1 and head h2, so ${side}.`);
    expect(verdict.unused.map((item) => item.row.head)).toEqual(["h2"]);
  });

  it("refuses a row of another case with the same hashes", () => {
    const verdict = resultVerdict([changed, { case: "y", base: "h1", head: "h1" }], { base: [], head: [row("y", "h1", "h2")] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ case: "x", outcome: "refused" }]);
  });

  it("refuses a revert under the row of the change, because the fields bind the direction", () => {
    expect(resultVerdict([{ case: "x", base: "h2", head: "h1" }], { base: [], head: [row("x", "h1", "h2")] }).outcome).toBe("fail");
  });

  it("reads a row of the base as spent: it accepts nothing, and it does not fail a run with no change", () => {
    const spent = row("x", "h1", "h2");
    const verdict = resultVerdict([{ case: "x", base: "h2", head: "h2" }], { base: [spent], head: [spent] });
    expect(verdict.outcome).toBe("pass");
    expect(verdict.spent).toEqual([spent]);
    expect(verdict.lines).toEqual(["The spent rows: 1. The base has them, so they accept nothing."]);
  });

  it("prints spent rows as one count line, and keeps each row for the caller", () => {
    const rows = [row("x", "h1", "h2"), row("y", "h1", "h2"), row("z", "h1", "h2")];
    const verdict = resultVerdict([], { base: rows, head: rows });
    expect(verdict.lines).toEqual(["The spent rows: 3. The base has them, so they accept nothing."]);
    expect(verdict.spent).toEqual(rows);
  });

  it("does not read a spent row of a case with no result as absent", () => {
    const spent = row("gone", "h1", "h2");
    const verdict = resultVerdict([], { base: [spent], head: [spent] });
    expect(verdict.outcome).toBe("pass");
    expect(verdict.absent).toEqual([]);
  });

  it("refuses the change of a spent row when it comes again, and states the path through", () => {
    const spent = row("x", "h1", "h2");
    const verdict = resultVerdict([changed], { base: [spent], head: [spent] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ outcome: "refused" }]);
    expect(verdict.lines[0]).toBe('The case "x" gives two different results, and the base already has the row of this change, so that row is spent. Delete that row in its own pull request, then add the row again.');
    expect(verdict.spent).toHaveLength(1);
  });

  it("reads a changed reason on a spent row as the same spent row", () => {
    const spent = row("x", "h1", "h2");
    expect(resultVerdict([changed], { base: [spent], head: [{ ...spent, reason: "a new reason" }] }).outcome).toBe("fail");
  });

  it("fails on a new row of a case with one result, and tells the author to delete or correct it", () => {
    const stale = row("x", "h1", "h2");
    const verdict = resultVerdict([{ case: "x", base: "h1", head: "h1" }], { base: [], head: [stale] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toEqual([]);
    expect(verdict.unused.map((item) => item.row)).toEqual([stale]);
    expect(verdict.absent).toEqual([]);
    expect(verdict.lines).toEqual(['The new row of the case "x" accepts no change of this run. Delete or correct the row.']);
  });

  it("fails on a new row of a case with no result, with its own read and no advice to delete the row", () => {
    const row1 = row("skipped", "h1", "h2");
    const verdict = resultVerdict([{ case: "x", base: "h1", head: "h1" }], { base: [], head: [row1] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.unused).toEqual([]);
    expect(verdict.absent.map((item) => item.row)).toEqual([row1]);
    expect(verdict.lines).toEqual(['The new row of the case "skipped" has no read: the case has no result in this run.']);
  });

  it("reads each case by itself: one accepted case does not carry a refused case", () => {
    const verdict = resultVerdict([changed, { case: "y", base: "h1", head: "h2" }], { base: [], head: [row("x", "h1", "h2")] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases.map((item) => [item.case, item.outcome])).toEqual([
      ["x", "accepted"],
      ["y", "refused"],
    ]);
  });

  it("lets two new rows of one case stand only if each accepts a change, so the second one fails", () => {
    const verdict = resultVerdict([changed], { base: [], head: [row("x", "h1", "h2"), row("x", "h1", "h3")] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ outcome: "accepted" }]);
    expect(verdict.unused.map((item) => item.row.head)).toEqual(["h3"]);
  });
});

describe("resultRows", () => {
  it("gives the rows of a good file, and only their four fields", () => {
    const good = row("x", "h1", "h2");
    expect(resultRows([good])).toEqual([good]);
    expect(resultRows([{ ...good, note: "more" }])).toEqual([good]);
    expect(resultRows([])).toEqual([]);
  });

  it.each([
    ["no array", { rows: [] }, /the rows are an array/],
    ["no object", [3], /row 0 has no case/],
    ["no case", [{ base: "h1", head: "h2", reason: "r" }], /row 0 has no case/],
    ["an empty case", [{ case: "", base: "h1", head: "h2", reason: "r" }], /row 0 has no case/],
    ["no base", [{ case: "x", head: "h2", reason: "r" }], /row 0 has no hash of the base/],
    ["an empty head", [{ case: "x", base: "h1", head: "", reason: "r" }], /row 0 has no hash of the head/],
    ["no reason", [{ case: "x", base: "h1", head: "h2" }], /row 0 has no reason/],
    ["a blank reason", [{ case: "x", base: "h1", head: "h2", reason: "  " }], /row 0 has no reason/],
  ])("stops on %s", (_name, content, message) => {
    expect(() => resultRows(content)).toThrow(message);
  });

  it("stops on one row two times, even with two reasons", () => {
    const good = row("x", "h1", "h2");
    expect(() => resultRows([good, { ...good, reason: "another" }])).toThrow(/row 1 repeats the case "x" with the same hashes/);
  });
});
