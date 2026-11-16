import { spawn } from "node:child_process";
import { openSync, writeSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STOP_SIGNALS, type Stop, type StopSignal, checkStop, stopTriggerOf } from "@mark1russell7/rigor-chaos";
import type { ChildExit } from "./child.ts";
import { describeExit, outputTail, within } from "./process.ts";

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
 */

/** The name of the environment variable that tells the child its stop and the file of its progress. */
export const STOP_ENV = "RIGOR_STOP";

/** The value of `STOP_ENV`: a JSON object. Without `step`, the child records each point and does not stop. */
interface StopOrder {
  readonly progress: string;
  readonly step?: number;
  readonly signal?: StopSignal;
}

/** One line of the progress file. */
interface ProgressLine {
  readonly step: number;
  readonly label?: string;
  readonly stop?: true;
}

interface PointState {
  readonly fd: number;
  readonly stopAt: number | undefined;
  readonly signal: StopSignal;
  next: number;
}

let points: PointState | null | undefined;

function openOrder(): PointState | null {
  const text = process.env[STOP_ENV];
  if (text === undefined || text === "") return null;
  let order: StopOrder;
  try {
    order = JSON.parse(text) as StopOrder;
  } catch (error) {
    throw new RangeError(`stopPoint: the variable ${STOP_ENV} is not JSON: ${text}`, { cause: error });
  }
  const step: unknown = order.step;
  const signal: unknown = order.signal ?? "SIGKILL";
  if (typeof order.progress !== "string" || order.progress === "") throw new RangeError(`stopPoint: the variable ${STOP_ENV} has no progress file: ${text}`);
  if (step !== undefined && !(typeof step === "number" && Number.isSafeInteger(step) && step >= 0)) {
    throw new RangeError(`stopPoint: the step of ${STOP_ENV} is a whole number of 0 or more, not ${String(step)}.`);
  }
  if (!(STOP_SIGNALS as readonly unknown[]).includes(signal)) throw new RangeError(`stopPoint: the signal of ${STOP_ENV} is one of ${STOP_SIGNALS.join(", ")}, not ${String(signal)}.`);
  const state: PointState = { fd: openSync(order.progress, "a"), stopAt: step as number | undefined, signal: signal as StopSignal, next: 0 };
  // The removal comes after the checks. Thus each call with an order that is not valid throws, also after a caught error.
  // A child that the program starts after this point does not get the order.
  delete process.env[STOP_ENV];
  return state;
}

/**
 * This function is one stop point of the program of a test. Each call is the next step, from 0. Without the variable
 * `STOP_ENV`, the function does no work. When the step is the step of the stop, the process sends the signal to itself.
 *
 * Each call writes the step and the label to the progress file before the signal. Thus the parent knows the last point
 * that the child got to. The first use removes `STOP_ENV` from the environment, thus a later child of the program does not
 * stop. An order that is not valid stays in the environment, and each call throws its `RangeError`.
 *
 * A child that the program starts before its first stop point gets the order. That child writes its own steps from 0 to
 * the same progress file, and it stops itself at the step of the stop. Start each child after the first stop point, or
 * remove `STOP_ENV` from its environment. A wrapper, for example `tsx`, needs the order for its child, so this function
 * does not refuse it.
 *
 * After `SIGKILL`, no code of the program runs. After `SIGTERM`, a program with a handler continues until its handler
 * ends it.
 */
export function stopPoint(label?: string): void {
  if (points === undefined) points = openOrder();
  if (points === null) return;
  const step = points.next;
  points.next += 1;
  const stops = step === points.stopAt;
  const line: ProgressLine = { step, ...(label === undefined ? {} : { label }), ...(stops ? { stop: true as const } : {}) };
  writeSync(points.fd, `${JSON.stringify(line)}\n`);
  if (stops) process.kill(process.pid, points.signal);
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
   * child before its end. A child that ends first gives `false`.
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
    const order: StopOrder =
      stop !== undefined && trigger?.measure === "step" ? { progress, step: trigger.value, signal: stop.signal } : { progress };
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
    const stopped = trigger?.measure === "step" ? lines.some((line) => line.stop === true) : sent;
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
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const lines: ProgressLine[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    try {
      lines.push(JSON.parse(line) as ProgressLine);
    } catch {
      // A line that the child did not write completely
    }
  }
  return lines;
}
