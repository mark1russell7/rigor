import { afterEach, describe, expect, it, vi } from "vitest";
import { type Arm, firstArm } from "./index.ts";
import { type BenchEnv, type ChildExit, type FreshOptions, type StartChild, benchEnv, childLine, freshRun, pairOrder } from "./fresh.ts";

const ENV: BenchEnv = { cpu: "test cpu", cores: 4, os: "linux", arch: "x64", node: "v24.0.0" };

/** The rule of `timeArmOrder` of the joint bench of layout-stack: the candidate pair 0 and the A/A pair 1. */
function timeArmOrder(round: number, caseIndex: number): { pair: number; first: Arm }[] {
  const candidate = { pair: 0, first: firstArm(round, caseIndex) };
  const aa = { pair: 1, first: firstArm(round, caseIndex + 1) };
  return (Math.floor(round / 2) + caseIndex) % 2 === 0 ? [candidate, aa] : [aa, candidate];
}

describe("pairOrder", () => {
  it("equals the rule of layout-stack for 2 pairs", () => {
    for (let round = 0; round < 12; round++) for (let c = 0; c < 6; c++) expect(pairOrder(2, round, c)).toEqual(timeArmOrder(round, c));
  });

  it("gives each pair both first orders in any 2 rounds, and 2 of each in any 4 rounds", () => {
    for (const pairs of [1, 2, 3, 4]) {
      for (let c = 0; c < 4; c++) {
        for (let from = 0; from < 8; from++) {
          const firsts = (n: number) => Array.from({ length: n }, (_, k) => pairOrder(pairs, from + k, c));
          for (let p = 0; p < pairs; p++) {
            expect(new Set(firsts(2).map((o) => o.find((s) => s.pair === p)!.first)).size).toBe(2);
            expect(firsts(4).filter((o) => o.find((s) => s.pair === p)!.first === "a").length).toBe(2);
          }
        }
      }
    }
  });

  it("puts each pair first in turn, one pair each second round", () => {
    expect([0, 1, 2, 3, 4, 5].map((r) => pairOrder(3, r, 0)[0]!.pair)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(pairOrder(3, 0, 0).map((s) => s.pair)).toEqual([0, 1, 2]);
  });

  it("refuses bad counts", () => {
    expect(() => pairOrder(0, 0, 0)).toThrow(RangeError);
    expect(() => pairOrder(2, -1, 0)).toThrow(RangeError);
    expect(() => pairOrder(2, 0, 1.5)).toThrow(RangeError);
  });
});

describe("childLine", () => {
  it("reads the last line that starts with {", () => {
    expect(childLine('log\n{"ms":5}\nmore log\n{"ms":2.5,"hash":"h"}\r\ndone\n')).toEqual({ ms: 2.5, hash: "h" });
    expect(childLine('  {"ms":1,"skipped":"too large"}')).toEqual({ ms: 1, skipped: "too large" });
    expect(childLine('{"skipped":"too large"}')).toEqual({ skipped: "too large" });
  });

  it("refuses no line, bad JSON and a bad time", () => {
    expect(() => childLine("no json\n")).toThrow(/no line that starts with/);
    expect(() => childLine("{ms: 1}")).toThrow(/not JSON/);
    expect(() => childLine("[1]\n{}")).toThrow(/finite number above 0/);
    for (const ms of ["0", "-1", '"5"', "null"]) expect(() => childLine(`{"ms":${ms}}`)).toThrow(/finite number above 0/);
    expect(() => childLine('{"ms":1,"hash":3}')).toThrow(/hash is a string/);
    expect(() => childLine('{"ms":1,"skipped":""}')).toThrow(/skip/);
  });
});

describe("benchEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives the computer, and the runner from BENCH_RUNNER or else RUNNER_NAME", () => {
    vi.stubEnv("BENCH_RUNNER", "");
    vi.stubEnv("RUNNER_NAME", "gh-1");
    const env = benchEnv();
    expect(env.cpu).not.toBe("");
    expect(env.cores).toBeGreaterThan(0);
    expect(env.node).toBe(process.version);
    expect(env.runner).toBe("gh-1");
    vi.stubEnv("BENCH_RUNNER", "box");
    expect(benchEnv().runner).toBe("box");
    vi.stubEnv("BENCH_RUNNER", "");
    vi.stubEnv("RUNNER_NAME", "");
    expect("runner" in benchEnv()).toBe(false);
  });
});

