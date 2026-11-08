import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { armModels, gateOf, isNoRead, noReadLine, writeNoRead } from "./index.ts";

const ONE = armModels([{ a: "AMD EPYC 7763", b: "AMD EPYC 7763" }]);
const MIXED = armModels([
  { a: "AMD EPYC 7763", b: "AMD EPYC 7763" },
  { a: "AMD EPYC 9V74", b: "AMD EPYC 7763" },
]);

describe("noReadLine", () => {
  it("gives no line when each case has a read", () => {
    const reads = [
      { case: "a", outcome: "faster" },
      { case: "b", outcome: "same" },
      { case: "c", outcome: "within" },
      { case: "d", outcome: "not slower" },
    ];
    expect(noReadLine(reads, { title: "bench" })).toBeUndefined();
  });

  it("gives a line for an empty list, as gateOf gives no read", () => {
    const line = noReadLine([], { title: "gate" });
    expect(gateOf([]).outcome).toBe("no read");
    expect(line).toMatchObject({ count: 0, total: 0, cases: [] });
    expect(line?.text).toBe("gate: no read: the read has no cases. A no read is not a pass.");
  });

  it("gives one line that names each of n no-read cases", () => {
    const reads = Array.from({ length: 7 }, (_, i) => ({ case: `c${i}`, outcome: i % 2 === 0 ? "cannot decide" : "slower" }));
    const line = noReadLine(reads, { title: "evaluator bench" });
    expect(line).toMatchObject({ count: 4, total: 7, cases: ["c0", "c2", "c4", "c6"], cpu: undefined, mixed: false });
    expect(line?.text).toBe("evaluator bench: no read for 4 of 7 cases: c0, c2, c4, c6. A no read is not a pass.");
  });

  it("reads the no-read cases of gateOf", () => {
    const gate = gateOf([
      { case: "x", outcome: "within" },
      { case: "y", outcome: "cannot decide" },
    ]);
    const line = noReadLine(gate.noRead.map((c) => ({ case: c, outcome: "no read" })).concat({ case: "x", outcome: "within" }), { title: "gate" });
    expect(line?.cases).toEqual(["y"]);
  });

  it("names the CPU pair, and tells a mixed pair", () => {
    const reads = [{ case: "a", outcome: "cannot decide" }];
    const one = noReadLine(reads, { title: "t", models: ONE });
    expect(one).toMatchObject({ cpu: "CPU a AMD EPYC 7763, b AMD EPYC 7763", mixed: false });
    const mixed = noReadLine(reads, { title: "t", models: MIXED });
    expect(mixed?.mixed).toBe(true);
    expect(mixed?.text).toContain("CPU a AMD EPYC 7763 + AMD EPYC 9V74, b AMD EPYC 7763 (a mixed pair");
  });

  it("knows the two words of a no-read", () => {
    expect(["cannot decide", "no read", "same", "within", "beyond", "pass"].map(isNoRead)).toEqual([true, true, false, false, false, false]);
  });
});

describe("writeNoRead", () => {
  it("writes nothing with no line", () => {
    const lines: string[] = [];
    expect(writeNoRead(undefined, { log: (s) => lines.push(s), summary: undefined })).toBeUndefined();
    expect(lines).toEqual([]);
  });

  it("writes a warning annotation with escaped text, and a line of the step summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "no-read-"));
    try {
      const file = join(dir, "summary.md");
      const lines: string[] = [];
      const line = noReadLine([{ case: "50%\nsplit", outcome: "cannot decide" }], { title: "bench: a, b" });
      const written = writeNoRead(line, { log: (s) => lines.push(s), summary: file });
      expect(lines).toEqual(["::warning title=No read%3A bench%3A a%2C b::bench: a, b: no read for 1 of 1 cases: 50%25%0Asplit. A no read is not a pass."]);
      expect(written?.annotation).toBe(lines[0]);
      expect(readFileSync(file, "utf8")).toBe("\n> [!WARNING]\n> **No read.** bench: a, b: no read for 1 of 1 cases: 50% split. A no read is not a pass.\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes only the log when there is no summary file", () => {
    const lines: string[] = [];
    const written = writeNoRead(noReadLine([], { title: "t" }), { log: (s) => lines.push(s), summary: "" });
    expect(lines).toHaveLength(1);
    expect(written?.summary).toContain("**No read.**");
  });
});
