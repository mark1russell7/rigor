import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Arm, armOrder, firstArm } from "./index.ts";
import { type BenchEnv, type ChildExit, type ChildTime, type FreshOptions, type StartChild, benchEnv, childLine, freshRun, pairOrder } from "./fresh.ts";

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

  it("reads the memory peak, the warm check and the events of a child", () => {
    const line = { ms: 2, hash: "h", peakRss: 4096, warm: 0.98, events: { gc: [3, 1], gcMs: [1.5, 0.25], deopt: [0, 2] }, other: "kept" };
    expect(childLine(JSON.stringify(line))).toEqual({ ms: 2, hash: "h", peakRss: 4096, warm: 0.98, events: { gc: [3, 1], gcMs: [1.5, 0.25], deopt: [0, 2] }, extra: { other: "kept" } });
    expect(childLine('{"ms":2,"events":{"gc":[0,0]}}')).toEqual({ ms: 2, events: { gc: [0, 0] } });
    // A skip line keeps only its reason, its time and its hash.
    expect(childLine('{"skipped":"too large","peakRss":1}')).toEqual({ skipped: "too large" });
  });

  it("keeps each other field of a time line in extra, as an own field", () => {
    const line = childLine('{"ms":3,"samples":[1.5,2,2.5],"batch":64,"meta":{"k":[1]},"__proto__":{"polluted":true}}') as ChildTime;
    expect(line).toMatchObject({ ms: 3, extra: { samples: [1.5, 2, 2.5], batch: 64, meta: { k: [1] } } });
    expect(Object.getPrototypeOf(line.extra)).toBe(Object.prototype);
    expect(Object.hasOwn(line.extra!, "__proto__")).toBe(true);
    expect((line.extra as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(childLine('{"ms":3,"peakRss":1}')).not.toHaveProperty("extra");
  });

  it("refuses a bad memory peak, warm check or events", () => {
    for (const peak of ["-1", '"1"', "null"]) expect(() => childLine(`{"ms":1,"peakRss":${peak}}`)).toThrow(/peakRss/);
    for (const warm of ["0", "-1", '"1"']) expect(() => childLine(`{"ms":1,"warm":${warm}}`)).toThrow(/warm check/);
    for (const events of ["[]", "{}", '{"gc":[1]}', '{"gc":[1,-1]}', '{"gc":[1,1.5]}', '{"gc":[1,1],"deopt":[1]}']) {
      expect(() => childLine(`{"ms":1,"events":${events}}`)).toThrow(/events/);
    }
    for (const gcMs of ["[1]", "[1,-0.5]", '[1,"2"]', "[1,null]", "{}"]) {
      expect(() => childLine(`{"ms":1,"events":{"gc":[1,1],"gcMs":${gcMs}}}`)).toThrow(/GC time gcMs/);
    }
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

  it("starts each child of an arm in its folder, and names the commits of the arms in each record", async () => {
    const folders: (string | undefined)[] = [];
    const start: StartChild = async (argv, options) => {
      folders.push(`${argv[0]}@${options.cwd ?? "here"}`);
      return { stdout: '{"ms":1}\n', stderr: "", code: 0 };
    };
    const old = { id: "old", command: ["old"], cwd: "/base", commit: "a".repeat(40) };
    const head = { id: "head", command: ["head"], commit: "b".repeat(40) };
    const result = await run({ start, base: old, candidates: [head], rounds: 1, cases: ["x"], aa: "each" });
    expect(Object.keys(result.pairs)).toEqual(["head", "old~aa", "head~aa"]);
    expect(new Set(folders)).toEqual(new Set(["old@/base", "head@here"]));
    expect(result.pairs["head"]![0]!.commits).toEqual({ a: "a".repeat(40), b: "b".repeat(40) });
    expect(result.pairs["old~aa"]![0]!.commits).toEqual({ a: "a".repeat(40), b: "a".repeat(40) });
    expect(result.pairs["head~aa"]![0]!.commits).toEqual({ a: "b".repeat(40), b: "b".repeat(40) });
    const plain = await run({ start: fake().start, rounds: 1 });
    expect(plain.pairs["next"]![0]!).not.toHaveProperty("commits");
  });

  it("refuses a bad aa, folder or commit", async () => {
    const { start } = fake();
    await expect(run({ start, aa: "all" as unknown as boolean })).rejects.toThrow(/aa is true, false or "each"/);
    await expect(run({ start, candidates: [{ ...next, cwd: "" }] })).rejects.toThrow(/the cwd of the arm "next"/);
    await expect(run({ start, base: { ...base, commit: "" } })).rejects.toThrow(/the commit of the arm "base"/);
    await expect(run({ start, aa: "each", candidates: [next, { id: "next~aa", command: ["x"] }] })).rejects.toThrow(/two arms or pairs have the id/);
  });

  it("removes a case that an arm skips in the first round from each pair, and starts no more children for it", async () => {
    const { start, calls } = fake((program, caseId, k) => (program === "next" && caseId === "y" && k <= 8 ? { stdout: '{"skipped":"too large"}' } : undefined));
    const result = await run({ start, roundOffset: 4 });
    expect(result.skipped).toEqual([{ arm: "next", case: "y", round: 4, reason: "too large" }]);
    for (const records of Object.values(result.pairs)) {
      expect(records.some((r) => r.case === "y")).toBe(false);
      expect(records.filter((r) => r.case === "x").length).toBe(4);
    }
    const lastY = calls.findLastIndex((c) => c.case === "y");
    expect(calls[lastY]!.program).toBe("next");
    expect(calls[lastY]!.ms).toBeLessThanOrEqual(8);
    expect(calls.slice(lastY + 1).every((c) => c.case === "x")).toBe(true);
  });

  it("refuses a skip after the first round of the job, with the round", async () => {
    const { start } = fake((program, caseId, k) => (program === "next" && caseId === "y" && k > 16 ? { stdout: '{"ms":1,"skipped":"too large"}' } : undefined));
    await expect(run({ start })).rejects.toThrow(/arm "next".*case "y", round 2 skipped the case after the first round/);
  });

  it("skips a case whose child takes too long in the first round, with overLimit skip", async () => {
    const { start, calls } = fake((program, caseId) => (program === "next" && caseId === "y" ? { code: null, timedOut: true } : undefined));
    const result = await run({ start, timeoutMs: 5000, overLimit: "skip" });
    expect(result.skipped).toEqual([{ arm: "next", case: "y", round: 0, reason: "took more than 5000 ms" }]);
    for (const records of Object.values(result.pairs)) {
      expect(records.some((r) => r.case === "y")).toBe(false);
      expect(records.filter((r) => r.case === "x").length).toBe(4);
    }
    expect(calls.filter((c) => c.case === "y" && c.program === "next").length).toBe(1);
  });

  it("refuses a child over the limit after the first round, with overLimit skip", async () => {
    const { start } = fake((program, caseId, k) => (program === "next" && caseId === "y" && k > 16 ? { code: null, timedOut: true } : undefined));
    await expect(run({ start, timeoutMs: 5000, overLimit: "skip" })).rejects.toThrow(/case "y", round 2 skipped the case after the first round of the job \("took more than 5000 ms"\)/);
  });

  it("refuses an overLimit that is not error or skip", async () => {
    const { start } = fake();
    await expect(run({ start, overLimit: "drop" as never })).rejects.toThrow(/overLimit is "error" or "skip", not "drop"/);
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

  it("keeps the fields of the child of each arm in the record, and no fields when no child gives one", async () => {
    const { start } = fake((program, _caseId, k) => (program === "next" ? { stdout: `${JSON.stringify({ ms: k + 1, peakRss: 1000 + k, warm: 1 })}\n` } : undefined));
    const result = await run({ start, rounds: 1, cases: ["x"] });
    const [record] = result.pairs["next"]!;
    expect(record!.fields).toEqual({ a: {}, b: { peakRss: 1000 + record!.b - 1, warm: 1 } });
    expect(result.pairs["base~aa"]![0]).not.toHaveProperty("fields");
  });

  it("starts one child of each arm in the order of armOrder with order arms, and the pairs share the base child", async () => {
    const other = { id: "other", command: ["other"] };
    const { start, calls } = fake();
    const result = await run({ start, candidates: [next, other], order: "arms", rounds: 8 });
    // The arms are base, next, other and base~aa: 4 children for each case and round, not 6.
    expect(calls.length).toBe(4 * 2 * 8);
    expect(Object.keys(result.pairs)).toEqual(["next", "other", "base~aa"]);
    const ids = ["base", "next", "other", "base~aa"];
    const program: Record<string, string> = { base: "base", next: "next", other: "other", "base~aa": "base" };
    let k = 0;
    const orders: unknown[] = [];
    for (let round = 0; round < 8; round++) {
      for (const [i, id] of ["x", "y"].entries()) {
        const sequence = armOrder([...ids.slice(i), ...ids.slice(0, i)], round);
        const ms: Record<string, number> = {};
        for (const arm of sequence) {
          const call = calls[k++]!;
          expect([call.program, call.case]).toEqual([program[arm], id]);
          ms[arm] = call.ms;
        }
        orders.push({ case: id, round, arms: sequence });
        for (const pair of ["next", "other", "base~aa"]) {
          const record = result.pairs[pair]!.find((r) => r.case === id && r.round === round);
          const first = sequence.indexOf("base") < sequence.indexOf(pair) ? "a" : "b";
          expect(record).toEqual({ case: id, round, first, a: ms["base"], b: ms[pair], job: "0", env: ENV });
        }
      }
    }
    expect(result.orders).toEqual(orders);
    // 8 rounds balance 4 arms: in each case, each pair has each first arm in 4 rounds.
    for (const records of Object.values(result.pairs)) {
      for (const id of ["x", "y"]) expect(records.filter((r) => r.case === id && r.first === "a").length).toBe(4);
    }
    expect(await run({ start: fake().start, rounds: 1 })).not.toHaveProperty("orders");
  });

  it("gives each A/A copy its own child with order arms, and checks its hash with the hash of its arm", async () => {
    const old = { id: "old", command: ["old"], commit: "a".repeat(40) };
    const head = { id: "head", command: ["head"], commit: "b".repeat(40) };
    const { start, calls } = fake();
    const result = await run({ start, base: old, candidates: [head], aa: "each", order: "arms", cases: ["x"], rounds: 1 });
    expect(calls.map((c) => c.program)).toEqual(["old", "head", "old", "head"]);
    expect(result.orders).toEqual([{ case: "x", round: 0, arms: ["old", "head", "old~aa", "head~aa"] }]);
    expect(result.pairs["head~aa"]).toEqual([{ case: "x", round: 0, first: "a", a: 2, b: 4, job: "0", env: ENV, commits: { a: "b".repeat(40), b: "b".repeat(40) } }]);
    expect(result.pairs["old~aa"]![0]).toMatchObject({ first: "a", a: 1, b: 3 });
    expect(result.pairs["head"]![0]).toMatchObject({ first: "a", a: 1, b: 2 });
    const twoHashes = fake((program, _c, k) => ({ stdout: JSON.stringify({ ms: 1, hash: program === "old" ? `h${k}` : "n" }) })).start;
    await expect(run({ start: twoHashes, base: old, candidates: [head], order: "arms", cases: ["x"], rounds: 1 })).rejects.toThrow(
      /the arm "old~aa" on the case "x", round 0 gave the hash h2, and an earlier child of the arm gave h0/,
    );
  });

  it("removes a case that an arm skips in the first round with order arms, and refuses a later skip", async () => {
    const { start, calls } = fake((program, caseId) => (program === "next" && caseId === "y" ? { stdout: '{"skipped":"too large"}' } : undefined));
    const result = await run({ start, order: "arms" });
    expect(result.skipped).toEqual([{ arm: "next", case: "y", round: 0, reason: "too large" }]);
    expect(result.orders!.map((o) => o.case)).toEqual(["x", "x", "x", "x"]);
    for (const records of Object.values(result.pairs)) expect(records.map((r) => r.case)).toEqual(["x", "x", "x", "x"]);
    expect(calls.filter((c) => c.case === "y").length).toBe(1);
    const late = fake((program, caseId, k) => (program === "next" && caseId === "y" && k > 6 ? { stdout: '{"skipped":"too large"}' } : undefined)).start;
    await expect(run({ start: late, order: "arms" })).rejects.toThrow(/the arm "next" on the case "y", round 1 skipped the case after the first round/);
  });

  it("keeps the extra fields of a child in the record of each pair, with order arms", async () => {
    const { start } = fake((program, _c, k) => (program === "next" ? { stdout: JSON.stringify({ ms: k + 1, samples: [k], batch: 8 }) } : undefined));
    const result = await run({ start, order: "arms", rounds: 1, cases: ["x"] });
    expect(result.pairs["next"]![0]!.fields).toEqual({ a: {}, b: { extra: { samples: [1], batch: 8 } } });
    expect(result.pairs["base~aa"]![0]).not.toHaveProperty("fields");
  });

  it("turns the order of the cases in each round with firstCase, and keeps the arms of each case and round", async () => {
    const cases = ["a", "b", "c", "d", "e"];
    const key = (records: readonly { case: string; round: number; first: string }[]) => records.map((r) => `${r.case} ${r.round} ${r.first}`).sort();
    for (const order of ["pairs", "arms"] as const) {
      const plain = fake();
      const fixed = await run({ start: plain.start, cases, rounds: 3, roundOffset: 2, order });
      const turned = fake();
      const result = await run({ start: turned.start, cases, rounds: 3, roundOffset: 2, order, firstCase: 7 });
      const perRound = turned.calls.length / 3;
      const perCase = perRound / cases.length;
      // The step is max(1, floor(5 / 3)) = 1. Global round 2 + r starts with the case (7 + 2 + r) % 5.
      for (let r = 0; r < 3; r++) {
        const shift = (7 + 2 + r) % 5;
        const inRound = turned.calls.slice(r * perRound, (r + 1) * perRound);
        expect(inRound.filter((_c, k) => k % perCase === 0).map((c) => c.case)).toEqual([...cases.slice(shift), ...cases.slice(0, shift)]);
        // Each case keeps the programs of its children, in their order, as without the turn.
        const programs = (calls: readonly { program: string; case: string }[], id: string) => calls.filter((c) => c.case === id).map((c) => c.program);
        const before = plain.calls.slice(r * perRound, (r + 1) * perRound);
        for (const id of cases) expect(programs(inRound, id)).toEqual(programs(before, id));
      }
      for (const pair of Object.keys(fixed.pairs)) expect(key(result.pairs[pair]!)).toEqual(key(fixed.pairs[pair]!));
      if (order === "arms") expect(result.orders!.slice(0, 5).map((o) => o.case)).toEqual(["e", "a", "b", "c", "d"]);
    }
    // The step spreads the first places when the cases are more than the rounds: 7 cases in 2 rounds give the step 3.
    const { start, calls } = fake();
    await run({ start, cases: ["a", "b", "c", "d", "e", "f", "g"], rounds: 2, order: "arms", firstCase: 0 });
    expect([calls[0]!.case, calls[calls.length / 2]!.case]).toEqual(["a", "d"]);
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
    await expect(run({ start, order: "both" as unknown as "arms" })).rejects.toThrow(/order is "pairs" or "arms"/);
    await expect(run({ start, firstCase: -1 })).rejects.toThrow(/first case is a whole number/);
    await expect(run({ start, firstCase: 1.5 })).rejects.toThrow(/first case is a whole number/);
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

  it("reads a real child that times its arm with timeArm and counts its events with eventProbe", async () => {
    const url = (file: string): string => new URL(file, import.meta.url).href;
    const script = [
      `const { timeArm } = await import(${JSON.stringify(url("./arm.ts"))});`,
      `const { eventProbe, peakRss } = await import(${JSON.stringify(url("./fresh.ts"))});`,
      "const probe = eventProbe({ deopt: true });",
      "const time = timeArm(() => Array.from({ length: 500 }, (_, i) => ({ i })).length, { samples: 6, warmMs: 20, targetMs: 2, mark: probe.mark });",
      "console.log(JSON.stringify({ ms: time.ms, warm: time.warm, peakRss: peakRss(), events: await probe.events(6) }));",
    ].join("\n");
    const node = { id: "node", command: [process.execPath, "--input-type=module", "-e", script, "--"] };
    const result = await freshRun({ base: node, candidates: [], cases: ["x"], rounds: 1, env: ENV });
    const [record] = result.pairs["node~aa"]!;
    for (const arm of ["a", "b"] as const) {
      const fields = record!.fields![arm];
      expect(fields.peakRss).toBeGreaterThan(0);
      expect(fields.warm).toBeGreaterThan(0);
      expect(fields.events!.gc.every((n) => Number.isSafeInteger(n) && n >= 0)).toBe(true);
      // A half without GC events has no GC time
      const { gc, gcMs } = fields.events!;
      expect(gcMs).toHaveLength(2);
      for (const half of [0, 1]) expect(gcMs![half]! >= 0 && (gc[half]! > 0 || gcMs![half] === 0)).toBe(true);
      expect(fields.events!.deopt).toHaveLength(2);
    }
  });

  it("gives the GC time of a half that has a GC event", () => {
    const script = [
      `const { eventProbe } = await import(${JSON.stringify(new URL("./fresh.ts", import.meta.url).href)});`,
      "const probe = eventProbe();",
      "probe.mark(0);",
      "globalThis.gc();",
      "probe.mark(1);",
      "probe.mark(2);",
      "console.log(JSON.stringify({ ms: 1, events: await probe.events(2) }));",
    ].join("\n");
    const stdout = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], { encoding: "utf8" });
    const line = childLine(stdout);
    if (line.skipped !== undefined) throw new Error("the child skipped");
    const { gc, gcMs } = line.events!;
    expect(gc[0]).toBeGreaterThanOrEqual(1);
    expect(gcMs![0]).toBeGreaterThan(0);
  });

  // The grandchild inherits stdout and keeps the pipe open.
  const grandchild = 'require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "inherit" }).unref();';

  it("settles a grace time after the exit of a child whose grandchild holds stdout", async () => {
    const node = { id: "node", command: [process.execPath, "-e", `${grandchild} console.log(JSON.stringify({ ms: 1 })); process.exit(0);`, "--"] };
    const t0 = performance.now();
    const result = await freshRun({ base: node, candidates: [], cases: ["x"], rounds: 1, env: ENV });
    expect(result.pairs["node~aa"]!.map((r) => [r.a, r.b])).toEqual([[1, 1]]);
    expect(performance.now() - t0).toBeLessThan(8000);
  }, 15000);

  it("stops a child that ignores SIGTERM and holds a grandchild, at the time limit", async () => {
    const node = { id: "node", command: [process.execPath, "-e", `process.on("SIGTERM", () => {}); ${grandchild} setInterval(() => {}, 1000);`, "--"] };
    const t0 = performance.now();
    await expect(freshRun({ base: node, candidates: [], cases: ["x"], rounds: 1, timeoutMs: 300, env: ENV })).rejects.toThrow(/took more than 300 ms/);
    expect(performance.now() - t0).toBeLessThan(6000);
  }, 15000);

  it("stops a child that does not end at the time limit, and skips its case, with overLimit skip", async () => {
    const node = { id: "node", command: [process.execPath, "-e", "setInterval(() => {}, 1000);", "--"] };
    const t0 = performance.now();
    const result = await freshRun({ base: node, candidates: [], cases: ["x"], rounds: 2, timeoutMs: 300, overLimit: "skip", env: ENV });
    expect(result.skipped).toEqual([{ arm: "node", case: "x", round: 0, reason: "took more than 300 ms" }]);
    expect(result.pairs["node~aa"]).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(6000);
  }, 15000);
});
