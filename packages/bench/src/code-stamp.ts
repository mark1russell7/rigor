/**
 * The stamp of the code of a run, for Node only. A run keeps a saved record when the stamp of the record equals the stamp of the run.
 * A version number is a poor stamp. A release that changes no result throws away each record. A change that has no release keeps wrong records.
 * This entry hashes what can change a result. These are the code that the entries reach after a tree shake and the lock closure of the engines.
 * The stated data files, the bundler version and the Node major are also in the hash.
 * The computer is no part of the stamp. Each record keeps it as a field.
 * The bundler is the optional peer `esbuild`, so a caller that only reads verdicts installs no native binary.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { hasWord } from "./read-words.ts";

/** The engines of a run, which stay outside the bundle. The lock file gives what each engine pulls in. */
export interface CodeStampEngines {
  /** The package names. A subpath of a name also stays outside the bundle. */
  readonly names: readonly string[];
  /** The path of the `pnpm-lock.yaml`, from `cwd`. */
  readonly lockFile: string;
  /** The key of the package in `importers` of the lock file, for example `packages/joint`. */
  readonly importer: string;
}

/** The inputs of `codeStamp`. Each relative path starts at `cwd`. */
export interface CodeStampOptions {
  readonly cwd: string;
  /** The source files that a run starts from. Each export of these files stays in the bundle, so a new export of an entry moves the stamp. */
  readonly entries: readonly string[];
  readonly engines?: CodeStampEngines;
  /**
   * The files that the code reads when it runs, for example a corpus or a table. A bundle cannot see them, so each has its own hash.
   * The hash of a text file reads each line end as LF, so a checkout with CRLF gives the same stamp. A file with a NUL byte hashes as its bytes.
   */
  readonly dataFiles?: readonly string[];
  /** The words of `CODE_STAMP_READ_WORDS` that the caller expects in the bundle. A difference in either direction refuses the stamp. */
  readonly reads?: readonly string[];
  /** The Node major of the stamp. The default is the major of this process. */
  readonly node?: string;
}

/** One engine of a stamp: the version in the lock file, and each package of its closure with its peers. */
export interface EngineClosure {
  readonly name: string;
  readonly version: string;
  readonly closure: readonly string[];
}

/** The hash of each part of a stamp, so that a change of the stamp names its cause. */
export interface CodeStampParts {
  readonly code: string;
  readonly engines: string;
  readonly data: string;
  /** The name and the version of the bundler, for example `esbuild@0.28.2`. */
  readonly bundler: string;
  readonly node: string;
}

/** The result of `codeStamp`. Only `hash` and `parts` are the stamp. The other fields tell what went in. */
export interface CodeStamp {
  readonly hash: string;
  readonly parts: CodeStampParts;
  /** The source files that put at least one byte in the bundle, with paths from `cwd`. */
  readonly inputs: readonly string[];
  /** The words of `CODE_STAMP_READ_WORDS` in the bundle. */
  readonly reads: readonly string[];
  readonly engines: readonly EngineClosure[];
}

/** The words in a bundle that show an input from outside the bundle. A word inside a text also counts, so the scan can only say too much. */
export const CODE_STAMP_READ_WORDS: readonly string[] = [
  "readFile",
  "readFileSync",
  "createReadStream",
  "readdir",
  "readdirSync",
  "opendir",
  "fetch",
  "WebAssembly",
  "require",
  "process.env",
  "import.meta.url",
  "import(",
];

const sha256 = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");

/** A lock document, read to the three maps that a closure needs. */
interface LockDocument {
  /** The key of each importer, then the name and the version of each of its packages. */
  readonly importers: Map<string, Map<string, string>>;
  /** The resolution line of each package, with no peers in the key. */
  readonly packages: Map<string, string>;
  /** The key of each snapshot, with the keys of its dependencies. */
  readonly snapshots: Map<string, string[]>;
}

const unquote = (text: string): string => text.trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");

