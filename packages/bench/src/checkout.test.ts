import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ChildExit, type StartChild, type StartOptions, checkoutArm, freshRun, repoCommit } from "./fresh.ts";
import { caseRatios } from "./paired.ts";

const HASH = "c".repeat(40);

/** A call of the fake start: the argv and the folder of the child. */
interface Call {
  readonly argv: readonly string[];
  readonly cwd: string | undefined;
}

/** A fake start that gives `HASH` for `rev-parse`, or the end that `reply` gives. */
function fake(reply: (argv: readonly string[]) => Partial<ChildExit> | undefined = () => undefined): { start: StartChild; calls: Call[] } {
  const calls: Call[] = [];
  const start: StartChild = async (argv, options: StartOptions) => {
    calls.push({ argv, cwd: options.cwd });
    const out = argv.includes("rev-parse") ? `${HASH}\n` : "";
    return { stdout: out, stderr: "", code: 0, ...reply(argv) };
  };
  return { start, calls };
}

/** A folder that does not exist yet. */
const NEW = join(tmpdir(), `rigor-checkout-${process.pid}-new`);

describe("repoCommit", () => {
  it("gives the full hash that git gives for the ref", async () => {
    const { start, calls } = fake();
    expect(await repoCommit("main", { repo: "/repo", start })).toBe(HASH);
    expect(calls[0]!.argv).toEqual(["git", "-C", "/repo", "rev-parse", "--verify", "--quiet", "main^{commit}"]);
  });

  it("refuses a bad ref, a short hash and a git that fails", async () => {
    const { start } = fake();
    await expect(repoCommit("--all", { start })).rejects.toThrow(/does not start with "-"/);
    await expect(repoCommit("", { start })).rejects.toThrow(/not empty/);
    await expect(repoCommit("main", { start: fake(() => ({ stdout: "abc123\n" })).start })).rejects.toThrow(/not a full commit hash/);
    const bad = fake(() => ({ code: 1, stderr: "fatal: no such ref\n" })).start;
    await expect(repoCommit("nope", { start: bad })).rejects.toThrow(/exited with the code 1. The tail of stderr: fatal: no such ref/);
    await expect(repoCommit("main", { start, timeoutMs: 0 })).rejects.toThrow(/time limit/);
  });
});

describe("checkoutArm", () => {
  it("adds a worktree of the commit, starts each setup command in it, and gives the arm", async () => {
    const { start, calls } = fake();
    const setup = [["pnpm", "install"], ["pnpm", "build"]];
    const arm = await checkoutArm({ id: "base", commit: "main", dir: NEW, command: ["node", "bench.js"], setup, repo: "/repo", start });
    expect(arm).toMatchObject({ id: "base", command: ["node", "bench.js"], cwd: NEW, commit: HASH });
    expect(calls.map((c) => [c.argv.join(" "), c.cwd])).toEqual([
      ["git -C /repo rev-parse --verify --quiet main^{commit}", undefined],
      [`git -C /repo worktree add --detach ${NEW} ${HASH}`, undefined],
      ["pnpm install", NEW],
      ["pnpm build", NEW],
    ]);
    await arm.remove();
    expect(calls.at(-1)!.argv).toEqual(["git", "-C", "/repo", "worktree", "remove", "--force", NEW]);
  });

  it("removes the worktree when a setup command fails, and names the command", async () => {
    const { start, calls } = fake((argv) => (argv[1] === "build" ? { code: 2, stderr: "error TS2322\n" } : undefined));
    const setup = [["pnpm", "install"], ["pnpm", "build"]];
    await expect(checkoutArm({ id: "base", commit: "main", dir: NEW, command: ["node"], setup, start })).rejects.toThrow(/the command "pnpm build" exited with the code 2. The tail of stderr: error TS2322/);
    expect(calls.at(-1)!.argv.slice(3)).toEqual(["worktree", "remove", "--force", NEW]);
  });

  it("refuses a folder that exists and bad commands", async () => {
    const { start, calls } = fake();
    await expect(checkoutArm({ id: "base", commit: "main", dir: tmpdir(), command: ["node"], start })).rejects.toThrow(/exists. A checkout needs a new folder/);
    await expect(checkoutArm({ id: "base", commit: "main", dir: NEW, command: [], start })).rejects.toThrow(/1 or more strings/);
    await expect(checkoutArm({ id: "base", commit: "main", dir: NEW, command: ["node"], setup: [[]], start })).rejects.toThrow(/1 or more strings/);
    await expect(checkoutArm({ id: "", commit: "main", dir: NEW, command: ["node"], start })).rejects.toThrow(/id/);
    expect(calls).toEqual([]);
  });
});

describe("two commits as paired arms", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("measures the base commit against the commit of the job in one run", async () => {
    root = mkdtempSync(join(tmpdir(), "rigor-commits-"));
    const repo = join(root, "repo");
    const git = (...args: string[]): string =>
      execFileSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@example.com", "-c", "commit.gpgsign=false", "-C", repo, ...args], { encoding: "utf8" });
    execFileSync("git", ["init", "-q", repo]);
    // Each commit has a bench that prints its own time: 10 for the base, 20 for the job.
    const bench = (ms: number): void => writeFileSync(join(repo, "bench.mjs"), `console.log(JSON.stringify({ ms: ${ms} }));\n`);
    bench(10);
    git("add", "bench.mjs");
    git("commit", "-q", "-m", "base");
    const first = git("rev-parse", "HEAD").trim();
    bench(20);
    git("commit", "-q", "-am", "job");

    const command = [process.execPath, "bench.mjs"];
    const setup = [[process.execPath, "-e", "require('node:fs').writeFileSync('built.txt', 'yes')"]];
    const old = await checkoutArm({ id: "base", commit: "HEAD~1", dir: join(root, "base"), command, setup, repo });
    try {
      expect(old.commit).toBe(first);
      expect(existsSync(join(root, "base", "built.txt"))).toBe(true);
      const head = { id: "head", command, cwd: repo, commit: await repoCommit("HEAD", { repo }) };
      const run = await freshRun({ base: old, candidates: [head], cases: ["x"], rounds: 2, aa: "each", args: () => [] });
      expect(Object.keys(run.pairs)).toEqual(["head", "base~aa", "head~aa"]);
      expect(caseRatios(run.pairs["head"]!)[0]!.ratio).toBe(2);
      expect(caseRatios(run.pairs["base~aa"]!)[0]!.ratio).toBe(1);
      expect(run.pairs["head"]![0]!.commits).toEqual({ a: first, b: head.commit });
    } finally {
      await old.remove();
    }
    expect(existsSync(join(root, "base"))).toBe(false);
  });
});
