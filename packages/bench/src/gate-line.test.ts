import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { armModels, gateLine, gateOf, isBlock, isNoRead, jobModels, writeGateLine } from "./index.ts";

const ONE = armModels([{ a: "AMD EPYC 7763", b: "AMD EPYC 7763" }]);
const MIXED = armModels([
  { a: "AMD EPYC 7763", b: "AMD EPYC 7763" },
  { a: "AMD EPYC 9V74", b: "AMD EPYC 7763" },
]);

/** This function writes a line to a list, with no summary file. */
function written(line: Parameters<typeof writeGateLine>[0]): { lines: string[]; out: ReturnType<typeof writeGateLine> } {
  const lines: string[] = [];
  return { lines, out: writeGateLine(line, { log: (s) => lines.push(s), summary: undefined }) };
}

describe("gateLine", () => {
  it("gives no line when each case passed", () => {
    const reads = [
      { case: "a", outcome: "faster" },
      { case: "b", outcome: "same" },
      { case: "c", outcome: "within" },
      { case: "d", outcome: "not slower" },
    ];
    expect(gateLine(reads, { title: "bench", enforced: true })).toBeUndefined();
    expect(written(gateLine(reads, { title: "bench" })).lines).toEqual([]);
  });

  it("gives a line for a block alone", () => {
    const line = gateLine([{ case: "a", outcome: "within" }, { case: "b", outcome: "beyond" }], { title: "store gate", enforced: true });
    expect(line).toMatchObject({ outcome: "block", level: "error", total: 2, blocks: { count: 1, cases: ["b"] }, noReads: { count: 0, cases: [] } });
    expect(line?.text).toBe("store gate: block for 1 of 2 cases: b.");
    expect(written(line).lines).toEqual(["::error title=store gate%3A block%2C 1 block::store gate: block for 1 of 2 cases: b."]);
  });

  it("gives a line for a no-read alone, with each of its cases", () => {
    const reads = Array.from({ length: 7 }, (_, i) => ({ case: `c${i}`, outcome: i % 2 === 0 ? "cannot decide" : "same" }));
    const line = gateLine(reads, { title: "evaluator bench" });
    expect(line).toMatchObject({ outcome: "no read", level: "warning", total: 7, blocks: { count: 0 }, noReads: { count: 4, cases: ["c0", "c2", "c4", "c6"] }, cpu: undefined, mixed: false });
    expect(line?.text).toBe("evaluator bench: no read for 4 of 7 cases: c0, c2, c4, c6. A no read is not a pass.");
  });

  it("names the blocks and the no-reads in one line, and a block decides the outcome as in gateOf", () => {
    const reads = [
      { case: "read-1", outcome: "beyond" },
      { case: "read-10", outcome: "cannot decide" },
      { case: "write-1", outcome: "within" },
      { case: "write-10", outcome: "cannot decide" },
    ];
    const line = gateLine(reads, { title: "store gate", enforced: true, reason: "too few rounds", models: ONE });
    expect(line?.outcome).toBe(gateOf(reads as Parameters<typeof gateOf>[0]).outcome);
    expect(line).toMatchObject({ outcome: "block", blocks: { count: 1, cases: ["read-1"] }, noReads: { count: 2, cases: ["read-10", "write-10"] } });
    expect(line?.text).toBe(
      "store gate: block for 1 of 4 cases: read-1. no read for 2 of 4 cases: read-10, write-10. too few rounds. CPU a AMD EPYC 7763, b AMD EPYC 7763. A no read is not a pass.",
    );
    expect(written(line).lines[0]).toBe(`::error title=store gate%3A block%2C 1 block and 2 no reads::${line?.text}`);
  });

  it("gives a warning for a read that only reports, and an error for an enforced gate", () => {
    const reads = [{ case: "a", outcome: "slower" }, { case: "b", outcome: "no read" }];
    const report = gateLine(reads, { title: "fan-out" });
    expect(report?.level).toBe("warning");
    expect(written(report).lines[0]?.startsWith("::warning title=fan-out%3A block (report only)%2C 1 block and 1 no read::")).toBe(true);
    expect(written(report).out?.summary.startsWith("> [!WARNING]\n> **Block.**")).toBe(true);
    const enforced = gateLine(reads, { title: "fan-out", enforced: true });
    expect(enforced?.level).toBe("error");
    expect(written(enforced).lines[0]?.startsWith("::error title=fan-out%3A block%2C 1 block and 1 no read::")).toBe(true);
    expect(written(enforced).out?.summary.startsWith("> [!CAUTION]\n> **Block.**")).toBe(true);
  });

  it("gives a line for an empty list, as gateOf gives no read", () => {
    const line = gateLine([], { title: "gate" });
    expect(gateOf([]).outcome).toBe("no read");
    expect(line).toMatchObject({ outcome: "no read", total: 0, blocks: { count: 0 }, noReads: { count: 0 } });
    expect(line?.text).toBe("gate: no read: the read has no cases. A no read is not a pass.");
    expect(written(line).lines[0]).toBe("::warning title=gate%3A no read (report only)%2C no cases::gate: no read: the read has no cases. A no read is not a pass.");
  });

  it("reads the cases of a Gate", () => {
    const gate = gateOf([
      { case: "x", outcome: "within" },
      { case: "y", outcome: "cannot decide" },
      { case: "z", outcome: "beyond" },
    ]);
    const reads = [...gate.blocks.map((c) => ({ case: c, outcome: "beyond" })), ...gate.noRead.map((c) => ({ case: c, outcome: "cannot decide" }))];
    expect(gateLine(reads, { title: "g" })).toMatchObject({ blocks: { cases: ["z"] }, noReads: { cases: ["y"] } });
  });

  it("puts a reason after the counts", () => {
    const line = gateLine([{ case: "a", outcome: "cannot decide" }], { title: "t", reason: "a decision needs 3 jobs, not 2.", models: ONE });
    expect(line?.reason).toBe("a decision needs 3 jobs, not 2");
    expect(line?.text).toBe("t: no read for 1 of 1 cases: a. a decision needs 3 jobs, not 2. CPU a AMD EPYC 7763, b AMD EPYC 7763. A no read is not a pass.");
    expect(gateLine([{ case: "a", outcome: "cannot decide" }], { title: "t", reason: " " })?.reason).toBeUndefined();
  });

  it("names the CPU pair, and tells a mixed pair", () => {
    const reads = [{ case: "a", outcome: "cannot decide" }];
    expect(gateLine(reads, { title: "t", models: ONE })).toMatchObject({ cpu: "CPU a AMD EPYC 7763, b AMD EPYC 7763", mixed: false });
    const mixed = gateLine(reads, { title: "t", models: MIXED });
    expect(mixed?.mixed).toBe(true);
    expect(mixed?.text).toContain("CPU a AMD EPYC 7763 + AMD EPYC 9V74, b AMD EPYC 7763 (a mixed pair");
  });

  it("names each model and its jobs in the job form, with no claim about a pair", () => {
    const reads = [{ case: "a", outcome: "cannot decide" }];
    const two = gateLine(reads, { title: "budget", models: [{ model: "AMD EPYC 7763", jobs: 2 }, { model: "AMD EPYC 9V74", jobs: 1 }] });
    expect(two).toMatchObject({ cpu: "jobs on 2 CPU models: AMD EPYC 7763 (2 jobs), AMD EPYC 9V74 (1 job)", mixed: true });
    expect(two?.text).not.toContain("pair");
    const one = gateLine(reads, { title: "budget", models: [{ model: "AMD EPYC 7763", jobs: 3 }] });
    expect(one).toMatchObject({ cpu: "jobs on 1 CPU model: AMD EPYC 7763 (3 jobs)", mixed: false });
    expect(one?.text).not.toContain("pair");
  });

  it("counts the jobs on each CPU model, sorted by model", () => {
    const envs = [{ cpu: "Intel Xeon 8370C" }, { cpu: "AMD EPYC 7763" }, { cpu: "Intel Xeon 8370C" }];
    expect(jobModels(envs)).toEqual([
      { model: "AMD EPYC 7763", jobs: 1 },
      { model: "Intel Xeon 8370C", jobs: 2 },
    ]);
    expect(jobModels([{ cpu: "b" }, { cpu: "a" }, { cpu: "a" }])).toEqual([
      { model: "a", jobs: 2 },
      { model: "b", jobs: 1 },
    ]);
    expect(jobModels([])).toEqual([]);
    expect(gateLine([{ case: "x", outcome: "cannot decide" }], { title: "t", models: jobModels(envs) })?.cpu).toBe("jobs on 2 CPU models: AMD EPYC 7763 (1 job), Intel Xeon 8370C (2 jobs)");
  });

  it("knows the words of a no-read and of a block", () => {
    const words = ["cannot decide", "no read", "beyond", "slower", "same", "within", "not slower", "faster"];
    expect(words.map(isNoRead)).toEqual([true, true, false, false, false, false, false, false]);
    expect(words.map(isBlock)).toEqual([false, false, true, true, false, false, false, false]);
  });
});

