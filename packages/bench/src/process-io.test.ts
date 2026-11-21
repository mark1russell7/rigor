import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type IoSample, processIo, watchIo } from "./fresh.ts";

const root = mkdtempSync(join(tmpdir(), "rigor-bench-io-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** This function writes the files of a fake folder, and gives the folder. */
function folder(name: string, files: Record<string, string>): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(path, file), text);
  return path;
}

const IO = "rchar: 9000\nwchar: 800\nsyscr: 12\nsyscw: 3\nread_bytes: 4096\nwrite_bytes: 8192\ncancelled_write_bytes: 0\n";
// The name of the program holds a space and a ")". Field 12, the major faults, is 37.
const STAT = "4242 (node (x) y) S 1 4242 4242 0 -1 4194560 1200 0 37 0 15 3 0 0 20 0 11 0 100 1000000 2500\n";
const PROC = folder("proc", { io: IO, stat: STAT, statm: "300000 2500 900 100 0 5000 0\n" });
const CGROUP = folder("cgroup", {
  "memory.current": "524288000\n",
  "memory.swap.current": "0\n",
  "io.stat": "8:0 rbytes=1000 wbytes=200 rios=10 wios=2 dbytes=0 dios=0\n253:0 rbytes=24 wbytes=56 rios=1 wios=3 dbytes=0 dios=0\n",
});
const FAKE = { proc: PROC, cgroup: CGROUP };

/** The fields of the sample of the fake files, with no time. */
const EXPECTED: Omit<IoSample, "at"> = {
  readBytes: 4096,
  writeBytes: 8192,
  majorFaults: 37,
  rss: 2500 * 4096,
  cgroup: { memory: 524_288_000, swap: 0, readBytes: 1024, writeBytes: 256, reads: 11, writes: 5 },
};

const NULLS: Omit<IoSample, "at"> = {
  readBytes: null,
  writeBytes: null,
  majorFaults: null,
  rss: null,
  cgroup: { memory: null, swap: null, readBytes: null, writeBytes: null, reads: null, writes: null },
};

/** This function gives a sample with no time. */
const fields = ({ at: _at, ...rest }: IoSample): Omit<IoSample, "at"> => rest;

const now = (): number => performance.timeOrigin + performance.now();

describe("processIo", () => {
  it("reads the counters of the process and of its cgroup, and the time of the read", () => {
    const before = now();
    const sample = processIo(FAKE);
    expect(fields(sample)).toEqual(EXPECTED);
    expect(sample.at).toBeGreaterThanOrEqual(before);
    expect(sample.at).toBeLessThanOrEqual(now());
  });

  it("gives null for each file that it cannot read or parse, and 0 for an io.stat with no lines", () => {
    const none = join(root, "none");
    expect(fields(processIo({ proc: none, cgroup: none }))).toEqual(NULLS);
    const odd = folder("odd", { io: "rchar: 1\n", stat: "1 (short) S 1\n", statm: "x\n", "memory.current": "max\n", "io.stat": "" });
    expect(fields(processIo({ proc: odd, cgroup: odd }))).toEqual({ ...NULLS, cgroup: { ...NULLS.cgroup, readBytes: 0, writeBytes: 0, reads: 0, writes: 0 } });
  });

  it("gives numbers from /proc/self on Linux, and null on a system with no /proc", () => {
    const sample = processIo();
    const counters = [sample.readBytes, sample.writeBytes, sample.majorFaults, sample.rss, ...Object.values(sample.cgroup)];
    expect(counters.every((value) => value === null || (Number.isSafeInteger(value) && value >= 0))).toBe(true);
    if (process.platform === "linux") {
      expect(sample.rss).toBeGreaterThan(0);
      expect(sample.majorFaults).toBeGreaterThanOrEqual(0);
    } else {
      expect([sample.readBytes, sample.writeBytes, sample.majorFaults, sample.rss]).toEqual([null, null, null, null]);
    }
  });
});

describe("watchIo", () => {
  it("takes a sample at the start, one each interval and one at the stop, in order, with the reader of processIo", async () => {
    const files = folder("watch", { io: IO, stat: STAT, statm: "300000 2500 900 100 0 5000 0\n" });
    const before = now();
    const watch = watchIo(5, { proc: files, cgroup: CGROUP });
    await new Promise((done) => setTimeout(done, 300));
    // A change of a file shows in the next samples.
    writeFileSync(join(files, "io"), IO.replace("read_bytes: 4096", "read_bytes: 12288"));
    await new Promise((done) => setTimeout(done, 100));
    const samples = await watch.stop();
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(samples[0]!.at).toBeGreaterThanOrEqual(before);
    expect(samples.at(-1)!.at).toBeLessThanOrEqual(now());
    for (let k = 1; k < samples.length; k++) expect(samples[k]!.at).toBeGreaterThanOrEqual(samples[k - 1]!.at);
    expect(fields(samples[0]!)).toEqual(EXPECTED);
    expect(fields(samples.at(-1)!)).toEqual({ ...EXPECTED, readBytes: 12_288 });
    expect(fields(samples.at(-1)!)).toEqual(fields(processIo({ proc: files, cgroup: CGROUP })));
    await expect(watch.stop()).rejects.toThrow("watchIo: the watch stopped before.");
  });

  it("gives null in each sample for files that it cannot read", async () => {
    const none = join(root, "none");
    const samples = await watchIo(10, { proc: none, cgroup: none }).stop();
    expect(samples.length).toBeGreaterThanOrEqual(2);
    for (const sample of samples) expect(fields(sample)).toEqual(NULLS);
  });

  it("takes samples while the main thread is blocked", async () => {
    const watch = watchIo(10, FAKE);
    // The wait gives the worker the time to start.
    await new Promise((done) => setTimeout(done, 300));
    const from = now();
    while (now() - from < 300) {
      // The main thread is busy, as in a synchronous read.
    }
    const to = now();
    const samples = await watch.stop();
    expect(samples.filter((sample) => sample.at >= from && sample.at <= to).length).toBeGreaterThanOrEqual(3);
  });

  it("does not keep the process alive, and a stop gives the samples in a process with no other work", () => {
    const url = JSON.stringify(new URL("./fresh.ts", import.meta.url).href);
    const idle = `const { watchIo } = await import(${url}); watchIo(5); console.log("started");`;
    expect(execFileSync(process.execPath, ["--input-type=module", "-e", idle], { encoding: "utf8", timeout: 20_000 })).toBe("started\n");
    const stop = `const { watchIo } = await import(${url}); const samples = await watchIo(5).stop(); console.log(samples.length);`;
    expect(Number(execFileSync(process.execPath, ["--input-type=module", "-e", stop], { encoding: "utf8", timeout: 20_000 }))).toBeGreaterThanOrEqual(2);
  });

  it("refuses an interval that is not a finite number above 0", () => {
    for (const interval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "5" as unknown as number]) expect(() => watchIo(interval)).toThrow(RangeError);
  });
});
