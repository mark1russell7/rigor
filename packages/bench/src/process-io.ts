/**
 * The disk reads, the disk writes, the major page faults and the memory of a child process, from `/proc/self` and
 * from its cgroup. `processIo` reads them one time, and `watchIo` reads them at an interval in a worker thread.
 */
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";

/**
 * The counters of the cgroup of a process in one sample. On Linux, the files are in `/sys/fs/cgroup`. In a Docker
 * container with cgroup v2, that folder is the cgroup of the container. A file that the read cannot get gives `null`.
 */
export interface CgroupSample {
  /** The memory of the cgroup in bytes: `memory.current`. It includes the page cache of the cgroup. */
  readonly memory: number | null;
  /** The swap of the cgroup in bytes: `memory.swap.current`. */
  readonly swap: number | null;
  /** The bytes that the cgroup read from its disks: the sum of `rbytes` over the lines of `io.stat`. */
  readonly readBytes: number | null;
  /** The bytes that the cgroup wrote to its disks: the sum of `wbytes` over the lines of `io.stat`. */
  readonly writeBytes: number | null;
  /** The read operations of the cgroup on its disks: the sum of `rios` over the lines of `io.stat`. */
  readonly reads: number | null;
  /** The write operations of the cgroup on its disks: the sum of `wios` over the lines of `io.stat`. */
  readonly writes: number | null;
}

/**
 * One sample of the disk and the memory of a process. A file that the read cannot get gives `null`. Thus a sample
 * on Windows or macOS has `null` in each counter. The counters only grow, so the difference of two samples is the work between them.
 */
export interface IoSample {
  /** The time of the sample in milliseconds: `performance.timeOrigin + performance.now()` of the thread that read it. */
  readonly at: number;
  /** The bytes that the process read from the disks: `read_bytes` of `/proc/self/io`. A read that the page cache serves is not in it. */
  readonly readBytes: number | null;
  /** The bytes that the process sent to the disks: `write_bytes` of `/proc/self/io`. */
  readonly writeBytes: number | null;
  /** The major page faults of the process: field 12 of `/proc/self/stat`. Each one waited for a read from a disk. */
  readonly majorFaults: number | null;
  /** The resident set of the process in bytes: field 2 of `/proc/self/statm`, times a page of 4096 bytes. */
  readonly rss: number | null;
  /** The counters of the cgroup of the process. */
  readonly cgroup: CgroupSample;
}

/** The options of `processIo` and `watchIo`. A test gives the folders of its own fake files. */
export interface IoOptions {
  /** The folder of the files of the process. The default is `/proc/self`. */
  readonly proc?: string;
  /** The folder of the files of the cgroup. The default is `/sys/fs/cgroup`. */
  readonly cgroup?: string;
}

/**
 * The JavaScript source of the reader of one sample. `processIo` compiles it in this thread, and the worker of `watchIo`
 * uses the same source. Thus the two reads cannot drift. The source uses only globals, and it gets the read of a file as an argument.
 */
const READER = String.raw`(readFile, proc, cgroup) => {
  const at = performance.timeOrigin + performance.now();
  const text = (folder, name) => {
    try {
      return String(readFile(folder + "/" + name, "utf8"));
    } catch {
      return null;
    }
  };
  const whole = (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : null);
  const field = (body, name) => {
    if (body === null) return null;
    for (const line of body.split("\n")) {
      const colon = line.indexOf(":");
      if (colon > 0 && line.slice(0, colon).trim() === name) return whole(line.slice(colon + 1));
    }
    return null;
  };
  const io = text(proc, "io");
  const stat = text(proc, "stat");
  const statm = text(proc, "statm");
  // The name of the program in /proc/self/stat can hold a space or a ")". Thus the fields start after the last ")", with field 3.
  const after = stat === null ? [] : stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
  const pages = statm === null ? null : whole(statm.trim().split(/\s+/)[1]);
  const ioStat = text(cgroup, "io.stat");
  const sums = { rbytes: 0, wbytes: 0, rios: 0, wios: 0 };
  if (ioStat !== null) {
    for (const line of ioStat.split("\n")) {
      for (const pair of line.trim().split(/\s+/).slice(1)) {
        const equal = pair.indexOf("=");
        const key = pair.slice(0, equal);
        const value = whole(pair.slice(equal + 1));
        if (equal > 0 && Object.hasOwn(sums, key) && value !== null) sums[key] += value;
      }
    }
  }
  const counter = (name) => whole(text(cgroup, name));
  return {
    at,
    readBytes: field(io, "read_bytes"),
    writeBytes: field(io, "write_bytes"),
    majorFaults: whole(after[9]),
    rss: pages === null ? null : pages * 4096,
    cgroup: {
      memory: counter("memory.current"),
      swap: counter("memory.swap.current"),
      readBytes: ioStat === null ? null : sums.rbytes,
      writeBytes: ioStat === null ? null : sums.wbytes,
      reads: ioStat === null ? null : sums.rios,
      writes: ioStat === null ? null : sums.wios,
    },
  };
}`;

