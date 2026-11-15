/**
 * The start of one child process for a bench, for Node only. A runner gives the argv, the time limit and the output limit.
 */
import { spawn } from "node:child_process";
import type { ChildExit, StartOptions } from "./fresh.ts";
import { stopTree } from "./tree.ts";

/** The longest tail of `stderr` in an error. */
const TAIL = 2000;

/** This function gives the last 2000 characters of the `stderr` of a child for an error, or `(empty)`. */
export function stderrTail(stderr: string): string {
  const tail = stderr.length > TAIL ? `...${stderr.slice(-TAIL)}` : stderr;
  return tail.trim() === "" ? "(empty)" : tail.trimEnd();
}

/** The wait, in milliseconds, for the pipes of a child after its exit, and for the exit of a child after a stop. */
const GRACE_MS = 1000;

/**
 * This function starts a process with `spawn` and no shell. It stops the process and its tree at the time limit or at the output limit.
 *
 * - The promise settles at the close of the pipes, or a grace time after the exit of the child. A grandchild can keep a pipe open.
 * - A stop sends SIGTERM to the process group, and SIGKILL after the grace time. On Windows, `taskkill /T /F` stops the tree.
 */
export function startProcess(argv: readonly string[], options: StartOptions): Promise<ChildExit> {
  return new Promise((resolve) => {
    const [program, ...rest] = argv;
    const windows = process.platform === "win32";
    // On POSIX, the child leads its own process group, so a signal to the group reaches the grandchildren.
    const proc = spawn(program!, rest, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: !windows, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    let stopping = false;
    let error: string | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const signal = (name: NodeJS.Signals): void => stopTree(proc, name);
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      proc.stdout.destroy();
      proc.stderr.destroy();
      const exit: ChildExit = { stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), code, timedOut };
      resolve(error === undefined ? exit : { ...exit, error });
    };
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      signal("SIGTERM");
      clearTimeout(grace);
      grace = setTimeout(() => {
        if (!windows) signal("SIGKILL");
        finish(null);
      }, GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const take = (list: Buffer[]) => {
      let bytes = 0;
      return (chunk: Buffer): void => {
        bytes += chunk.length;
        if (bytes > options.maxBuffer) {
          error ??= `an output is more than ${options.maxBuffer} bytes`;
          stop();
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
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (stopping) return;
      // A grandchild that holds a pipe keeps the event close away. After the grace time, the runner stops the group.
      grace = setTimeout(() => {
        if (!windows) signal("SIGKILL");
        finish(code);
      }, GRACE_MS);
    });
    proc.on("close", (code) => finish(code));
  });
}
