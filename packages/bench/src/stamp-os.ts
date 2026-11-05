/**
 * This internal file compares the stamps of one tree on two operating systems. A CI job runs it on Linux and on Windows, and a third job compares the two reads.
 * The compare has no fixed value, so a new version of the bundler does not fail it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type CodeStampOptions, codeStamp } from "./code-stamp.ts";

/** One stamp of a read. */
export interface StampOsRow {
  readonly hash: string;
  readonly parts: Readonly<Record<string, string>>;
  readonly inputs: readonly string[];
}

/** The read of one operating system. */
export interface StampOsRead {
  readonly platform: string;
  readonly rows: Readonly<Record<string, StampOsRow>>;
}

/** Each flip row changes one thing of the row `tree`, and this table names the part that the change moves. */
const FLIPS: readonly (readonly [string, string])[] = [
  ["flip-code", "code"],
  ["flip-data", "data"],
  ["flip-engine", "engines"],
];

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      engine:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  engine@1.0.0:
    resolution: {integrity: sha512-INTEGRITY}

snapshots:

  engine@1.0.0: {}
`;

/** This function gives the small tree of a read. The file `lib/old.cjs` is CommonJS, so the bundle holds its path. */
function treeFiles(code: string, data: string, integrity: string): Record<string, string> {
  return {
    "sub/entry.ts": 'import old from "../lib/old.cjs";\nexport const value = old.v;\n',
    "lib/old.cjs": `module.exports = { v: ${code} };\n`,
    "pnpm-lock.yaml": LOCK.replace("INTEGRITY", integrity),
    "data/deep/table.json": `[1,\n${data}]\n`,
  };
}

/** This function gives the stamp of one small tree. On Windows each file has CRLF line ends, as a checkout with no `eol` rule has. */
async function treeStamp(files: Record<string, string>, platform: string): Promise<StampOsRow> {
  const root = mkdtempSync(join(tmpdir(), "stamp-os-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), platform === "win32" ? text.replaceAll("\n", "\r\n") : text);
    }
    const options: CodeStampOptions = {
      cwd: root,
      entries: ["sub/entry.ts"],
      dataFiles: ["data/deep/table.json"],
      engines: { names: ["engine"], lockFile: "pnpm-lock.yaml", importer: "." },
      node: "any",
    };
    const stamp = await codeStamp(options);
    return { hash: stamp.hash, parts: { ...stamp.parts }, inputs: stamp.inputs };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * This function reads the stamps of this operating system: the checkout of the repository, a small tree, and the flips of the small tree.
 * The option `node` is a constant, because a compare of 2 reads is not a read of the Node major.
 */
export async function readStampOs(repository: string, platform: string = process.platform): Promise<StampOsRead> {
  const real = await codeStamp({
    cwd: repository,
    entries: ["packages/bench/src/paired.ts"],
    dataFiles: ["packages/bench/src/model.fixture.json"],
    engines: { names: ["esbuild"], lockFile: "pnpm-lock.yaml", importer: "packages/bench" },
    node: "any",
  });
  return {
    platform,
    rows: {
      checkout: { hash: real.hash, parts: { ...real.parts }, inputs: real.inputs },
      tree: await treeStamp(treeFiles("1", "2", "a"), platform),
      "flip-code": await treeStamp(treeFiles("2", "2", "a"), platform),
      "flip-data": await treeStamp(treeFiles("1", "3", "a"), platform),
      "flip-engine": await treeStamp(treeFiles("1", "2", "b"), platform),
    },
  };
}

function rowFindings(name: string, a: StampOsRow, b: StampOsRow): string[] {
  const found: string[] = [];
  if (a.hash !== b.hash) found.push(`${name}: the hash differs`);
  for (const part of new Set([...Object.keys(a.parts), ...Object.keys(b.parts)])) {
    if (a.parts[part] !== b.parts[part]) found.push(`${name}: the part ${part} differs`);
  }
  if (a.inputs.join("\n") !== b.inputs.join("\n")) found.push(`${name}: the inputs differ`);
  for (const input of [...a.inputs, ...b.inputs]) {
    if (input.includes("\\")) found.push(`${name}: the input ${input} has a backslash`);
  }
  return found;
}

/**
 * This function gives the faults of two reads. It gives none when two different operating systems agree on each row, and each flip moved its own part on both.
 * Two reads of one operating system are a fault, because they do not read a difference of operating systems.
 */
export function stampOsFindings(a: StampOsRead, b: StampOsRead): readonly string[] {
  const found: string[] = [];
  if (a.platform === b.platform) found.push(`both reads come from ${a.platform}`);
  for (const name of new Set([...Object.keys(a.rows), ...Object.keys(b.rows)])) {
    const left = a.rows[name];
    const right = b.rows[name];
    if (left === undefined || right === undefined) found.push(`${name}: one read has no such row`);
    else found.push(...rowFindings(name, left, right));
  }
  for (const read of [a, b]) {
    const plain = read.rows.tree;
    if (plain === undefined) continue;
    for (const [name, part] of FLIPS) {
      const flipped = read.rows[name];
      if (flipped === undefined) continue;
      if (flipped.hash === plain.hash) found.push(`${name} on ${read.platform}: the hash did not move`);
      if (flipped.parts[part] === plain.parts[part]) found.push(`${name} on ${read.platform}: the part ${part} did not move`);
    }
  }
  return found;
}

/** This function gives a copy of a read with one injected fault: another `code` part in the row `tree`. The compare in CI must read it as a fault. */
export function withInjectedFault(read: StampOsRead): StampOsRead {
  const plain = read.rows.tree;
  if (plain === undefined) throw new Error("The read has no row tree.");
  return { ...read, rows: { ...read.rows, tree: { ...plain, parts: { ...plain.parts, code: "injected" } } } };
}
