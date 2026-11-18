import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  commandName,
  countProcessStarts,
  lineCommandName,
  parseStartBudgets,
  startBudgetBreak,
  startKey,
  startsIn,
  startsOf,
  startsReport,
} from "./process-starts.ts";

describe("the count of process starts", () => {
  it("names a command file by its name, with no folder and no extension", () => {
    expect(commandName("git")).toBe("git");
    expect(commandName("C:\\Program Files\\Git\\cmd\\git.exe")).toBe("git");
    expect(commandName("/usr/bin/git")).toBe("git");
    expect(commandName("pnpm.CMD")).toBe("pnpm");
    expect(commandName(process.execPath)).toBe("node");
    expect(commandName(undefined)).toBe("unknown");
  });

  it("names the command of a command line by its first word, or its first part in quotes", () => {
    expect(lineCommandName("pnpm install --frozen-lockfile")).toBe("pnpm");
    expect(lineCommandName('"C:\\Program Files\\GitHub CLI\\gh.exe" pr view')).toBe("gh");
    expect(lineCommandName("  git status")).toBe("git");
    expect(lineCommandName(42)).toBe("unknown");
  });

  it("counts a git start under its command, and sums each key of a command", () => {
    expect(startKey("git", ["-c", "user.name=test", "-C", "a", "ls-files", "-z"])).toBe("git-ls-files");
    expect(startKey("git", "ls-files")).toBe("git");
    expect(startKey("git", ["--version"])).toBe("git");
    expect(startKey("node", ["-e", "1"])).toBe("node");
    const counts = new Map([["git", 2], ["git-commit", 3], ["gh", 4], ["github", 1]]);
    expect(startsIn(counts, "git")).toBe(5);
    expect(startsIn(counts, "gh")).toBe(4);
  });

  it("counts the starts of the named imports of node:child_process, one time for each start", () => {
    const counts = countProcessStarts();
    expect(countProcessStarts()).toBe(counts);
    const before = startsOf("node");
    spawnSync(process.execPath, ["-e", "0"]);
    execFileSync(process.execPath, ["-e", "0"]);
    expect(startsOf("node") - before).toBe(2);
  });

  it("reports the files with the most starts first, and a line of the sums", () => {
    const lines = startsReport([
      { file: "src/a.test.ts", counts: { git: 3 } },
      { file: "src/b.test.ts", counts: { git: 10, node: 2 } },
      { file: "src/c.test.ts", counts: {} },
    ]);
    expect(lines).toEqual([
      "process-starts 12 src/b.test.ts git=10 node=2",
      "process-starts 3 src/a.test.ts git=3",
      "process-starts 0 src/c.test.ts ",
      "process-starts 15 (all 3 files) git=13 node=2",
    ]);
  });
});

describe("the start budgets", () => {
  const budgets = parseStartBudgets(JSON.stringify({ default: 2, files: { "src/a.test.ts": 4 } }), "starts.json");

  it("holds a file under its own budget, and each other file under the default", () => {
    expect(startBudgetBreak("src/a.test.ts", new Map([["git-add", 2], ["git-commit", 2]]), budgets)).toBeUndefined();
    expect(startBudgetBreak("src/a.test.ts", new Map([["git-add", 5], ["node", 9]]), budgets, { source: "starts.json" })).toBe(
      "src/a.test.ts started git 5 times, over its budget of 4 in starts.json.",
    );
    expect(startBudgetBreak("src/b.test.ts", new Map([["git", 2], ["node", 9]]), budgets)).toBeUndefined();
    expect(startBudgetBreak("src/b.test.ts", new Map([["git", 3]]), budgets, { advice: "Share the fixtures." })).toBe(
      "src/b.test.ts started git 3 times, over its budget of 2 in the budget file. Share the fixtures.",
    );
  });

  it("counts the command of the options", () => {
    expect(startBudgetBreak("src/b.test.ts", new Map([["git", 9], ["pnpm", 2]]), budgets, { command: "pnpm" })).toBeUndefined();
    expect(startBudgetBreak("src/b.test.ts", new Map([["pnpm", 3]]), budgets, { command: "pnpm" })).toMatch(/started pnpm 3 times/);
  });

  it("refuses a budget that is not a count, and names the file", () => {
    expect(() => parseStartBudgets("[]", "starts.json")).toThrow("starts.json: the text is not an object");
    expect(() => parseStartBudgets(JSON.stringify({ default: -1, files: {} }))).toThrow("default is not a count");
    expect(() => parseStartBudgets(JSON.stringify({ default: 1 }))).toThrow("files is not an object");
    expect(() => parseStartBudgets(JSON.stringify({ default: 1, files: { "src/a.test.ts": 1.5 } }))).toThrow("the budget of src/a.test.ts");
  });
});
