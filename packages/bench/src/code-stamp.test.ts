import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODE_STAMP_READ_WORDS, type CodeStamp, type CodeStampOptions, codeStamp, lockClosure } from "./code-stamp.ts";

/** A lock file with the two documents of pnpm: the first holds the package manager, the second holds the packages. */
const LOCK = `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.10.1
        version: 12.10.1

packages:

  pnpm@12.10.1:
    resolution: {integrity: sha512-pnpm}

snapshots:

  pnpm@12.10.1: {}

---
lockfileVersion: '9.0'

importers:

  packages/joint:
    dependencies:
      '@x/engine':
        specifier: ^1.0.0
        version: 1.0.0(peer@2.0.0)
      '@x/local':
        specifier: workspace:*
        version: link:../local
      other:
        specifier: ^3.0.0
        version: 3.0.0

packages:

  '@x/engine@1.0.0':
    resolution: {integrity: sha512-engine}

  below@4.0.0:
    resolution: {integrity: sha512-below}

  deep@5.0.0:
    resolution: {integrity: sha512-deep}

  loop@6.0.0:
    resolution: {integrity: sha512-loop}

  named@7.0.0:
    resolution: {integrity: sha512-named}

  other@3.0.0:
    resolution: {integrity: sha512-other}

  peer@2.0.0:
    resolution: {integrity: sha512-peer}

snapshots:

  '@x/engine@1.0.0(peer@2.0.0)':
    dependencies:
      below: 4.0.0
      peer: 2.0.0
      alias: named@7.0.0
    optionalDependencies:
      loop: 6.0.0
    transitivePeerDependencies:
      - nothing

  below@4.0.0:
    dependencies:
      deep: 5.0.0

  deep@5.0.0: {}

  loop@6.0.0:
    dependencies:
      '@x/engine': 1.0.0(peer@2.0.0)

  named@7.0.0: {}

  other@3.0.0: {}

  peer@2.0.0: {}
`;

const ENTRY = `import { used, type Size } from "./lib/index.ts";
export function run(size: Size): number {
  return used(size) + 1;
}
`;
const LIB = `export type Size = number;
export function used(size: Size): number {
  return size * 2;
}
export function unused(): string {
  return "not reached";
}
`;

const dirs: string[] = [];

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** A tree of source files with an engine, a lock file and a data file. */
function tree(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "code-stamp-"));
  dirs.push(root);
  write(root, {
    "entry.ts": ENTRY,
    "lib/index.ts": LIB,
    "lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0" }),
    "pnpm-lock.yaml": LOCK,
    "data/table.json": "[1,2,3]",
    ...extra,
  });
  return root;
}

const ENGINES = { names: ["@x/engine"], lockFile: "pnpm-lock.yaml", importer: "packages/joint" };
const optionsOf = (cwd: string, more: Partial<CodeStampOptions> = {}): CodeStampOptions => ({ cwd, entries: ["entry.ts"], engines: ENGINES, dataFiles: ["data/table.json"], ...more });
const stampOf = (cwd: string, more: Partial<CodeStampOptions> = {}): Promise<CodeStamp> => codeStamp(optionsOf(cwd, more));

/** This function gives the stamp of a tree before and after one change of the tree. */
async function flip(change: (root: string) => void, more: Partial<CodeStampOptions> = {}): Promise<readonly [CodeStamp, CodeStamp]> {
  const root = tree();
  const before = await stampOf(root, more);
  change(root);
  return [before, await stampOf(root, more)];
}

