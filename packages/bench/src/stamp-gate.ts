/**
 * The stamp gate of a bench, for Node only. The bench of a pull request runs only when the stamp of its timed code
 * differs at the head and at the merge base. Two commits with the same stamp time the same code, so a second bench gives only noise.
 *
 * A config file (`stamp-config/1`) names the timed code of a bench. It gives the package folder, the entries of each timed child, the reads and the data files.
 * `configStamp` gives the stamp of that code in a checkout, and `stampChanges` compares two stamp records.
 * The bin `rigor-stamp` gives these functions to a workflow step.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { codeStamp, type CodeStamp } from "./code-stamp.ts";

/** The schema of a stamp config file. */
export const STAMP_CONFIG_SCHEMA = "stamp-config/1";
/** The schema of a stamp record. */
export const STAMP_RECORD_SCHEMA = "bench-stamp/1";

/** The timed code of a bench. Each path uses forward slashes. */
export interface StampConfig {
  readonly schema: typeof STAMP_CONFIG_SCHEMA;
  /** The package folder of the bench, from the root of the checkout, for example `packages/joint`. The root is `.`. */
  readonly package: string;
  /** The source files that each timed child runs, from the package folder. */
  readonly entries: readonly string[];
  /** The words of `CODE_STAMP_READ_WORDS` that the timed code holds. The default is no word. */
  readonly reads?: readonly string[];
  /** The files that the timed code reads when it runs, from the package folder. The default is no file. */
  readonly dataFiles?: readonly string[];
  /** The pnpm lock file, from the root of the checkout. The default is `pnpm-lock.yaml`. */
  readonly lockFile?: string;
  /** The key of the package in `importers` of the lock file. The default is the package folder. */
  readonly importer?: string;
}

/**
 * This function reads a stamp config from a parsed JSON value.
 *
 * @throws RangeError when the value is not a config of `stamp-config/1`
 */
export function stampConfig(value: unknown): StampConfig {
  const fail = (what: string): never => {
    throw new RangeError(`stampConfig: ${what}.`);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("the config is not an object");
  const record = value as Record<string, unknown>;
  if (record["schema"] !== STAMP_CONFIG_SCHEMA) fail(`the schema is not ${STAMP_CONFIG_SCHEMA}`);
  const known = new Set(["schema", "package", "entries", "reads", "dataFiles", "lockFile", "importer"]);
  for (const key of Object.keys(record)) if (!known.has(key)) fail(`the field ${key} is not known`);
  const text = (key: string, optional: boolean): void => {
    const field = record[key];
    if (field === undefined && optional) return;
    if (typeof field !== "string" || field === "") fail(`the field ${key} is not a text`);
  };
  const texts = (key: string, optional: boolean): void => {
    const field = record[key];
    if (field === undefined && optional) return;
    if (!Array.isArray(field) || field.some((item) => typeof item !== "string" || item === "")) fail(`the field ${key} is not a list of texts`);
  };
  text("package", false);
  texts("entries", false);
  if ((record["entries"] as unknown[]).length === 0) fail("the field entries is empty");
  texts("reads", true);
  texts("dataFiles", true);
  text("lockFile", true);
  text("importer", true);
  return record as unknown as StampConfig;
}

/** The name of the package of an import specifier, or undefined for a relative path or a `node:` module. */
export function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** The specifiers of the static imports and re-exports of a source text. A match in a comment also counts, so the list can only say too much. */
export function importSpecifiers(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) found.add(specifier);
  }
  return [...found].sort();
}

/** The dependency fields of a package manifest that `enginesOf` reads. */
export interface StampManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * The engines of a stamp: each package of the manifest that a source file of the bundle imports.
 * A package that the manifest has and the timed code does not import stays out, so a change of its lock lines moves no stamp.
 * A workspace package (`workspace:`) enters the bundle, and its code is in the stamp.
 */
export function enginesOf(manifest: StampManifest, sources: readonly string[]): string[] {
  const own = new Map(Object.entries({ ...manifest.devDependencies, ...manifest.dependencies }));
  const imported = new Set(sources.flatMap((text) => importSpecifiers(text).map(packageOf)).filter((name): name is string => name !== undefined));
  return [...imported].filter((name) => own.has(name) && own.get(name)?.startsWith("workspace:") !== true).sort();
}

/**
 * This function gives the stamp of the timed code of a config in the checkout at `root`. The lock file and the installed packages of that checkout decide it.
 * The first pass keeps each package of the manifest outside the bundle, and it gives the source files of the bundle.
 * The second pass keeps only the packages that these files import, with their lock closure.
 */
export async function configStamp(root: string, config: StampConfig): Promise<CodeStamp> {
  const cwd = resolve(root, config.package);
  const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as StampManifest;
  const all = Object.entries({ ...manifest.devDependencies, ...manifest.dependencies })
    .filter(([, range]) => !range.startsWith("workspace:"))
    .map(([name]) => name)
    .sort();
  const lock = { lockFile: resolve(root, config.lockFile ?? "pnpm-lock.yaml"), importer: config.importer ?? config.package };
  const options = { cwd, entries: config.entries, reads: config.reads ?? [], dataFiles: config.dataFiles ?? [] };
  const first = await codeStamp({ ...options, engines: { ...lock, names: all } });
  const sources = first.inputs.map((input) => readFileSync(resolve(cwd, input), "utf8"));
  return codeStamp({ ...options, engines: { ...lock, names: enginesOf(manifest, sources) } });
}

