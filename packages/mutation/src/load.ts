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
// The optional "(" and its spaces are one group, so that each space has one match (no slow backtracking).
const LOADED = /(?:\bfrom|\bimport|\brequire|\bvi\.\w+|\bnew\s+URL)\s*(?:\(\s*)?(["'`])([^"'`\r\n]*)\1/g;
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
  return loadWalk(files, vitestConfig).leaving.toSorted(byPlace);
}

/** This function orders places by file, then by line. */
function byPlace(a: { readonly file: string; readonly line: number }, b: { readonly file: string; readonly line: number }): number {
  if (a.file === b.file) return a.line - b.line;
  return a.file < b.file ? -1 : 1;
}

/** This function walks the files that the run loads, from the test files and the config files. It gives them and the paths that leave the folder. */
function loadWalk(files: readonly PackageFile[], vitestConfig: string | undefined): { readonly loaded: ReadonlySet<string>; readonly leaving: LeavingPath[] } {
  const texts = new Map(files.map((f) => [f.file, f.text]));
  const known = new Set(texts.keys());
  const queue = files.map((f) => f.file).filter((f) => TEST.test(f) || isConfigFile(f, vitestConfig));
  const loaded = new Set(queue);
  const leaving: LeavingPath[] = [];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const { line, path } of pathsOf(next, texts.get(next) ?? "", vitestConfig)) {
      if (leaves(next, path)) leaving.push({ file: next, line, path });
      else {
        const t = target(next, path, known);
        if (t !== undefined && !loaded.has(t)) {
          loaded.add(t);
          queue.push(t);
        }
      }
    }
  }
  return { loaded, leaving };
}

// A dynamic import whose path is not one string: a name, a call, or a template with an expression.
const COMPUTED_IMPORT = /\bimport\s*\(\s*(?!(["'])[^"'`\r\n]*\1|`[^`$\r\n]*`)/;

/** A dynamic import with a computed path in a file that the run loads. */
export interface ComputedImport {
  /** The file, from the folder of the package, with `/`. */
  readonly file: string;
  /** The line of the import, from 1. */
  readonly line: number;
}

/**
 * This function gives each dynamic import with a computed path in the files that the run loads. The related walk of
 * Vitest does not follow this type of import. So no selection starts a test file that reaches the mutated files only through
 * it, and each mutant of these files survives. The function does not read comments and config files.
 *
 * @param files - the files of the package, from its folder
 * @param vitestConfig - the field `vitestConfig` of the lane
 */
export function computedImports(files: readonly PackageFile[], vitestConfig?: string): ComputedImport[] {
  const { loaded } = loadWalk(files, vitestConfig);
  return files
    .filter((f) => loaded.has(f.file) && !isConfigFile(f.file, vitestConfig))
    .flatMap((f) => f.text.split("\n").flatMap((lineText, i) => (COMMENT.test(lineText) || !COMPUTED_IMPORT.test(lineText) ? [] : [{ file: f.file, line: i + 1 }])))
    .toSorted(byPlace);
}

// A type import or export to its semicolon, also on more than one line. The test runner removes it.
const TYPE_STATEMENT = /^[ \t]*(?:import|export)[ \t]+type\b[^;]*;/gm;

/** This function replaces each type import and export with its line ends, so the lines of the other paths stay. */
function withoutTypeStatements(text: string): string {
  return text.replace(TYPE_STATEMENT, (statement) => statement.replace(/[^\n]/g, ""));
}

/**
 * This function gives the test files that the related mode of the Vitest runner starts for a selection. A test file
 * is related when it loads a file of the selection, directly or through other files of the package. The function
 * does not read comments and type imports. The order is the order of `files`.
 *
 * @param files - the files of the package, from its folder
 * @param selected - the function that tells if a file is a file of the selection
 */
export function relatedTestFiles(files: readonly PackageFile[], selected: (file: string) => boolean): string[] {
  const texts = new Map(files.map((f) => [f.file, withoutTypeStatements(f.text)]));
  const known = new Set(texts.keys());
  const loads = (file: string): string[] =>
    pathsOf(file, texts.get(file) ?? "", undefined).flatMap(({ path }) => {
      const t = target(file, path, known);
      return t === undefined ? [] : [t];
    });
  const reaches = (test: string): boolean => {
    const queue = [test];
    const loaded = new Set(queue);
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      for (const t of loads(next)) {
        if (!TEST.test(t) && selected(t)) return true;
        if (!loaded.has(t)) {
          loaded.add(t);
          queue.push(t);
        }
      }
    }
    return false;
  };
  return files.map((f) => f.file).filter((f) => TEST.test(f) && reaches(f));
}

/** A test file as the collect of Vitest gives it (`load-check --collect`). */
export interface CollectedFile {
  /** The file, with `/`. */
  readonly file: string;
  /** The messages of the errors of the file. A file that does not load has one or more. */
  readonly errors: readonly string[];
  /** The number of tests and suites at the top of the file. */
  readonly children: number;
}

/** The collect of Vitest in the folder of a package. */
export interface Collected {
  /** The version of Vitest that the folder of the package resolves. */
  readonly version: string;
  /** The real path of the entry `vitest/node` that the folder resolves. */
  readonly path: string;
  readonly files: readonly CollectedFile[];
  /** The messages of the errors outside a test file. */
  readonly unhandled: readonly string[];
  /** The test files that the related mode of Vitest starts for each selection, by the name of the selection. */
  readonly selections: Readonly<Record<string, readonly string[]>>;
}

/** The request of the collect script: the folder, the config, and the mutated files of each selection. */
export interface CollectRequest {
  /** The folder where Vitest collects: the copy of the folder of the package. */
  readonly dir: string;
  /** The config of Vitest, from `dir`. */
  readonly config?: string;
  /** The mutated files of each selection, from `dir`, by the name of the selection. */
  readonly selections: Readonly<Record<string, readonly string[]>>;
}

/**
 * This function gives the reason of each fault of a collect. A test file that does not load gives no failed test, so
 * each mutant that it detects survives (V-090 of Vex). A test file with no test detects no mutant. An error outside a
 * test file and a package with no test file are faults too.
 */
export function collectFaults(collected: Collected): string[] {
  const faults = collected.files.flatMap((f) => {
    if (f.errors.length > 0) return [`${f.file}: the file does not load: ${f.errors.join(" ")}`];
    return f.children === 0 ? [`${f.file}: the file holds no test`] : [];
  });
  faults.push(...collected.unhandled.map((e) => `an error outside a test file: ${e}`));
  if (collected.files.length === 0) faults.push("Vitest finds no test file");
  return faults;
}
