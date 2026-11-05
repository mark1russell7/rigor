/**
 * The runner of cases with a time budget. A case runs in a child process, so a hard stop works on code that does not return.
 * One child runs each case that is left. The child writes the start and the end of each case to a progress file.
 * When a case passes its budget, the supervisor stops the child, reports the case, and starts a new child on the cases that are left.
 * Only an overrun costs a new child, so the times of the other cases do not change.
 */

import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { stopTree } from "./tree.ts";

/** The count of overruns in one group, after which the other cases of the group do not run. */
export const DEFAULT_OVERRUNS = 2;

/** The time between two reads of the progress file, in milliseconds. */
export const DEFAULT_POLL_MS = 1000;

/** One case of a supervised run. */
export interface SupervisedCase {
  readonly id: string;
  /** The time budget of each stage of the case, in milliseconds. */
  readonly budgetMs: number;
  /**
   * The group of each stage of the case. An overrun in a stage counts for the group of that stage only.
   * A case with stages `pack` and `route` can thus count against a router, or against a packer, and not against both.
   */
  readonly groups?: Readonly<Record<string, string>>;
  /**
   * The place of the case in its groups, for example its input size. The default is 0.
   * Overruns count for each group and rank. They stop the cases of that group at that rank and above, and a smaller rank goes on.
   */
  readonly rank?: number;
}

/** The end of a case that did not finish: an overrun, which is measured, or a skip, which is not. */
export type SupervisedEnd =
  | { readonly kind: "over-budget"; readonly id: string; readonly budgetMs: number; readonly stage: string }
  | { readonly kind: "not-run"; readonly id: string; readonly budgetMs: number; readonly group: string; readonly because: readonly string[] };

/** One running child. */
export interface SupervisedChild {
  /** This function stops the child and its tree at once. */
  stop(): void;
  /** The exit code of the child, or `null` when a signal stopped it. */
  readonly exited: Promise<number | null>;
}

/** The options of `superviseCases`. */
export interface SuperviseOptions {
  /** The cases, in the order of the run. */
  readonly cases: readonly SupervisedCase[];
  /** The ids of the cases of an earlier run. These cases do not run. */
  readonly done?: ReadonlySet<string>;
  /**
   * The ends of an earlier run of these cases, in their order. These cases do not run, and an `over-budget` end needs its case in `cases`.
   * Each `over-budget` end counts for its group, so a stop and a resume give the same ends as a run with no stop.
   */
  readonly earlier?: readonly SupervisedEnd[];
  /** The file that the child writes with `caseProgress`. The supervisor makes it empty at the start. */
  readonly progressFile: string;
  /** This function starts a child on the ids that are left. */
  readonly start: (left: readonly string[]) => SupervisedChild;
  /** This function is the callback for the record of each case that did not finish. */
  readonly onEnd: (end: SupervisedEnd) => void;
  /** The default is `DEFAULT_OVERRUNS`. */
  readonly overruns?: number;
  /** The default is `DEFAULT_POLL_MS`. */
  readonly pollMs?: number;
  /** The clock of the supervisor. It is the clock of `caseProgress`. */
  readonly now?: () => number;
}

/** The result of `superviseCases`. */
export interface SuperviseResult {
  /** The exit code of the last child, or `null` when no child ran or a signal stopped the last child. */
  readonly code: number | null;
  /** The count of the children. */
  readonly starts: number;
  readonly ends: readonly SupervisedEnd[];
  /** The ids that have no result, because the last child ended before them. */
  readonly left: readonly string[];
}

/** The writer of a progress file, for the child. */
export interface CaseProgress {
  /** This function tells that a stage of a case starts. Each stage has its own budget. */
  start(id: string, stage?: string): void;
  /** This function tells that a case ended. Call it after the result of the case is on the disk. */
  end(id: string): void;
}

interface ProgressEvent {
  readonly event: "start" | "end";
  readonly id: string;
  readonly stage?: string;
  readonly at?: number;
}

/** This function gives the writer of a progress file. Each write is synchronous, so it works in a loop that does not yield. */
export function caseProgress(file: string, now: () => number = Date.now): CaseProgress {
  const write = (event: ProgressEvent): void => appendFileSync(file, `${JSON.stringify(event)}\n`);
  return {
    start: (id, stage = "") => write({ event: "start", id, stage, at: now() }),
    end: (id) => write({ event: "end", id }),
  };
}

/** The reader of a progress file: each call gives the events of the lines that are whole and were not read. */
function progressReader(file: string): () => ProgressEvent[] {
  let read = 0;
  return () => {
    const text = readFileSync(file, "utf8");
    const whole = text.slice(0, text.lastIndexOf("\n") + 1);
    const lines = whole.slice(read).split("\n").filter((line) => line !== "");
    read = whole.length;
    return lines.map((line) => JSON.parse(line) as ProgressEvent);
  };
}

