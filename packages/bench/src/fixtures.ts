/**
 * The fixture files of a bench: the files that its cases read, each with a pinned SHA-256. A run checks each hash
 * before its first child, and its record keeps the hashes. Thus two records compare only with the same fixtures.
 * The fetch of the files is a step of the job before the run, with the tool of the owner of the files.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One fixture file and its pinned hash. */
export interface FixtureFile {
  /** The path of the file in the folder of the fixtures, with `/` between its parts. It is not absolute, and it has no part `..`. */
  readonly file: string;
  /** The pinned SHA-256 of the bytes of the file, as 64 lowercase hex characters. */
  readonly sha256: string;
}

/** One checked fixture file: its path, its hash and its size. A record of a run keeps it. */
export interface FixtureHash extends FixtureFile {
  /** The size of the file in bytes. */
  readonly bytes: number;
}

/** The options of `checkFixtures`. */
export interface FixtureOptions {
  /** The read of a file. The default is `readFileSync`. A test gives its own. */
  readonly read?: (path: string) => Uint8Array;
}

/** This function examines the list of fixture files. A bad path, a bad hash or a path that is in the list two times is a `RangeError`. */
function checkList(files: readonly FixtureFile[]): void {
  if (!Array.isArray(files)) throw new RangeError("checkFixtures: the fixture files are a list.");
  const seen = new Set<string>();
  for (const f of files) {
    const file = f?.file;
    const parts = typeof file === "string" ? file.split("/") : [];
    if (typeof file !== "string" || file === "" || file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.includes("\\") || parts.some((p) => p === "" || p === "." || p === "..")) {
      throw new RangeError(`checkFixtures: the path of a fixture file is a relative path with "/" between its parts and no part "", "." or "..", not ${JSON.stringify(file)}.`);
    }
    if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new RangeError(`checkFixtures: the SHA-256 of ${JSON.stringify(file)} is 64 lowercase hex characters, not ${JSON.stringify(f.sha256)}.`);
    if (seen.has(file)) throw new RangeError(`checkFixtures: the file ${JSON.stringify(file)} is in the list 2 times.`);
    seen.add(file);
  }
}

/**
 * This function reads each fixture file in `folder` and compares the SHA-256 of its bytes with the pinned hash. It gives
 * the hash and the size of each file for the record. A file that it cannot read, or that has a different hash, is an error.
 * This error names each such file, so one run shows all the bad files.
 */
export function checkFixtures(folder: string, files: readonly FixtureFile[], options: FixtureOptions = {}): FixtureHash[] {
  if (typeof folder !== "string" || folder === "") throw new RangeError("checkFixtures: the folder is a string that is not empty.");
  checkList(files);
  const read = options.read ?? ((path: string) => readFileSync(path));
  const out: FixtureHash[] = [];
  const faults: string[] = [];
  for (const { file, sha256 } of files) {
    let bytes: Uint8Array;
    try {
      bytes = read(join(folder, ...file.split("/")));
    } catch (error) {
      faults.push(`${file}: it cannot be read (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual === sha256) out.push({ file, sha256, bytes: bytes.byteLength });
    else faults.push(`${file}: its SHA-256 is ${actual}, not the pinned ${sha256}`);
  }
  if (faults.length > 0) throw new Error(`checkFixtures: ${faults.length} of ${files.length} fixture files in ${folder} are not the pinned files. ${faults.join(". ")}.`);
  return out;
}

/**
 * This function compares the fixture hashes of two records. It gives each file that only one record has, or that has two
 * different hashes, in sorted order. Two records with differences did not read the same fixtures, so a comparison of their times is not valid.
 */
export function fixtureDifferences(a: readonly FixtureFile[], b: readonly FixtureFile[]): string[] {
  const left = new Map(a.map((f) => [f.file, f.sha256]));
  const right = new Map(b.map((f) => [f.file, f.sha256]));
  const files = new Set([...left.keys(), ...right.keys()]);
  return [...files].filter((f) => left.get(f) !== right.get(f)).sort();
}
