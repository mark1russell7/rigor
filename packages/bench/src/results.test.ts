import { describe, expect, it } from "vitest";
import { type ResultRow, resultPair, resultRows, resultVerdict } from "./results.ts";

const row = (name: string, base: string, head: string): ResultRow => ({ case: name, pair: resultPair(base, head), reason: "the case reads one more field" });
const changed = { case: "x", base: "1", head: "2" };

describe("resultPair", () => {
  it("gives one hash for one pair, and a different hash for each other pair", () => {
    expect(resultPair("1", "2")).toBe(resultPair("1", "2"));
    expect(resultPair("1", "2")).toMatch(/^[0-9a-f]{64}$/);
    expect(resultPair("1", "3")).not.toBe(resultPair("1", "2"));
  });

  it("has an order, so a row of a change does not accept its revert", () => {
    expect(resultPair("2", "1")).not.toBe(resultPair("1", "2"));
  });

  it("keeps the two results apart, so moving a character between them changes the hash", () => {
    expect(resultPair("ab", "c")).not.toBe(resultPair("a", "bc"));
    expect(resultPair('a","b', "c")).not.toBe(resultPair("a", 'b","c'));
  });
});

describe("resultVerdict", () => {
  it("passes with no row when each case gives one result", () => {
    expect(resultVerdict([{ case: "x", base: "1", head: "1" }], { base: [], head: [] })).toEqual({ outcome: "pass", cases: [], unused: [], spent: [], lines: [] });
  });

  it("refuses a change with no row, and prints the exact row to add", () => {
    const verdict = resultVerdict([changed], { base: [], head: [] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ case: "x", outcome: "refused", base: "1", head: "2", pair: resultPair("1", "2") }]);
    expect(verdict.lines[0]).toContain(`{"case":"x","pair":"${resultPair("1", "2")}","reason":"the reason for the change"}`);
  });

  // The flip: one row, two runs. The same row passes on its pair and fails on one other result, for the stated reason.
  it("accepts a new row of the exact pair, and prints its reason", () => {
    const verdict = resultVerdict([changed], { base: [], head: [row("x", "1", "2")] });
    expect(verdict.outcome).toBe("pass");
    expect(verdict.cases).toMatchObject([{ case: "x", outcome: "accepted" }]);
    expect(verdict.lines).toEqual([`The case "x" changes its result, and a row accepts the pair ${resultPair("1", "2")}: the case reads one more field`]);
  });

  it("refuses the same row against one other result, because the hash binds the row to its pair", () => {
    const verdict = resultVerdict([{ case: "x", base: "1", head: "3" }], { base: [], head: [row("x", "1", "2")] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ outcome: "refused", pair: resultPair("1", "3") }]);
    expect(verdict.lines[0]).toBe(`The case "x" gives two different results, with the pair ${resultPair("1", "3")}. The rows of this case accept only ${resultPair("1", "2")}.`);
    expect(verdict.unused.map((item) => item.row.pair)).toEqual([resultPair("1", "2")]);
  });

  it("refuses a row of another case with the same pair", () => {
    const verdict = resultVerdict([changed], { base: [], head: [row("y", "1", "2")] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ case: "x", outcome: "refused" }]);
  });

  it("refuses a revert under the row of the change", () => {
    expect(resultVerdict([{ case: "x", base: "2", head: "1" }], { base: [], head: [row("x", "1", "2")] }).outcome).toBe("fail");
  });

  it("reads a row of the base as spent: it accepts nothing, and it does not fail a run with no change", () => {
    const spent = row("x", "1", "2");
    const verdict = resultVerdict([{ case: "x", base: "2", head: "2" }], { base: [spent], head: [spent] });
    expect(verdict.outcome).toBe("pass");
    expect(verdict.spent.map((item) => item.row)).toEqual([spent]);
    expect(verdict.lines).toEqual([`The row of the case "x" with the pair ${spent.pair} is spent: the base has it, so it accepts nothing.`]);
  });

  it("refuses the pair of a spent row when it comes again, and states the path through", () => {
    const spent = row("x", "1", "2");
    const verdict = resultVerdict([changed], { base: [spent], head: [spent] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ outcome: "refused" }]);
    expect(verdict.lines[0]).toBe('The case "x" gives two different results, and the base already has the row of this pair, so that row is spent. Delete that row in its own pull request, then add the row again.');
    expect(verdict.spent).toHaveLength(1);
  });

  it("reads a changed reason on a spent row as the same spent row", () => {
    const spent = row("x", "1", "2");
    expect(resultVerdict([changed], { base: [spent], head: [{ ...spent, reason: "a new reason" }] }).outcome).toBe("fail");
  });

  it("accepts the pair again after the base deleted the spent row", () => {
    expect(resultVerdict([changed], { base: [], head: [row("x", "1", "2")] }).outcome).toBe("pass");
  });

  it("fails on a new row that accepts nothing, and names it", () => {
    const stale = row("x", "1", "2");
    const verdict = resultVerdict([{ case: "x", base: "1", head: "1" }], { base: [], head: [stale] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toEqual([]);
    expect(verdict.unused.map((item) => item.row)).toEqual([stale]);
    expect(verdict.lines).toEqual([`The new row of the case "x" with the pair ${stale.pair} accepts no change of this run. Delete or correct the row.`]);
  });

  it("reads each case by itself: one accepted case does not carry a refused case", () => {
    const verdict = resultVerdict([changed, { case: "y", base: "1", head: "2" }], { base: [], head: [row("x", "1", "2")] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases.map((item) => [item.case, item.outcome])).toEqual([
      ["x", "accepted"],
      ["y", "refused"],
    ]);
  });

  it("lets two new rows of one case stand only if each accepts a change, so the second one fails", () => {
    const verdict = resultVerdict([changed], { base: [], head: [row("x", "1", "2"), row("x", "1", "3")] });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.cases).toMatchObject([{ outcome: "accepted" }]);
    expect(verdict.unused.map((item) => item.row.pair)).toEqual([resultPair("1", "3")]);
  });
});

describe("resultRows", () => {
  it("gives the rows of a good file, and only their three fields", () => {
    const good = row("x", "1", "2");
    expect(resultRows([good])).toEqual([good]);
    expect(resultRows([{ ...good, note: "more" }])).toEqual([good]);
    expect(resultRows([])).toEqual([]);
  });

  it.each([
    ["no array", { rows: [] }, /the rows are an array/],
    ["no object", [3], /row 0 has no case/],
    ["no case", [{ pair: resultPair("1", "2"), reason: "r" }], /row 0 has no case/],
    ["an empty case", [{ case: "", pair: resultPair("1", "2"), reason: "r" }], /row 0 has no case/],
    ["no pair", [{ case: "x", reason: "r" }], /row 0 has no pair/],
    ["a short pair", [{ case: "x", pair: "abc", reason: "r" }], /row 0 has no pair/],
    ["no reason", [{ case: "x", pair: resultPair("1", "2") }], /row 0 has no reason/],
    ["a blank reason", [{ case: "x", pair: resultPair("1", "2"), reason: "  " }], /row 0 has no reason/],
  ])("stops on %s", (_name, content, message) => {
    expect(() => resultRows(content)).toThrow(message);
  });

  it("stops on one row two times, even with two reasons", () => {
    const good = row("x", "1", "2");
    expect(() => resultRows([good, { ...good, reason: "another" }])).toThrow(/row 1 repeats the case "x" with the same pair/);
  });
});