const edit = (root: string, path: string, from: string, to: string): void => {
  const text = readFileSync(join(root, path), "utf8");
  if (!text.includes(from)) throw new Error(`no ${from} in ${path}`);
  writeFileSync(join(root, path), text.replace(from, to));
};

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("a change that cannot change a result keeps the stamp", () => {
  const keeps: readonly (readonly [string, (root: string) => void])[] = [
    ["a version in a package file", (root) => edit(root, "lib/package.json", "1.0.0", "1.0.1")],
    ["a new export that the entries do not reach", (root) => edit(root, "lib/index.ts", "export function unused", "export const added = 1;\nexport function unused")],
    ["the body of an export that the entries do not reach", (root) => edit(root, "lib/index.ts", "not reached", "still not reached")],
    ["a line comment", (root) => edit(root, "lib/index.ts", "return size * 2;", "// a note\n  return size * 2; // a note")],
    ["a block comment and a doc comment", (root) => edit(root, "entry.ts", "export function run", "/** A doc. */\n/* a block */\nexport function run")],
    ["a legal comment", (root) => edit(root, "lib/index.ts", "export function used", "/*! a licence */\n//! a licence\nexport function used")],
    ["blank lines and indents", (root) => edit(root, "entry.ts", "  return used(size) + 1;", "\n\n        return used(size)   +   1;\n")],
    ["line ends", (root) => writeFileSync(join(root, "entry.ts"), ENTRY.replaceAll("\n", "\r\n"))],
    ["a type", (root) => edit(root, "lib/index.ts", "export type Size = number;", "export type Size = number & { readonly unit?: string };")],
    ["a type-only import", (root) => edit(root, "entry.ts", "export function run", 'import type { Size as Other } from "./lib/index.ts";\nexport type Alias = Other;\nexport function run')],
    ["a compiler option in a tsconfig file", (root) => write(root, { "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }) })],
  ];
  it.each(keeps)("%s", async (_name, change) => {
    const [before, after] = await flip(change);
    expect(after.hash).toBe(before.hash);
    expect(after.parts).toEqual(before.parts);
  });

  it("the same code in another folder", async () => {
    const root = tree();
    const moved = join(root, "deep", "er");
    const again = tree();
    mkdirSync(moved, { recursive: true });
    cpSync(again, moved, { recursive: true });
    expect((await stampOf(moved)).hash).toBe((await stampOf(again)).hash);
  });

  it("the order of the entries and of the data files", async () => {
    const root = tree({ "second.ts": "export const second = 2;\n", "data/other.txt": "x" });
    const a = await stampOf(root, { entries: ["entry.ts", "second.ts"], dataFiles: ["data/table.json", "data/other.txt"] });
    const b = await stampOf(root, { entries: ["./second.ts", "entry.ts", "entry.ts"], dataFiles: ["data/other.txt", "data/table.json"] });
    expect(b.hash).toBe(a.hash);
  });
});

describe("a change that can change a result moves the stamp and names its part", () => {
  const moves: readonly (readonly [string, keyof CodeStamp["parts"], (root: string) => void])[] = [
    ["one token of an entry", "code", (root) => edit(root, "entry.ts", "+ 1", "+ 2")],
    ["one token of a reached function", "code", (root) => edit(root, "lib/index.ts", "size * 2", "size * 3")],
    ["one text of a reached function", "code", (root) => edit(root, "lib/index.ts", "return size * 2;", 'return String("a").length * size * 2;')],
    ["a new export of an entry", "code", (root) => edit(root, "entry.ts", "export function run", "export const added = 1;\nexport function run")],
    ["the engine version in the lock file", "engines", (root) => {
      const text = readFileSync(join(root, "pnpm-lock.yaml"), "utf8").replaceAll("1.0.0", "1.0.1");
      writeFileSync(join(root, "pnpm-lock.yaml"), text);
    }],
    ["a transitive package of an engine", "engines", (root) => {
      const text = readFileSync(join(root, "pnpm-lock.yaml"), "utf8").replaceAll("deep@5.0.0", "deep@5.0.1").replace("deep: 5.0.0", "deep: 5.0.1");
      writeFileSync(join(root, "pnpm-lock.yaml"), text);
    }],
    ["the integrity of a transitive package", "engines", (root) => edit(root, "pnpm-lock.yaml", "sha512-deep", "sha512-another")],
    ["a data file", "data", (root) => edit(root, "data/table.json", "1,2,3", "1,2,4")],
    ["the name of a data file", "data", (root) => {
      write(root, { "data/moved.json": readFileSync(join(root, "data/table.json"), "utf8") });
    }],
  ];
  it.each(moves)("%s", async (name, part, change) => {
    const root = tree();
    const before = await stampOf(root);
    change(root);
    const after = await stampOf(root, name === "the name of a data file" ? { dataFiles: ["data/moved.json"] } : {});
    expect(after.hash).not.toBe(before.hash);
    expect(after.parts[part]).not.toBe(before.parts[part]);
    const others = (Object.keys(before.parts) as (keyof CodeStamp["parts"])[]).filter((key) => key !== part);
    for (const key of others) expect(after.parts[key]).toBe(before.parts[key]);
  });

  it("the Node major", async () => {
    const root = tree();
    const a = await stampOf(root, { node: "26" });
    const b = await stampOf(root, { node: "27" });
    expect(b.hash).not.toBe(a.hash);
    expect(b.parts.code).toBe(a.parts.code);
    expect(a.parts.node).toBe("26");
  });

  it("a package outside the closure of the engines moves nothing", async () => {
    const [before, after] = await flip((root) => edit(root, "pnpm-lock.yaml", "sha512-other", "sha512-another"));
    expect(after.hash).toBe(before.hash);
  });

  it("a package that is not an engine enters the bundle, so only what the entries reach counts", async () => {
    const extra = { "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js", sideEffects: false }), "node_modules/dep/index.js": "export const reached = 1;\nexport const other = 2;\n", "entry.ts": 'import { reached } from "dep";\nexport const run = reached;\n' };
    const root = tree(extra);
    const before = await stampOf(root);
    expect(before.inputs).toContain("node_modules/dep/index.js");
    edit(root, "node_modules/dep/package.json", "1.0.0", "1.0.9");
    edit(root, "node_modules/dep/index.js", "other = 2", "other = 3");
    expect((await stampOf(root)).hash).toBe(before.hash);
    edit(root, "node_modules/dep/index.js", "reached = 1", "reached = 9");
    expect((await stampOf(root)).parts.code).not.toBe(before.parts.code);
  });
});

describe("the bundle and what the caller reads from a stamp", () => {
  it("an engine stays outside the bundle, also by a subpath, and a change of its code on the disk moves nothing", async () => {
    const extra = { "node_modules/@x/engine/package.json": JSON.stringify({ name: "@x/engine", version: "1.0.0", exports: { ".": "./index.js", "./sub": "./sub.js" } }), "node_modules/@x/engine/index.js": "export const a = 1;\n", "node_modules/@x/engine/sub.js": "export const b = 1;\n", "entry.ts": 'import { a } from "@x/engine";\nimport { b } from "@x/engine/sub";\nexport const run = a + b;\n' };
    const root = tree(extra);
    const before = await stampOf(root);
    expect(before.inputs).toEqual(["entry.ts"]);
    edit(root, "node_modules/@x/engine/index.js", "a = 1", "a = 2");
    expect((await stampOf(root)).hash).toBe(before.hash);
  });

  it("gives the inputs, the engines and the bundler in words", async () => {
    const stamp = await stampOf(tree());
    expect(stamp.inputs).toEqual(["entry.ts", "lib/index.ts"]);
    expect(stamp.parts.bundler).toMatch(/^esbuild@\d+\.\d+\.\d+/);
    expect(stamp.parts.node).toBe(process.versions.node.split(".")[0]);
    expect(stamp.engines.map((engine) => [engine.name, engine.version])).toEqual([["@x/engine", "1.0.0"]]);
    expect(stamp.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a JSON file that the code imports enters the bundle", async () => {
    const root = tree({ "entry.ts": 'import table from "./data/table.json";\nexport const run = table;\n' });
    const before = await stampOf(root);
    expect(before.inputs).toContain("data/table.json");
    edit(root, "data/table.json", "1,2,3", "1,2,4");
    expect((await stampOf(root)).parts.code).not.toBe(before.parts.code);
  });

  it("works with no engines and no data, for the compiler of one tree", async () => {
    const root = tree();
    const a = await codeStamp({ cwd: root, entries: ["entry.ts"] });
    expect(a.engines).toEqual([]);
    edit(root, "entry.ts", "return used", "// a comment\n  return used");
    expect((await codeStamp({ cwd: root, entries: ["entry.ts"] })).hash).toBe(a.hash);
    edit(root, "entry.ts", "+ 1", "+ 2");
    expect((await codeStamp({ cwd: root, entries: ["entry.ts"] })).hash).not.toBe(a.hash);
  });
});

describe("a read that a bundle cannot see", () => {
  const READER = 'import { readFileSync } from "node:fs";\nexport const run = () => readFileSync("data/table.json", "utf8");\n';

  it("refuses a read that the caller does not state", async () => {
    await expect(stampOf(tree({ "entry.ts": READER }))).rejects.toThrow(/not stated: readFileSync/);
  });

  it("passes a stated read, and the data file moves the stamp", async () => {
    const root = tree({ "entry.ts": READER });
    const before = await stampOf(root, { reads: ["readFileSync"] });
    expect(before.reads).toEqual(["readFileSync"]);
    edit(root, "data/table.json", "1,2,3", "1,2,4");
    const after = await stampOf(root, { reads: ["readFileSync"] });
    expect(after.parts.data).not.toBe(before.parts.data);
    expect(after.parts.code).toBe(before.parts.code);
  });

  it("refuses a stated read that the bundle no longer holds", async () => {
    await expect(stampOf(tree(), { reads: ["readFileSync"] })).rejects.toThrow(/not in the bundle: readFileSync/);
  });

  const words: readonly (readonly [string, string])[] = [
    ["fetch", 'export const run = () => fetch("https://example.test/table");\n'],
    ["process.env", "export const run = () => process.env.SIZE;\n"],
    ["import.meta.url", 'export const run = () => new URL("./table.bin", import.meta.url);\n'],
    ["import(", "export const run = (name: string) => import(name);\n"],
    ["WebAssembly", "export const run = (bytes: Uint8Array) => WebAssembly.compile(bytes);\n"],
  ];
  it.each(words)("sees %s", async (word, text) => {
    expect(CODE_STAMP_READ_WORDS).toContain(word);
    await expect(stampOf(tree({ "entry.ts": text }))).rejects.toThrow(word);
    expect((await stampOf(tree({ "entry.ts": text }), { reads: [word] })).reads).toEqual([word]);
  });

  it("does not see a word inside a longer name", async () => {
    expect((await stampOf(tree({ "entry.ts": "const fetched = 1;\nconst prefetch = 2;\nexport const run = fetched + prefetch;\n" }))).reads).toEqual([]);
  });

  it("a read in a function that the entries do not reach is out of the bundle", async () => {
    const root = tree();
    edit(root, "lib/index.ts", 'return "not reached";', 'return process.env.X ?? "not reached";');
    expect((await stampOf(root)).reads).toEqual([]);
  });

  it("refuses a data file that does not exist", async () => {
    await expect(stampOf(tree(), { dataFiles: ["data/none.json"] })).rejects.toThrow(/ENOENT/);
  });
});

describe("the same tree on another computer", () => {
  const CJS_TREE = {
    "sub/entry.ts": 'import old from "../lib/old.cjs";\nexport const value = old.v;\n',
    "lib/old.cjs": "module.exports = { v: 1 };\n",
    "pnpm-lock.yaml": LOCK,
    "data/deep/table.json": "[1,\n2]\n",
  };
  const cjsOptions = { entries: ["sub/entry.ts"], dataFiles: ["data/deep/table.json"], node: "26" };

  it("each slash direction in the options gives one stamp", async () => {
    const root = tree(CJS_TREE);
    const forward = await stampOf(root, cjsOptions);
    const back = await stampOf(root, { ...cjsOptions, entries: ["sub\\entry.ts"], dataFiles: ["data\\deep\\table.json"] });
    expect(back).toEqual(forward);
    expect(forward.inputs.join(" ")).not.toContain("\\");
  });

  it("the line ends of a text data file and of the lock file keep the stamp", async () => {
    const [before, after] = await flip((root) => {
      writeFileSync(join(root, "data/table.json"), "[1,\r\n2]\r\n");
      writeFileSync(join(root, "pnpm-lock.yaml"), LOCK.replaceAll("\n", "\r\n"));
    }, {});
    const [lf] = await flip((root) => writeFileSync(join(root, "data/table.json"), "[1,\n2]\n"), {});
    expect(after.parts.engines).toBe(before.parts.engines);
    expect(lf.parts.data).toBe(before.parts.data);
    const a = tree({ "data/table.json": "[1,\n2]\n" });
    const b = tree({ "data/table.json": "[1,\r\n2]\r\n" });
    expect((await stampOf(b)).hash).toBe((await stampOf(a)).hash);
  });

  it("a line end in a binary data file moves the stamp, and a byte of a text file also moves it", async () => {
    const a = tree();
    const b = tree();
    writeFileSync(join(a, "data/table.json"), Buffer.from([0, 13, 10, 1]));
    writeFileSync(join(b, "data/table.json"), Buffer.from([0, 10, 1]));
    expect((await stampOf(b)).parts.data).not.toBe((await stampOf(a)).parts.data);
    const c = tree({ "data/table.json": "[1,\r\n2]\r\n" });
    const d = tree({ "data/table.json": "[1,\r\n3]\r\n" });
    expect((await stampOf(d)).parts.data).not.toBe((await stampOf(c)).parts.data);
  });
});

describe("the options that a stamp refuses", () => {
  it("no entries", async () => {
    await expect(codeStamp({ cwd: tree(), entries: [] })).rejects.toThrow(/at least one entry/);
  });

  it("an entry outside the folder", async () => {
    await expect(codeStamp({ cwd: tree(), entries: ["../other.ts"] })).rejects.toThrow(/outside/);
  });

  it("an entry that does not exist", async () => {
    await expect(codeStamp({ cwd: tree(), entries: ["none.ts"] })).rejects.toThrow(/none\.ts/);
  });

  it("a missing lock file", async () => {
    await expect(stampOf(tree(), { engines: { ...ENGINES, lockFile: "none.yaml" } })).rejects.toThrow(/ENOENT/);
  });
});

describe("the closure of an engine in a lock file", () => {
  it("follows dependencies, optional dependencies, aliases and a cycle, in sorted order", () => {
    const [engine] = lockClosure(LOCK, "packages/joint", ["@x/engine"]);
    expect(engine).toEqual({
      name: "@x/engine",
      version: "1.0.0",
      closure: [
        "@x/engine@1.0.0(peer@2.0.0) {integrity: sha512-engine}",
        "below@4.0.0 {integrity: sha512-below}",
        "deep@5.0.0 {integrity: sha512-deep}",
        "loop@6.0.0 {integrity: sha512-loop}",
        "named@7.0.0 {integrity: sha512-named}",
        "peer@2.0.0 {integrity: sha512-peer}",
      ],
    });
  });

  it("reads a lock file with Windows line ends", () => {
    expect(lockClosure(LOCK.replaceAll("\n", "\r\n"), "packages/joint", ["@x/engine"])).toEqual(lockClosure(LOCK, "packages/joint", ["@x/engine"]));
  });

  it("gives one closure for each name, in the order of the names", () => {
    expect(lockClosure(LOCK, "packages/joint", ["other", "@x/engine"]).map((engine) => engine.name)).toEqual(["other", "@x/engine"]);
    expect(lockClosure(LOCK, "packages/joint", ["other"])[0]!.closure).toEqual(["other@3.0.0 {integrity: sha512-other}"]);
  });

  it("refuses a workspace package, which belongs in the bundle", () => {
    expect(() => lockClosure(LOCK, "packages/joint", ["@x/local"])).toThrow(/workspace package/);
  });

  it("refuses an unknown importer and an unknown name", () => {
    expect(() => lockClosure(LOCK, "packages/none", ["@x/engine"])).toThrow(/no importer/);
    expect(() => lockClosure(LOCK, "packages/joint", ["none"])).toThrow(/no package none/);
  });

  it("refuses a snapshot that the lock file does not hold", () => {
    expect(() => lockClosure(LOCK.replace("deep@5.0.0: {}", "gone@5.0.0: {}"), "packages/joint", ["@x/engine"])).toThrow(/no snapshot deep@5\.0\.0/);
  });

  it("refuses another lock version, and a text with no lock", () => {
    expect(() => lockClosure(LOCK.replaceAll("'9.0'", "'10.0'"), "packages/joint", ["@x/engine"])).toThrow(/lock version 9/);
    expect(() => lockClosure("", "packages/joint", ["@x/engine"])).toThrow(/lock version 9/);
  });
});

describe("a new version of the bundler", () => {
  // The bundle is only the text of a hash, and no run uses it, so a new version with an equal bundle keeps the records.
  it("keeps the hash when the bundle is equal, and the part names the version", async () => {
    const root = tree();
    const before = await stampOf(root);
    vi.resetModules();
    vi.doMock("esbuild", async () => ({ ...(await vi.importActual<object>("esbuild")), version: "9.9.9" }));
    try {
      const fresh = await import("./code-stamp.ts");
      const after = await fresh.codeStamp(optionsOf(root));
      expect(after.hash).toBe(before.hash);
      expect(after.parts.bundler).toBe("esbuild@9.9.9");
      expect(after.parts.code).toBe(before.parts.code);
    } finally {
      vi.doUnmock("esbuild");
      vi.resetModules();
    }
  });

  it("moves the hash when the bundle changes", async () => {
    const root = tree();
    const before = await stampOf(root);
    vi.resetModules();
    vi.doMock("esbuild", async () => {
      const real = await vi.importActual<{ build(options: object): Promise<{ outputFiles: { text: string }[] }> }>("esbuild");
      const build = async (options: object) => {
        const result = await real.build(options);
        return { ...result, outputFiles: result.outputFiles.map((file) => ({ text: `${file.text}\n"another bundle";` })) };
      };
      return { ...real, version: "9.9.9", build };
    });
    try {
      const fresh = await import("./code-stamp.ts");
      const after = await fresh.codeStamp(optionsOf(root));
      expect(after.parts.code).not.toBe(before.parts.code);
      expect(after.hash).not.toBe(before.hash);
    } finally {
      vi.doUnmock("esbuild");
      vi.resetModules();
    }
  });
});

describe("the optional peer", () => {
  it("tells the caller to add it when it is absent", async () => {
    vi.resetModules();
    vi.doMock("esbuild", () => {
      throw new Error("no such package");
    });
    try {
      const fresh = await import("./code-stamp.ts");
      await expect(fresh.codeStamp({ cwd: tree(), entries: ["entry.ts"] })).rejects.toThrow(/optional peer esbuild/);
    } finally {
      vi.doUnmock("esbuild");
      vi.resetModules();
    }
  });
});