/** The reader of one sample, from `READER`. */
type Reader = (readFile: (path: string, encoding: "utf8") => string, proc: string, cgroup: string) => IoSample;

/** The reader of this thread. The first use of `processIo` compiles it. */
let reader: Reader | undefined;

/** The default folder of the files of the process. */
const PROC = "/proc/self";

/** The default folder of the files of the cgroup. */
const CGROUP = "/sys/fs/cgroup";

/**
 * This function reads one sample of the disk and the memory of this process at the time of the call. It is synchronous.
 * A start program reads it when its app is ready, for the totals of the start. A file that the read cannot get gives `null`.
 */
export function processIo(options: IoOptions = {}): IoSample {
  reader ??= new Function(`return ${READER};`)() as Reader;
  return reader(readFileSync, options.proc ?? PROC, options.cgroup ?? CGROUP);
}

/** A watch of the disk and the memory of this process. `watchIo` gives it. */
export interface IoWatch {
  /** This function takes one last sample, stops the worker, and gives each sample in the order of the reads. A second call is an error. */
  readonly stop: () => Promise<readonly IoSample[]>;
}

/** The longest interval of a timer of Node, in milliseconds. A longer interval becomes 1 ms in Node. */
const LONGEST_TIMER = 2 ** 31 - 1;

/**
 * The source of the worker of `watchIo`. It takes a sample at its start, one each interval, and one at the stop.
 * The worker gets the `execArgv` of its process. With `--input-type=module`, the source is an ES module and has no `require`.
 * Thus the source loads its modules with `import()`, which operates in a CommonJS script and in an ES module.
 */
const WORKER = [
  "(async () => {",
  '  const { parentPort, workerData } = await import("node:worker_threads");',
  '  const { readFileSync } = await import("node:fs");',
  `  const read = ${READER};`,
  "  const { proc, cgroup, every } = workerData;",
  "  const sample = () => read(readFileSync, proc, cgroup);",
  "  const samples = [sample()];",
  "  const timer = setInterval(() => samples.push(sample()), every);",
  '  parentPort.once("message", () => {',
  "    clearInterval(timer);",
  "    samples.push(sample());",
  "    parentPort.postMessage(samples);",
  "    parentPort.close();",
  "  });",
  "})();",
].join("\n");

/**
 * This function starts a watch of the disk and the memory of this process. A worker thread takes the samples with the
 * reader of `processIo`. Thus the samples continue while the main thread waits in a page fault or in a synchronous read.
 *
 * - The first sample is at the start of the worker. Then the worker takes one sample each `intervalMs` milliseconds.
 * - The worker does not keep the process alive. `stop` takes one last sample and gives each sample in order.
 * - The worker adds approximately a few MiB to the resident set of the process.
 * - The field `at` of a sample is the time of the worker. Subtract `performance.timeOrigin` of this thread for the time from its start.
 * - An interval that is not a finite number above 0 is a `RangeError`.
 */
export function watchIo(intervalMs: number, options: IoOptions = {}): IoWatch {
  if (!(typeof intervalMs === "number" && Number.isFinite(intervalMs) && intervalMs > 0)) throw new RangeError(`watchIo: the interval is a finite number of milliseconds above 0, not ${intervalMs}.`);
  const worker = new Worker(WORKER, { eval: true, workerData: { proc: options.proc ?? PROC, cgroup: options.cgroup ?? CGROUP, every: Math.min(intervalMs, LONGEST_TIMER) } });
  worker.unref();
  // A listener of the event error keeps a fault of the worker from a stop of the process. The stop gives the fault.
  let fault: unknown;
  worker.on("error", (error) => {
    fault ??= error;
  });
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return Promise.reject(new Error("watchIo: the watch stopped before."));
      stopped = true;
      if (fault !== undefined) return Promise.reject(new Error(`watchIo: the worker failed: ${fault instanceof Error ? fault.message : String(fault)}`, { cause: fault }));
      // The wait for the samples keeps the process alive, so a process with no other work gets the samples.
      worker.ref();
      return new Promise((resolve, reject) => {
        worker.once("message", (samples: readonly IoSample[]) => {
          resolve(samples);
          void worker.terminate();
        });
        worker.once("error", (error: unknown) => reject(new Error(`watchIo: the worker failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })));
        worker.once("exit", (code) => reject(new Error(`watchIo: the worker exited with the code ${code} before it gave its samples.`)));
        worker.postMessage("stop");
      });
    },
  };
}
