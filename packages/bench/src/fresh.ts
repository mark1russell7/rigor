/**
 * The fresh-process runner of a bench, for Node only. Each arm of each pair, case and round is one fresh child process.
 * The child prints one JSON line with its time. The runner keeps the order of `pairOrder`, and gives `PairedTime` records.
 */
import { readFileSync, rmSync } from "node:fs";
import { arch, cpus, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { PerformanceObserver } from "node:perf_hooks";
import { setFlagsFromString } from "node:v8";
import { type Arm, type PairedTime, firstArm } from "./paired.ts";
import { startProcess, stderrTail } from "./start.ts";

export { type CheckoutArm, type CheckoutArmOptions, type RepoCommitOptions, checkoutArm, repoCommit } from "./checkout.ts";

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

/** Two counts of events: in the first half and in the last half of the counted samples of a child. */
export type HalfCounts = readonly [early: number, late: number];

/** The events of a child in its counted samples. `eventProbe` gives them. */
export interface ChildEvents {
  /** The GC events of each half. */
  readonly gc: HalfCounts;
  /** The deopts of each half. Only a probe with `deopt: true` counts them. */
  readonly deopt?: HalfCounts;
}

/** The fields of a child line in addition to its time. Each field is optional. */
export interface ChildFields {
  /** The memory peak of the child process in bytes. `peakRss()` gives it. */
  readonly peakRss?: number;
  /** The warm check of `timeArm`: the median of the last half of the samples over the median of the first half. */
  readonly warm?: number;
  /** The events of the counted samples. */
  readonly events?: ChildEvents;
}

/** The result line of a child that timed the arm. */
export interface ChildTime extends ChildFields {
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
 * The fields `peakRss`, `warm` and `events` are optional. When a line has one of them, the field must be valid.
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
  return { ms, ...(hash === undefined ? {} : { hash }), ...childFields(value as Record<string, unknown>) };
}

/** This function reads the optional fields of a child line. A field that is not valid is an error. */
function childFields(value: Record<string, unknown>): ChildFields {
  const { peakRss, warm, events } = value;
  if (peakRss !== undefined && !(typeof peakRss === "number" && Number.isFinite(peakRss) && peakRss >= 0)) {
    throw new Error(`childLine: the memory peak peakRss is a finite number of bytes of 0 or more, not ${JSON.stringify(peakRss)}.`);
  }
  if (warm !== undefined && !(typeof warm === "number" && Number.isFinite(warm) && warm > 0)) throw new Error(`childLine: the warm check is a finite number above 0, not ${JSON.stringify(warm)}.`);
  const counts = (x: unknown): x is HalfCounts => Array.isArray(x) && x.length === 2 && x.every((n) => Number.isSafeInteger(n) && (n as number) >= 0);
  let read: ChildEvents | undefined;
  if (events !== undefined) {
    const { gc, deopt } = (typeof events === "object" && events !== null && !Array.isArray(events) ? events : {}) as Record<string, unknown>;
    if (!counts(gc) || (deopt !== undefined && !counts(deopt))) {
      throw new Error(`childLine: the events have gc, and an optional deopt, each two whole numbers of 0 or more, not ${JSON.stringify(events)}.`);
    }
    read = { gc: [gc[0], gc[1]], ...(deopt === undefined ? {} : { deopt: [deopt[0], deopt[1]] as const }) };
  }
  return { ...(peakRss === undefined ? {} : { peakRss }), ...(warm === undefined ? {} : { warm }), ...(read === undefined ? {} : { events: read }) };
}

/** This function gives the memory peak of this process in bytes. Print it in the child line as `peakRss`. */
export function peakRss(): number {
  // The field maxRSS of Node is in kibibytes.
  return process.resourceUsage().maxRSS * 1024;
}

/** The options of an event probe. */
export interface ProbeOptions {
  /** The value `true` also counts the deopts with the V8 flag `--trace-deopt`. The default is `false`. */
  readonly deopt?: boolean;
  /** The folder of the trace file of the deopts. The default is the folder of the temporary files. */
  readonly dir?: string;
}

/** The event probe of a child. Give `mark` to `timeArm`, then read `events` after it. */
export interface EventProbe {
  readonly mark: (sample: number) => void;
  /** This function gives the counts of each half of the counted samples, and stops the probe. */
  readonly events: (samples: number) => Promise<ChildEvents>;
}

/**
 * This function starts the event probe of a child. A `PerformanceObserver` records the start of each GC event.
 * With `deopt: true`, the V8 flag `--trace-deopt` writes each deopt to a file of the child.
 * Each mark records its time and the count of deopts. The read of the file is outside the time of the mark.
 */
export function eventProbe(options: ProbeOptions = {}): EventProbe {
  const file = options.deopt === true ? join(options.dir ?? tmpdir(), `rigor-bench-deopt-${process.pid}.txt`) : undefined;
  if (file !== undefined) for (const flag of ["--trace-deopt", "--redirect-code-traces", `--redirect-code-traces-to=${file}`]) setFlagsFromString(flag);
  const gc: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) gc.push(entry.startTime);
  });
  observer.observe({ entryTypes: ["gc"] });
  const deopts = (): number => {
    if (file === undefined) return 0;
    try {
      return readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.includes("[bailout (kind")).length;
    } catch {
      // V8 makes the file at the first deopt.
      return 0;
    }
  };
  const marks = new Map<number, { before: number; deopt: number; after: number }>();
  return {
    mark: (sample) => {
      const before = performance.now();
      const deopt = deopts();
      marks.set(sample, { before, deopt, after: performance.now() });
    },
    events: async (samples) => {
      // The observer gets the GC entries after a turn of the event loop.
      await new Promise((done) => setTimeout(done, 10));
      observer.disconnect();
      if (file !== undefined) {
        setFlagsFromString("--no-trace-deopt");
        rmSync(file, { force: true });
      }
      const half = Math.floor(samples / 2);
      const span = (from: number, to: number): [number, number] => {
        const a = marks.get(from);
        const b = marks.get(to);
        if (a === undefined || b === undefined) throw new Error(`eventProbe: the probe has no mark at the sample ${a === undefined ? from : to}.`);
        return [gc.filter((t) => t >= a.after && t < b.before).length, b.deopt - a.deopt];
      };
      const early = span(0, half);
      const late = span(samples - half, samples);
      return { gc: [early[0], late[0]], ...(file === undefined ? {} : { deopt: [early[1], late[1]] as const }) };
    },
  };
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
  /** The folder where each child of the arm starts. The default is the folder of this process. */
  readonly cwd?: string;
  /** The commit of the build of the arm. Each record of a pair with this arm names it in `commits`. */
  readonly commit?: string;
}

