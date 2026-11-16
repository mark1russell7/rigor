import { openSync, writeSync } from "node:fs";
import { constants } from "node:os";
import type { StopSignal } from "@mark1russell7/rigor-chaos";

/**
 * The child side of the stop protocol: the order in `STOP_ENV`, the progress file and `stopPoint`. This module imports
 * only modules of Node.js. Thus one copy of its built file speaks the protocol in a container with no packages.
 *
 * The entry `/stop` gives the same names from this module, so a program has one state of its stop points. The entry
 * `/stop` also has the parent side: `runToStop`, `countStops`, `stopOrderOf` and `stopOccurred`.
 */

/** The name of the environment variable that tells the child its stop and the file of its progress. */
export const STOP_ENV = "RIGOR_STOP";

/**
 * The value of `STOP_ENV`: a JSON object. Without `step`, the child records each point and does not stop. A harness that
 * starts the child itself, for example in a container, makes the order with `stopOrderOf`.
 */
export interface StopOrder {
  readonly progress: string;
  readonly step?: number;
  readonly signal?: StopSignal;
}

/** One line of the progress file. `parseProgress` reads the lines of a file. */
export interface ProgressLine {
  readonly step: number;
  readonly label?: string;
  readonly stop?: true;
}

/**
 * This function gives the lines of the text of a progress file, in their sequence. It ignores a line that is not JSON:
 * the last line of a child that stopped in its write. It also ignores a value that is not a progress line.
 */
export function parseProgress(text: string): ProgressLine[] {
  const lines: ProgressLine[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue; // A line that the child did not write completely
    }
    if (isProgressLine(value)) lines.push(value);
  }
  return lines;
}

/** This function tells if a value from a progress file has the shape of `ProgressLine`, with a whole step of 0 or more. */
function isProgressLine(value: unknown): value is ProgressLine {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const line = value as Record<string, unknown>;
  const step = line["step"];
  if (typeof step !== "number" || !Number.isSafeInteger(step) || step < 0) return false;
  return (line["label"] === undefined || typeof line["label"] === "string") && (line["stop"] === undefined || line["stop"] === true);
}

interface PointState {
  readonly fd: number;
  readonly stopAt: number | undefined;
  readonly signal: string;
  next: number;
}

let points: PointState | null | undefined;

/**
 * This function reads the order of `STOP_ENV`. The signal is the name of a signal of Node.js. Thus a signal that the
 * system does not know causes a `RangeError` at the first point, not at the stop. `stopOrderOf` of the entry `/stop`
 * also examines the signal of a plan with `@mark1russell7/rigor-chaos`.
 */
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
  if (typeof signal !== "string" || !Object.hasOwn(constants.signals, signal)) {
    throw new RangeError(`stopPoint: the signal of ${STOP_ENV} is the name of a signal, for example SIGKILL or SIGTERM, not ${String(signal)}.`);
  }
  const state: PointState = { fd: openSync(order.progress, "a"), stopAt: step as number | undefined, signal, next: 0 };
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