/** The record of a stamp. Only `hash` and `parts` are the stamp. The other fields tell what went in. */
export interface StampRecord {
  readonly schema: typeof STAMP_RECORD_SCHEMA;
  readonly hash: string;
  readonly parts: CodeStamp["parts"];
  readonly inputs: readonly string[];
  /** Each engine as `name@version`. */
  readonly engines: readonly string[];
}

/** This function gives the record of a stamp. */
export function stampRecord(stamp: CodeStamp): StampRecord {
  return { schema: STAMP_RECORD_SCHEMA, hash: stamp.hash, parts: stamp.parts, inputs: stamp.inputs, engines: stamp.engines.map((engine) => `${engine.name}@${engine.version}`) };
}

/**
 * This function gives the parts of the stamp that differ between two records: `code`, `engines`, `data` or `node`.
 * When these parts are the same and the hashes differ, it gives `hash`. The version of the bundler is not in the hash, so it gives no part.
 * A value that is not a stamp record gives `record`, so the caller times again. An empty list means the same timed code.
 */
export function stampChanges(base: unknown, head: unknown): string[] {
  const valid = (record: unknown): record is StampRecord =>
    typeof record === "object" &&
    record !== null &&
    (record as StampRecord).schema === STAMP_RECORD_SCHEMA &&
    typeof (record as StampRecord).hash === "string" &&
    typeof (record as StampRecord).parts === "object" &&
    (record as StampRecord).parts !== null;
  if (!valid(base) || !valid(head)) return ["record"];
  const parts = (["code", "engines", "data", "node"] as const).filter((part) => base.parts[part] !== head.parts[part]);
  return parts.length === 0 && base.hash !== head.hash ? ["hash"] : parts;
}

/** The help text of `rigor-stamp`. */
export const STAMP_HELP: string = `rigor-stamp: the stamp gate of a bench.

  rigor-stamp stamp --config <file> [--root <checkout>] [--out <file>]
  rigor-stamp changed --base <file> --head <file>

  stamp     writes the stamp record of the timed code of the config to the standard output and, with --out, to a file.
            --root is the checkout to stamp. The default is the current folder. The config is read from its own path.
  changed   compares two stamp records. A part that differs, or a record that it cannot read, gives match=true: the bench runs.
            It writes match=true or match=false to the file of the variable GITHUB_OUTPUT, when the variable is set.
  --help    this text.

  The config (stamp-config/1):
    { "schema": "stamp-config/1", "package": "packages/joint", "entries": ["bench/child.ts"],
      "reads": [], "dataFiles": [], "lockFile": "pnpm-lock.yaml", "importer": "packages/joint" }
  "reads", "dataFiles", "lockFile" and "importer" are optional.

  The exit code is 0 for a record and for a comparison. A stamp that fails gives 1. A bad argument or config gives 2.
`;

/** The inputs and outputs of `stampCli`. The bin gives the files, the streams and the environment of the process. */
export interface StampCliIo {
  /** This function gives the text of a file. */
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, text: string) => void;
  readonly appendFile: (path: string, text: string) => void;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** The environment. The command reads `GITHUB_OUTPUT` from it. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The current folder. A relative path of an argument starts at it. */
  readonly cwd: string;
  /** The stamp of a config in a checkout. The default is `configStamp`. A test gives another one. */
  readonly stamp?: (root: string, config: StampConfig) => Promise<CodeStamp>;
}

/** The command line of `rigor-stamp`. The work is in this function, so a test can start the same command. It gives the exit code. */
export async function stampCli(argv: readonly string[], io: StampCliIo): Promise<number> {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    io.stderr(`rigor-stamp: ${error instanceof Error ? error.message : String(error)}\n\n${STAMP_HELP}`);
    return 2;
  }
  const { command, values } = parsed;
  if (values.help === true) {
    io.stdout(STAMP_HELP);
    return 0;
  }
  const path = (value: string): string => resolve(io.cwd, value);
  if (command === "changed") {
    if (values.base === undefined || values.head === undefined) return usage(io, "changed needs --base and --head");
    const readRecord = (file: string): unknown => {
      try {
        return JSON.parse(io.readFile(path(file)));
      } catch {
        return undefined;
      }
    };
    const parts = stampChanges(readRecord(values.base), readRecord(values.head));
    const match = parts.length > 0;
    io.stdout(match ? `The timed code differs: ${parts.join(", ")}. So the bench runs.\n` : "The timed code is the same. So the bench does not run.\n");
    const output = io.env["GITHUB_OUTPUT"];
    if (output !== undefined && output !== "") io.appendFile(output, `match=${String(match)}\n`);
    return 0;
  }
  if (command === "stamp") {
    if (values.config === undefined) return usage(io, "stamp needs --config");
    let config: StampConfig;
    try {
      config = stampConfig(JSON.parse(io.readFile(path(values.config))));
    } catch (error) {
      return usage(io, `the config ${values.config} is not read: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const record = stampRecord(await (io.stamp ?? configStamp)(path(values.root ?? "."), config));
      const text = `${JSON.stringify(record, null, 2)}\n`;
      if (values.out !== undefined) io.writeFile(path(values.out), text);
      io.stdout(text);
      return 0;
    } catch (error) {
      io.stderr(`rigor-stamp: the stamp failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
  return usage(io, `the command is stamp or changed, not ${command ?? "nothing"}`);
}

function usage(io: StampCliIo, message: string): number {
  io.stderr(`rigor-stamp: ${message}.\n\n${STAMP_HELP}`);
  return 2;
}

function parseCliArgs(argv: readonly string[]) {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: "string" },
      root: { type: "string" },
      out: { type: "string" },
      base: { type: "string" },
      head: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (positionals.length > 1) throw new Error(`one command only, not ${positionals.join(" ")}`);
  return { command: positionals[0], values };
}
