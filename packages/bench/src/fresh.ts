/**
 * The fresh-process runner of a bench, for Node only. Each arm of each pair, case and round is one fresh child process.
 * The child prints one JSON line with its time. The runner keeps the order of `pairOrder`, and gives `PairedTime` records.
 */
import { spawn } from "node:child_process";
import { arch, cpus, platform } from "node:os";
import { type Arm, type PairedTime, firstArm } from "./paired.ts";

/** The computer of a run. The `cpu` is the model of the first CPU. */
export interface BenchEnv {
  readonly cpu: string;
  readonly cores: number;
  readonly os: string;
  readonly arch: string;
  readonly node: string;
  /** The name of the runner, from `BENCH_RUNNER` or else `RUNNER_NAME`. An empty value is absent. */
  readonly runner?: string;
}

/** This function gives the computer of this process. The runner comes from `BENCH_RUNNER`, or else from `RUNNER_NAME`. */
export function benchEnv(): BenchEnv {
  const all = cpus();
  const env = { cpu: all[0]?.model.trim() || "unknown", cores: all.length, os: platform(), arch: arch(), node: process.version };
  const runner = process.env["BENCH_RUNNER"] || process.env["RUNNER_NAME"];
  return runner === undefined || runner === "" ? env : { ...env, runner };
}

/** The JSON line of a child: its time in milliseconds, the hash of its output, and the reason of a skip. */
export type ChildLine = ChildTime | ChildSkip;

/** The result line of a child that timed the arm. */
export interface ChildTime {
  readonly ms: number;
  /** The hash of the output of the arm. Two different hashes of one arm on one case are an error. */
  readonly hash?: string;
  readonly skipped?: undefined;
}

/** The result line of a child that skipped the case. A skip line does not need a time. */
export interface ChildSkip {
  /** The reason of the skip. The runner removes the case from each pair. */
  readonly skipped: string;
  readonly ms?: number;
  readonly hash?: string;
}

/**
 * This function reads the last line of `stdout` that starts with `{`. The time `ms` is a finite number above 0.
 * A skip line has the reason `skipped` and does not need a time. No such line, bad JSON or a bad field is an error.
 */
