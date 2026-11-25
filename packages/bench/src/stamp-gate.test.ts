import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeStamp } from "./code-stamp.ts";
import { configStamp, enginesOf, importSpecifiers, packageOf, STAMP_HELP, stampChanges, stampCli, stampConfig, stampRecord, type StampCliIo, type StampConfig } from "./stamp-gate.ts";

describe("packageOf", () => {
  it("gives the package of a bare specifier, with its scope, and no package for a path or a node module", () => {
    expect(packageOf("@a/b")).toBe("@a/b");
    expect(packageOf("@a/b/graph")).toBe("@a/b");
    expect(packageOf("zod")).toBe("zod");
    expect(packageOf("zod/mini")).toBe("zod");
    expect(packageOf("./x.ts")).toBeUndefined();
    expect(packageOf("../src/x.ts")).toBeUndefined();
    expect(packageOf("node:fs")).toBeUndefined();
  });
});

describe("importSpecifiers", () => {
  it("finds imports, type imports, re-exports and imports for side effects, each one time", () => {
    const text = [
      'import { a } from "@a/b";',
      'import type { T } from "@a/c/types";',
      "import {",
      "  x,",
      "  y,",
      '} from "./local.ts";',
      'export { z } from "zod";',
      'export * from "./more.ts";',
      'import "@a/side";',
      'import { a as again } from "@a/b";',
    ].join("\n");
    expect(importSpecifiers(text)).toEqual(["./local.ts", "./more.ts", "@a/b", "@a/c/types", "@a/side", "zod"]);
  });
});

describe("enginesOf", () => {
  const manifest = { dependencies: { "@a/b": "^1.0.0", "@a/core": "workspace:*", unused: "^2.0.0" }, devDependencies: { "@a/bench": "^0.3.0" } };

  it("keeps each package of the manifest that a source imports, and leaves out a workspace package", () => {
    const sources = ['import { a } from "@a/b/graph";', 'import { c } from "@a/core";\nimport { t } from "@a/bench";', 'import { n } from "not-in-the-manifest";'];
    expect(enginesOf(manifest, sources)).toEqual(["@a/b", "@a/bench"]);
  });

  it("gives no engine when no source imports a package", () => {
    expect(enginesOf(manifest, ['import { x } from "./x.ts";'])).toEqual([]);
  });
});

/** A stamp record with the given code and engines parts. */
const record = (code: string, engines = "e") => ({ schema: "bench-stamp/1", hash: `${code}${engines}`, parts: { code, engines, data: "d", bundler: "esbuild@1", node: "26" }, inputs: [], engines: [] });

describe("stampChanges", () => {
  it("gives no part for the same stamp, and each part that differs", () => {
    expect(stampChanges(record("c"), record("c"))).toEqual([]);
    expect(stampChanges(record("c"), record("c2"))).toEqual(["code"]);
    expect(stampChanges(record("c"), record("c2", "e2"))).toEqual(["code", "engines"]);
  });

  it("gives record for a missing or unknown record, so the bench runs", () => {
    expect(stampChanges(undefined, record("c"))).toEqual(["record"]);
    expect(stampChanges(record("c"), { schema: "other" })).toEqual(["record"]);
    expect(stampChanges(record("c"), { ...record("c"), parts: null })).toEqual(["record"]);
  });

  it("does not count the version of the bundler, which is not in the hash", () => {
    const other = { ...record("c"), parts: { ...record("c").parts, bundler: "esbuild@2" } };
    expect(stampChanges(record("c"), other)).toEqual([]);
  });

  it("gives hash when the parts are the same and the hashes differ", () => {
    expect(stampChanges(record("c"), { ...record("c"), hash: "other" })).toEqual(["hash"]);
  });
});

describe("stampConfig", () => {
  const config = { schema: "stamp-config/1", package: "packages/joint", entries: ["bench/child.ts"] };

  it("reads a config with the optional fields or without them", () => {
    expect(stampConfig(config)).toEqual(config);
    const full = { ...config, reads: ["readFileSync"], dataFiles: ["bench/table.json"], lockFile: "pnpm-lock.yaml", importer: "packages/joint" };
    expect(stampConfig(full)).toEqual(full);
  });

  it.each([
    ["no object", [], /not an object/],
    ["another schema", { ...config, schema: "stamp-config/2" }, /schema/],
    ["an unknown field", { ...config, entry: "x.ts" }, /field entry is not known/],
    ["no package", { ...config, package: "" }, /field package/],
    ["no entry", { ...config, entries: [] }, /entries is empty/],
    ["an entry that is not a text", { ...config, entries: [1] }, /field entries/],
    ["reads that are not a list", { ...config, reads: "fetch" }, /field reads/],
  ])("refuses %s", (_name, value, message) => {
    expect(() => stampConfig(value)).toThrow(message);
  });
});

