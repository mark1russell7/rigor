/**
 * The load check. Stryker copies the folder of a package to `<dir>/.stryker-tmp/sandbox-*` and starts the tests there.
 * A relative path that leaves the folder then finds no file. A test file that does not load gives no failed test, so
 * each mutant that it detects survives with no error (V-072 of Vex). This check finds these paths before Stryker. It
 * reads only the files that the run loads, so a script of the folder that no test loads can leave the folder.
 */
import { posix } from "node:path";

/** A relative path in a file of a package that leaves the folder of the package. */
export interface LeavingPath {
  /** The file, from the folder of the package, with `/`. */
  readonly file: string;
  /** The line of the path, from 1. */
  readonly line: number;
  /** The path as the file writes it. */
  readonly path: string;
}

/** A file of a package and its text. */
export interface PackageFile {
  /** The file, from the folder of the package, with `/`. */
  readonly file: string;
  readonly text: string;
}

// The paths that a module loads: import and export from, import(), require(), vi.mock() and the other vi functions,
// and new URL(path, import.meta.url).
const LOADED = /(?:\bfrom|\bimport|\brequire|\bvi\.\w+|\bnew\s+URL)\s*\(?\s*(["'`])([^"'`\r\n]*)\1/g;
// Each relative path string of a config file, for example setupFiles: ["../testkit/setup.ts"].
const CONFIG_PATH = /(["'`])(\.\.?\/[^"'`\r\n]*)\1/g;
// A type import or export: the test runner removes it, so it loads no file.
const TYPE_ONLY = /^\s*(?:import|export)\s+type\b/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;
const CONFIG_FILE = /(?:^|\/)vite(?:st)?\.(?:config|workspace)\.[cm]?[jt]s$/;

/**
 * This function tells if a file is a config file of Vitest or Vite. Each relative path string of a config file must
 * stay in the folder.
 *
 * @param vitestConfig - the field `vitestConfig` of the lane, from the folder of the package
 */
export function isConfigFile(file: string, vitestConfig?: string): boolean {
  return CONFIG_FILE.test(file) || (vitestConfig !== undefined && posix.normalize(vitestConfig.replaceAll("\\", "/")) === file);
}

function leaves(file: string, path: string): boolean {
  if (!(path === "." || path === ".." || path.startsWith("./") || path.startsWith("../")) || path.includes("${")) return false;
  const target = posix.normalize(posix.join(posix.dirname(file), path));
  return target === ".." || target.startsWith("../");
}

const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"];

/** This function gives each relative path of one file, with its line. It does not read comments and type imports. */
function pathsOf(file: string, text: string, vitestConfig: string | undefined): { line: number; path: string }[] {
  const pattern = isConfigFile(file, vitestConfig) ? CONFIG_PATH : LOADED;
  return text.split("\n").flatMap((lineText, i) => {
    if (COMMENT.test(lineText) || TYPE_ONLY.test(lineText)) return [];
    return [...lineText.matchAll(pattern)].map((m) => ({ line: i + 1, path: m[2] ?? "" })).filter((p) => p.path.startsWith("."));
  });
}

/** This function gives the file of the package that a relative path in the folder loads, or undefined. */
function target(file: string, path: string, known: ReadonlySet<string>): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(file), path));
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "");
  return [...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.slice(1).map((e) => stem + e)].find((f) => known.has(f));
}

/**
 * This function gives each relative path of the files that leaves the folder of the package. It reads the files that
 * the run loads. These are the test files, the config files, and each file that they load in the folder.
 * In a config file it reads each relative path string, for example a setup file. It does not read comments and type
 * imports.
 *
 * @param files - the files of the package, from its folder
 * @param vitestConfig - the field `vitestConfig` of the lane
 */
export function leavingPaths(files: readonly PackageFile[], vitestConfig?: string): LeavingPath[] {
  const texts = new Map(files.map((f) => [f.file, f.text]));
  const known = new Set(texts.keys());
  const queue = files.map((f) => f.file).filter((f) => TEST.test(f) || isConfigFile(f, vitestConfig));
  const loaded = new Set(queue);
  const found: LeavingPath[] = [];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const { line, path } of pathsOf(next, texts.get(next) ?? "", vitestConfig)) {
      if (leaves(next, path)) found.push({ file: next, line, path });
      else {
        const t = target(next, path, known);
        if (t !== undefined && !loaded.has(t)) {
          loaded.add(t);
          queue.push(t);
        }
      }
    }
  }
  return found.toSorted((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}
