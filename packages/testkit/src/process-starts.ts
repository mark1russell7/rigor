import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

/**
 * The count of the process starts of a test process, by command, and a budget of starts for each test file. Each start of a
 * process costs time. On Windows each start also loads images that the kernel does not free, so a suite that starts
 * thousands of processes can stop the computer.
 *
 * `countProcessStarts` wraps the functions of `node:child_process` one time in a process. A setup file of the test runner
 * uses it. The setup file clears the map before each test file. After the file, it compares the count with the budget.
 */

/** This function gives the name of a command file: its name with no folder and no extension, or `node` for this Node.js. */
export function commandName(file: unknown): string {
  if (typeof file !== "string") return "unknown";
  if (file === process.execPath) return "node";
  return basename(file.replace(/\\/g, "/")).replace(/\.(?:exe|cmd|bat)$/i, "").toLowerCase();
}

/** This function gives the name of the command of a command line: the first word, or the first part in quotes. */
export function lineCommandName(line: unknown): string {
  if (typeof line !== "string") return "unknown";
  const match = /^\s*(?:"([^"]+)"|(\S+))/.exec(line);
  return commandName(match?.[1] ?? match?.[2] ?? "");
}

/**
 * This function gives the key of a start in the count. A git start counts under `git-<command>`, for example
 * `git-ls-files`, so a report shows which git commands start most. The first argument that is not an option, and not the
 * value of `-c` or `-C`, is the git command. Each other start counts under the name of its command.
 */
export function startKey(name: string, args: unknown): string {
  if (name !== "git" || !Array.isArray(args)) return name;
  for (let index = 0; index < args.length; index++) {
    const arg: unknown = args[index];
    if (arg === "-c" || arg === "-C") index++;
    else if (typeof arg === "string" && !arg.startsWith("-")) return `git-${arg}`;
  }
  return name;
}

/** This function gives the count of the starts of the command `name` in the counts: the key `name` and each key `<name>-<command>`. */
export function startsIn(counts: ReadonlyMap<string, number>, name: string): number {
  let sum = 0;
  for (const [key, n] of counts) if (key === name || key.startsWith(`${name}-`)) sum += n;
  return sum;
}

type Wrapped = (file: unknown, ...rest: unknown[]) => unknown;
const STATE = Symbol.for("@mark1russell7/rigor-testkit/process-starts");
const holder = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;

/**
 * This function wraps the functions of `node:child_process` one time in a process, and gives the map of the counts by the
 * key of `startKey`. The ESM named imports of `node:child_process` see the wrappers too. A second call gives the same map.
 */
export function countProcessStarts(): Map<string, number> {
  const existing = holder[STATE];
  if (existing !== undefined) return existing;
  const counts = new Map<string, number>();
  const count = (key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const functions = childProcess as unknown as Record<string, Wrapped | undefined>;
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    const original = functions[name];
    if (original === undefined) continue;
    const line = name === "exec" || name === "execSync";
    functions[name] = (file, ...rest) => {
      const command = name === "fork" ? "node" : line ? lineCommandName(file) : commandName(file);
      count(startKey(command, line ? undefined : rest[0]));
      return original(file, ...rest);
    };
  }
  syncBuiltinESMExports();
  holder[STATE] = counts;
  return counts;
}

/** This function gives the count of the starts of the command `name` since the last clear of the map of `countProcessStarts`. */
export function startsOf(name: string): number {
  return startsIn(countProcessStarts(), name);
}

/** The count of the process starts of one test file, by key. */
export interface FileStarts {
  /** The path of the test file, from the root of its package. */
  readonly file: string;
  readonly counts: Readonly<Record<string, number>>;
}

/** This function gives the lines of a report: one line for each file, the most starts first, and a line of the sums. */
export function startsReport(rows: readonly FileStarts[]): string[] {
  const total = (row: FileStarts): number => Object.values(row.counts).reduce((sum, n) => sum + n, 0);
  const sums = new Map<string, number>();
  for (const row of rows) for (const [name, n] of Object.entries(row.counts)) sums.set(name, (sums.get(name) ?? 0) + n);
  const counts = (entries: Iterable<[string, number]>): string =>
    [...entries]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, n]) => `${name}=${String(n)}`)
      .join(" ");
  const lines = [...rows]
    .sort((a, b) => total(b) - total(a) || a.file.localeCompare(b.file))
    .map((row) => `process-starts ${String(total(row))} ${row.file} ${counts(Object.entries(row.counts))}`);
  lines.push(`process-starts ${String(rows.reduce((sum, row) => sum + total(row), 0))} (all ${String(rows.length)} files) ${counts(sums)}`);
  return lines;
}