/** The limits of one child. */
export interface StartOptions {
  /** The longest time of the child in milliseconds. */
  readonly timeoutMs: number;
  /** The most bytes of `stdout` or `stderr`. */
  readonly maxBuffer: number;
  /** The folder where the child starts. The default is the folder of this process. */
  readonly cwd?: string;
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
  /**
   * The value `true` adds the A/A pair (base, base) with the id `${base.id}~aa`. The default is `true`.
   * The value `"each"` also adds the A/A pair of each candidate, with the id `${id}~aa`. Two builds of a run need it.
   */
  readonly aa?: boolean | "each";
  /** The arguments of a case after the command of an arm. The default is `["--case", id]`. */
  readonly args?: (caseId: string) => readonly string[];
  /** The longest time of one child in milliseconds. The default is 600000 (10 minutes). */
  readonly timeoutMs?: number;
  /**
   * The result of a child that takes more time than `timeoutMs`. The default `"error"` stops the run with an error.
   * With `"skip"`, a child over the limit in the first round of the job skips its case, with the reason
   * `took more than <timeoutMs> ms`. Thus a case that does not end is a result with a reason, and the job ends in time.
   * A child over the limit in a later round is an error, as each skip after the first round is.
   */
  readonly overLimit?: "error" | "skip";
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
  /** The fields of the child of each arm in addition to its time. Only a record with a child that gives a field has it. */
  readonly fields?: { readonly a: ChildFields; readonly b: ChildFields };
  /** The commits of the arms of the pair. Only a record of a pair with an arm that names a commit has it. */
  readonly commits?: { readonly a?: string; readonly b?: string };
}

