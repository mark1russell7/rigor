/**
 * The fresh-process runner of a bench, for Node only. Each arm of each pair, case and round is one fresh child process.
 * The child prints one JSON line with its time. The runner keeps the order of `pairOrder`, and gives `PairedTime` records.
 */
import { readFileSync, rmSync } from "node:fs";
import { arch, cpus, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { PerformanceObserver } from "node:perf_hooks";
import { setFlagsFromString } from "node:v8";
import type { ArmProcess } from "./arm-times.ts";
import { type FixtureFile, type FixtureHash, checkFixtures } from "./fixtures.ts";
import { type Arm, type PairedTime, armOrder, balancedRounds, firstArm } from "./paired.ts";
import { startProcess, stderrTail } from "./start.ts";

export { type ArmProcess, type ArmTimes, armTimes } from "./arm-times.ts";
export { type CheckoutArm, type CheckoutArmOptions, type RepoCommitOptions, checkoutArm, repoCommit } from "./checkout.ts";
export { type FixtureFile, type FixtureHash, type FixtureOptions, checkFixtures, fixtureDifferences } from "./fixtures.ts";

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

/** Two times in milliseconds: in the first half and in the last half of the counted samples of a child. */
export type HalfTimes = readonly [early: number, late: number];

/** The events of a child in its counted samples. `eventProbe` gives them. */
export interface ChildEvents {
  /** The GC events of each half. */
  readonly gc: HalfCounts;
  /** The GC time of each half: the sum of the durations of its GC events. A line of an older probe has no `gcMs`. */
  readonly gcMs?: HalfTimes;
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
  const times = (x: unknown): x is HalfTimes => Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
  let read: ChildEvents | undefined;
  if (events !== undefined) {
    const { gc, gcMs, deopt } = (typeof events === "object" && events !== null && !Array.isArray(events) ? events : {}) as Record<string, unknown>;
    if (!counts(gc) || (deopt !== undefined && !counts(deopt))) {
      throw new Error(`childLine: the events have gc, and an optional deopt, each two whole numbers of 0 or more, not ${JSON.stringify(events)}.`);
    }
    if (gcMs !== undefined && !times(gcMs)) throw new Error(`childLine: the GC time gcMs of the events is two finite numbers of 0 or more, not ${JSON.stringify(gcMs)}.`);
    read = {
      gc: [gc[0], gc[1]],
      ...(gcMs === undefined ? {} : { gcMs: [gcMs[0], gcMs[1]] as const }),
      ...(deopt === undefined ? {} : { deopt: [deopt[0], deopt[1]] as const }),
    };
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
  /** This function gives the counts and the GC time of each half of the counted samples, and stops the probe. */
  readonly events: (samples: number) => Promise<ChildEvents>;
}

/**
 * This function starts the event probe of a child. A `PerformanceObserver` records the start and the duration of each GC event.
 * A GC event is in a half when it starts in that half. Its full duration counts in that half.
 * With `deopt: true`, the V8 flag `--trace-deopt` writes each deopt to a file of the child.
 * Each mark records its time and the count of deopts. The read of the file is outside the time of the mark.
 */
export function eventProbe(options: ProbeOptions = {}): EventProbe {
  const file = options.deopt === true ? join(options.dir ?? tmpdir(), `rigor-bench-deopt-${process.pid}.txt`) : undefined;
  if (file !== undefined) for (const flag of ["--trace-deopt", "--redirect-code-traces", `--redirect-code-traces-to=${file}`]) setFlagsFromString(flag);
  const gc: { start: number; ms: number }[] = [];
  const record = (entries: readonly { readonly startTime: number; readonly duration: number }[]): void => {
    for (const entry of entries) gc.push({ start: entry.startTime, ms: entry.duration });
  };
  const observer = new PerformanceObserver((list) => record(list.getEntries()));
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
      // The observer gets the GC entries after a turn of the event loop. takeRecords gets the entries that are still in its buffer.
      await new Promise((done) => setTimeout(done, 10));
      record(observer.takeRecords());
      observer.disconnect();
      if (file !== undefined) {
        setFlagsFromString("--no-trace-deopt");
        rmSync(file, { force: true });
      }
      const half = Math.floor(samples / 2);
      const span = (from: number, to: number): { count: number; ms: number; deopt: number } => {
        const a = marks.get(from);
        const b = marks.get(to);
        if (a === undefined || b === undefined) throw new Error(`eventProbe: the probe has no mark at the sample ${a === undefined ? from : to}.`);
        const inside = gc.filter((event) => event.start >= a.after && event.start < b.before);
        return { count: inside.length, ms: inside.reduce((sum, event) => sum + event.ms, 0), deopt: b.deopt - a.deopt };
      };
      const early = span(0, half);
      const late = span(samples - half, samples);
      return {
        gc: [early.count, late.count],
        gcMs: [early.ms, late.ms],
        ...(file === undefined ? {} : { deopt: [early.deopt, late.deopt] as const }),
      };
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
          const line = await child(start, [...who.command, ...args(id)], { timeoutMs, maxBuffer, ...(who.cwd === undefined ? {} : { cwd: who.cwd }) }, where, overLimit, "freshRun");
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

/** One arm of a run of arms: its id, the case that it times, and the argv of its child. */
export interface CaseArm {
  readonly id: string;
  /** The id of the case of the arm. The child of the arm gets `args(case)` after its command. */
  readonly case: string;
  /** The argv of the child before the arguments of the case. The default is the `command` of the run. */
  readonly command?: readonly string[];
  /** The folder where each child of the arm starts. The default is the folder of this process. */
  readonly cwd?: string;
}

/** The fixture files of a run of arms: their folder and their pinned hashes. */
export interface ArmsFixtures {
  readonly folder: string;
  readonly files: readonly FixtureFile[];
  /** The read of a file. The default is `readFileSync`. A test gives its own. */
  readonly read?: (path: string) => Uint8Array;
}

/** The options of a run of arms. */
export interface FreshArmsOptions {
  /** The arms. Each arm usually times its own case. Two arms with the same case and command make an A/A pair. */
  readonly arms: readonly CaseArm[];
  /** The argv of the child of each arm that has no command of its own. */
  readonly command?: readonly string[];
  /** The arguments of a case after the command of an arm. The default is `["--case", id]`. */
  readonly args?: (caseId: string) => readonly string[];
  /** The ids of the two arms of the A/A pair. The two arms have the same case, command and folder. Arm `a` of each A/A record is the first id. */
  readonly aa?: readonly [string, string];
  /** The count of the rounds of this job. The default is `balancedRounds` of the count of arms. */
  readonly rounds?: number;
  /** The global round of the first round of this job. The default is 0. A run of many jobs sets it to `job * rounds`. */
  readonly roundOffset?: number;
  /** The fixture files. The run checks their hashes with `checkFixtures` before the first child. */
  readonly fixtures?: ArmsFixtures;
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
  /** This function gets the record of each child when the child ends. A runner prints its progress with it. */
  readonly onProcess?: (record: ArmProcess) => void;
}

/** The result of a run of arms. */
export interface FreshArms {
  readonly env: BenchEnv;
  readonly job: string;
  readonly rounds: number;
  /** The value is `true` when `rounds` is a multiple of `balancedRounds` of the count of arms. */
  readonly balanced: boolean;
  /** The warnings of the run, for example a count of rounds that is not balanced. */
  readonly warnings: readonly string[];
  /** The record of each child, in the order of the starts. */
  readonly processes: readonly ArmProcess[];
  /** The A/A record of each round, with the job and the computer. `aaOrders`, `aaStats` and `poolRecords` read them. Only a run with `aa` has records. */
  readonly aa: readonly FreshRecord[];
  /** The hashes of the fixture files. Only a run with fixtures has them. */
  readonly fixtures?: readonly FixtureHash[];
}

/** This function examines the options of a run of arms and gives the command of each arm. A bad option is a `RangeError`. */
function armsCommands(options: FreshArmsOptions): Map<string, readonly string[]> {
  const { arms } = options;
  if (arms.length === 0) throw new RangeError("freshArms: the run has 1 or more arms.");
  const commands = new Map<string, readonly string[]>();
  for (const arm of arms) {
    if (typeof arm.id !== "string" || arm.id === "") throw new RangeError("freshArms: the id of an arm is a string that is not empty.");
    if (commands.has(arm.id)) throw new RangeError(`freshArms: two arms have the id ${JSON.stringify(arm.id)}.`);
    if (typeof arm.case !== "string" || arm.case === "") throw new RangeError(`freshArms: the case of the arm ${JSON.stringify(arm.id)} is a string that is not empty.`);
    if (arm.cwd !== undefined && (typeof arm.cwd !== "string" || arm.cwd === "")) throw new RangeError(`freshArms: the cwd of the arm ${JSON.stringify(arm.id)} is a string that is not empty.`);
    const command = arm.command ?? options.command;
    if (command === undefined || command.length === 0 || command.some((s) => typeof s !== "string")) {
      throw new RangeError(`freshArms: the command of the arm ${JSON.stringify(arm.id)} is 1 or more strings. Give the command of the arm or of the run.`);
    }
    commands.set(arm.id, command);
  }
  if (options.aa !== undefined) {
    const [a, b] = options.aa;
    const left = arms.find((arm) => arm.id === a);
    const right = arms.find((arm) => arm.id === b);
    if (left === undefined || right === undefined || a === b) throw new RangeError(`freshArms: the A/A pair is 2 different ids of arms, not ${JSON.stringify(options.aa)}.`);
    const same = left.case === right.case && left.cwd === right.cwd && commands.get(a)!.join("\u0000") === commands.get(b)!.join("\u0000");
    if (!same) throw new RangeError(`freshArms: the A/A arms ${JSON.stringify(a)} and ${JSON.stringify(b)} have the same case, command and folder.`);
  }
  return commands;
}

/**
 * This function starts one fresh child for each arm in each round, and gives the record of each child.
 * - The arms of a round come in the order of `armOrder`. The default count of rounds is balanced, and another count gives a warning.
 * - With `aa`, each round gives an A/A record. Arm `a` is the first id of `aa`, and `first` is the arm that started first.
 * - With `fixtures`, a file that is not the pinned file stops the run before the first child.
 * - A child that exits with an error, takes too long, prints no JSON line or skips its case is an error. A run of arms has no skips.
 * - Two different hashes from children with the same argv and folder are an error.
 */
export async function freshArms(options: FreshArmsOptions): Promise<FreshArms> {
  const commands = armsCommands(options);
  const { arms } = options;
  const period = balancedRounds(arms.length);
  const rounds = options.rounds ?? period;
  const roundOffset = options.roundOffset ?? 0;
  const job = options.job ?? "0";
  const timeoutMs = options.timeoutMs ?? 600_000;
  const maxBuffer = options.maxBuffer ?? 1 << 24;
  const args = options.args ?? ((id: string) => ["--case", id]);
  const start = options.start ?? startProcess;
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError(`freshArms: the rounds are a whole number of 1 or more, not ${rounds}.`);
  if (!Number.isSafeInteger(roundOffset) || roundOffset < 0) throw new RangeError(`freshArms: the round offset is a whole number of 0 or more, not ${roundOffset}.`);
  if (!(timeoutMs > 0) || !(maxBuffer > 0)) throw new RangeError("freshArms: the time limit and the output limit are above 0.");
  const balanced = rounds % period === 0;
  const warnings = balanced
    ? []
    : [`${rounds} rounds is not a multiple of ${period} (2 times the ${arms.length} arms), so the order of the arms is not balanced. The A/A pair can show a bias of order.`];
  const fixtures = options.fixtures === undefined ? undefined : checkFixtures(options.fixtures.folder, options.fixtures.files, options.fixtures.read === undefined ? {} : { read: options.fixtures.read });

  const env = options.env ?? benchEnv();
  const processes: ArmProcess[] = [];
  const hashes = new Map<string, string>();
  const aa: FreshRecord[] = [];
  for (let r = 0; r < rounds; r++) {
    const round = roundOffset + r;
    const inRound = new Map<string, ArmProcess>();
    const order = armOrder(arms, round);
    for (let position = 0; position < order.length; position++) {
      const arm = order[position]!;
      const argv = [...commands.get(arm.id)!, ...args(arm.case)];
      const where = `the arm ${JSON.stringify(arm.id)} on the case ${JSON.stringify(arm.case)}, round ${round}`;
      const line = await child(start, argv, { timeoutMs, maxBuffer, ...(arm.cwd === undefined ? {} : { cwd: arm.cwd }) }, where, "error", "freshArms");
      if (line.skipped !== undefined) throw new Error(`freshArms: ${where} skipped the case (${JSON.stringify(line.skipped)}). A run of arms has no skips: remove the arm, or fix its child.`);
      if (line.hash !== undefined) {
        const key = `${arm.cwd ?? ""}\u0000${argv.join("\u0000")}`;
        const known = hashes.get(key);
        if (known !== undefined && known !== line.hash) throw new Error(`freshArms: ${where} gave the hash ${line.hash}, and an earlier child with the same argv gave ${known}.`);
        hashes.set(key, line.hash);
      }
      const { ms, hash: _hash, skipped: _skipped, ...more } = line;
      const record: ArmProcess = { arm: arm.id, case: arm.case, round, position, ms, ...(Object.keys(more).length > 0 ? { fields: more } : {}) };
      processes.push(record);
      inRound.set(arm.id, record);
      options.onProcess?.(record);
    }
    if (options.aa !== undefined) {
      const a = inRound.get(options.aa[0])!;
      const b = inRound.get(options.aa[1])!;
      const fields = a.fields !== undefined || b.fields !== undefined ? { fields: { a: a.fields ?? {}, b: b.fields ?? {} } } : {};
      aa.push({ case: a.case, round, first: a.position < b.position ? "a" : "b", a: a.ms, b: b.ms, job, env, ...fields });
    }
  }
  return { env, job, rounds, balanced, warnings, processes, aa, ...(fixtures === undefined ? {} : { fixtures }) };
}

/** This function gives the field `commits` of the records of a pair, or nothing when no arm of the pair names a commit. */
function commitsOf(pair: { a: FreshArm; b: FreshArm }): { commits?: { a?: string; b?: string } } {
  if (pair.a.commit === undefined && pair.b.commit === undefined) return {};
  return { commits: { ...(pair.a.commit === undefined ? {} : { a: pair.a.commit }), ...(pair.b.commit === undefined ? {} : { b: pair.b.commit }) } };
}

/** This function starts one child and reads its JSON line. A fault gives an error that names the arm, the case, the round and the tail of `stderr`. */
async function child(start: StartChild, argv: readonly string[], limits: StartOptions, where: string, overLimit: "error" | "skip", runner: string): Promise<ChildLine> {
  let exit: ChildExit;
  try {
    exit = await start(argv, limits);
  } catch (error) {
    throw new Error(`${runner}: ${where} did not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const fail = (why: string): Error => {
    return new Error(`${runner}: ${where} ${why}. The tail of stderr: ${stderrTail(exit.stderr)}`);
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