/** A fake process for `stampCli`: files in a map, captured streams and a fake stamp. */
/** The key of a file of the fake io: the path with slashes and with no drive, so that a test gives the same keys on Windows. */
const fileKey = (path: string): string => path.replaceAll("\\", "/").replace(/^[A-Za-z]:/u, "");

function fakeIo(files: Record<string, string>, env: Record<string, string> = {}, stamp?: StampCliIo["stamp"]) {
  const out: string[] = [];
  const err: string[] = [];
  const stamps: { root: string; config: StampConfig }[] = [];
  const io: StampCliIo = {
    readFile: (path) => {
      const text = files[fileKey(path)];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    writeFile: (path, text) => {
      files[fileKey(path)] = text;
    },
    appendFile: (path, text) => {
      const key = fileKey(path);
      files[key] = (files[key] ?? "") + text;
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env,
    cwd: "/w",
    stamp:
      stamp ??
      (async (root, config) => {
        stamps.push({ root: root.replaceAll("\\", "/"), config });
        return { hash: "h", parts: { code: "c", engines: "e", data: "d", bundler: "esbuild@1", node: "26" }, inputs: ["bench/child.ts"], reads: [], engines: [{ name: "@x/engine", version: "1.0.0", closure: [] }] } satisfies CodeStamp;
      }),
  };
  return { io, files, out, err, stamps };
}

/** The path of a file of the fake process, with no drive letter. */
const at = (files: Record<string, string>, end: string): string | undefined => Object.entries(files).find(([path]) => path.endsWith(end))?.[1];

describe("stampCli", () => {
  const config = JSON.stringify({ schema: "stamp-config/1", package: "packages/joint", entries: ["bench/child.ts"] });

  it("writes the stamp record of a config in a checkout to the output and to a file", async () => {
    const run = fakeIo({});
    run.files[join("/w", "bench", "stamp.json").replaceAll("\\", "/")] = config;
    expect(await stampCli(["stamp", "--config", "bench/stamp.json", "--root", "base", "--out", "head.json"], run.io)).toBe(0);
    expect(run.stamps).toHaveLength(1);
    expect(run.stamps[0]?.root.endsWith("/w/base")).toBe(true);
    expect(run.stamps[0]?.config.package).toBe("packages/joint");
    const written = JSON.parse(at(run.files, "/w/head.json") ?? "{}");
    expect(written).toEqual({ schema: "bench-stamp/1", hash: "h", parts: { code: "c", engines: "e", data: "d", bundler: "esbuild@1", node: "26" }, inputs: ["bench/child.ts"], engines: ["@x/engine@1.0.0"] });
    expect(run.out.join("")).toBe(at(run.files, "/w/head.json"));
  });

  it("gives 1 when the stamp fails, and 2 for a config that it cannot read", async () => {
    const failing = fakeIo({}, {}, () => Promise.reject(new Error("The reads of the bundle differ")));
    failing.files[join("/w", "c.json").replaceAll("\\", "/")] = config;
    expect(await stampCli(["stamp", "--config", "c.json"], failing.io)).toBe(1);
    expect(failing.err.join("")).toContain("The reads of the bundle differ");
    const missing = fakeIo({});
    expect(await stampCli(["stamp", "--config", "none.json"], missing.io)).toBe(2);
    expect(missing.err.join("")).toContain("the config none.json is not read");
    expect(missing.stamps).toHaveLength(0);
  });

  it("writes match to GITHUB_OUTPUT: false for the same code, true for a change or a record that it cannot read", async () => {
    const same = fakeIo({}, { GITHUB_OUTPUT: "/out" });
    same.files[join("/w", "a.json").replaceAll("\\", "/")] = JSON.stringify(record("c"));
    same.files[join("/w", "b.json").replaceAll("\\", "/")] = JSON.stringify(record("c"));
    expect(await stampCli(["changed", "--base", "a.json", "--head", "b.json"], same.io)).toBe(0);
    expect(same.files["/out"]).toBe("match=false\n");
    expect(same.out.join("")).toContain("is the same");

    const moved = fakeIo({}, { GITHUB_OUTPUT: "/out" });
    moved.files[join("/w", "a.json").replaceAll("\\", "/")] = JSON.stringify(record("c"));
    moved.files[join("/w", "b.json").replaceAll("\\", "/")] = JSON.stringify(record("c2"));
    expect(await stampCli(["changed", "--base", "a.json", "--head", "b.json"], moved.io)).toBe(0);
    expect(moved.files["/out"]).toBe("match=true\n");
    expect(moved.out.join("")).toContain("differs: code");

    const lost = fakeIo({}, { GITHUB_OUTPUT: "/out" });
    lost.files[join("/w", "b.json").replaceAll("\\", "/")] = JSON.stringify(record("c"));
    expect(await stampCli(["changed", "--base", "a.json", "--head", "b.json"], lost.io)).toBe(0);
    expect(lost.files["/out"]).toBe("match=true\n");
  });

  it("gives 2 and the help for a bad command line, and the help for --help", async () => {
    for (const argv of [[], ["run"], ["stamp"], ["changed", "--base", "a.json"], ["stamp", "--config"], ["stamp", "--other", "x"], ["stamp", "changed"]]) {
      const run = fakeIo({});
      expect(await stampCli(argv, run.io)).toBe(2);
      expect(run.err.join("")).toContain(STAMP_HELP);
    }
    const help = fakeIo({});
    expect(await stampCli(["--help"], help.io)).toBe(0);
    expect(help.out.join("")).toBe(STAMP_HELP);
  });
});

/** A pnpm lock file of version 9 with one importer: an engine, a package that the timed code does not import, and a workspace package. */
const LOCK = `lockfileVersion: '9.0'

importers:

  packages/joint:
    dependencies:
      '@x/engine':
        specifier: ^1.0.0
        version: 1.0.0
      '@x/local':
        specifier: workspace:*
        version: link:../local
      other:
        specifier: ^3.0.0
        version: 3.0.0

packages:

  '@x/engine@1.0.0':
    resolution: {integrity: sha512-engine}

  other@3.0.0:
    resolution: {integrity: sha512-other}

snapshots:

  '@x/engine@1.0.0': {}

  other@3.0.0: {}
`;

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A checkout with a bench in packages/joint. Its child imports the engine and a local file. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), "stamp-gate-"));
  dirs.push(root);
  const files: Record<string, string> = {
    "pnpm-lock.yaml": LOCK,
    "packages/joint/package.json": JSON.stringify({ name: "joint", dependencies: { "@x/engine": "^1.0.0", "@x/local": "workspace:*", other: "^3.0.0" } }),
    "packages/joint/bench/child.ts": 'import { engine } from "@x/engine";\nimport { size } from "../src/size.ts";\nexport function child(): number {\n  return engine(size(2));\n}\n',
    "packages/joint/src/size.ts": "export function size(n: number): number {\n  return n * 2;\n}\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("configStamp", () => {
  const config: StampConfig = { schema: "stamp-config/1", package: "packages/joint", entries: ["bench/child.ts"] };
  const edit = (root: string, path: string, from: string, to: string): void => writeFileSync(join(root, path), readFileSync(join(root, path), "utf8").replace(from, to));

  it("stamps the child, the code it calls and only the engines that it imports", { timeout: 60_000 }, async () => {
    const root = checkout();
    const stamp = await configStamp(root, config);
    expect(stamp.inputs).toEqual(["bench/child.ts", "src/size.ts"]);
    expect(stampRecord(stamp).engines).toEqual(["@x/engine@1.0.0"]);
    expect(stampChanges(stampRecord(stamp), stampRecord(await configStamp(root, config)))).toEqual([]);
  });

  it("keeps the stamp for a lock change of a package that the code does not import, and moves it for a change of the code or the engine", { timeout: 60_000 }, async () => {
    const root = checkout();
    const before = stampRecord(await configStamp(root, config));
    edit(root, "pnpm-lock.yaml", "sha512-other", "sha512-other2");
    expect(stampChanges(before, stampRecord(await configStamp(root, config)))).toEqual([]);
    edit(root, "pnpm-lock.yaml", "sha512-engine", "sha512-engine2");
    expect(stampChanges(before, stampRecord(await configStamp(root, config)))).toEqual(["engines"]);
    edit(root, "packages/joint/src/size.ts", "n * 2", "n * 3");
    expect(stampChanges(before, stampRecord(await configStamp(root, config)))).toEqual(["code", "engines"]);
  });

  it("reads the lock file and the importer of the config", { timeout: 60_000 }, async () => {
    const root = checkout();
    writeFileSync(join(root, "other-lock.yaml"), LOCK.replace("packages/joint:", "joint:"));
    const stamp = await configStamp(root, { ...config, lockFile: "other-lock.yaml", importer: "joint" });
    expect(stampRecord(stamp).engines).toEqual(["@x/engine@1.0.0"]);
    await expect(configStamp(root, { ...config, importer: "joint" })).rejects.toThrow();
  });
});