/** A case that an arm skipped. The case is in no pair. */
export interface FreshSkip {
  readonly arm: string;
  readonly case: string;
  /** The global round of the skip. A skip is in the first round of its job. */
  readonly round: number;
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

/**
 * This function starts each arm of each pair, case and round in a fresh child, and gives the records of each pair.
 * - Each candidate is a pair (base, candidate) with its own base child. The A/A pair is (base, base).
 * - In each round and case, the pairs come in the order of `pairOrder`. The first arm of a pair starts first.
 * - A child that exits with an error, takes too long or prints no JSON line is an error. A skip line skips a case.
 *   With `overLimit: "skip"`, a child that takes too long in the first round skips its case too.
 * - A case that an arm skips in the first round of the job leaves each pair, and the runner starts no more children for it.
 * - A skip after the first round is an error. It shows a child that is not deterministic, and it drops paid data.
 * - Two different hashes of one arm on one case are an error.
 */
export async function freshRun(options: FreshOptions): Promise<FreshRun> {
  const { base, candidates, cases, rounds } = options;
  const roundOffset = options.roundOffset ?? 0;
  const job = options.job ?? "0";
  const timeoutMs = options.timeoutMs ?? 600_000;
  const overLimit = options.overLimit ?? "error";
  const maxBuffer = options.maxBuffer ?? 1 << 24;
  const args = options.args ?? ((id: string) => ["--case", id]);
  const start = options.start ?? startProcess;
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError(`freshRun: the rounds are a whole number of 1 or more, not ${rounds}.`);
  if (!Number.isSafeInteger(roundOffset) || roundOffset < 0) throw new RangeError(`freshRun: the round offset is a whole number of 0 or more, not ${roundOffset}.`);
  if (!(timeoutMs > 0) || !(maxBuffer > 0)) throw new RangeError("freshRun: the time limit and the output limit are above 0.");
  if (overLimit !== "error" && overLimit !== "skip") throw new RangeError(`freshRun: overLimit is "error" or "skip", not ${JSON.stringify(overLimit)}.`);
  if (cases.length === 0 || new Set(cases).size !== cases.length || cases.some((c) => typeof c !== "string" || c === "")) {
    throw new RangeError("freshRun: the cases are 1 or more different strings that are not empty.");
  }
  const pairs: { id: string; a: FreshArm; b: FreshArm }[] = candidates.map((c) => ({ id: c.id, a: base, b: c }));
  const aa = options.aa ?? true;
  if (aa !== true && aa !== false && aa !== "each") throw new RangeError(`freshRun: aa is true, false or "each", not ${JSON.stringify(aa)}.`);
  if (aa !== false) pairs.push({ id: `${base.id}${AA_SUFFIX}`, a: base, b: base });
  if (aa === "each") for (const c of candidates) pairs.push({ id: `${c.id}${AA_SUFFIX}`, a: c, b: c });
  if (pairs.length === 0) throw new RangeError("freshRun: the run has no pairs. Give a candidate, or keep the A/A pair.");
  for (const arm of [base, ...candidates]) {
    if (typeof arm.id !== "string" || arm.id === "") throw new RangeError("freshRun: the id of an arm is a string that is not empty.");
    if (arm.command.length === 0 || arm.command.some((s) => typeof s !== "string")) throw new RangeError(`freshRun: the command of the arm ${JSON.stringify(arm.id)} is 1 or more strings.`);
    for (const key of ["cwd", "commit"] as const) {
      const value = arm[key];
      if (value !== undefined && (typeof value !== "string" || value === "")) throw new RangeError(`freshRun: the ${key} of the arm ${JSON.stringify(arm.id)} is a string that is not empty.`);
    }
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
        const fields: Record<Arm, ChildFields> = { a: {}, b: {} };
        for (const arm of [slot.first, slot.first === "a" ? "b" : "a"] as const) {
          const who = pair[arm];
          const where = `the arm ${JSON.stringify(who.id)} (pair ${JSON.stringify(pair.id)}, arm ${arm}) on the case ${JSON.stringify(id)}, round ${round}`;
          const line = await child(start, [...who.command, ...args(id)], { timeoutMs, maxBuffer, ...(who.cwd === undefined ? {} : { cwd: who.cwd }) }, where, overLimit);
          if (line.skipped !== undefined) {
            if (r > 0) throw new Error(`freshRun: ${where} skipped the case after the first round of the job (${JSON.stringify(line.skipped)}). A child that skips only in a later round is not deterministic.`);
            skip = { arm: who.id, case: id, round, reason: line.skipped };
            break;
          }
          if (line.hash !== undefined) {
            const key = `${who.id}\u0000${id}`;
            const known = hashes.get(key);
            if (known !== undefined && known !== line.hash) throw new Error(`freshRun: ${where} gave the hash ${line.hash}, and an earlier child of the arm gave ${known}.`);
            hashes.set(key, line.hash);
          }
          times[arm] = line.ms;
          const { ms: _ms, hash: _hash, skipped: _skipped, ...more } = line;
          fields[arm] = more;
        }
        if (skip !== undefined) break;
        const extra = Object.keys(fields.a).length + Object.keys(fields.b).length > 0 ? { fields } : {};
        records.push({ pair: pair.id, record: { case: id, round, first: slot.first, a: times.a!, b: times.b!, job, env, ...extra, ...commitsOf(pair) } });
      }
      if (skip !== undefined) {
        skipped.push(skip);
        gone.add(id);
        continue;
      }
      for (const { pair, record } of records) out[pair]!.push(record);
    }
  }
  return { env, job, pairs: out, skipped };
}

