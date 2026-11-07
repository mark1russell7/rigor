/**
 * The examples of Markdown files as test cases. Each fenced code block of a selected language is
 * one case. A case runs its block as a module, so a doc cannot drift from the code that it shows.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The options of `markdownExamples`. */
export interface MarkdownExampleOptions {
  /**
   * The map from an import specifier to a source file. A block that imports `"pkg"` or
   * `"pkg/sub"` gets the file of that key. A relative path starts at `root`.
   */
  readonly imports?: Readonly<Record<string, string>> | undefined;
  /** The languages of the blocks to run, from the first word of the fence. The default is `["ts"]`. */
  readonly lang?: readonly string[] | undefined;
  /** The folder that the names of the cases and the relative paths start at. The default is the current folder. */
  readonly root?: string | undefined;
  /**
   * The folder for the module files of the blocks. A block resolves the packages that it does not
   * map from this folder. The default is `.cache/rigor-testkit` under `root`. Node does not strip
   * the types of a file under `node_modules`, so a TypeScript block in a folder there fails under
   * `node:test`.
   */
  readonly cacheDir?: string | undefined;
}

/** One block of a Markdown file, as a test case. */
export interface MarkdownExample {
  /** The name of the case: the path of the file from `root`, a colon and the line of the opening fence. */
  readonly name: string;
  /** The absolute path of the Markdown file. */
  readonly file: string;
  /** The line of the opening fence, from 1. */
  readonly line: number;
  /** The language of the block. */
  readonly lang: string;
  /** The code of the block, with the import specifiers as the file has them. */
  readonly code: string;
  /**
   * This function runs the block as a module. When the block throws, the promise rejects with an
   * `Error` whose message starts with `name`. The original error is its `cause`.
   */
  readonly run: () => Promise<void>;
}

/** A fenced code block of a Markdown text. */
export interface FencedBlock {
  /** The first word of the info string, in lower case. It is empty when the fence has no info string. */
  readonly lang: string;
  /** The words of the info string after the first word. */
  readonly flags: readonly string[];
  /** The line of the opening fence, from 1. */
  readonly line: number;
  /** The code of the block. */
  readonly code: string;
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * This function gives each fenced code block of a Markdown text, in the order of the text. A block
 * with no closing fence goes to the end of the text, as in CommonMark. This function removes the
 * indent of the opening fence from each line of the block.
 */
export function fencedBlocks(text: string): FencedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: FencedBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]!);
    if (open === null) continue;
    const indent = open[1]!.length;
    const fence = open[2]!;
    const info = open[3]!.trim();
    // A backtick fence cannot have a backtick in its info string (CommonMark 4.5)
    if (fence[0] === "`" && info.includes("`")) continue;
    const words = info.split(/\s+/).filter((word) => word.length > 0);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[j]!);
      if (close !== null && close[1]![0] === fence[0] && close[1]!.length >= fence.length) break;
      body.push(lines[j]!.replace(new RegExp(`^ {0,${indent}}`), ""));
    }
    blocks.push({ lang: (words[0] ?? "").toLowerCase(), flags: words.slice(1), line: i + 1, code: body.join("\n") });
    i = j;
  }
  return blocks;
}

const EXTENSION: Readonly<Record<string, string>> = {
  ts: ".ts",
  typescript: ".ts",
  mts: ".mts",
  tsx: ".tsx",
  js: ".js",
  javascript: ".js",
  mjs: ".mjs",
  jsx: ".jsx",
};

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g;

/**
 * This function changes each import specifier of `code` that `imports` maps to the file URL of its
 * source file. It keeps each other specifier as it is.
 */
export function mapImports(code: string, imports: Readonly<Record<string, string>>, root: string): string {
  return code.replace(SPECIFIER, (whole, head: string, quote: string, specifier: string) => {
    const target = imports[specifier];
    if (target === undefined) return whole;
    const path = isAbsolute(target) ? target : resolve(root, target);
    return `${head}${quote}${pathToFileURL(path).href}${quote}`;
  });
}

let runs = 0;

/**
 * This function gives one test case for each fenced block of the selected languages in the files.
 * A block with the flag `no-run` after its language, for example `ts no-run`, gives no case.
 *
 * @param files - The Markdown files. A relative path starts at `root`.
 * @param options - The map of the imports, the languages, the root and the cache folder.
 * @returns The cases, in the order of the files and of the blocks in each file.
 */
export function markdownExamples(files: readonly string[], options: MarkdownExampleOptions = {}): MarkdownExample[] {
  const root = resolve(options.root ?? process.cwd());
  const langs = new Set((options.lang ?? ["ts"]).map((lang) => lang.toLowerCase()));
  for (const lang of langs) {
    if (EXTENSION[lang] === undefined) throw new RangeError(`markdownExamples: the language ${lang} is not one of ${Object.keys(EXTENSION).join(", ")}`);
  }
  const imports = options.imports ?? {};
  const cacheDir = resolve(root, options.cacheDir ?? ".cache/rigor-testkit");
  const cases: MarkdownExample[] = [];
  for (const given of files) {
    const file = resolve(root, given);
    const shown = relative(root, file).split("\\").join("/");
    for (const block of fencedBlocks(readFileSync(file, "utf8"))) {
      if (!langs.has(block.lang) || block.flags.includes("no-run")) continue;
      const name = `${shown}:${block.line}`;
      const source = mapImports(block.code, imports, root);
      const extension = EXTENSION[block.lang]!;
      cases.push({
        name,
        file,
        line: block.line,
        lang: block.lang,
        code: block.code,
        run: async () => {
          // A folder that this function makes gets a .gitignore, so its files stay out of git
          if (mkdirSync(cacheDir, { recursive: true }) !== undefined) writeFileSync(resolve(cacheDir, ".gitignore"), "*\n");
          // A new file for each run: a module loader keeps a module of the same path, and then the block does not run again
          runs += 1;
          const module = resolve(cacheDir, `${shown.replace(/[^\w.-]+/g, "_")}-${block.line}-${process.pid}-${runs}${extension}`);
          writeFileSync(module, source);
          try {
            await import(pathToFileURL(module).href);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${name}: ${message}`, { cause: error });
          } finally {
            rmSync(module, { force: true });
          }
        },
      });
    }
  }
  return cases;
}
