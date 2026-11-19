import { describe, expect, it } from "vitest";
import { type ArmProcess, type BenchEnv, type ChildExit, type FreshArmsOptions, type StartChild, type StartOptions, armTimes, freshArms } from "./fresh.ts";
import { aaOrders, armOrder, balancedRounds } from "./index.ts";

const ENV: BenchEnv = { cpu: "test cpu", cores: 4, os: "linux", arch: "x64", node: "v24.0.0" };
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

/** A call of the fake start: its argv and its options. */
interface Call {
  readonly argv: readonly string[];
  readonly options: StartOptions;
}

/** A fake start. The child of a case gives the time of `times`, or the end that `reply` gives. */
function fake(reply: (argv: readonly string[], k: number) => Partial<ChildExit> | undefined = () => undefined): { start: StartChild; calls: Call[] } {
  const calls: Call[] = [];
  const times: Record<string, number> = { slow: 50, fast: 2, same: 10 };
  const start: StartChild = async (argv, options) => {
    const k = calls.length;
    calls.push({ argv, options });
    const id = argv[argv.indexOf("--case") + 1] ?? "";
    return { stdout: `log\n${JSON.stringify({ ms: (times[id] ?? 1) + k / 1000 })}\n`, stderr: "", code: 0, ...reply(argv, k) };
  };
  return { start, calls };
}

const ARMS = [
  { id: "slow", case: "slow" },
  { id: "fast", case: "fast" },
  { id: "same", case: "same" },
  { id: "same#aa", case: "same" },
];

function run(options: Partial<FreshArmsOptions> & { start: StartChild }) {
  return freshArms({ arms: ARMS, command: ["node", "child.ts"], aa: ["same", "same#aa"], env: ENV, ...options });
}

describe("balancedRounds", () => {
  it("puts each arm at each position 2 times, and gives each pair each order the same count of times", () => {
    for (const n of [1, 2, 3, 4, 7]) {
      const arms = Array.from({ length: n }, (_, i) => i);
      const rounds = balancedRounds(n);
      expect(rounds).toBe(2 * n);
      for (const from of [0, 5]) {
        const orders = Array.from({ length: rounds }, (_, r) => armOrder(arms, from + r));
        for (const arm of arms) for (let p = 0; p < n; p++) expect(orders.filter((o) => o[p] === arm).length).toBe(2);
        for (const x of arms) for (const y of arms) if (x < y) expect(orders.filter((o) => o.indexOf(x) < o.indexOf(y)).length).toBe(n);
      }
    }
  });

  it("refuses a count of arms that is not a whole number of 1 or more", () => {
    expect(() => balancedRounds(0)).toThrow(RangeError);
    expect(() => balancedRounds(1.5)).toThrow(RangeError);
  });
});

