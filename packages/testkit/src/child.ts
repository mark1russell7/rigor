import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

/**
 * A server of a test in a child process. The child listens on the port 0 and reports the port that it got: in a line
 * of its standard output, in a ready file, or in a place that a read function finds. The fixture gives that port to the
 * test. Thus no other process can take the port between a pick and a listen.
 */

/** This is how the child reports its port. */
export type PortReport =
  | {
      /** The child writes a line with its port to its standard output. The line ends with a newline. */
      readonly from: "stdout";
      /** The first group of this pattern matches the port in one line. The default is `PORT_LINE`. */
      readonly pattern?: RegExp;
    }
  | {
      /** The child writes its port to a file. */
      readonly from: "file";
      readonly path: string;
      /** This function gives the port from the text of the file, or `undefined` while the file is not complete. The default is `portOfText`. */
      readonly parse?: (text: string) => number | undefined;
    }
  | {
      /** The fixture starts `read` again after each `pollMs` until it gives a port. */
      readonly from: "poll";
      readonly read: (child: ChildProcess) => number | undefined | Promise<number | undefined>;
    };

/** A line that holds only a port, with spaces around it or no spaces. */
export const PORT_LINE: RegExp = /^\s*(\d+)\s*$/;

/** The options of a child server. */
export interface ChildServerOptions {
  /** The program, for example `process.execPath`. The fixture starts it with no shell. */
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** The environment of the child. The default is the environment of this process. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** How the child reports its port. The default is a line with only the port on the standard output. */
  readonly report?: PortReport;
  /** The time in ms for the report of the port. The default is 10 000. After it, the fixture stops the child and rejects. */
  readonly timeoutMs?: number;
  /** The time in ms between two reads of a file or of a read function. The default is 20. */
  readonly pollMs?: number;
  /** The time in ms between `SIGTERM` and `SIGKILL` at a stop. The default is 2 000. */
  readonly stopGraceMs?: number;
  /** A signal that stops the start. The fixture then stops the child and rejects. */
  readonly signal?: AbortSignal;
}

/** The end of a child: its exit code, or the signal that stopped it. */
export interface ChildExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** A child server with the port that it reported. */
export interface ChildServer {
  readonly port: number;
  readonly child: ChildProcess;
  /** This function gives the last 256 KiB of the standard output and the standard error of the child. */
  output(): string;
  /** This function stops the child with `SIGTERM`, and with `SIGKILL` after `stopGraceMs`. Each call gives the same promise. */
  stop(): Promise<ChildExit>;
}

/** A set of child servers that stop together, for the end of each test. */
export interface ChildServerGroup {
  /** This function starts a child server and adds it to the group. */
  start(options: ChildServerOptions): Promise<ChildServer>;
  /** This function stops each child server of the group, and empties the group. */
  stopAll(): Promise<void>;
}

/** The error of a child that did not report a port. The fixture stopped the child before the error. */
export class ChildServerError extends Error {
  /** The process id of the child, or `undefined` when it did not start. */
  readonly pid: number | undefined;
  /** The last 256 KiB of the output of the child. */
  readonly output: string;
  /** The end of the child, or `undefined` when it did not start. */
  readonly exit: ChildExit | undefined;

  constructor(message: string, details: { pid: number | undefined; output: string; exit: ChildExit | undefined }, options?: ErrorOptions) {
    const tail = details.output.slice(-MESSAGE_OUTPUT_LIMIT);
    super(tail === "" ? message : `${message}\nThe last output of the child:\n${tail}`, options);
    this.name = "ChildServerError";
    this.pid = details.pid;
    this.output = details.output;
    this.exit = details.exit;
  }
}

/** The fixture keeps this number of characters of the output of a child. */
const OUTPUT_LIMIT = 256 * 1024;
/** The message of an error holds this number of the last characters of the output. */
const MESSAGE_OUTPUT_LIMIT = 2_000;
/** After the exit of a child, the fixture waits this time in ms for the end of its output. */
const CLOSE_WAIT_MS = 250;

/**
 * This function gives the port in the text of a ready file: a number alone, or a JSON object with a number field
 * `port`. It gives `undefined` for other text, and for a file that the child did not write completely.
 */
export function portOfText(text: string): number | undefined {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value === "object" && value !== null && "port" in value && typeof value.port === "number") return value.port;
  } catch {
    // The child did not write the complete file
  }
  return undefined;
}

/**
 * This function starts a child process and waits until the child reports its port. Give the child the port 0: it
 * then listens on a free port, and no other process can take that port before the listen.
 *
 * The promise rejects with a `ChildServerError` when the child ends, does not start, reports no port in `timeoutMs`,
 * reports a number that is not a port, or when `signal` aborts. The fixture stops the child before it rejects.
 */
