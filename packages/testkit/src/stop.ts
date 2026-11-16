import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Stop } from "@mark1russell7/rigor-chaos";
import type { ChildExit } from "./child.ts";
import { importPeer } from "./peer.ts";
import { describeExit, outputTail, within } from "./process.ts";
import { STOP_ENV, parseProgress, type ProgressLine, type StopOrder } from "./stop-point.ts";

// rigor-chaos is an optional peer dependency. Without it, the import of this entry throws an error with the install.
const { checkStop, stopTriggerOf } = await importPeer(
  () => import("@mark1russell7/rigor-chaos"),
  "@mark1russell7/rigor-chaos",
  "@mark1russell7/rigor-testkit/stop",
);

/**
 * The harness of a stop plan of `@mark1russell7/rigor-chaos`. The program of a test uses `stopPoint` at each point of
 * interest. Examples are the points before and after each write of a transaction. `runToStop` starts the program in a
 * child process and stops it with the signal of the plan at its point. Then the test examines the state that the child
 * left.
 *
 * A stop of a process is not a power cut. The kernel keeps each write that the process gave to it, also after a
 * `SIGKILL`. Only a power cut or a crash of the kernel loses the writes that are not on the disk.
 *
 * On Windows, `SIGTERM` and `SIGKILL` both end the process at once, and the process cannot catch `SIGTERM`.
 *
 * The child side is also the entry `/stop-point`: `STOP_ENV`, `stopPoint` and `parseProgress`. That entry imports only
 * modules of Node.js, so a copy of its built file works with no packages. This entry gives the same names.
 */

export { STOP_ENV, parseProgress, stopPoint, type ProgressLine, type StopOrder } from "./stop-point.ts";

/**
 * This function gives the order of a stop for `STOP_ENV`, with the path of the progress file in the child. A stop at a
 * step goes into the order, and the child stops itself. A stop at a time does not: the parent sends its signal. Without a
 * stop, the child records each point and does not stop. This function throws a `RangeError` for a stop with problems.
 */
export function stopOrderOf(stop: Stop | undefined, progress: string): StopOrder {
  if (stop === undefined) return { progress };
  const problems = checkStop(stop);
  if (problems.length > 0) throw new RangeError(`stopOrderOf: ${problems.join(" ")}`);
  const trigger = stopTriggerOf(stop.at);
  return trigger?.measure === "step" ? { progress, step: trigger.value, signal: stop.signal } : { progress };
}

/** The parts of a run that tell if its stop occurred. A harness that starts the child itself has the same parts. */
export interface StopEvidence {
  /** The stop of the run, or `undefined` for a complete run. */
  readonly stop: Stop | undefined;
  /** The lines of the progress file, from `parseProgress`. */
  readonly lines: readonly ProgressLine[];
  /** For a stop at a time, this value is `true` when the harness sent the signal and the send did not fail. */
  readonly sent: boolean;
  /** The exit of the child. */
  readonly exit: ChildExit;
}

/**
 * This function tells if the stop of a run occurred. For a step, the child wrote the line of the stop. For a time, the
 * harness sent the signal, and the exit code of the child is not 0.
 *
 * A child can end a moment before the signal. Node reads the exit after a short time, thus the send can succeed after the
 * end. An exit code of 0 shows that the child got to its end, so the stop did not occur.
 */
export function stopOccurred(evidence: StopEvidence): boolean {
  const { stop, lines, sent, exit } = evidence;
  if (stop === undefined) return false;
  if (stopTriggerOf(stop.at)?.measure === "step") return lines.some((line) => line.stop === true);
  return sent && exit.code !== 0;
}

/** The options of a run of a program to its stop. */
export interface StopRunOptions {
  /** The program, for example `process.execPath`. The harness starts it with no shell. */
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** The environment of the child. The default is the environment of this process. The harness adds `STOP_ENV`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The stop of the run. Without a stop, the child operates to its end, and the run counts its stop points. */
  readonly stop?: Stop;
  /** The time in ms for the run. The default is 60 000. After it, the harness stops the child with `SIGKILL` and rejects. */
  readonly timeoutMs?: number;
}

