import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyOfFolder, ignoreRules, minimatchOf, removeCopy, sandboxFiles, tempDirOf } from "./sandbox.ts";

const folders: string[] = [];
afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});

/** This function makes a folder with the files, each with a short text. */
function folderWith(files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "rigor-sandbox-"));
  folders.push(dir);
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "x");
  }
  return dir;
}

const Minimatch = minimatchOf(process.cwd());
if (typeof Minimatch === "string") throw new Error(Minimatch);

describe("ignoreRules", () => {
  it("gives the rules of Stryker 10 with the defaults, then the ignorePatterns of the config", () => {
    expect(ignoreRules({})).toEqual([
      "node_modules",
      ".git",
      "*.tsbuildinfo",
      "/stryker.log",
      ".next",
      ".nuxt",
      ".svelte-kit",
      ".stryker-tmp",
      "reports/stryker-incremental.json",
      "reports/mutation/mutation.html",
      "reports/mutation/mutation.json",
    ]);
    const config = { tempDirName: "tmp", htmlReporter: { fileName: "r/a.html" }, jsonReporter: { fileName: "r/a.json" }, ignorePatterns: ["/tsconfig.json", 3] };
    expect(ignoreRules(config).slice(-5)).toEqual(["tmp", "reports/stryker-incremental.json", "r/a.html", "r/a.json", "/tsconfig.json"]);
    expect(tempDirOf(config)).toBe("tmp");
  });
});

describe("sandboxFiles", () => {
  it("leaves out the files of the rules, and keeps the other files of a folder with a rule", () => {
    const dir = folderWith([
      "src/a.ts",
      "src/a.test.ts",
      "tsconfig.json",
      "src/tsconfig.json",
      "node_modules/x/index.js",
      ".stryker-tmp/sandbox-1/a.ts",
      "reports/mutation/mutation.json",
      "reports/other.txt",
      "a.tsbuildinfo",
    ]);
    const files = sandboxFiles(dir, ignoreRules({ ignorePatterns: ["/tsconfig.json"] }), Minimatch);
    expect(files).toEqual(["reports/other.txt", "src/a.test.ts", "src/a.ts", "src/tsconfig.json"]);
  });
});

describe("copyOfFolder", () => {
  it("copies the files to a new folder of the sandboxes, and removeCopy removes it", () => {
    const dir = folderWith(["src/a.ts", "tsconfig.json", "node_modules/x/index.js"]);
    const copy = copyOfFolder(dir, ["src/a.ts"], ".stryker-tmp");
    expect(dirname(copy)).toBe(join(dir, ".stryker-tmp"));
    expect(existsSync(join(copy, "src/a.ts"))).toBe(true);
    expect(existsSync(join(copy, "tsconfig.json"))).toBe(false);
    expect(existsSync(join(copy, "node_modules/x/index.js"))).toBe(true);
    removeCopy(copy);
    expect(existsSync(join(dir, ".stryker-tmp"))).toBe(false);
    expect(existsSync(join(dir, "node_modules/x/index.js"))).toBe(true);
  });

  it("removes the part of the copy that it made when a file does not copy", () => {
    const dir = folderWith(["src/a.ts"]);
    expect(() => copyOfFolder(dir, ["src/a.ts", "src/gone.ts"], ".stryker-tmp")).toThrow();
    expect(existsSync(join(dir, ".stryker-tmp"))).toBe(false);
  });
});