export async function startChildServer(options: ChildServerOptions): Promise<ChildServer> {
  checkOptions(options);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 20;
  const stopGraceMs = options.stopGraceMs ?? 2_000;
  const report: PortReport = options.report ?? { from: "stdout" };
  if (options.signal?.aborted) {
    throw new ChildServerError("The signal stopped the start before the child started.", { pid: undefined, output: "", exit: undefined }, { cause: options.signal.reason });
  }

  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  // An error after the start (a failed kill) is not an error of the test
  child.on("error", () => undefined);

  let output = "";
  const keep = (text: string): void => {
    output += text;
    if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT);
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  let exit: ChildExit | undefined;
  const exited = new Promise<ChildExit>((resolve) => {
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
  });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));

  let stopping: Promise<ChildExit> | undefined;
  const stop = (): Promise<ChildExit> => {
    stopping ??= (async () => {
      if (exit) return exit;
      if (child.pid === undefined) return { code: null, signal: null };
      child.kill("SIGTERM");
      const ended = await within(exited, stopGraceMs);
      if (ended) return ended;
      child.kill("SIGKILL");
      return exited;
    })();
    return stopping;
  };

  const port = await new Promise<number>((resolve, reject) => {
    let settled = false;
    const cleanups: Array<() => void> = [];
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanups) cleanup();
      finish();
    };
    const fail = (message: string, cause?: unknown): void => {
      settle(() => {
        void stop().then(() => reject(new ChildServerError(message, { pid: child.pid, output, exit }, cause === undefined ? undefined : { cause })));
      });
    };
    const found = (value: number): void => {
      if (isPort(value)) settle(() => resolve(value));
      else fail(`The child reported ${String(value)}, which is not a port from 1 to 65535.`);
    };

    const timer = setTimeout(() => fail(`The child reported no port in ${timeoutMs} ms.`), timeoutMs);
    cleanups.push(() => clearTimeout(timer));
    const signal = options.signal;
    if (signal) {
      const onAbort = (): void => fail("The signal stopped the start of the child.", signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }
    child.once("error", (error) => fail(`The child did not start: ${error.message}`, error));
    child.once("exit", () => {
      // The fixture waits for the end of the output, so the error holds the last lines of the child
      void within(closed, CLOSE_WAIT_MS).then(() => fail(`The child ended before it reported a port (${describeExit(exit)}).`));
    });

    switch (report.from) {
      case "stdout": {
        const pattern = new RegExp(report.pattern?.source ?? PORT_LINE.source, (report.pattern?.flags ?? "").replace(/[gy]/g, ""));
        let partial = "";
        const onData = (chunk: string): void => {
          const lines = (partial + chunk).split("\n");
          partial = (lines.pop() ?? "").slice(-OUTPUT_LIMIT);
          for (const line of lines) {
            const text = pattern.exec(line.replace(/\r$/, ""))?.[1];
            if (text !== undefined) return found(Number(text));
          }
        };
        child.stdout.on("data", onData);
        cleanups.push(() => child.stdout.off("data", onData));
        break;
      }
      case "file":
      case "poll": {
        let read: () => number | undefined | Promise<number | undefined>;
        if (report.from === "file") {
          read = fileReader(report.path, report.parse ?? portOfText);
        } else {
          const readPort = report.read;
          read = () => readPort(child);
        }
        void (async () => {
          while (!settled) {
            let value: number | undefined;
            try {
              value = await read();
            } catch (error) {
              return fail(`The read of the port failed: ${error instanceof Error ? error.message : String(error)}`, error);
            }
            if (settled) return;
            if (value !== undefined) return found(value);
            await new Promise((resolve) => setTimeout(resolve, pollMs));
          }
        })();
        break;
      }
    }
  });
  return { port, child, output: () => output, stop };
}

/** This function makes a group of child servers. Give `stopAll` to the `afterEach` of the test framework. */
export function childServerGroup(): ChildServerGroup {
  const servers: ChildServer[] = [];
  return {
    start: async (options) => {
      const server = await startChildServer(options);
      servers.push(server);
      return server;
    },
    stopAll: async () => {
      await Promise.all(servers.splice(0).map((server) => server.stop()));
    },
  };
}

function checkOptions(options: ChildServerOptions): void {
  const times = { timeoutMs: options.timeoutMs, pollMs: options.pollMs, stopGraceMs: options.stopGraceMs };
  for (const [name, value] of Object.entries(times)) {
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
      throw new RangeError(`startChildServer: ${name} must be a positive number of ms, not ${String(value)}.`);
    }
  }
  const report = options.report;
  if (report?.from === "stdout" && report.pattern !== undefined && groupCount(report.pattern) < 1) {
    throw new RangeError(`startChildServer: the pattern ${String(report.pattern)} has no group for the port.`);
  }
}

/** This function gives the number of the capture groups of a pattern. */
function groupCount(pattern: RegExp): number {
  // The empty alternative matches each text, and the match has one entry for each group
  return (new RegExp(`${pattern.source}|`).exec("")?.length ?? 1) - 1;
}

function fileReader(path: string, parse: (text: string) => number | undefined): () => Promise<number | undefined> {
  return async () => {
    try {
      return parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function describeExit(exit: ChildExit | undefined): string {
  if (exit?.signal) return `the signal ${exit.signal}`;
  return `the code ${String(exit?.code)}`;
}

/** This function gives the value of a promise, or `undefined` when the promise takes more than `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}