/** The record of a run of a program to its stop. */
export interface StopRun {
  /** The stop of the run, or `undefined` for a complete run. */
  readonly stop: Stop | undefined;
  readonly exit: ChildExit;
  /**
   * This value is `true` when the stop occurred. For a step, the child got to the step. For a time, the signal went to the
   * child before its end. A child that ends first gives `false`. A child with an exit code of 0 also gives `false` for a
   * time, because the child got to its end. `stopOccurred` has the rule.
   */
  readonly stopped: boolean;
  /** The number of the stop points that the child got to. */
  readonly steps: number;
  /**
   * The last stop point that the child got to, or `undefined` when it got to no point. After a stop at a time, the stop at
   * this step is the nearest earlier stop that a step can make.
   */
  readonly lastStep: number | undefined;
  /** The label of the last stop point, or `undefined` when that point has no label. */
  readonly lastLabel: string | undefined;
  /** The last 256 KiB of the standard output of the child. */
  readonly stdout: string;
  /** The last 256 KiB of the standard error of the child. */
  readonly stderr: string;
  /** The time in ms from the start of the child to its end. */
  readonly ms: number;
}

/** After the exit of a child, the harness waits this time in ms for the end of its output. */
const CLOSE_WAIT_MS = 250;
/** The message of an error holds this number of the last characters of the output. */
const MESSAGE_OUTPUT_LIMIT = 2_000;

/**
 * This function starts a program in a child process with a stop, and gives the record of the run after the end of the
 * child. A stop at a step comes from `stopPoint` in the child. The harness sends the signal of a stop at a time.
 *
 * The promise rejects when the child does not start, or when it does not end in `timeoutMs`. It does not reject for an
 * exit code: a stopped child has no exit code of 0. This function throws a `RangeError` for a stop with problems.
 */
export async function runToStop(options: StopRunOptions): Promise<StopRun> {
  const stop = options.stop;
  if (stop !== undefined) {
    const problems = checkStop(stop);
    if (problems.length > 0) throw new RangeError(`runToStop: ${problems.join(" ")}`);
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new RangeError(`runToStop: timeoutMs is a positive number of ms, not ${String(timeoutMs)}.`);
  const trigger = stop === undefined ? undefined : stopTriggerOf(stop.at);

  const folder = await mkdtemp(join(tmpdir(), "rigor-stop-"));
  try {
    const progress = join(folder, "progress.jsonl");
    const order = stopOrderOf(stop, progress);
    const started = performance.now();
    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...(options.env ?? process.env), [STOP_ENV]: JSON.stringify(order) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      stdout = outputTail(stdout + text);
    });
    child.stderr.on("data", (text: string) => {
      stderr = outputTail(stderr + text);
    });
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));

    let sent = false;
    let late = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const exit = await new Promise<ChildExit>((resolve, reject) => {
      child.on("error", (error) => {
        // A child that did not start has no exit. A failed kill of a child that started is not an error of the run.
        if (child.pid === undefined) reject(new Error(`runToStop: the child did not start: ${error.message}`, { cause: error }));
      });
      child.once("exit", (code, signal) => resolve({ code, signal }));
      if (stop !== undefined && trigger?.measure === "ms") {
        timers.push(
          setTimeout(() => {
            sent = child.exitCode === null && child.signalCode === null && child.kill(stop.signal);
          }, trigger.value),
        );
      }
      timers.push(
        setTimeout(() => {
          late = true;
          child.kill("SIGKILL");
        }, timeoutMs),
      );
    }).finally(() => {
      for (const timer of timers) clearTimeout(timer);
    });
    const ms = performance.now() - started;
    await within(closed, CLOSE_WAIT_MS);
    if (late) throw new Error(`runToStop: the child did not end in ${timeoutMs} ms.${lastOutput(`${stdout}${stderr}`)}`);

    const lines = await progressLines(progress);
    const last = lines.at(-1);
    const stopped = stopOccurred({ stop, lines, sent, exit });
    return { stop, exit, stopped, steps: lines.length, lastStep: last?.step, lastLabel: last?.label, stdout, stderr, ms };
  } finally {
    // On Windows, a file that a process held a moment ago can refuse a removal
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function lastOutput(output: string): string {
  const tail = output.slice(-MESSAGE_OUTPUT_LIMIT);
  return tail === "" ? "" : `\nThe last output of the child:\n${tail}`;
}

/**
 * This function starts a program with no stop, and gives the number of its stop points. Give the number to the
 * limit `within: { step }` of a spec of `stopPlan`. The promise rejects when the child does not end with the code 0.
 */
export async function countStops(options: Omit<StopRunOptions, "stop">): Promise<number> {
  const run = await runToStop(options);
  if (run.exit.code !== 0) {
    throw new Error(`countStops: the complete run ended with ${describeExit(run.exit)}, not the code 0.${lastOutput(`${run.stdout}${run.stderr}`)}`);
  }
  return run.steps;
}

async function progressLines(path: string): Promise<readonly ProgressLine[]> {
  try {
    return parseProgress(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