describe("freshArms", () => {
  it("starts one child for each arm in each round of a balanced run, in the order of armOrder", async () => {
    const { start, calls } = fake();
    const seen: ArmProcess[] = [];
    const result = await run({ start, onProcess: (p) => seen.push(p) });
    expect(result.rounds).toBe(8);
    expect(result.balanced).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.processes).toHaveLength(32);
    expect(seen).toEqual(result.processes);
    for (let round = 0; round < 8; round++) {
      const ids = result.processes.filter((p) => p.round === round).map((p) => p.arm);
      expect(ids).toEqual(armOrder(ARMS, round).map((a) => a.id));
    }
    expect(calls[0]!.argv).toEqual(["node", "child.ts", "--case", "slow"]);
    expect(result.processes[0]).toEqual({ arm: "slow", case: "slow", round: 0, position: 0, ms: 50 });
    expect(result).not.toHaveProperty("fixtures");
  });

  it("gives one A/A record in each round, with the arm that started first", async () => {
    const result = await run({ start: fake().start, job: "2", roundOffset: 8 });
    expect(result.aa).toHaveLength(8);
    for (const record of result.aa) {
      const a = result.processes.find((p) => p.round === record.round && p.arm === "same")!;
      const b = result.processes.find((p) => p.round === record.round && p.arm === "same#aa")!;
      expect(record).toEqual({ case: "same", round: record.round, first: a.position < b.position ? "a" : "b", a: a.ms, b: b.ms, job: "2", env: ENV });
    }
    expect(result.aa.map((r) => r.round)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    const [orders] = aaOrders(result.aa);
    expect(orders!.aFirst!.rounds).toBe(4);
    expect(orders!.bFirst!.rounds).toBe(4);
  });

  it("warns on a count of rounds that is not balanced", async () => {
    const result = await run({ start: fake().start, rounds: 6 });
    expect(result.balanced).toBe(false);
    expect(result.warnings).toEqual([expect.stringMatching(/^6 rounds is not a multiple of 8 \(2 times the 4 arms\)/)]);
  });

  it("checks the fixture files before the first child, and keeps their hashes", async () => {
    const good = fake();
    const read = (path: string): Uint8Array => new TextEncoder().encode(path.endsWith("a.ttf") ? "abc" : "abd");
    const result = await run({ start: good.start, rounds: 1, fixtures: { folder: "f", files: [{ file: "a.ttf", sha256: ABC }], read } });
    expect(result.fixtures).toEqual([{ file: "a.ttf", sha256: ABC, bytes: 3 }]);
    const bad = fake();
    await expect(run({ start: bad.start, fixtures: { folder: "f", files: [{ file: "b.ttf", sha256: ABC }], read } })).rejects.toThrow(/b\.ttf: its SHA-256/);
    expect(bad.calls).toHaveLength(0);
  });

  it("gives the fields of a child line, the command and the folder of an arm, and the arguments of the run", async () => {
    const { start, calls } = fake((argv) => (argv[0] === "deno" ? { stdout: JSON.stringify({ ms: 3, peakRss: 100, samples: [2.5, 3.5], batch: 4 }) } : undefined));
    const arms = [{ id: "x", case: "one", command: ["deno", "x.ts"], cwd: "/tmp/x" }, { id: "y", case: "two" }];
    const result = await freshArms({ arms, command: ["node", "y.ts"], args: (id) => [`--id=${id}`], rounds: 1, env: ENV, start });
    expect(calls.map((c) => c.argv)).toEqual([["deno", "x.ts", "--id=one"], ["node", "y.ts", "--id=two"]]);
    expect(calls[0]!.options.cwd).toBe("/tmp/x");
    expect(calls[1]!.options).not.toHaveProperty("cwd");
    expect(result.processes[0]).toEqual({ arm: "x", case: "one", round: 0, position: 0, ms: 3, fields: { peakRss: 100, extra: { samples: [2.5, 3.5], batch: 4 } } });
    expect(result.processes[1]).not.toHaveProperty("fields");
    expect(result.aa).toEqual([]);
  });

  it("starts warmUp children of each different child before the first round, and keeps no record of them", async () => {
    const { start, calls } = fake();
    const seen: ArmProcess[] = [];
    const result = await run({ start, warmUp: 2, onProcess: (p) => seen.push(p) });
    // The A/A arms "same" and "same#aa" have one child, so each pass starts 3 different children.
    const pass = ["slow", "fast", "same"];
    expect(calls.slice(0, 6).map((c) => c.argv.at(-1))).toEqual([...pass, ...pass]);
    expect(result.warmUp!.map((w) => [w.arm, w.case])).toEqual([...pass, ...pass].map((id) => [id, id]));
    expect(result.warmUp![0]).toEqual({ arm: "slow", case: "slow", ms: 50 });
    expect(calls).toHaveLength(6 + 32);
    expect(result.processes).toHaveLength(32);
    expect(seen).toEqual(result.processes);
    expect(await run({ start: fake().start })).not.toHaveProperty("warmUp");
  });

  it("stops on a warm-up child that skips, and on a warm-up hash that differs from a later hash of its argv", async () => {
    const skip = fake((_, k) => (k === 0 ? { stdout: JSON.stringify({ skipped: "cold" }) } : undefined)).start;
    await expect(run({ start: skip, warmUp: 1 })).rejects.toThrow(/^freshArms: the warm-up child 1 of the arm "slow" on the case "slow" skipped the case \("cold"\)\. A run of arms has no skips/);
    const hashOf = (argv: readonly string[], k: number) => ({ stdout: JSON.stringify({ ms: 1, hash: argv.includes("same") && k === 2 ? "cold" : "h" }) });
    await expect(run({ start: fake(hashOf).start, warmUp: 1 })).rejects.toThrow(/gave the hash h, and an earlier child with the same argv gave cold/);
  });

  it("stops on a failed child, a skip and two hashes of one argv", async () => {
    await expect(run({ start: fake((_, k) => (k === 2 ? { code: 1, stderr: "boom" } : undefined)).start })).rejects.toThrow(/^freshArms: the arm .* exited with the code 1\. The tail of stderr: boom/);
    await expect(run({ start: fake(() => ({ stdout: JSON.stringify({ skipped: "no fonts" }) })).start })).rejects.toThrow(/has no skips/);
    const hashOf = (argv: readonly string[], k: number) => ({ stdout: JSON.stringify({ ms: 1, hash: argv.includes("same") ? `h${k}` : "h" }) });
    await expect(run({ start: fake(hashOf).start })).rejects.toThrow(/an earlier child with the same argv gave h/);
  });

  it("refuses bad arms, a bad A/A pair and bad counts", async () => {
    const { start } = fake();
    const bad: Partial<FreshArmsOptions>[] = [
      { arms: [] },
      { arms: [ARMS[0]!, ARMS[0]!] },
      { arms: [{ id: "x", case: "" }] },
      { arms: [{ id: "x", case: "c", cwd: "" }] },
      { command: [] },
      { aa: ["same", "nope"] },
      { aa: ["same", "same"] },
      { aa: ["same", "fast"] },
      { arms: [...ARMS.slice(0, 3), { id: "same#aa", case: "same", command: ["deno"] }] },
      { rounds: 0 },
      { roundOffset: -1 },
      { timeoutMs: 0 },
      { warmUp: -1 },
      { warmUp: 0.5 },
    ];
    for (const options of bad) await expect(run({ start, ...options }), JSON.stringify(options)).rejects.toThrow(RangeError);
  });
});

describe("armTimes", () => {
  it("gives the median, the 10th and the 90th percentiles, their ratio, the least and the greatest time of each arm", () => {
    const records = (arm: string, times: readonly number[]): ArmProcess[] => times.map((ms, round) => ({ arm, case: arm, round, position: 0, ms }));
    const [x, y] = armTimes([...records("x", [6, 2, 3, 4, 5, 1, 7, 8, 9, 11, 10]), ...records("y", [4, 4])]);
    expect(x).toEqual({ arm: "x", case: "x", processes: 11, median: 6, p10: 2, p90: 10, spread: 5, min: 1, max: 11 });
    expect(y).toEqual({ arm: "y", case: "y", processes: 2, median: 4, p10: 4, p90: 4, spread: 1, min: 4, max: 4 });
  });

  it("refuses a bad time and an arm with two cases", () => {
    expect(() => armTimes([{ arm: "x", case: "x", round: 0, position: 0, ms: 0 }])).toThrow(RangeError);
    expect(() => armTimes([{ arm: "x", case: "x", round: 0, position: 0, ms: 1 }, { arm: "x", case: "y", round: 1, position: 0, ms: 1 }])).toThrow(/two|cases/);
  });
});