/** This function gives the field `commits` of the records of a pair, or nothing when no arm of the pair names a commit. */
function commitsOf(pair: { a: FreshArm; b: FreshArm }): { commits?: { a?: string; b?: string } } {
  if (pair.a.commit === undefined && pair.b.commit === undefined) return {};
  return { commits: { ...(pair.a.commit === undefined ? {} : { a: pair.a.commit }), ...(pair.b.commit === undefined ? {} : { b: pair.b.commit }) } };
}

/** This function starts one child and reads its JSON line. A fault gives an error that names the arm, the case, the round and the tail of `stderr`. */
async function child(start: StartChild, argv: readonly string[], limits: StartOptions, where: string, overLimit: "error" | "skip"): Promise<ChildLine> {
  let exit: ChildExit;
  try {
    exit = await start(argv, limits);
  } catch (error) {
    throw new Error(`freshRun: ${where} did not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const fail = (why: string): Error => {
    return new Error(`freshRun: ${where} ${why}. The tail of stderr: ${stderrTail(exit.stderr)}`);
  };
  if (exit.error !== undefined) throw fail(`failed: ${exit.error}`);
  if (exit.timedOut === true) {
    if (overLimit === "skip") return { skipped: `took more than ${limits.timeoutMs} ms` };
    throw fail(`took more than ${limits.timeoutMs} ms`);
  }
  if (exit.code !== 0) throw fail(exit.code === null ? "stopped on a signal" : `exited with the code ${exit.code}`);
  try {
    return childLine(exit.stdout);
  } catch (error) {
    throw fail(`printed no good JSON line (${error instanceof Error ? error.message : String(error)})`);
  }
}
