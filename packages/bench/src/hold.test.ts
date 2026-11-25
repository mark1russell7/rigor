import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gateOf } from "./gate.ts";
import { holdAcceptances, holdGate, holdPasses, holdVerdictWord, readHoldAcceptances } from "./hold.ts";

const RECORD = { case: "x", head: "abcdef012345", cost: "+10 %", reason: "a test", owner: "rigor" };
const file = (records: unknown) => ({ name: "1.json", text: typeof records === "string" ? records : JSON.stringify(records) });
const FULL = "abcdef0123456789";
const slowerX = gateOf([
  { case: "x", outcome: "beyond" },
  { case: "y", outcome: "within" },
]);
const slowerXY = gateOf([
  { case: "x", outcome: "beyond" },
  { case: "y", outcome: "beyond" },
]);
const read = holdAcceptances([file([RECORD])]);

describe("the records that accept the cost of a hold", () => {
  it("reads a list of correct records, with the name of their file", () => {
    expect(read).toEqual({ records: [{ ...RECORD, file: "1.json" }], faults: [] });
  });

  it("gives a fault for a file that is not JSON, not a list, or an empty list", () => {
    expect(holdAcceptances([file("not JSON")]).faults).toEqual(["The file 1.json is not JSON."]);
    expect(holdAcceptances([file(RECORD)]).faults).toEqual(["The file 1.json is not a list of records."]);
    expect(holdAcceptances([file([])]).faults).toEqual(["The file 1.json is not a list of records."]);
  });

  it("gives a fault for each empty or absent field, and no record of that file counts", () => {
    const bad = holdAcceptances([file([RECORD, { ...RECORD, cost: " ", reason: undefined }, ["x"]])]);
    expect(bad.records).toEqual([]);
    expect(bad.faults).toEqual(["The record 2 of 1.json has no cost, reason.", "The record 3 of 1.json has no case, head, cost, reason, owner."]);
  });

  it("gives a fault for a head that is not 12 to 64 characters of a hash in lower case", () => {
    for (const head of ["abc", "ABCDEF012345", "abcdef01234g", "a".repeat(65)]) expect(holdAcceptances([file([{ ...RECORD, head }])]).faults).toHaveLength(1);
  });

  it("reads the JSON files of a folder in the order of their names, and no records from a folder that does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "hold-"));
    try {
      mkdirSync(join(dir, "sub"));
      writeFileSync(join(dir, "2.json"), JSON.stringify([{ ...RECORD, case: "b" }]));
      writeFileSync(join(dir, "10.json"), JSON.stringify([{ ...RECORD, case: "a" }]));
      writeFileSync(join(dir, "notes.md"), "not a record");
      expect(readHoldAcceptances(dir).records.map((r) => r.file)).toEqual(["10.json", "2.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(readHoldAcceptances(join(tmpdir(), "no-such-folder-of-records-118"))).toEqual({ records: [], faults: [] });
  });
});

describe("the hold of a gate (rigor#118)", () => {
  it("no hold: a gate that passes gives pass, also with records", () => {
    const hold = holdGate(gateOf([{ case: "x", outcome: "within" }]), [FULL], read);
    expect(hold).toMatchObject({ outcome: "pass", accepted: [], held: [], lines: [] });
    expect(holdPasses(hold.outcome)).toBe(true);
    expect(holdVerdictWord(hold.outcome)).toBe("pass");
  });

  it("a hold with a record gives accepted, and the line names the record", () => {
    const hold = holdGate(slowerX, [FULL, FULL], read);
    expect(hold).toMatchObject({ outcome: "accepted", held: [], accepted: [{ case: "x", file: "1.json" }] });
    expect(hold.lines).toEqual(["Accepted: x, +10 %, by rigor: a test (1.json)."]);
    expect(holdPasses(hold.outcome)).toBe(true);
    expect(holdVerdictWord(hold.outcome)).toBe("pass");
  });

  it("a hold with no record gives held, and the summary check fails", () => {
    const hold = holdGate(slowerX, [FULL], { records: [], faults: [] });
    expect(hold).toMatchObject({ outcome: "held", held: ["x"], accepted: [] });
    expect(hold.lines[0]).toContain("Held: x is slower");
    expect(holdPasses(hold.outcome)).toBe(false);
    expect(holdVerdictWord(hold.outcome)).toBe("block");
  });

  it("a record for another head accepts nothing, and nor do runs with different heads, a run with no hash or no runs", () => {
    expect(holdGate(slowerX, ["ffffff0123456789"], read).outcome).toBe("held");
    expect(holdGate(slowerX, [FULL, "abcdef0123450000"], read).outcome).toBe("held");
    expect(holdGate(slowerX, [FULL, "abcdef0000000000"], read).outcome).toBe("held");
    expect(holdGate(slowerX, [FULL, undefined], read).outcome).toBe("held");
    expect(holdGate(slowerX, [], read).lines[0]).toContain("(the runs give no one head)");
  });

  it("a record for another case accepts nothing: each slower case needs its own record", () => {
    expect(holdGate(slowerX, [FULL], holdAcceptances([file([{ ...RECORD, case: "y" }])])).held).toEqual(["x"]);
    const hold = holdGate(slowerXY, [FULL], read);
    expect(hold).toMatchObject({ outcome: "held", held: ["y"], accepted: [{ case: "x" }] });
    expect(hold.lines).toEqual([expect.stringContaining("Accepted: x"), expect.stringContaining("Held: y")]);
  });

  it("a record with an empty field gives no read, which is not a pass, also when the gate passes", () => {
    const bad = holdAcceptances([file([{ ...RECORD, owner: "" }])]);
    for (const gate of [slowerX, gateOf([{ case: "x", outcome: "within" }])]) {
      const hold = holdGate(gate, [FULL], bad);
      expect(hold.outcome).toBe("no read");
      expect(hold.lines).toEqual(["The record 1 of 1.json has no owner."]);
      expect(holdPasses(hold.outcome)).toBe(false);
      expect(holdVerdictWord(hold.outcome)).toBe("no-read");
    }
  });

  it("a gate with no read gives no read, and a record does not change it", () => {
    const hold = holdGate(gateOf([{ case: "x", outcome: "cannot decide" }]), [FULL], read);
    expect(hold.outcome).toBe("no read");
    expect(holdPasses(hold.outcome)).toBe(false);
  });
});
