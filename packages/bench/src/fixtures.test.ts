import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFixtures, fixtureDifferences } from "./fresh.ts";

/** The SHA-256 of "abc" and of no bytes, from FIPS 180-2. */
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** A read of an in-memory folder. A path that is not in it is an error, as for `readFileSync`. */
function memory(files: Record<string, string>): { read: (path: string) => Uint8Array; paths: string[] } {
  const paths: string[] = [];
  const read = (path: string): Uint8Array => {
    paths.push(path);
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return new TextEncoder().encode(text);
  };
  return { read, paths };
}

describe("checkFixtures", () => {
  it("gives the hash and the size of each file when each hash is the pinned hash", () => {
    const { read, paths } = memory({ [join("fonts", "a.ttf")]: "abc", [join("fonts", "sub", "b.ttf")]: "" });
    const files = [{ file: "a.ttf", sha256: ABC }, { file: "sub/b.ttf", sha256: EMPTY }];
    expect(checkFixtures("fonts", files, { read })).toEqual([{ file: "a.ttf", sha256: ABC, bytes: 3 }, { file: "sub/b.ttf", sha256: EMPTY, bytes: 0 }]);
    expect(paths).toEqual([join("fonts", "a.ttf"), join("fonts", "sub", "b.ttf")]);
  });

  it("names each file that is missing or has another hash in one error", () => {
    const { read } = memory({ [join("f", "a.ttf")]: "abd" });
    const files = [{ file: "a.ttf", sha256: ABC }, { file: "b.ttf", sha256: EMPTY }];
    expect(() => checkFixtures("f", files, { read })).toThrow(/2 of 2 fixture files .*a\.ttf: its SHA-256 is [0-9a-f]{64}, not the pinned ba7816.*b\.ttf: it cannot be read \(ENOENT/);
  });

  it("reads real files with the default read", () => {
    const folder = mkdtempSync(join(tmpdir(), "rigor-fixtures-"));
    try {
      writeFileSync(join(folder, "abc.txt"), "abc");
      expect(checkFixtures(folder, [{ file: "abc.txt", sha256: ABC }])).toEqual([{ file: "abc.txt", sha256: ABC, bytes: 3 }]);
      expect(() => checkFixtures(folder, [{ file: "abc.txt", sha256: EMPTY }])).toThrow(/not the pinned/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("refuses a bad path, a bad hash, a path in the list 2 times and an empty folder", () => {
    const { read } = memory({});
    for (const file of ["", "../a", "/a", "C:a", "a\\b", "a//b", "./a", "a/..", "a/"]) {
      expect(() => checkFixtures("f", [{ file, sha256: ABC }], { read }), file).toThrow(RangeError);
    }
    expect(() => checkFixtures("f", [{ file: "a", sha256: ABC.toUpperCase() }], { read })).toThrow(/64 lowercase hex/);
    expect(() => checkFixtures("f", [{ file: "a", sha256: ABC }, { file: "a", sha256: ABC }], { read })).toThrow(/2 times/);
    expect(() => checkFixtures("", [], { read })).toThrow(RangeError);
  });

  it("gives no hash for an empty list", () => {
    expect(checkFixtures("f", [], memory({}))).toEqual([]);
  });
});

describe("fixtureDifferences", () => {
  it("gives each file that one record has alone or with another hash", () => {
    const a = [{ file: "x", sha256: ABC }, { file: "y", sha256: ABC }, { file: "z", sha256: ABC }];
    const b = [{ file: "z", sha256: ABC }, { file: "x", sha256: EMPTY }, { file: "w", sha256: ABC }];
    expect(fixtureDifferences(a, b)).toEqual(["w", "x", "y"]);
    expect(fixtureDifferences(a, [...a].reverse())).toEqual([]);
  });
});
