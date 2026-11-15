/**
 * The arms of two builds of one repository in one job. Arm A is a checkout of the base commit, and arm B is the build
 * of the job. Each round and case pairs the two builds on one computer, so the ratio has no offset between jobs.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { errorMessage } from "@mark1russell7/text";
import type { ChildExit, FreshArm, StartChild, StartOptions } from "./fresh.ts";
import { startProcess, stderrTail } from "./start.ts";

/** The options of `repoCommit`. */
export interface RepoCommitOptions {
  /** The folder of the repository. The default is the folder of this process. */
  readonly repo?: string;
  /** The longest time of the git command in milliseconds. The default is 600000 (10 minutes). */
  readonly timeoutMs?: number;
  /** The start of a child. The default starts a process. A test gives its own. */
  readonly start?: StartChild;
}

/** The pattern of a full commit hash: SHA-1 (40 digits) or SHA-256 (64 digits). */
const FULL_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The longest output of a git or setup command. */
const MAX_BUFFER = 1 << 24;

/** This function gives the full hash of the commit of `ref` in a repository. The arm of the job uses `repoCommit("HEAD")`. */
export async function repoCommit(ref: string, options: RepoCommitOptions = {}): Promise<string> {
  if (typeof ref !== "string" || ref === "" || ref.startsWith("-")) throw new RangeError(`repoCommit: the ref is a string that is not empty and does not start with "-", not ${JSON.stringify(ref)}.`);
  const limits = { timeoutMs: timeLimit("repoCommit", options.timeoutMs), maxBuffer: MAX_BUFFER };
  const argv = ["git", "-C", options.repo ?? process.cwd(), "rev-parse", "--verify", "--quiet", `${ref}^{commit}`];
  const hash = (await command("repoCommit", options.start ?? startProcess, argv, limits)).trim();
  if (!FULL_HASH.test(hash)) throw new Error(`repoCommit: git gave ${JSON.stringify(hash)} for the ref ${JSON.stringify(ref)}, not a full commit hash.`);
  return hash;
}

/** The options of `checkoutArm`. */
export interface CheckoutArmOptions {
  readonly id: string;
  /** The commit of the arm: a hash, a tag or a branch. The arm keeps its full hash. */
  readonly commit: string;
  /** The folder of the new checkout. The folder does not exist yet. */
  readonly dir: string;
  /** The command of each child of the arm. Each child starts in `dir`. */
  readonly command: readonly string[];
  /** The commands that build the checkout, in order, each as an argv. Each command starts in `dir`. The default is no command. */
  readonly setup?: readonly (readonly string[])[];
  /** The folder of the repository. The default is the folder of this process. */
  readonly repo?: string;
  /** The longest time of each git and setup command in milliseconds. The default is 600000 (10 minutes). */
  readonly timeoutMs?: number;
  /** The start of a child. The default starts a process. A test gives its own. */
  readonly start?: StartChild;
}

/** An arm on a checkout of a commit. The function `remove` removes the checkout. */
export interface CheckoutArm extends FreshArm {
  readonly cwd: string;
  readonly commit: string;
  readonly remove: () => Promise<void>;
}

/**
 * This function makes an arm on a checkout of a commit of a repository.
 * - It adds a detached git worktree of the commit in `dir`. Then it starts each setup command in `dir`, in order.
 * - A setup command that fails removes the worktree, and the error has the tail of its `stderr`.
 * - A checkout in CI needs the history of the commit, for example `fetch-depth: 0` of `actions/checkout`.
 * - The arm of the job is `{ id, command, commit: await repoCommit("HEAD") }`. Use `aa: "each"` of `freshRun` with the two arms.
 */
export async function checkoutArm(options: CheckoutArmOptions): Promise<CheckoutArm> {
  const { id, command: argv } = options;
  const setup = options.setup ?? [];
  if (typeof id !== "string" || id === "") throw new RangeError("checkoutArm: the id of the arm is a string that is not empty.");
  if (typeof options.dir !== "string" || options.dir === "") throw new RangeError("checkoutArm: the folder of the checkout is a string that is not empty.");
  for (const list of [argv, ...setup]) {
    if (list.length === 0 || list.some((s) => typeof s !== "string")) throw new RangeError(`checkoutArm: the command and each setup command of the arm ${JSON.stringify(id)} are 1 or more strings.`);
  }
  const dir = resolve(options.dir);
  if (existsSync(dir)) throw new Error(`checkoutArm: the folder ${dir} exists. A checkout needs a new folder.`);
  const start = options.start ?? startProcess;
  const repo = options.repo ?? process.cwd();
  const timeoutMs = timeLimit("checkoutArm", options.timeoutMs);
  const limits: StartOptions = { timeoutMs, maxBuffer: MAX_BUFFER };
  const commit = await repoCommit(options.commit, { repo, timeoutMs, start });
  await command("checkoutArm", start, ["git", "-C", repo, "worktree", "add", "--detach", dir, commit], limits);
  const remove = async (): Promise<void> => {
    await command("checkoutArm", start, ["git", "-C", repo, "worktree", "remove", "--force", dir], limits);
  };
  try {
    for (const step of setup) await command("checkoutArm", start, step, { ...limits, cwd: dir });
  } catch (error) {
    await remove().catch(() => undefined);
    throw error;
  }
  return { id, command: [...argv], cwd: dir, commit, remove };
}

/** This function checks a time limit. The default is 600000 milliseconds (10 minutes). */
function timeLimit(name: string, timeoutMs: number | undefined): number {
  const value = timeoutMs ?? 600_000;
  if (!(value > 0) || !Number.isFinite(value)) throw new RangeError(`${name}: the time limit is a finite number above 0, not ${value}.`);
  return value;
}

/** This function starts one command and gives its `stdout`. A fault gives an error that names the command and has the tail of its `stderr`. */
async function command(name: string, start: StartChild, argv: readonly string[], limits: StartOptions): Promise<string> {
  const what = `the command ${JSON.stringify(argv.join(" "))}`;
  let exit: ChildExit;
  try {
    exit = await start(argv, limits);
  } catch (error) {
    throw new Error(`${name}: ${what} did not start: ${errorMessage(error)}`, { cause: error });
  }
  const why =
    exit.error !== undefined
      ? `failed: ${exit.error}`
      : exit.timedOut === true
        ? `took more than ${limits.timeoutMs} ms`
        : exit.code === 0
          ? undefined
          : exit.code === null
            ? "stopped on a signal"
            : `exited with the code ${exit.code}`;
  if (why !== undefined) throw new Error(`${name}: ${what} ${why}. The tail of stderr: ${stderrTail(exit.stderr)}`);
  return exit.stdout;
}