/** A call of the fake start: the program (the first item of the argv), the case, and the time that it gave. */
interface Call {
  readonly program: string;
  readonly case: string;
  readonly ms: number;
}

/** A fake start. Call `k` gives the time `k + 1`, or the end that `reply` gives. */
function fake(reply: (program: string, caseId: string, k: number) => Partial<ChildExit> | undefined = () => undefined): { start: StartChild; calls: Call[] } {
  const calls: Call[] = [];
  const start: StartChild = async (argv) => {
    const program = argv[0]!;
    const caseId = argv[argv.indexOf("--case") + 1]!;
    const k = calls.length;
    calls.push({ program, case: caseId, ms: k + 1 });
    return { stdout: `${JSON.stringify({ ms: k + 1 })}\n`, stderr: "", code: 0, ...reply(program, caseId, k) };
  };
  return { start, calls };
}

const base = { id: "base", command: ["base"] };
const next = { id: "next", command: ["next"] };

function run(options: Partial<FreshOptions> & { start: StartChild }) {
  return freshRun({ base, candidates: [next], cases: ["x", "y"], rounds: 4, env: ENV, ...options });
}

describe("freshRun", () => {
  it("starts the children in the order of pairOrder, with a base child of its own in each pair", async () => {
    const { start, calls } = fake();
    const result = await run({ start });
    expect(Object.keys(result.pairs)).toEqual(["next", "base~aa"]);
    expect(calls.length).toBe(4 * 2 * 4);
    expect(calls.filter((c) => c.program === "base").length).toBe(4 * 2 * 3);
    // Rebuild the records from the order of the calls.
    const pairs = [{ id: "next", a: "base", b: "next" }, { id: "base~aa", a: "base", b: "base" }];
    let k = 0;
    const expected: Record<string, unknown[]> = { next: [], "base~aa": [] };
    for (let round = 0; round < 4; round++) {
      for (const [i, id] of ["x", "y"].entries()) {
        for (const slot of pairOrder(2, round, i)) {
          const pair = pairs[slot.pair]!;
          const second: Arm = slot.first === "a" ? "b" : "a";
          const first = calls[k++]!;
          const other = calls[k++]!;
          expect([first.program, first.case, other.program, other.case]).toEqual([pair[slot.first], id, pair[second], id]);
          const times = { [slot.first]: first.ms, [second]: other.ms } as Record<Arm, number>;
          expected[pair.id]!.push({ case: id, round, first: slot.first, a: times.a, b: times.b, job: "0", env: ENV });
        }
      }
    }
    expect(result.pairs).toEqual(expected);
    expect(result).toMatchObject({ env: ENV, job: "0", skipped: [] });
  });

  it("gives global rounds from roundOffset, and keeps the job label", async () => {
    const { start } = fake();
    const result = await run({ start, rounds: 2, roundOffset: 6, job: "3" });
    const records = result.pairs["base~aa"]!;
    expect(records.map((r) => r.round)).toEqual([6, 6, 7, 7]);
    expect(records.map((r) => r.first)).toEqual([firstArm(6, 1), firstArm(6, 2), firstArm(7, 1), firstArm(7, 2)]);
    expect(records.every((r) => r.job === "3" && r.env === ENV)).toBe(true);
  });

  it("makes a pair for each candidate, and leaves out the A/A pair with aa false", async () => {
    const other = { id: "other", command: ["other"] };
    const three = await run({ start: fake().start, candidates: [next, other], rounds: 1 });
    expect(Object.keys(three.pairs)).toEqual(["next", "other", "base~aa"]);
    const { start, calls } = fake();
    const one = await run({ start, aa: false, rounds: 1 });
    expect(Object.keys(one.pairs)).toEqual(["next"]);
    expect(calls.length).toBe(4);
  });

  it("removes a skipped case from each pair, and starts no more children for it", async () => {
    const { start, calls } = fake((program, caseId, k) => (program === "next" && caseId === "y" && k > 16 ? { stdout: '{"ms":1,"skipped":"too large"}' } : undefined));
    const result = await run({ start });
    expect(result.skipped).toEqual([{ arm: "next", case: "y", reason: "too large" }]);
    for (const records of Object.values(result.pairs)) {
      expect(records.some((r) => r.case === "y")).toBe(false);
      expect(records.filter((r) => r.case === "x").length).toBe(4);
    }
    const lastY = calls.findLastIndex((c) => c.case === "y");
    expect(calls[lastY]!.program).toBe("next");
    expect(calls[lastY]!.ms).toBeGreaterThan(17);
    expect(calls.slice(lastY + 1).every((c) => c.case === "x")).toBe(true);
  });

  it("refuses a crash, a timeout and a child with no JSON line, with the arm, the case, the round and the tail of stderr", async () => {
    const at = (end: Partial<ChildExit>) => fake((program, caseId) => (program === "next" && caseId === "y" ? end : undefined)).start;
    const where = /the arm "next" \(pair "next", arm b\) on the case "y", round 0/;
    await expect(run({ start: at({ code: 1, stderr: "TypeError: boom\n" }) })).rejects.toThrow(where);
    await expect(run({ start: at({ code: 1, stderr: "TypeError: boom\n" }) })).rejects.toThrow(/exited with the code 1. The tail of stderr: TypeError: boom/);
    await expect(run({ start: at({ code: null, timedOut: true }) })).rejects.toThrow(/took more than 600000 ms/);
    await expect(run({ start: at({ stdout: "hello\n" }) })).rejects.toThrow(/printed no good JSON line/);
    await expect(run({ start: at({ error: "spawn ENOENT" }) })).rejects.toThrow(/failed: spawn ENOENT/);
    const long = `${"x".repeat(5000)}END`;
    const error = (await run({ start: at({ code: 2, stderr: long }) }).then(
      () => new Error("no error"),
      (e: unknown) => e as Error,
    ));
    expect(error.message).toContain("END");
    expect(error.message.length).toBeLessThan(2400);
    const rejected: StartChild = async () => {
      throw new Error("no such file");
    };
    await expect(run({ start: rejected })).rejects.toThrow(/did not start: no such file/);
  });

  it("refuses two hashes of one arm on one case, and permits other hashes for other arms", async () => {
    const hashOf = (program: string, k: number) => (program === "base" ? (k < 20 ? "h1" : "h2") : "n1");
    const start = fake((program, _c, k) => ({ stdout: JSON.stringify({ ms: 1, hash: hashOf(program, k) }) })).start;
    await expect(run({ start, cases: ["x"], rounds: 10 })).rejects.toThrow(/the arm "base" .* on the case "x", round \d+ gave the hash h2, and an earlier child of the arm gave h1/);
    const same = fake((program) => ({ stdout: JSON.stringify({ ms: 1, hash: program === "base" ? "h1" : "n1" }) })).start;
    expect((await run({ start: same })).pairs["next"]!.length).toBe(8);
  });

  it("refuses bad options", async () => {
    const { start } = fake();
    await expect(run({ start, rounds: 0 })).rejects.toThrow(/rounds/);
    await expect(run({ start, roundOffset: -1 })).rejects.toThrow(/round offset/);
    await expect(run({ start, cases: [] })).rejects.toThrow(/cases/);
    await expect(run({ start, cases: ["x", "x"] })).rejects.toThrow(/cases/);
    await expect(run({ start, candidates: [{ id: "base", command: ["b"] }] })).rejects.toThrow(/two arms or pairs/);
    await expect(run({ start, candidates: [next, next] })).rejects.toThrow(/two arms or pairs/);
    await expect(run({ start, candidates: [{ id: "base~aa", command: ["b"] }] })).rejects.toThrow(/two arms or pairs/);
    await expect(run({ start, candidates: [], aa: false })).rejects.toThrow(/no pairs/);
    await expect(run({ start, candidates: [{ id: "z", command: [] }] })).rejects.toThrow(/command/);
  });

  it("starts real child processes", async () => {
    const script = 'console.log("log line"); console.log(JSON.stringify({ ms: 1, hash: "h" }))';
    const node = { id: "node", command: [process.execPath, "-e", script, "--"] };
    const result = await freshRun({ base: node, candidates: [], cases: ["x"], rounds: 2, env: ENV });
    expect(result.pairs["node~aa"]!.map((r) => [r.a, r.b])).toEqual([
      [1, 1],
      [1, 1],
    ]);
    const crash = { id: "crash", command: [process.execPath, "-e", 'console.error("it broke"); process.exit(3)', "--"] };
    await expect(freshRun({ base: node, candidates: [crash], cases: ["x"], rounds: 1, aa: false, env: ENV })).rejects.toThrow(/arm "crash".*code 3.*it broke/s);
    const missing = { id: "missing", command: ["D:/no/such/program-of-rigor"] };
    await expect(freshRun({ base: missing, candidates: [], cases: ["x"], rounds: 1, env: ENV })).rejects.toThrow(/arm "missing".*failed/);
  });
});