/** The start budgets of the test files: a budget for each file in `files`, and the budget `default` of each other file. */
export interface StartBudgets {
  readonly default: number;
  readonly files: Readonly<Record<string, number>>;
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * This function reads the text of a budget file: an object with a count `default` and an object `files` of counts.
 * `source` names the file in the messages.
 *
 * @throws Error when the text is not such an object
 */
export function parseStartBudgets(text: string, source = "the budget file"): StartBudgets {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${source}: the text is not an object`);
  const { default: other, files } = value as Record<string, unknown>;
  if (!isCount(other)) throw new Error(`${source}: default is not a count`);
  if (typeof files !== "object" || files === null || Array.isArray(files)) throw new Error(`${source}: files is not an object`);
  for (const [file, budget] of Object.entries(files)) if (!isCount(budget)) throw new Error(`${source}: the budget of ${file} is not a count`);
  return { default: other, files: files as Record<string, number> };
}

/** This function gives the budget of a count of starts: the next multiple of `step` above the count. */
export function budgetOf(count: number, step = 10): number {
  return (Math.floor(count / step) + 1) * step;
}

/** A task of the test runner, with only the fields that `ranInFull` reads. A file, a suite and a test of vitest fit it. */
export interface SuiteTask {
  readonly type: string;
  readonly mode: string;
  readonly result?: { readonly state?: string } | undefined;
  readonly tasks?: readonly SuiteTask[];
}

/**
 * This function tells if each test of the tasks passed, with no filter and no skip. A name filter, `.only`, `.skip` or a
 * failed test gives fewer starts, so then a count below the budget shows no gain.
 */
export function ranInFull(tasks: readonly SuiteTask[]): boolean {
  return tasks.every((task) => (task.tasks !== undefined ? ranInFull(task.tasks) : (task.mode === "run" || task.mode === "only") && task.result?.state === "pass"));
}

/** The options of `startBudgetBreak`. */
export interface StartBudgetOptions {
  /** The command that the budget counts. The default is `git`. */
  readonly command?: string;
  /** The name of the budget file in the message. The default is `the budget file`. */
  readonly source?: string;
  /** A sentence at the end of the message that tells how to start fewer processes. */
  readonly advice?: string;
  /**
   * True when each test of the file passed, from `ranInFull`. Then a file budget above `budgetOf` the count also breaks.
   * Thus each gain stays held. The default is false.
   */
  readonly inFull?: boolean;
  /** The step of `budgetOf`. The default is 10. */
  readonly step?: number;
}

/**
 * This function gives the message for a test file with more starts of the command than its budget, or `undefined`. With
 * `inFull`, it also gives a message for a file budget above `budgetOf` the count.
 */
export function startBudgetBreak(file: string, counts: ReadonlyMap<string, number>, budgets: StartBudgets, options: StartBudgetOptions = {}): string | undefined {
  const command = options.command ?? "git";
  const source = options.source ?? "the budget file";
  const used = startsIn(counts, command);
  const own = budgets.files[file];
  const budget = own ?? budgets.default;
  if (used > budget) {
    const message = `${file} started ${command} ${String(used)} times, over its budget of ${String(budget)} in ${source}.`;
    return options.advice === undefined ? message : `${message} ${options.advice}`;
  }
  const lower = budgetOf(used, options.step);
  if (options.inFull !== true || own === undefined || lower >= own) return undefined;
  const fix = lower <= budgets.default ? `Remove its entry: the default budget of ${String(budgets.default)} covers it.` : `Lower its budget to ${String(lower)}.`;
  return `${file} started ${command} ${String(used)} times, well under its budget of ${String(own)} in ${source}. ${fix} Thus the gain stays held.`;
}