/** The first colon outside quotes ends a key. For example, the key `'@a/b@1.0.0'` holds no colon outside its quotes. */
function splitKey(line: string): readonly [string, string] {
  const body = line.trim();
  if (body.startsWith("'") || body.startsWith('"')) {
    const end = body.indexOf(body[0]!, 1);
    return [body.slice(1, end), body.slice(end + 1).replace(/^:/, "").trim()];
  }
  const colon = body.indexOf(":");
  return colon < 0 ? [body, ""] : [body.slice(0, colon), body.slice(colon + 1).trim()];
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** A value in `dependencies` of a snapshot is a version with peers, or a whole key when the name is an alias. */
function keyOfDependency(name: string, value: string): string {
  return /^[^\d(].*@\d/.test(value) ? value : `${name}@${value}`;
}

/** This function reads one document of a pnpm lock file. It reads only lines that the closure needs. */
function readLockDocument(lines: readonly string[]): LockDocument {
  const doc: LockDocument = { importers: new Map(), packages: new Map(), snapshots: new Map() };
  let section = "";
  let top = "";
  let group = "";
  let name = "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    const [key, value] = splitKey(line);
    if (indent === 0) {
      section = key;
      continue;
    }
    if (indent === 2) {
      top = key;
      group = "";
      if (section === "importers") doc.importers.set(top, new Map());
      if (section === "snapshots") doc.snapshots.set(top, []);
      continue;
    }
    if (section === "packages" && indent === 4 && key === "resolution") doc.packages.set(top, value);
    if (section === "snapshots") {
      if (indent === 4) group = key;
      else if (indent === 6 && (group === "dependencies" || group === "optionalDependencies")) doc.snapshots.get(top)!.push(keyOfDependency(key, unquote(value)));
    }
    if (section === "importers") {
      if (indent === 4) group = key;
      else if (indent === 6) name = key;
      else if (indent === 8 && key === "version") doc.importers.get(top)!.set(name, unquote(value));
    }
  }
  return doc;
}

const withoutPeers = (key: string): string => key.replace(/\(.*$/, "");

/**
 * This function gives the closure of each engine from the text of a pnpm lock file of version 9, in the order of `names`.
 * A closure holds each package that the engine pulls in, with its peers, in sorted order.
 * It refuses another lock version, an unknown importer or name, and a workspace package, which belongs in the bundle.
 */
export function lockClosure(lockText: string, importer: string, names: readonly string[]): readonly EngineClosure[] {
  const documents = lockText.split(/\r?\n---\r?\n|^---\r?\n/).filter((text) => text.includes("importers:"));
  const lines = (documents.at(-1) ?? "").split(/\r?\n/);
  const version = lines.find((line) => line.startsWith("lockfileVersion:"));
  if (version === undefined || !/^9\./.test(unquote(version.slice("lockfileVersion:".length)))) throw new Error(`The lock file has the version line ${version ?? "(none)"}. This reader knows only lock version 9.`);
  const doc = readLockDocument(lines);
  const packages = doc.importers.get(importer);
  if (packages === undefined) throw new Error(`The lock file has no importer ${importer}.`);
  return names.map((name) => {
    const resolved = packages.get(name);
    if (resolved === undefined) throw new Error(`The importer ${importer} has no package ${name} in the lock file.`);
    if (resolved.startsWith("link:")) throw new Error(`The engine ${name} is a workspace package (${resolved}). It has no lock closure, so leave it out of the engines and let it enter the bundle.`);
    const start = keyOfDependency(name, resolved);
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const key = stack.pop()!;
      if (seen.has(key)) continue;
      const dependencies = doc.snapshots.get(key);
      if (dependencies === undefined) throw new Error(`The lock file has no snapshot ${key}, which ${name} pulls in.`);
      seen.add(key);
      stack.push(...dependencies);
    }
    const closure = [...seen].sort().map((key) => `${key} ${doc.packages.get(withoutPeers(key)) ?? ""}`);
    return { name, version: withoutPeers(resolved), closure };
  });
}

/** The part of a bundler that this entry uses. */
interface Bundler {
  readonly version: string;
  build(options: Record<string, unknown>): Promise<{
    readonly outputFiles?: readonly { readonly text: string }[];
    readonly metafile?: { readonly outputs: Record<string, { readonly inputs: Record<string, { readonly bytesInOutput: number }> }> };
  }>;
}

async function loadBundler(): Promise<Bundler> {
  try {
    return (await import("esbuild")) as unknown as Bundler;
  } catch (cause) {
    throw new Error("The function codeStamp uses the optional peer esbuild. Add esbuild to the dependencies of the caller, so that its lock file pins the version.", { cause });
  }
}

const forwardSlashes = (path: string): string => path.split("\\").join("/");

const fromCwd = (cwd: string, path: string): string => forwardSlashes(relative(cwd, resolve(cwd, forwardSlashes(path))));

/** This function gives the bytes that a data file hashes as. Git uses the same test for a binary file: a NUL byte. */
function dataBytes(bytes: Buffer): Buffer {
  return bytes.includes(0) ? bytes : Buffer.from(bytes.toString("latin1").replaceAll("\r\n", "\n"), "latin1");
}

/**
 * This function gives the stamp of the code of a run. Only the options, the source files and the data files decide it, so another folder gives the same stamp.
 * A change in comments, blank space, line ends or types alone keeps the stamp. A new export that the entries do not reach also keeps it.
 * A change in a token that the entries reach moves `parts.code`. Identifiers stay as they are, so a rename also moves it. This gives a false rerun, not a false keep.
 * A bundle cannot see a file that the code reads when it runs. So a word of `CODE_STAMP_READ_WORDS` that `reads` does not state refuses the stamp, and `dataFiles` lists the files.
 */
export async function codeStamp(options: CodeStampOptions): Promise<CodeStamp> {
  const cwd = resolve(options.cwd);
  const entries = [...new Set(options.entries.map((entry) => fromCwd(cwd, entry)))].sort();
  if (entries.length === 0) throw new Error("A code stamp needs at least one entry.");
  const outside = entries.find((entry) => entry.startsWith("..") || isAbsolute(entry));
  if (outside !== undefined) throw new Error(`The entry ${outside} is outside ${cwd}. Another folder would give another stamp.`);
  const bundler = await loadBundler();
  const result = await bundler.build({
    stdin: { contents: entries.map((entry, i) => `export * as e${i} from "./${entry}";`).join("\n"), resolveDir: cwd, loader: "ts" },
    absWorkingDir: cwd,
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    outfile: "stamp.js",
    treeShaking: true,
    minifyWhitespace: true,
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
    // The tsconfig file of a package is not an input: another compiler option in that file does not move the stamp.
    tsconfigRaw: {},
    external: [...(options.engines?.names ?? [])],
  });
  const text = (result.outputFiles ?? []).map((file) => file.text).join("\n");
  const reads = CODE_STAMP_READ_WORDS.filter((word) => hasWord(text, word));
  const stated = [...new Set(options.reads ?? [])];
  const notStated = reads.filter((word) => !stated.includes(word));
  const notFound = stated.filter((word) => !reads.includes(word));
  if (notStated.length > 0 || notFound.length > 0) {
    throw new Error(
      `The reads of the bundle differ from the option reads. In the bundle and not stated: ${notStated.join(", ") || "(none)"}. Stated and not in the bundle: ${notFound.join(", ") || "(none)"}. List each file that such a read opens in dataFiles.`,
    );
  }
  const inputs = new Set<string>();
  for (const output of Object.values(result.metafile?.outputs ?? {})) {
    for (const [input, facts] of Object.entries(output.inputs)) if (facts.bytesInOutput > 0 && input !== "<stdin>") inputs.add(forwardSlashes(input));
  }
  const engines = options.engines === undefined ? [] : lockClosure(readFileSync(resolve(cwd, options.engines.lockFile), "utf8"), options.engines.importer, options.engines.names);
  const data = [...new Set((options.dataFiles ?? []).map((file) => fromCwd(cwd, file)))].sort().map((file) => `${file} ${sha256(dataBytes(readFileSync(resolve(cwd, file))))}`);
  const parts: CodeStampParts = {
    code: sha256(text),
    engines: sha256(JSON.stringify(engines)),
    data: sha256(JSON.stringify(data)),
    bundler: `esbuild@${bundler.version}`,
    node: options.node ?? process.versions.node.split(".")[0]!,
  };
  return { hash: sha256(JSON.stringify(parts)), parts, inputs: [...inputs].sort(), reads, engines };
}
