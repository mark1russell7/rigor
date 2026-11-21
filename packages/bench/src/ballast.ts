/**
 * A ballast: a second Node process that holds a resident set of a given size. A child that starts a ballast in its
 * container has less free memory and less page cache. Thus the child operates as on a machine where other processes use the memory.
 */
import { spawn } from "node:child_process";

/** A running ballast. `startBallast` gives it. */
export interface Ballast {
  /** The process id of the ballast. */
  readonly pid: number;
  /** The resident set of the ballast in bytes, from its line. A small target gives the resident set of a bare Node, above the target. */
  readonly rss: number;
  /** The time in milliseconds from the spawn of the ballast to its line. */
  readonly ms: number;
  /** This function stops the ballast with `SIGKILL` and waits for its exit. A call after the exit does nothing. */
  readonly stop: () => Promise<void>;
}

/** The options of `startBallast`. */
export interface BallastOptions {
  /** The program of Node for the ballast. The default is `process.execPath`. */
  readonly execPath?: string;
}

/** The size of each chunk of the ballast: 1 MiB. */
const CHUNK = 1 << 20;

/**
 * This function gives the inline program of a ballast. It fills chunks of 1 MiB with the byte 1, so each page is resident, and keeps each chunk.
 * At the target, it writes the line `{"rss": N}`. It exits at the end of its `stdin`, so it does not live after its parent.
 */
const program = (bytes: number): string =>
  [
    `const target = ${bytes};`,
    "const chunks = [];",
    "globalThis.rigorBallast = chunks;",
    `while (process.memoryUsage.rss() < target) chunks.push(Buffer.allocUnsafe(${CHUNK}).fill(1));`,
    'process.stdout.write(JSON.stringify({ rss: process.memoryUsage.rss() }) + "\\n");',
    "const end = () => process.exit(0);",
    'process.stdin.on("end", end);',
    'process.stdin.on("close", end);',
    'process.stdin.on("error", end);',
    "process.stdin.resume();",
  ].join("\n");

/** A pipe of a child process. A pipe is a socket, and its `unref` lets this process exit while the pipe is open. */
type Pipe = { unref?: () => unknown };

/**
 * This function starts a ballast of `bytes` bytes, and it gives the ballast after its line. The ballast is a Node process
 * with an inline program, so a container needs no file for it. Its `stderr` goes to the `stderr` of this process.
 *
 * - The ballast fills chunks of 1 MiB until its resident set is `bytes` or more. A target below the resident set of a bare Node fills nothing.
 *   The field `rss` gives the real resident set.
 * - The ballast exits when its `stdin` closes. Thus it does not live after this process. It does not keep this process alive.
 * - A ballast that exits before its line is an `Error` with its exit code. A target that is not a whole number of 0 or more is a `RangeError`.
 */
export function startBallast(bytes: number, options: BallastOptions = {}): Promise<Ballast> {
  if (!(Number.isSafeInteger(bytes) && bytes >= 0)) throw new RangeError(`startBallast: the target is a whole number of bytes, 0 or more, not ${bytes}.`);
  const execPath = options.execPath ?? process.execPath;
  if (!(typeof execPath === "string" && execPath !== "")) throw new RangeError("startBallast: the program of Node is a string that is not empty.");
  const started = performance.now();
  const proc = spawn(execPath, ["-e", program(bytes)], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  return new Promise((resolve, reject) => {
    let out = "";
    let settled = false;
    const fail = (why: string, cause?: unknown): void => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error(`startBallast: ${why}`, cause === undefined ? undefined : { cause }));
    };
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      if (settled) return;
      out += chunk;
      const end = out.indexOf("\n");
      if (end < 0) return;
      const ms = performance.now() - started;
      let rss: unknown;
      try {
        rss = (JSON.parse(out.slice(0, end)) as { rss?: unknown }).rss;
      } catch (error) {
        fail(`the line of the ballast is not JSON: ${out.slice(0, Math.min(end, 200))}`, error);
        return;
      }
      if (!(typeof rss === "number" && Number.isSafeInteger(rss) && rss > 0)) {
        fail(`the line of the ballast has no resident set: ${out.slice(0, Math.min(end, 200))}`);
        return;
      }
      settled = true;
      // The ballast holds its memory until its stdin closes. These handles do not keep this process alive.
      proc.unref();
      (proc.stdin as Pipe).unref?.();
      (proc.stdout as Pipe).unref?.();
      const stop = async (): Promise<void> => {
        proc.ref();
        if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
        await exited;
      };
      resolve({ pid: proc.pid!, rss, ms, stop });
    });
    proc.once("error", (error) => fail(`the ballast did not start: ${error.message}`, error));
    proc.once("exit", (code, signal) => fail(`the ballast exited before its line, ${code === null ? `on the signal ${signal}` : `with the code ${code}`}.`));
  });
}