export function childLine(stdout: string): ChildLine {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .findLast((l) => l.startsWith("{"));
  if (line === undefined) throw new Error("childLine: the output has no line that starts with {.");
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(`childLine: the last line that starts with { is not JSON: ${line.slice(0, 200)}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`childLine: the last JSON line is not an object: ${line.slice(0, 200)}`);
  const { ms, hash, skipped } = value as Record<string, unknown>;
  if (hash !== undefined && typeof hash !== "string") throw new Error(`childLine: the hash is a string, not ${JSON.stringify(hash)}.`);
  if (skipped !== undefined) {
    if (!(typeof skipped === "string" && skipped !== "")) throw new Error(`childLine: the reason of a skip is a string that is not empty, not ${JSON.stringify(skipped)}.`);
    return { skipped, ...(typeof ms === "number" ? { ms } : {}), ...(hash === undefined ? {} : { hash }) };
  }
  if (!(typeof ms === "number" && Number.isFinite(ms) && ms > 0)) throw new Error(`childLine: the time ms is a finite number above 0, not ${JSON.stringify(ms)}.`);
  return { ms, ...(hash === undefined ? {} : { hash }) };
}

/** One slot of the order of a round: the index of the pair, and the arm of that pair that starts first. */
export interface PairSlot {
  readonly pair: number;
  readonly first: Arm;
}

/**
 * This function gives the order of the pairs of one case in one round. `round` is the global round.
 * - Pair `p` starts with `firstArm(round, caseIndex + p)`.
 * - The pairs rotate by `(Math.floor(round / 2) + caseIndex) % pairs`. Thus the pair that starts first turns each second round.
 * - For 2 pairs, the order is the order of `timeArmOrder` of the joint bench.
 */
export function pairOrder(pairs: number, round: number, caseIndex: number): PairSlot[] {
  if (!Number.isSafeInteger(pairs) || pairs < 1) throw new RangeError(`pairOrder: the count of the pairs is a whole number of 1 or more, not ${pairs}.`);
  if (!Number.isSafeInteger(round) || round < 0) throw new RangeError(`pairOrder: the round is a whole number of 0 or more, not ${round}.`);
  if (!Number.isSafeInteger(caseIndex) || caseIndex < 0) throw new RangeError(`pairOrder: the index of the case is a whole number of 0 or more, not ${caseIndex}.`);
  const shift = (Math.floor(round / 2) + caseIndex) % pairs;
  return Array.from({ length: pairs }, (_, i) => {
    const pair = (shift + i) % pairs;
    return { pair, first: firstArm(round, caseIndex + pair) };
  });
}

/** One arm of a run: its id and the argv of its child. The first item of `command` is the program. */
export interface FreshArm {
  readonly id: string;
  readonly command: readonly string[];
}

/** The limits of one child. */
export interface StartOptions {
  /** The longest time of the child in milliseconds. */
  readonly timeoutMs: number;
  /** The most bytes of `stdout` or `stderr`. */
  readonly maxBuffer: number;
}

/** The end of one child. */
export interface ChildExit {
  readonly stdout: string;
  readonly stderr: string;
  /** The exit code, or `null` when a signal stopped the child. */
  readonly code: number | null;
  /** The value is `true` when the child took more time than the limit. */
  readonly timedOut?: boolean;
  /** The reason of a fault outside the child, for example a program that does not exist or too much output. */
  readonly error?: string;
}

/** The start of one child: it gives the end of the child. The default starts a process with `spawn`, without a shell. */
export type StartChild = (argv: readonly string[], options: StartOptions) => Promise<ChildExit>;

/** The options of a fresh run. */
export interface FreshOptions {
  /** The base arm. It is arm `a` of each pair. */
  readonly base: FreshArm;
  /** The candidate arms. Each candidate is arm `b` of its own pair, and the id of the pair is its id. */
  readonly candidates: readonly FreshArm[];
  /** The ids of the cases. */
  readonly cases: readonly string[];
  /** The count of the rounds of this job. */
  readonly rounds: number;
  /**
   * The global round of the first round of this job. The default is 0.
   * A run of many jobs sets it to `job * rounds`, so each round is global over the jobs.
   * Without it, each job repeats the first orders, and the merge removes more records.
   */
  readonly roundOffset?: number;
  /** The value `true` adds the A/A pair (base, base) with the id `${base.id}~aa`. The default is `true`. */
  readonly aa?: boolean;
  /** The arguments of a case after the command of an arm. The default is `["--case", id]`. */
  readonly args?: (caseId: string) => readonly string[];
  /** The longest time of one child in milliseconds. The default is 600000 (10 minutes). */
  readonly timeoutMs?: number;
  /** The most bytes of the output of one child. The default is 16 MiB. */
  readonly maxBuffer?: number;
  /** The label of the job. The default is `"0"`. */
  readonly job?: string;
  /** The computer of the run. The default is `benchEnv()`. */
  readonly env?: BenchEnv;
  /** The start of a child. The default starts a process. A test gives its own. */
  readonly start?: StartChild;
}

/** One record of a fresh run: a `PairedTime` record with the job and the computer of its job. */
export interface FreshRecord extends PairedTime {
  readonly job: string;
  readonly env: BenchEnv;
}

/** A case that an arm skipped. The case is in no pair. */
export interface FreshSkip {
  readonly arm: string;
  readonly case: string;
  readonly reason: string;
}

/** The result of a fresh run. */
export interface FreshRun {
  readonly env: BenchEnv;
  readonly job: string;
  /** The records of each pair, by the id of the pair. */
  readonly pairs: Record<string, FreshRecord[]>;
  readonly skipped: FreshSkip[];
}

/** The suffix of the id of the A/A pair. */
const AA_SUFFIX = "~aa";

/** The longest tail of `stderr` in an error. */
const TAIL = 2000;

/**
 * This function starts each arm of each pair, case and round in a fresh child, and gives the records of each pair.
 * - Each candidate is a pair (base, candidate) with its own base child. The A/A pair is (base, base).
 * - In each round and case, the pairs come in the order of `pairOrder`. The first arm of a pair starts first.
 * - A child that exits with an error, takes too long or prints no JSON line is an error. Only a skip line skips a case.
 * - A case that an arm skips leaves each pair, and the runner starts no more children for it.
 * - Two different hashes of one arm on one case are an error.
 */
export async function freshRun(options: FreshOptions): Promise<FreshRun> {
  const { base, candidates, cases, rounds } = options;
  const roundOffset = options.roundOffset ?? 0;
  const job = options.job ?? "0";
  const timeoutMs = options.timeoutMs ?? 600_000;
  const maxBuffer = options.maxBuffer ?? 1 << 24;
  const args = options.args ?? ((id: string) => ["--case", id]);
  const start = options.start ?? startProcess;
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError(`freshRun: the rounds are a whole number of 1 or more, not ${rounds}.`);
  if (!Number.isSafeInteger(roundOffset) || roundOffset < 0) throw new RangeError(`freshRun: the round offset is a whole number of 0 or more, not ${roundOffset}.`);
  if (!(timeoutMs > 0) || !(maxBuffer > 0)) throw new RangeError("freshRun: the time limit and the output limit are above 0.");
  if (cases.length === 0 || new Set(cases).size !== cases.length || cases.some((c) => typeof c !== "string" || c === "")) {
    throw new RangeError("freshRun: the cases are 1 or more different strings that are not empty.");
  }
  const pairs: { id: string; a: FreshArm; b: FreshArm }[] = candidates.map((c) => ({ id: c.id, a: base, b: c }));
  if (options.aa ?? true) pairs.push({ id: `${base.id}${AA_SUFFIX}`, a: base, b: base });
  if (pairs.length === 0) throw new RangeError("freshRun: the run has no pairs. Give a candidate, or keep the A/A pair.");
  for (const arm of [base, ...candidates]) {
    if (typeof arm.id !== "string" || arm.id === "") throw new RangeError("freshRun: the id of an arm is a string that is not empty.");
    if (arm.command.length === 0 || arm.command.some((s) => typeof s !== "string")) throw new RangeError(`freshRun: the command of the arm ${JSON.stringify(arm.id)} is 1 or more strings.`);
  }
  const ids = new Set([base.id]);
  for (const { id } of pairs) {
    if (ids.has(id)) throw new RangeError(`freshRun: two arms or pairs have the id ${JSON.stringify(id)}.`);
    ids.add(id);
  }

  const env = options.env ?? benchEnv();
  const out: Record<string, FreshRecord[]> = Object.fromEntries(pairs.map((p) => [p.id, []]));
  const skipped: FreshSkip[] = [];
  const gone = new Set<string>();
  const hashes = new Map<string, string>();

  for (let r = 0; r < rounds; r++) {
    const round = roundOffset + r;
    for (let i = 0; i < cases.length; i++) {
      const id = cases[i]!;
      if (gone.has(id)) continue;
      const records: { pair: string; record: FreshRecord }[] = [];
      let skip: FreshSkip | undefined;
      for (const slot of pairOrder(pairs.length, round, i)) {
        const pair = pairs[slot.pair]!;
        const times: Partial<Record<Arm, number>> = {};
        for (const arm of [slot.first, slot.first === "a" ? "b" : "a"] as const) {
          const who = pair[arm];
          const where = `the arm ${JSON.stringify(who.id)} (pair ${JSON.stringify(pair.id)}, arm ${arm}) on the case ${JSON.stringify(id)}, round ${round}`;
          const line = await child(start, [...who.command, ...args(id)], { timeoutMs, maxBuffer }, where);
          if (line.skipped !== undefined) {
            skip = { arm: who.id, case: id, reason: line.skipped };
            break;
          }
          if (line.hash !== undefined) {
            const key = `${who.id}\u0000${id}`;
            const known = hashes.get(key);
            if (known !== undefined && known !== line.hash) throw new Error(`freshRun: ${where} gave the hash ${line.hash}, and an earlier child of the arm gave ${known}.`);
            hashes.set(key, line.hash);
          }
          times[arm] = line.ms;
        }
        if (skip !== undefined) break;
        records.push({ pair: pair.id, record: { case: id, round, first: slot.first, a: times.a!, b: times.b!, job, env } });
      }
      if (skip !== undefined) {
        skipped.push(skip);
        gone.add(id);
        for (const list of Object.values(out)) for (let k = list.length - 1; k >= 0; k--) if (list[k]!.case === id) list.splice(k, 1);
        continue;
      }
      for (const { pair, record } of records) out[pair]!.push(record);
    }
  }
  return { env, job, pairs: out, skipped };
}

/** This function starts one child and reads its JSON line. A fault gives an error that names the arm, the case, the round and the tail of `stderr`. */
async function child(start: StartChild, argv: readonly string[], limits: StartOptions, where: string): Promise<ChildLine> {
  let exit: ChildExit;
  try {
    exit = await start(argv, limits);
  } catch (error) {
    throw new Error(`freshRun: ${where} did not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const fail = (why: string): Error => {
    const tail = exit.stderr.length > TAIL ? `...${exit.stderr.slice(-TAIL)}` : exit.stderr;
    return new Error(`freshRun: ${where} ${why}. The tail of stderr: ${tail.trim() === "" ? "(empty)" : tail.trimEnd()}`);
  };
  if (exit.error !== undefined) throw fail(`failed: ${exit.error}`);
  if (exit.timedOut === true) throw fail(`took more than ${limits.timeoutMs} ms`);
  if (exit.code !== 0) throw fail(exit.code === null ? "stopped on a signal" : `exited with the code ${exit.code}`);
  try {
    return childLine(exit.stdout);
  } catch (error) {
    throw fail(`printed no good JSON line (${error instanceof Error ? error.message : String(error)})`);
  }
}

/** This function starts a process with `spawn` and no shell. It stops the process at the time limit or at the output limit. */
function startProcess(argv: readonly string[], options: StartOptions): Promise<ChildExit> {
  return new Promise((resolve) => {
    const [program, ...rest] = argv;
    const proc = spawn(program!, rest, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    let error: string | undefined;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const exit: ChildExit = { stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), code, timedOut };
      resolve(error === undefined ? exit : { ...exit, error });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, options.timeoutMs);
    const take = (list: Buffer[]) => {
      let bytes = 0;
      return (chunk: Buffer): void => {
        bytes += chunk.length;
        if (bytes > options.maxBuffer) {
          error ??= `an output is more than ${options.maxBuffer} bytes`;
          proc.kill();
          return;
        }
        list.push(chunk);
      };
    };
    proc.stdout.on("data", take(out));
    proc.stderr.on("data", take(err));
    proc.on("error", (e) => {
      error ??= e.message;
      // A program that does not start gives no event close.
      if (proc.pid === undefined) finish(null);
    });
    proc.on("close", (code) => finish(code));
  });
}