describe("writeGateLine", () => {
  it("writes nothing with no line", () => {
    const { lines, out } = written(undefined);
    expect(out).toBeUndefined();
    expect(lines).toEqual([]);
  });

  it("escapes the text of the annotation, and appends a line to the step summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-line-"));
    try {
      const file = join(dir, "summary.md");
      const lines: string[] = [];
      const line = gateLine([{ case: "50%\nsplit", outcome: "cannot decide" }], { title: "bench: a, b" });
      const out = writeGateLine(line, { log: (s) => lines.push(s), summary: file });
      expect(lines).toEqual(["::warning title=bench%3A a%2C b%3A no read (report only)%2C 1 no read::bench: a, b: no read for 1 of 1 cases: 50%25%0Asplit. A no read is not a pass."]);
      expect(out?.annotation).toBe(lines[0]);
      expect(readFileSync(file, "utf8")).toBe("\n> [!WARNING]\n> **No read.** bench: a, b: no read for 1 of 1 cases: 50% split. A no read is not a pass.\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes only the log when there is no summary file", () => {
    const lines: string[] = [];
    const out = writeGateLine(gateLine([], { title: "t" }), { log: (s) => lines.push(s), summary: "" });
    expect(lines).toHaveLength(1);
    expect(out?.summary).toContain("**No read.**");
  });
});
