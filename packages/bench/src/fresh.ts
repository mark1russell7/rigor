/**
 * The fresh-process runner of a bench, for Node only. Each arm of each pair, case and round is one fresh child process.
 * The child prints one JSON line with its time. The runner keeps the order of `pairOrder`, and gives `PairedTime` records.
 */
import { readFileSync, rmSync } from "node:fs";
import { arch, cpus, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { PerformanceObserver } from "node:perf_hooks";
import { GCProfiler, getHeapStatistics, setFlagsFromString } from "node:v8";
import type { ArmProcess } from "./arm-times.ts";
import type { SidecarEnd } from "./container.ts";
import { type FixtureFile, type FixtureHash, checkFixtures } from "./fixtures.ts";
import { type BenchMachine, cpuInfoMachine } from "./machine.ts";
import { type Arm, type PairedTime, armOrder, balancedRounds, firstArm } from "./paired.ts";
import { startProcess, stderrTail } from "./start.ts";

export { type ArmProcess, type ArmTimes, armTimes } from "./arm-times.ts";
export { type Ballast, type BallastOptions, startBallast } from "./ballast.ts";
export { type CheckoutArm, type CheckoutArmOptions, type RepoCommitOptions, checkoutArm, repoCommit } from "./checkout.ts";
export {
  type ContainerOptions,
  type DiskLimit,
  type DiskReads,
  type Sidecar,
  type SidecarEnd,
  MIN_CONTAINER_MEMORY,
  PAGE_CACHE_DROP,
  containerArgv,
  containerStart,
  diskOf,
  dropPageCache,
} from "./container.ts";
export { type FixtureFile, type FixtureHash, type FixtureOptions, checkFixtures, fixtureDifferences } from "./fixtures.ts";
export { type CgroupSample, type IoOptions, type IoSample, type IoWatch, processIo, watchIo } from "./process-io.ts";
export { type BenchMachine, cpuInfoMachine } from "./machine.ts";
export { startProcess } from "./start.ts";

/** The computer of a run. The `cpu` is the model of the first CPU. */
export interface BenchEnv {
  readonly cpu: string;
  readonly cores: number;
  readonly os: string;
  readonly arch: string;
  readonly node: string;
  /** The name of the runner, from `BENCH_RUNNER` or else `RUNNER_NAME`. An empty value is absent. */
  readonly runner?: string;
  /** The kind of the machine inside its CPU model, from `/proc/cpuinfo`. It is absent on a system with no such file. */
  readonly machine?: BenchMachine;
}

/** This function gives the kind of the machine on Linux, or `undefined`. A read that fails gives `undefined`. */
function readMachine(): BenchMachine | undefined {
  if (platform() !== "linux") return undefined;
  try {
    return cpuInfoMachine(readFileSync("/proc/cpuinfo", "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * This function gives the computer of this process. The runner comes from `BENCH_RUNNER`, or else from `RUNNER_NAME`.
 * On Linux, the field `machine` comes from `/proc/cpuinfo`.
 */
export function benchEnv(): BenchEnv {
  const all = cpus();
  const base: BenchEnv = { cpu: all[0]?.model.trim() || "unknown", cores: all.length, os: platform(), arch: arch(), node: process.version };
  const runner = process.env["BENCH_RUNNER"] || process.env["RUNNER_NAME"];
  const machine = readMachine();
  return { ...base, ...(runner === undefined || runner === "" ? {} : { runner }), ...(machine === undefined ? {} : { machine }) };
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
  /**
   * The longest GC event of each half: the duration of one event, in milliseconds. A half with no GC event has 0.
   * A line of an older probe has no `gcMaxMs`.
   */
  readonly gcMaxMs?: HalfTimes;
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
  /**
   * The other fields of the child line, with their JSON values, for example the samples of a child.
   * The runner keeps them in the record, and it does not examine them. Only a line with another field has `extra`.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** The fields of a child line that `childLine` reads. Each other field of a time line goes into `extra`. */
const KNOWN_FIELDS: ReadonlySet<string> = new Set(["ms", "hash", "skipped", "peakRss", "warm", "events"]);

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
 *
 * A time line keeps each other field in `extra`. A skip line keeps only its reason, its time and its hash.
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
    const { gc, gcMs, gcMaxMs, deopt } = (typeof events === "object" && events !== null && !Array.isArray(events) ? events : {}) as Record<string, unknown>;
    if (!counts(gc) || (deopt !== undefined && !counts(deopt))) {
      throw new Error(`childLine: the events have gc, and an optional deopt, each two whole numbers of 0 or more, not ${JSON.stringify(events)}.`);
    }
    if (gcMs !== undefined && !times(gcMs)) throw new Error(`childLine: the GC time gcMs of the events is two finite numbers of 0 or more, not ${JSON.stringify(gcMs)}.`);
    if (gcMaxMs !== undefined && !times(gcMaxMs)) {
      throw new Error(`childLine: the longest GC event gcMaxMs of the events is two finite numbers of 0 or more, not ${JSON.stringify(gcMaxMs)}.`);
    }
    read = {
      gc: [gc[0], gc[1]],
      ...(gcMs === undefined ? {} : { gcMs: [gcMs[0], gcMs[1]] as const }),
      ...(gcMaxMs === undefined ? {} : { gcMaxMs: [gcMaxMs[0], gcMaxMs[1]] as const }),
      ...(deopt === undefined ? {} : { deopt: [deopt[0], deopt[1]] as const }),
    };
  }
  // Object.fromEntries makes own fields, so a key such as "__proto__" stays a plain field.
  const others = Object.entries(value).filter(([key]) => !KNOWN_FIELDS.has(key));
  return {
    ...(peakRss === undefined ? {} : { peakRss }),
    ...(warm === undefined ? {} : { warm }),
    ...(read === undefined ? {} : { events: read }),
    ...(others.length === 0 ? {} : { extra: Object.fromEntries(others) }),
  };
}

/** This function gives the memory peak of this process in bytes. Print it in the child line as `peakRss`. */
export function peakRss(): number {
  // The field maxRSS of Node is in kibibytes.
  return process.resourceUsage().maxRSS * 1024;
}

/**
 * The memory of a process at one time, in bytes. On Linux, the fields of the resident set come from `/proc/self/status`.
 * A field that the system does not give is `null`.
 */
export interface ProcessMemory {
  /** The resident set: `VmRSS` on Linux, and `process.memoryUsage().rss` on a different system. */
  readonly rss: number;
  /** The peak of the resident set from the start of the process: `VmHWM` on Linux, and `peakRss()` on a different system. */
  readonly peakRss: number;
  /** The anonymous part of the resident set: `RssAnon`. It holds the heaps and the other private memory, and no file. */
  readonly anon: number | null;
  /** The part of the resident set that maps files: `RssFile`. The system can drop these pages when it needs memory. */
  readonly file: number | null;
  /** The used heap of V8. */
  readonly heapUsed: number;
  /** The memory outside the heap that V8 knows: the objects of C++ and the buffers. */
  readonly external: number;
}

/** The fields of the resident set in `/proc/<pid>/status`. */
export type StatusMemory = Pick<ProcessMemory, "rss" | "peakRss" | "anon" | "file">;

/** The names of the fields in `/proc/<pid>/status`, by the name of the field of `StatusMemory`. */
const STATUS_FIELDS = { rss: "VmRSS", peakRss: "VmHWM", anon: "RssAnon", file: "RssFile" } as const;

/**
 * This function reads the fields of the resident set from the text of `/proc/<pid>/status`, in bytes. The file gives
 * each field in kibibytes. The function gives `null` when the text has no `VmRSS` or no `VmHWM`. A text with no
 * `RssAnon` or no `RssFile`, from a kernel before 4.5, gives `null` for that field.
 */
export function statusMemory(text: string): StatusMemory | null {
  const read = (name: string): number | null => {
    const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB\\s*$`, "m").exec(text);
    return match === null ? null : Number(match[1]) * 1024;
  };
  const rss = read(STATUS_FIELDS.rss);
  const peak = read(STATUS_FIELDS.peakRss);
  if (rss === null || peak === null) return null;
  return { rss, peakRss: peak, anon: read(STATUS_FIELDS.anon), file: read(STATUS_FIELDS.file) };
}

/** The options of `processMemory` and `watchMemory`. */
export interface MemoryOptions {
  /** This function gives the text of `/proc/self/status`. The default reads the file. A system with no such file throws. */
  readonly status?: () => string;
}

/** This function gives the text of `/proc/self/status` of this process. */
const readStatus = (): string => readFileSync("/proc/self/status", "utf8");

/**
 * This function gives the memory of this process at the time of the call. On a system with no `/proc/self/status`, the resident set comes
 * from Node, and the fields `anon` and `file` are `null`. Print it in the child line as `memory`. The runner keeps it in `extra`.
 */
export function processMemory(options: MemoryOptions = {}): ProcessMemory {
  let status: StatusMemory | null = null;
  try {
    status = statusMemory((options.status ?? readStatus)());
  } catch {
    status = null;
  }
  const usage = process.memoryUsage();
  const resident = status ?? { rss: usage.rss, peakRss: peakRss(), anon: null, file: null };
  return { ...resident, heapUsed: usage.heapUsed, external: usage.external };
}

/**
 * The Node flags of a child that reads its heap with `heapAfterGc()`. `--expose-gc` gives the function `gc`.
 * `--single-threaded` stops the background threads of V8. With them, a compile task or a GC task ends before the read
 * in some children and after it in others. Then the heap of two equal children can differ by some KiB, and a memory gate
 * has no read. `freshArms` warns on an arm with `--expose-gc` and without `--single-threaded`.
 */
export const HEAP_READ_FLAGS: readonly ["--expose-gc", "--single-threaded"] = ["--expose-gc", "--single-threaded"];

/**
 * This function starts a full garbage collection, and it gives the used heap of V8 after it, in bytes. Thus the value
 * is the live heap, with no garbage. The child needs the Node flag `--expose-gc`. With no such flag, the function throws.
 * For a value that repeats from child to child, start the child with each flag of `HEAP_READ_FLAGS`.
 */
export function heapAfterGc(): number {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== "function") throw new Error("heapAfterGc: the child needs the Node flag --expose-gc.");
  gc();
  return process.memoryUsage().heapUsed;
}

/** This function gives the larger value of each field of two readings. A field that is `null` in one reading stays `null`. */
export function memoryPeak(a: ProcessMemory, b: ProcessMemory): ProcessMemory {
  const larger = (x: number | null, y: number | null): number | null => (x === null || y === null ? null : Math.max(x, y));
  return {
    rss: Math.max(a.rss, b.rss),
    peakRss: Math.max(a.peakRss, b.peakRss),
    anon: larger(a.anon, b.anon),
    file: larger(a.file, b.file),
    heapUsed: Math.max(a.heapUsed, b.heapUsed),
    external: Math.max(a.external, b.external),
  };
}

/** The options of `watchMemory`. */
export interface WatchOptions extends MemoryOptions {
  /** The time between two readings, in milliseconds, above 0. The default is 100. */
  readonly every?: number;
}

/** A watch of the memory of this process. `watchMemory` gives it. */
export interface MemoryWatch {
  /** This function reads the memory at the time of the call, and it gives the peak of each field over each reading of the watch. */
  readonly peak: () => ProcessMemory;
  /** This function stops the readings. The peak stays. */
  readonly stop: () => void;
}

/**
 * This function reads the memory of this process at once and then each `every` milliseconds, and it keeps the peak of
 * each field. A reading needs a free event loop. Thus work that blocks the loop for a long time can hide a short peak.
 * The timer does not keep the process alive.
 */
export function watchMemory(options: WatchOptions = {}): MemoryWatch {
  const every = options.every ?? 100;
  if (!(Number.isFinite(every) && every > 0)) throw new RangeError(`watchMemory: the time between two readings is a finite number above 0, not ${every}.`);
  let peak = processMemory(options);
  const read = (): ProcessMemory => {
    peak = memoryPeak(peak, processMemory(options));
    return peak;
  };
  const timer = setInterval(read, every);
  timer.unref();
  return { peak: read, stop: () => clearInterval(timer) };
}

/** The peaks of the heap of V8 over a heap watch, in bytes, and the counts of its GC events. `watchHeap` gives them. */
export interface HeapPeaks {
  /** The peak of the used heap with its garbage: the largest used heap before a GC event or at the stop. */
  readonly used: number;
  /** The peak of the live heap: the largest used heap after a full GC. The value is `null` when no full GC ran in the watch. */
  readonly live: number | null;
  /** The count of the GC events of the watch. */
  readonly gc: number;
  /** The count of the full GC events of the watch: the mark-compact events of the whole heap. */
  readonly fullGc: number;
  /** The GC time of the watch in milliseconds: the sum of the costs of its GC events. */
  readonly gcMs: number;
  /** The heap size limit of V8 at the stop. */
  readonly limit: number;
}

/** The heap statistics of one side of a GC event in a profile of `v8.GCProfiler`. */
export interface GcSide {
  readonly heapStatistics: { readonly usedHeapSize: number };
}

/** The part of a profile of `v8.GCProfiler` that `watchHeap` reads. It has the type and the cost of each GC event, and the used heap before and after it. The cost is in microseconds. */
export interface GcProfile {
  readonly statistics: readonly { readonly gcType: string; readonly cost: number; readonly beforeGC: GcSide; readonly afterGC: GcSide }[];
}

/** The options of `watchHeap`. A test gives its own profile and heap. */
export interface HeapWatchOptions {
  /** This function starts a profile of the GC events, and it gives the function that stops the profile. The default uses `v8.GCProfiler`. */
  readonly profile?: () => () => GcProfile | undefined;
  /** This function gives the used heap and the heap size limit at the time of the call. The default reads `v8.getHeapStatistics()`. */
  readonly heap?: () => { readonly used: number; readonly limit: number };
}

/** A watch of the heap of V8. `watchHeap` gives it. */
export interface HeapWatch {
  /** This function stops the watch, and it gives the peaks over the GC events of the watch. A second call is an error. */
  readonly stop: () => HeapPeaks;
}

/** The type of a full GC in a profile of `v8.GCProfiler`. */
const FULL_GC = "MarkSweepCompact";

/** This function starts a profile of `v8.GCProfiler`, and it gives the function that stops it. */
const gcProfile = (): (() => GcProfile | undefined) => {
  const profiler = new GCProfiler();
  profiler.start();
  return () => profiler.stop() as GcProfile | undefined;
};

/** This function gives the used heap and the heap size limit of V8 at the time of the call. */
const heapNow = (): { used: number; limit: number } => {
  const statistics = getHeapStatistics();
  return { used: statistics.used_heap_size, limit: statistics.heap_size_limit };
};

/**
 * This function starts a watch of the heap of V8 with `v8.GCProfiler`. V8 records each GC event, also when work blocks the event loop.
 * Thus the watch sees the peaks that a reading at an interval can miss.
 *
 * - Between two GC events the used heap only grows. Thus its peak is the used heap before a GC event, or at the stop.
 * - The live heap is the used heap after a full GC. To include the live heap at the end, call `heapAfterGc()` before the stop.
 */
export function watchHeap(options: HeapWatchOptions = {}): HeapWatch {
  const stopProfile = (options.profile ?? gcProfile)();
  let stopped = false;
  return {
    stop: () => {
      if (stopped) throw new Error("watchHeap: the watch stopped before.");
      stopped = true;
      const events = stopProfile()?.statistics ?? [];
      const now = (options.heap ?? heapNow)();
      let used = now.used;
      let live: number | null = null;
      let fullGc = 0;
      let cost = 0;
      for (const event of events) {
        cost += event.cost;
        used = Math.max(used, event.beforeGC.heapStatistics.usedHeapSize);
        if (event.gcType !== FULL_GC) continue;
        fullGc += 1;
        live = Math.max(live ?? 0, event.afterGC.heapStatistics.usedHeapSize);
      }
      return { used, live, gc: events.length, fullGc, gcMs: cost / 1000, limit: now.limit };
    },
  };
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
  /** This function gives the counts, the GC time and the longest GC event of each half of the counted samples, and stops the probe. */
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
      const span = (from: number, to: number): { count: number; ms: number; maxMs: number; deopt: number } => {
        const a = marks.get(from);
        const b = marks.get(to);
        if (a === undefined || b === undefined) throw new Error(`eventProbe: the probe has no mark at the sample ${a === undefined ? from : to}.`);
        const inside = gc.filter((event) => event.start >= a.after && event.start < b.before);
        const ms = inside.reduce((sum, event) => sum + event.ms, 0);
        const maxMs = inside.reduce((longest, event) => Math.max(longest, event.ms), 0);
        return { count: inside.length, ms, maxMs, deopt: b.deopt - a.deopt };
      };
      const early = span(0, half);
      const late = span(samples - half, samples);
      return {
        gc: [early.count, late.count],
        gcMs: [early.ms, late.ms],
        gcMaxMs: [early.maxMs, late.maxMs],
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
  /** The value is `true` when the memory limit of the container of the child stopped the child. `containerStart` gives it. */
  readonly oomKilled?: boolean;
  /** The output of each sidecar of the child, in the order of the sidecars. `containerStart` gives it for a child with sidecars. */
  readonly sidecars?: readonly SidecarEnd[];
}

/** The start of one child: it gives the end of the child. The default starts a process with `spawn`, without a shell. */
export type StartChild = (argv: readonly string[], options: StartOptions) => Promise<ChildExit>;

/** The child that the step `before` of a run prepares: the arm whose command starts, the case and the round. */
export interface ChildTurn {
  /** The id of the arm whose command starts. For a child of an A/A copy in `freshRun`, it is the id of the arm of the copy, not the id of the pair. */
  readonly arm: string;
  /** The id of the case. */
  readonly case: string;
  /** The global round, with `roundOffset` in it. A warm-up child has the round 0. */
  readonly round: number;
  /** The value is `true` for a warm-up child. */
  readonly warmUp: boolean;
}

/**
 * The step before each child of a run, warm-up children included. The run waits for the step, and then it starts the child.
 * The time limit of the child starts after the step, and no time of the child includes the step.
 * A step that throws is an error of its child, as a start that throws is.
 */
export type BeforeChild = (turn: ChildTurn) => Promise<void>;

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
  /**
   * The order of the children of a case in a round. The default `"pairs"` starts the pairs in the order of `pairOrder`.
   * Then each pair has a child of the base of its own.
   *
   * With `"arms"`, each arm starts one child in the order of `armOrder`, after a turn by the index of the case.
   * The arms are the base, each candidate and each A/A copy. Each pair gets the time of the one base child of the round.
   * Thus a round of k pairs has k + 1 children, not 2 k, as in `timeArmRounds`.
   * A multiple of `balancedRounds(k + 1)` rounds balances the order.
   */
  readonly order?: "pairs" | "arms";
  /**
   * The index of the case that starts the first round. Without it, each round starts with the first case.
   * With it, the order of the cases turns in each round. Thus a cost of the first place of a round does not stay on one case.
   *
   * Global round `r` starts with the case `(firstCase + r * max(1, floor(cases / rounds))) % cases`, and the other cases follow in their order.
   * The turn of the arms and the order of the pairs keep the index of each case in `cases`.
   * A retry of a job can give another value, so that the retry has another order.
   */
  readonly firstCase?: number;
  /** The arguments of a case after the command of an arm. The default is `["--case", id]`. */
  readonly args?: (caseId: string) => readonly string[];
  /** The longest time of one child in milliseconds. The default is 600000 (10 minutes). */
  readonly timeoutMs?: number;
  /**
   * The result of a child that takes more time than `timeoutMs`. The default `"error"` stops the run with an error.
   * With `"skip"`, a child over the limit in the first round of the job skips its case, with the reason
   * `took more than <timeoutMs> ms`. Thus a case that does not end is a result with a reason, and the job ends in time.
   * A child over the limit in a later round is an error, as each skip after the first round is.
   *
   * Two more limits follow the same rule. Each skip has the kind of its limit.
   * - A child that the memory limit of its container stopped (`oomKilled`) has the reason `passed the memory limit of its container`.
   * - A child that V8 stopped at the heap limit has the reason `reached the heap limit of V8`, and the tail of its `stderr`.
   */
  readonly overLimit?: "error" | "skip";
  /**
   * The part of the run that a skip removes. The default `"case"` removes the case from each pair, and the runner starts no more children for it.
   *
   * With `"child"`, a skip removes only its child. This scope needs the order `"arms"`, where each child of a round is one arm.
   * - The other arms of the case still start, and each later round starts each arm again.
   * - A pair gets a record only when its two children give a time. A skip in a later round is a result, not an error.
   * - Use it when a child can pass a limit on a case, and the other arms are the measure. An example is a start near a memory limit.
   * - `poolRecords` still removes each case with a skip from the pool of the jobs. Thus a time verdict reads only the cases that each child timed.
   */
  readonly skipScope?: "case" | "child";
  /** The most bytes of the output of one child. The default is 16 MiB. */
  readonly maxBuffer?: number;
  /** The label of the job. The default is `"0"`. */
  readonly job?: string;
  /** The computer of the run. The default is `benchEnv()`. */
  readonly env?: BenchEnv;
  /** The start of a child. The default is `startProcess`. A test gives its own, and a caller can wrap `startProcess` to write the `stderr` of each child. */
  readonly start?: StartChild;
  /**
   * The step before each child, warm-up children included, for example a fresh copy of the state of the child and `dropPageCache`.
   * The run waits for the step. Then the child and its time limit start. A step that throws is an error of its child.
   * The arm of the turn is the id of the arm whose command starts. For an A/A copy, it is the base, or the candidate of the copy.
   */
  readonly before?: BeforeChild;
  /**
   * The count of warm-up children of each arm before the first round. The default is 0.
   * A warm-up child fills the file cache and the compile cache, so the first timed child does not start cold.
   * Each warm-up child starts on the first case of the job, through `start`, with the limits of a timed child.
   *
   * In each pass, the base starts first, then each candidate in its order. An A/A copy has the child of its arm, so it gets no warm-up child.
   * The run keeps no record of a warm-up child, and a skip line of a warm-up child removes no case.
   * A fault of a warm-up child is an error. Its hash and each later hash of its arm on the case must agree.
   */
  readonly warmUp?: number;
}

/** One warm-up child of a run. The pairs and the processes of the run do not include it. */
export interface WarmUpChild {
  /** The id of the arm. */
  readonly arm: string;
  /** The case of the child. */
  readonly case: string;
  /** The time of the child line in milliseconds. A child with a skip line has no time. */
  readonly ms?: number;
  /** The reason of the skip line of the child. */
  readonly skipped?: string;
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

/**
 * The kind of a skip: the cause that the child gave no time.
 *
 * - `line`: the child printed a skip line.
 * - `time`: the child took more time than `timeoutMs`.
 * - `memory`: the memory limit of the container of the child stopped the child (`oomKilled`).
 * - `heap`: V8 stopped the child at the heap limit, with the error `JavaScript heap out of memory`.
 */
export type SkipKind = "line" | "time" | "memory" | "heap";

/**
 * A case that an arm skipped. With the scope `"case"`, the case is in no pair. With the scope `"child"`, only the pairs of the child lose the round.
 * In the order `"arms"`, the arm of the A/A copy is the id of its pair, as in `orders`.
 */
export interface FreshSkip {
  readonly arm: string;
  readonly case: string;
  /** The global round of the skip. With the scope `"case"`, a skip is in the first round of its job. */
  readonly round: number;
  readonly reason: string;
  readonly kind: SkipKind;
}

/** The order of the children of one case in one round of a fresh run with the order `"arms"`. */
export interface CaseOrder {
  readonly case: string;
  /** The global round. */
  readonly round: number;
  /** The ids of the arms in the order of their children. The id of an A/A copy is the id of its pair. */
  readonly arms: readonly string[];
}

/**
 * A timed child is the time and the fields of one child of a run with the order `"arms"`. A pair gets a record only
 * when its two children give a time. Thus with `skipScope: "child"`, the child of an arm can have no record of a pair.
 */
export interface TimedChild {
  /** The id of the arm. The id of an A/A copy is the id of its pair, as in `orders`. */
  readonly arm: string;
  readonly case: string;
  /** The global round. */
  readonly round: number;
  /** The place of the child in the order of its case and round, from 0. */
  readonly position: number;
  /** The time of the child line in milliseconds. */
  readonly ms: number;
  /** The fields of the child line in addition to its time. Only a child that gives a field has them. */
  readonly fields?: ChildFields;
}

/** The result of a fresh run. */
export interface FreshRun {
  readonly env: BenchEnv;
  readonly job: string;
  /** The records of each pair, by the id of the pair. */
  readonly pairs: Record<string, FreshRecord[]>;
  readonly skipped: FreshSkip[];
  /** The order of the children of each case in each round. Only a run with the order `"arms"` has it. A skipped case has no order. */
  readonly orders?: readonly CaseOrder[];
  /** Each child that gave a time, in the order of the starts. Only a run with the order `"arms"` has it. A skipped case has no child. */
  readonly children?: readonly TimedChild[];
  /** The warm-up children, in the order of their starts. Only a run with `warmUp` above 0 has them. */
  readonly warmUp?: readonly WarmUpChild[];
}

/** The suffix of the id of the A/A pair. */
const AA_SUFFIX = "~aa";

/**
 * This function starts each arm of each pair, case and round in a fresh child, and gives the records of each pair.
 * - Each candidate is a pair (base, candidate). The A/A pair is (base, base).
 * - With the default order `"pairs"`, the pairs of a round and case come in the order of `pairOrder`.
 *   Each pair has its own base child, and the first arm of a pair starts first.
 * - With the order `"arms"`, each arm starts one child in the order of `armOrder`. The pairs share the base child.
 *   The result keeps the order of each round and case in `orders`, and each child with a time in `children`.
 * - With `firstCase`, the order of the cases turns in each round. The turn of the arms and the order of the pairs do not change.
 * - With `warmUp`, each arm starts that count of warm-up children on the first case of the job before the first round.
 *   The result lists them in `warmUp`, outside the pairs.
 * - A child that exits with an error, takes too long or prints no JSON line is an error. A skip line skips a case.
 *   With `overLimit: "skip"`, a child that takes too long in the first round skips its case too.
 * - A case that an arm skips in the first round of the job leaves each pair, and the runner starts no more children for it.
 * - A skip after the first round is an error. It shows a child that is not deterministic, and it drops paid data.
 * - With `skipScope: "child"`, a skip removes only its child, and the two rules above do not apply.
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
  const firstCase = options.firstCase;
  const warmUp = warmUpCount(options.warmUp, "freshRun");
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError(`freshRun: the rounds are a whole number of 1 or more, not ${rounds}.`);
  if (firstCase !== undefined && (!Number.isSafeInteger(firstCase) || firstCase < 0)) throw new RangeError(`freshRun: the first case is a whole number of 0 or more, not ${firstCase}.`);
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
  const order = options.order ?? "pairs";
  if (order !== "pairs" && order !== "arms") throw new RangeError(`freshRun: order is "pairs" or "arms", not ${JSON.stringify(order)}.`);
  const skipScope = options.skipScope ?? "case";
  if (skipScope !== "case" && skipScope !== "child") throw new RangeError(`freshRun: skipScope is "case" or "child", not ${JSON.stringify(skipScope)}.`);
  // In the order "pairs", the base starts once in each pair. Thus one arm has many children in a round, and a skip does not name one child.
  if (skipScope === "child" && order !== "arms") throw new RangeError('freshRun: skipScope "child" needs the order "arms".');
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
  const orders: CaseOrder[] = [];
  const children: TimedChild[] = [];
  // The arms of the order "arms": the base, then arm `b` of each pair with the id of the pair.
  const slots: { id: string; arm: FreshArm }[] = [{ id: base.id, arm: base }, ...pairs.map((p) => ({ id: p.id, arm: p.b }))];

  const before = options.before;
  /**
   * This function starts one child of an arm on a case, after the step `before`, and examines its skip and its hash.
   * With the scope "case", a skip after the first round is an error. A warm-up child gets the round 0 in its turn.
   */
  const timed = async (who: FreshArm, id: string, r: number, where: string, warm = false): Promise<ChildEnd> => {
    const prepare = before === undefined ? undefined : () => before({ arm: who.id, case: id, round: warm ? 0 : roundOffset + r, warmUp: warm });
    const line = await child(start, [...who.command, ...args(id)], { timeoutMs, maxBuffer, ...(who.cwd === undefined ? {} : { cwd: who.cwd }) }, where, overLimit, "freshRun", prepare);
    if (line.skipped !== undefined) {
      if (r > 0 && skipScope === "case") throw new Error(`freshRun: ${where} skipped the case after the first round of the job (${JSON.stringify(line.skipped)}). A child that skips only in a later round is not deterministic.`);
      return line;
    }
    if (line.hash !== undefined) {
      const key = `${who.id}\u0000${id}`;
      const known = hashes.get(key);
      if (known !== undefined && known !== line.hash) throw new Error(`freshRun: ${where} gave the hash ${line.hash}, and an earlier child of the arm gave ${known}.`);
      hashes.set(key, line.hash);
    }
    return line;
  };

  // The step of the turn of the cases spreads the first places of the rounds of one job over the cases.
  const step = Math.max(1, Math.floor(cases.length / rounds));
  const shiftOf = (round: number): number => (firstCase === undefined ? 0 : (firstCase + round * step) % cases.length);
  // The warm-up children start on the first case of the job, before the first round. They give no record.
  const warmed: WarmUpChild[] = [];
  const warmCase = cases[shiftOf(roundOffset)]!;
  for (let w = 1; w <= warmUp; w++) {
    for (const arm of [base, ...candidates]) {
      const line = await timed(arm, warmCase, 0, `the warm-up child ${w} of the arm ${JSON.stringify(arm.id)} on the case ${JSON.stringify(warmCase)}`, true);
      warmed.push({ arm: arm.id, case: warmCase, ...(line.skipped === undefined ? { ms: line.ms } : { skipped: line.skipped }) });
    }
  }
  for (let r = 0; r < rounds; r++) {
    const round = roundOffset + r;
    const shift = shiftOf(round);
    for (let k = 0; k < cases.length; k++) {
      // The index of the case, not its place in the round, gives the turn of the arms and the order of the pairs.
      const i = (shift + k) % cases.length;
      const id = cases[i]!;
      if (gone.has(id)) continue;
      if (order === "arms") {
        const turn = i % slots.length;
        const sequence = armOrder([...slots.slice(turn), ...slots.slice(0, turn)], round);
        const times = new Map<string, { ms: number; fields: ChildFields; position: number }>();
        const skips: FreshSkip[] = [];
        for (const [position, slot] of sequence.entries()) {
          const line = await timed(slot.arm, id, r, `the arm ${JSON.stringify(slot.id)} on the case ${JSON.stringify(id)}, round ${round}`);
          if (line.skipped !== undefined) {
            skips.push({ arm: slot.id, case: id, round, reason: line.skipped, kind: line.kind ?? "line" });
            if (skipScope === "case") break;
            continue;
          }
          const { ms, hash: _hash, skipped: _skipped, ...more } = line;
          times.set(slot.id, { ms, fields: more, position });
        }
        skipped.push(...skips);
        if (skips.length > 0 && skipScope === "case") {
          gone.add(id);
          continue;
        }
        orders.push({ case: id, round, arms: sequence.map((slot) => slot.id) });
        for (const [arm, each] of times) children.push({ arm, case: id, round, position: each.position, ms: each.ms, ...(Object.keys(each.fields).length > 0 ? { fields: each.fields } : {}) });
        for (const pair of pairs) {
          const a = times.get(pair.a.id);
          const b = times.get(pair.id);
          // With the scope "child", a pair with a skipped child has no record of the round.
          if (a === undefined || b === undefined) continue;
          const extra = Object.keys(a.fields).length + Object.keys(b.fields).length > 0 ? { fields: { a: a.fields, b: b.fields } } : {};
          out[pair.id]!.push({ case: id, round, first: a.position < b.position ? "a" : "b", a: a.ms, b: b.ms, job, env, ...extra, ...commitsOf(pair) });
        }
        continue;
      }
      const records: { pair: string; record: FreshRecord }[] = [];
      let skip: FreshSkip | undefined;
      for (const slot of pairOrder(pairs.length, round, i)) {
        const pair = pairs[slot.pair]!;
        const times: Partial<Record<Arm, number>> = {};
        const fields: Record<Arm, ChildFields> = { a: {}, b: {} };
        for (const arm of [slot.first, slot.first === "a" ? "b" : "a"] as const) {
          const who = pair[arm];
          const where = `the arm ${JSON.stringify(who.id)} (pair ${JSON.stringify(pair.id)}, arm ${arm}) on the case ${JSON.stringify(id)}, round ${round}`;
          const line = await timed(who, id, r, where);
          if (line.skipped !== undefined) {
            skip = { arm: who.id, case: id, round, reason: line.skipped, kind: line.kind ?? "line" };
            break;
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
  return { env, job, pairs: out, skipped, ...(order === "arms" ? { orders, children } : {}), ...(warmUp > 0 ? { warmUp: warmed } : {}) };
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
  /**
   * The step before each child, warm-up children included, as in `freshRun`. The run waits for the step, and then it starts the child.
   * The arm of the turn is the id of the arm. A step that throws is an error of its child.
   */
  readonly before?: BeforeChild;
  /** This function gets the record of each child when the child ends. A runner prints its progress with it. */
  readonly onProcess?: (record: ArmProcess) => void;
  /**
   * The count of warm-up children of each different child of the arms before the first round. The default is 0.
   * The two arms of the A/A pair have the same child, so they share their warm-up children.
   * The run keeps no record of a warm-up child, and `onProcess` does not get it. A fault or a skip of a warm-up child is an error.
   */
  readonly warmUp?: number;
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
  /** The warm-up children, in the order of their starts. Only a run with `warmUp` above 0 has them. */
  readonly warmUp?: readonly WarmUpChild[];
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
 * - With `warmUp`, each different child of the arms starts that count of times before the first round. The result lists them in `warmUp`.
 * - A child that exits with an error, takes too long, prints no JSON line or skips its case is an error. A run of arms has no skips.
 * - Two different hashes from children with the same argv and folder are an error.
 * - An arm with the Node flag `--expose-gc` and without `--single-threaded` gives a warning (`HEAP_READ_FLAGS`).
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
  const warmUp = warmUpCount(options.warmUp, "freshArms");
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError(`freshArms: the rounds are a whole number of 1 or more, not ${rounds}.`);
  if (!Number.isSafeInteger(roundOffset) || roundOffset < 0) throw new RangeError(`freshArms: the round offset is a whole number of 0 or more, not ${roundOffset}.`);
  if (!(timeoutMs > 0) || !(maxBuffer > 0)) throw new RangeError("freshArms: the time limit and the output limit are above 0.");
  const balanced = rounds % period === 0;
  const warnings: string[] = balanced
    ? []
    : [`${rounds} rounds is not a multiple of ${period} (2 times the ${arms.length} arms), so the order of the arms is not balanced. The A/A pair can show a bias of order.`];
  const threaded = arms.filter((arm) => {
    const command = commands.get(arm.id)!;
    return command.includes("--expose-gc") && !command.includes("--single-threaded");
  });
  if (threaded.length > 0) {
    const ids = threaded.map((arm) => JSON.stringify(arm.id)).join(", ");
    warnings.push(`The arms ${ids} have --expose-gc and not --single-threaded. The background threads of V8 can change a heap read by some KiB from child to child. Start the children with HEAP_READ_FLAGS.`);
  }
  const fixtures = options.fixtures === undefined ? undefined : checkFixtures(options.fixtures.folder, options.fixtures.files, options.fixtures.read === undefined ? {} : { read: options.fixtures.read });

  const env = options.env ?? benchEnv();
  const processes: ArmProcess[] = [];
  const hashes = new Map<string, string>();
  const aa: FreshRecord[] = [];
  const argvOf = (arm: CaseArm): string[] => [...commands.get(arm.id)!, ...args(arm.case)];
  // Two children with the same argv and folder are the same child. The hashes and the warm-up children use this key.
  const keyOf = (arm: CaseArm): string => `${arm.cwd ?? ""}\u0000${argvOf(arm).join("\u0000")}`;
  const before = options.before;
  /** This function starts one child of an arm, after the step `before`, and examines its skip and its hash. A skip is an error. */
  const timed = async (arm: CaseArm, where: string, round: number, warm: boolean): Promise<ChildTime> => {
    const prepare = before === undefined ? undefined : () => before({ arm: arm.id, case: arm.case, round, warmUp: warm });
    const line = await child(start, argvOf(arm), { timeoutMs, maxBuffer, ...(arm.cwd === undefined ? {} : { cwd: arm.cwd }) }, where, "error", "freshArms", prepare);
    if (line.skipped !== undefined) throw new Error(`freshArms: ${where} skipped the case (${JSON.stringify(line.skipped)}). A run of arms has no skips: remove the arm, or fix its child.`);
    if (line.hash !== undefined) {
      const key = keyOf(arm);
      const known = hashes.get(key);
      if (known !== undefined && known !== line.hash) throw new Error(`freshArms: ${where} gave the hash ${line.hash}, and an earlier child with the same argv gave ${known}.`);
      hashes.set(key, line.hash);
    }
    return line;
  };

  // The warm-up children: each different child starts `warmUp` times before the first round. They give no record.
  const warmed: WarmUpChild[] = [];
  const different: CaseArm[] = [];
  const keys = new Set<string>();
  for (const arm of arms) {
    if (!keys.has(keyOf(arm))) different.push(arm);
    keys.add(keyOf(arm));
  }
  for (let w = 1; w <= warmUp; w++) {
    for (const arm of different) {
      const line = await timed(arm, `the warm-up child ${w} of the arm ${JSON.stringify(arm.id)} on the case ${JSON.stringify(arm.case)}`, 0, true);
      warmed.push({ arm: arm.id, case: arm.case, ms: line.ms });
    }
  }
  for (let r = 0; r < rounds; r++) {
    const round = roundOffset + r;
    const inRound = new Map<string, ArmProcess>();
    const order = armOrder(arms, round);
    for (let position = 0; position < order.length; position++) {
      const arm = order[position]!;
      const line = await timed(arm, `the arm ${JSON.stringify(arm.id)} on the case ${JSON.stringify(arm.case)}, round ${round}`, round, false);
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
  return { env, job, rounds, balanced, warnings, processes, aa, ...(fixtures === undefined ? {} : { fixtures }), ...(warmUp > 0 ? { warmUp: warmed } : {}) };
}

/** This function examines the count of warm-up children of a run. The default is 0. A bad count is a `RangeError`. */
function warmUpCount(value: number | undefined, runner: string): number {
  const count = value ?? 0;
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`${runner}: warmUp is a whole number of 0 or more, not ${count}.`);
  return count;
}

/** This function gives the field `commits` of the records of a pair, or nothing when no arm of the pair names a commit. */
function commitsOf(pair: { a: FreshArm; b: FreshArm }): { commits?: { a?: string; b?: string } } {
  if (pair.a.commit === undefined && pair.b.commit === undefined) return {};
  return { commits: { ...(pair.a.commit === undefined ? {} : { a: pair.a.commit }), ...(pair.b.commit === undefined ? {} : { b: pair.b.commit }) } };
}

/** The reason of a child that the memory limit of its container stopped. */
const MEMORY_LIMIT = "passed the memory limit of its container";

/** The reason of a child that V8 stopped at the heap limit. */
const HEAP_LIMIT = "reached the heap limit of V8";

/** This rule finds the fatal error of V8 at the heap limit in the `stderr` of a child. */
const HEAP_OUT = /JavaScript heap out of memory|Reached heap limit/;

/** The longest tail of `stderr` in the reason of a heap skip. */
const HEAP_TAIL = 300;

/** The end of one child: its line, and the kind of a skip at a limit. A skip line of the child has no kind. */
type ChildEnd = ChildLine & { readonly kind?: SkipKind };

/**
 * This function waits for the step `prepare`, then it starts one child and reads its JSON line. A fault gives an error that
 * names the arm, the case, the round and the tail of `stderr`. A step that throws is an error, as a start that throws is.
 */
async function child(
  start: StartChild,
  argv: readonly string[],
  limits: StartOptions,
  where: string,
  overLimit: "error" | "skip",
  runner: string,
  prepare?: () => Promise<void>,
): Promise<ChildEnd> {
  if (prepare !== undefined) {
    try {
      await prepare();
    } catch (error) {
      throw new Error(`${runner}: ${where} did not start: the step before the child failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
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
    if (overLimit === "skip") return { skipped: `took more than ${limits.timeoutMs} ms`, kind: "time" };
    throw fail(`took more than ${limits.timeoutMs} ms`);
  }
  if (exit.oomKilled === true) {
    if (overLimit === "skip") return { skipped: MEMORY_LIMIT, kind: "memory" };
    throw fail(MEMORY_LIMIT);
  }
  if (exit.code !== 0 && HEAP_OUT.test(exit.stderr)) {
    if (overLimit === "skip") return { skipped: `${HEAP_LIMIT}: ${exit.stderr.slice(-HEAP_TAIL).replaceAll(/\s+/g, " ").trim()}`, kind: "heap" };
    throw fail(HEAP_LIMIT);
  }
  if (exit.code !== 0) throw fail(exit.code === null ? "stopped on a signal" : `exited with the code ${exit.code}`);
  try {
    return childLine(exit.stdout);
  } catch (error) {
    throw fail(`printed no good JSON line (${error instanceof Error ? error.message : String(error)})`);
  }
}
