import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATE_LINE_HELP, type GateLineCliIo, gateLine, gateLineCli, jobModels, writeGateLine } from "./index.ts";

const BIN = fileURLToPath(new URL("./cli.ts", import.meta.url));

const DOC = {
  reads: [
    { case: "read-1", outcome: "beyond" },
    { case: "read-10", outcome: "cannot decide" },
    { case: "write-1", outcome: "within" },
  ],
  options: { title: "store gate", reason: "too few rounds" },
  jobs: [{ cpu: "AMD EPYC 7763", cores: 4 }, { cpu: "AMD EPYC 7763", cores: 4 }],
  cores: true,
};

/** This function gives a fake io with files in a map, and keeps the text of each stream. */
function fakeIo(files: Record<string, string>, stdin = "", env: Record<string, string | undefined> = {}): GateLineCliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    readStdin: () => stdin,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env,
  };
}

/** This function gives the annotation that writeGateLine gives for the document, as the expected value. */
function expected(doc: typeof DOC): string {
  const line = gateLine(doc.reads, { ...doc.options, models: jobModels(doc.jobs, { cores: doc.cores }) });
  return writeGateLine(line, { log: () => undefined, summary: undefined })?.annotation ?? "";
}

describe("gateLineCli", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gate-line-cli-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the document from --from, and writes the annotation to stdout and the line to the summary of the environment", () => {
    const summary = join(dir, "summary.md");
    const io = fakeIo({ "doc.json": JSON.stringify(DOC) }, "", { GITHUB_STEP_SUMMARY: summary });
    expect(gateLineCli(["--from", "doc.json"], io)).toBe(0);
    expect(io.out).toEqual([`${expected(DOC)}\n`]);
    expect(io.out[0]).toBe(
      "::warning title=store gate%3A block (report only)%2C 1 block and 1 no read::store gate: block for 1 of 3 cases: read-1. No read for 1 of 3 cases: read-10. Too few rounds. Jobs on 1 CPU model: AMD EPYC 7763 with 4 cores (2 jobs). A no read is not a pass.\n",
    );
    expect(io.err).toEqual([]);
    expect(readFileSync(summary, "utf8")).toContain("> [!WARNING]\n> **Block.** store gate: block for 1 of 3 cases: read-1.");
  });

  it("reads stdin without --from, writes to stderr with --stream stderr, and takes --summary before the environment", () => {
    const summary = join(dir, "own.md");
    const doc = { reads: [{ case: "a", outcome: "slower" }], options: { title: "t", enforced: true, models: { a: ["m"], b: ["m"], one: true } } };
    const io = fakeIo({}, JSON.stringify(doc), { GITHUB_STEP_SUMMARY: join(dir, "env.md") });
    expect(gateLineCli(["--stream=stderr", "--summary", summary], io)).toBe(0);
    expect(io.out).toEqual([]);
    expect(io.err).toEqual(["::error title=t%3A block%2C 1 block::t: block for 1 of 1 cases: a. CPU a m, b m.\n"]);
    expect(readFileSync(summary, "utf8")).toBe("\n> [!CAUTION]\n> **Block.** t: block for 1 of 1 cases: a. CPU a m, b m.\n");
  });

  it("writes nothing and exits with 0 when each case passed", () => {
    const io = fakeIo({}, JSON.stringify({ reads: [{ case: "a", outcome: "within" }], options: { title: "t", enforced: true } }));
    expect(gateLineCli([], io)).toBe(0);
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
  });

  it("exits with 0 for an enforced block, because the step decides its own exit", () => {
    const io = fakeIo({}, JSON.stringify({ reads: [{ case: "a", outcome: "beyond" }], options: { title: "t", enforced: true } }));
    expect(gateLineCli([], io)).toBe(0);
    expect(io.out[0]?.startsWith("::error ")).toBe(true);
  });

  it("gives the help with exit code 0", () => {
    const io = fakeIo({});
    expect(gateLineCli(["--help"], io)).toBe(0);
    expect(io.out).toEqual([GATE_LINE_HELP]);
  });

  it("refuses a bad argument or a bad document with exit code 2 and a reason", () => {
    const bad: [string[], string, RegExp][] = [
      [["--nope"], "{}", /unknown argument "--nope"/u],
      [["--from"], "{}", /--from needs a value/u],
      [["--stream", "both"], "{}", /--stream is stdout or stderr/u],
      [[], "not json", /the input is not JSON/u],
      [[], "[]", /not a JSON object/u],
      [[], JSON.stringify({ reads: [] }), /"options" has no string "title"/u],
      [[], JSON.stringify({ reads: {}, options: { title: "t" } }), /"reads" is not a list/u],
      [[], JSON.stringify({ reads: [{ case: 1, outcome: "beyond" }], options: { title: "t" } }), /"reads"\[0\]/u],
      [[], JSON.stringify({ reads: [], options: { title: "t", enforced: "yes" } }), /"options.enforced" is not a boolean/u],
      [[], JSON.stringify({ reads: [], options: { title: "t", models: [] }, jobs: [] }), /not both/u],
      [[], JSON.stringify({ reads: [], options: { title: "t", models: [{ model: "m", jobs: -1 }] } }), /"options.models"\[0\]/u],
      [[], JSON.stringify({ reads: [], options: { title: "t", models: { a: ["m"], b: [1], one: true } } }), /"options.models.b"/u],
      [[], JSON.stringify({ reads: [], options: { title: "t" }, jobs: [{ cpu: "m", cores: 1.5 }] }), /"jobs"\[0\].cores/u],
    ];
    for (const [argv, stdin, reason] of bad) {
      const io = fakeIo({}, stdin);
      expect(gateLineCli(argv, io), argv.join(" ") + stdin).toBe(2);
      expect(io.out).toEqual([]);
      expect(io.err.join("")).toMatch(reason);
      expect(io.err.join("").startsWith("rigor-gate-line: ")).toBe(true);
    }
  });

  it("runs as the bin, from a file and from stdin", () => {
    const file = join(dir, "doc.json");
    const summary = join(dir, "summary.md");
    writeFileSync(file, JSON.stringify(DOC));
    const env = { ...process.env, GITHUB_STEP_SUMMARY: summary };
    const fromFile = spawnSync(process.execPath, [BIN, "--from", file], { env, encoding: "utf8" });
    expect(fromFile.status).toBe(0);
    expect(fromFile.stdout).toBe(`${expected(DOC)}\n`);
    expect(readFileSync(summary, "utf8")).toContain("**Block.** store gate");
    const fromStdin = spawnSync(process.execPath, [BIN, "--stream", "stderr", "--summary", ""], { env, input: JSON.stringify(DOC), encoding: "utf8" });
    expect(fromStdin.status).toBe(0);
    expect(fromStdin.stdout).toBe("");
    expect(fromStdin.stderr).toContain(`${expected(DOC)}\n`);
    const bad = spawnSync(process.execPath, [BIN], { env, input: "{", encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("rigor-gate-line: the input is not JSON");
  });
});