/**
 * This function runs the cases and holds each case to its budget.
 *
 * - A stage over its budget stops the child, and `onEnd` gets `over-budget`. The next child runs the cases that are left.
 * - After `overruns` overruns in one group at one rank, each other case of the group at that rank or above ends as `not-run`.
 *   The end has the ids of those overruns.
 * - A case of a smaller rank goes on, and an overrun at another rank does not count. With no ranks, all cases of a group have one rank.
 * - A case in `done` or `earlier` does not run. A case that ended, or that has an end from `onEnd`, does not run again.
 * - An `over-budget` end of `earlier` counts as an overrun of this run. `onEnd` does not get the end again.
 * - A child that ends without a stop ends the run. Its exit code is the code of the result.
 * - A line of the progress file that is not JSON stops the child, and this function then throws the error.
 */
export async function superviseCases(options: SuperviseOptions): Promise<SuperviseResult> {
  const { cases, progressFile, start, onEnd, now = Date.now } = options;
  const limit = options.overruns ?? DEFAULT_OVERRUNS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const byId = new Map(cases.map((c) => [c.id, c]));
  for (const c of cases) {
    if (c.rank !== undefined && !Number.isFinite(c.rank)) throw new RangeError(`The case "${c.id}" has the rank ${c.rank}. A rank must be a finite number.`);
  }
  const finished = new Set(options.done ?? []);
  const groupOverruns = new Map<string, Map<number, string[]>>();
  const ends: SupervisedEnd[] = [];
  const left = (): string[] => cases.filter((c) => !finished.has(c.id)).map((c) => c.id);
  const report = (end: SupervisedEnd): void => {
    finished.add(end.id);
    ends.push(end);
    onEnd(end);
  };
  const countOverrun = (id: string, stage: string): void => {
    const overrun = byId.get(id);
    const group = overrun?.groups?.[stage];
    if (group === undefined) return;
    const rank = overrun?.rank ?? 0;
    const ranks = groupOverruns.get(group) ?? new Map<number, string[]>();
    const ids = [...(ranks.get(rank) ?? []), id];
    ranks.set(rank, ids);
    groupOverruns.set(group, ranks);
    if (ids.length < limit) return;
    for (const c of cases) {
      if (!finished.has(c.id) && (c.rank ?? 0) >= rank && Object.values(c.groups ?? {}).includes(group)) report({ kind: "not-run", id: c.id, budgetMs: c.budgetMs, group, because: ids.slice(0, limit) });
    }
  };

  const earlier = options.earlier ?? [];
  for (const end of earlier) {
    if (end.kind === "over-budget" && !byId.has(end.id)) throw new RangeError(`The case "${end.id}" of the option earlier is not in the option cases.`);
    finished.add(end.id);
  }
  for (const end of earlier) {
    if (end.kind === "over-budget") countOverrun(end.id, end.stage);
  }

  writeFileSync(progressFile, "");
  const readEvents = progressReader(progressFile);
  const state: { running?: { readonly id: string; readonly stage: string; readonly at: number } | undefined; exit?: { readonly code: number | null } | undefined } = {};
  const update = (): void => {
    for (const event of readEvents()) {
      if (event.event === "start") {
        state.running = { id: event.id, stage: event.stage ?? "", at: event.at ?? now() };
      } else {
        finished.add(event.id);
        if (state.running?.id === event.id) state.running = undefined;
      }
    }
  };

  // A function makes this reset, so that the checks of the loop see the declared types of the state.
  const forgetChild = (): void => {
    state.running = undefined;
    state.exit = undefined;
  };

  let starts = 0;
  let code: number | null = null;
  while (left().length > 0) {
    forgetChild();
    starts += 1;
    const child = start(left());
    const exited = child.exited.then((value) => {
      state.exit = { code: value };
    });
    let over: { readonly id: string; readonly stage: string; readonly budgetMs: number } | undefined;
    while (state.exit === undefined && over === undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([exited, new Promise((resolve) => (timer = setTimeout(resolve, pollMs)))]);
      clearTimeout(timer);
      try {
        update();
      } catch (error) {
        // A progress file that cannot be read cannot hold the child to its budget, so the child must not outlive the supervisor.
        child.stop();
        await exited;
        throw error;
      }
      const current = state.running;
      const budgetMs = current === undefined ? undefined : byId.get(current.id)?.budgetMs;
      if (state.exit === undefined && current !== undefined && budgetMs !== undefined && now() - current.at > budgetMs) over = { id: current.id, stage: current.stage, budgetMs };
    }
    if (over === undefined) {
      code = state.exit?.code ?? null;
      break;
    }
    child.stop();
    await exited;
    code = null;
    update();
    // The case can end between the read and the stop. Then its result is on the disk, and it has no overrun.
    if (finished.has(over.id)) continue;
    report({ kind: "over-budget", ...over });
    countOverrun(over.id, over.stage);
  }
  return { code, starts, ends, left: left() };
}

/** This function starts a process for `superviseCases`, with no shell. The process shares the output of the supervisor, and `stop` stops its tree at once. */
export function startSupervisedProcess(argv: readonly string[], options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {}): SupervisedChild {
  const [program, ...rest] = argv;
  // On POSIX, the child leads its own process group, so a signal to the group reaches the grandchildren.
  const proc = spawn(program!, rest, { stdio: ["ignore", "inherit", "inherit"], windowsHide: true, detached: process.platform !== "win32", ...options });
  const exited = new Promise<number | null>((resolve) => {
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve(code));
  });
  return { stop: () => stopTree(proc, "SIGKILL"), exited };
}
