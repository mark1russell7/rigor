/**
 * The copy of `load-check --collect`. Stryker copies the files of a package to its sandbox, and it leaves out each file
 * of its ignore rules. This copy takes the same files. So a test file loads in the copy only if it loads in Stryker.
 * The walk is a port of `resolveInputFileNames` of `project-reader.js` in `@stryker-mutator/core` 10.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The rules that Stryker 10 applies to each project (`ALWAYS_IGNORE` of `project-reader.js`). */
const ALWAYS_IGNORE: readonly string[] = ["node_modules", ".git", "*.tsbuildinfo", "/stryker.log", ".next", ".nuxt", ".svelte-kit"];

/** A rule of `minimatch`, as Stryker makes it. */
interface Rule {
  readonly negate: boolean;
  match(path: string, partial?: boolean): boolean;
}

/** The class `Minimatch` of `minimatch`. */
type MinimatchClass = new (pattern: string, options: { dot: boolean; flipNegate: boolean; nocase: boolean }) => Rule;

const text = (value: unknown, otherwise: string): string => (typeof value === "string" ? value : otherwise);
const fileName = (reporter: unknown): string | undefined => {
  if (typeof reporter !== "object" || reporter === null) return undefined;
  const name: unknown = (reporter as { fileName?: unknown }).fileName;
  return typeof name === "string" ? name : undefined;
};

/**
 * This function gives the ignore rules of Stryker for a Stryker config, in the order of Stryker. The defaults of
 * `tempDirName`, `incrementalFile` and the reporters are the defaults of Stryker 10.
 *
 * @param config - the Stryker config of a selection, from `strykerConfig`
 */
export function ignoreRules(config: Readonly<Record<string, unknown>>): string[] {
  const patterns = config["ignorePatterns"];
  return [
    ...ALWAYS_IGNORE,
    tempDirOf(config),
    text(config["incrementalFile"], "reports/stryker-incremental.json"),
    fileName(config["htmlReporter"]) ?? "reports/mutation/mutation.html",
    fileName(config["jsonReporter"]) ?? "reports/mutation/mutation.json",
    ...(Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === "string") : []),
  ];
}

/** This function gives the folder of the sandboxes of Stryker for a Stryker config. */
export function tempDirOf(config: Readonly<Record<string, unknown>>): string {
  return text(config["tempDirName"], ".stryker-tmp");
}

/**
 * This function gives the `Minimatch` of the Stryker that the folder `dir` resolves. Each folder uses its own Stryker,
 * so the rules match as in its run. It gives a reason when the folder resolves no Stryker.
 */
export function minimatchOf(dir: string): MinimatchClass | string {
  try {
    const core = createRequire(join(dir, "package.json")).resolve("@stryker-mutator/core/package.json");
    return (createRequire(core)("minimatch") as { Minimatch: MinimatchClass }).Minimatch;
  } catch (e) {
    return `the folder resolves no @stryker-mutator/core, so the check cannot apply the ignore rules of Stryker: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * This function gives each file of the folder `root` that Stryker copies to its sandbox, from `root`, with `/`. A rule
 * with `!` takes a file back. Stryker does not go into a folder that a rule leaves out.
 *
 * @param rules - the ignore rules, from `ignoreRules`
 */
export function sandboxFiles(root: string, rules: readonly string[], Minimatch: MinimatchClass): string[] {
  const matchers = rules.map((pattern) => new Minimatch(pattern, { dot: true, flipNegate: true, nocase: true }));
  const matchesFile = (name: string, path: string, rule: Rule): boolean => rule.match(name) || rule.match(path) || rule.match(`/${path}`);
  const matchesDirectory = (name: string, path: string, rule: Rule): boolean =>
    matchesFile(name, path, rule) || rule.match(`/${path}/`) || rule.match(`${path}/`) || (rule.negate && (rule.match(`/${path}`, true) || rule.match(path, true)));
  const files: string[] = [];
  const crawl = (relativeDir: string): void => {
    for (const entry of readdirSync(join(root, relativeDir), { withFileTypes: true })) {
      const path = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      let included = true;
      for (const rule of matchers) {
        if (rule.negate === included) continue;
        const match = entry.isDirectory() ? matchesDirectory(entry.name, path, rule) : matchesFile(entry.name, path, rule);
        if (match) included = rule.negate;
      }
      if (!included) continue;
      if (entry.isDirectory()) crawl(path);
      else files.push(path);
    }
  };
  crawl("");
  return files.toSorted();
}

/**
 * This function copies the files of `sandboxFiles` to a new folder in `<dir>/<tempDir>`, as Stryker makes its sandbox.
 * It links the `node_modules` of the folder. On an error it removes the part of the copy that it made.
 */
export function copyOfFolder(dir: string, files: readonly string[], tempDir: string): string {
  const base = join(dir, tempDir);
  mkdirSync(base, { recursive: true });
  const copy = mkdtempSync(join(base, "load-check-"));
  try {
    for (const file of files) {
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      copyFileSync(join(dir, file), join(copy, file));
    }
    if (existsSync(join(dir, "node_modules"))) symlinkSync(join(dir, "node_modules"), join(copy, "node_modules"), "junction");
    return copy;
  } catch (e) {
    removeCopy(copy);
    throw e;
  }
}

/** This function removes a copy of `copyOfFolder`, and its folder of sandboxes when nothing else is in it. */
export function removeCopy(copy: string): void {
  rmSync(copy, { recursive: true, force: true });
  const base = dirname(copy);
  if (existsSync(base) && readdirSync(base).length === 0) rmSync(base, { recursive: true, force: true });
}
