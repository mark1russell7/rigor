import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson, sha256Hex } from "./hash.ts";
import { random, type Random } from "./random.ts";

const nodeSha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** This function gives a string of `n` characters from a mix of ASCII, 2-byte, 3-byte and 4-byte characters. */
function textOf(r: Random, n: number): string {
  const parts = ["a", "Z", "0", " ", "\"", "\\", "\n", "é", "ß", "€", "中", "😀", "𝄞"];
  let s = "";
  for (let i = 0; i < n; i++) s += r.pick(parts);
  return s;
}

describe("sha256Hex", () => {
  it("gives the digests of the test vectors of FIPS 180-2", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("gives the digest of node:crypto at each length near a block edge", () => {
    for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const s = "x".repeat(n);
      expect(sha256Hex(s), String(n)).toBe(nodeSha(s));
    }
  });

  it("gives the digest of node:crypto for 200 seeded strings with characters of 1 to 4 bytes", () => {
    const r = random("sha256Hex");
    for (let i = 0; i < 200; i++) {
      const s = textOf(r, r.int(0, 90));
      expect(sha256Hex(s)).toBe(nodeSha(Buffer.from(s, "utf8")));
      expect(sha256Hex(s, { input: "wtf8" })).toBe(sha256Hex(s));
    }
  });

  it("reads a lone surrogate as U+FFFD by default, and as its own 3 bytes with wtf8", () => {
    for (const s of ["\ud800", "a\udc00b", "\ud83d", "x\ud83d😀"]) {
      expect(sha256Hex(s), JSON.stringify(s)).toBe(nodeSha(Buffer.from(s, "utf8")));
      expect(sha256Hex(s, { input: "wtf8" })).not.toBe(sha256Hex(s));
    }
    expect(sha256Hex("\ud800", { input: "wtf8" })).toBe(nodeSha(new Uint8Array([0xed, 0xa0, 0x80])));
    expect(sha256Hex("a\udc00b", { input: "wtf8" })).toBe(nodeSha(new Uint8Array([0x61, 0xed, 0xb0, 0x80, 0x62])));
  });

  it("refuses an unknown input", () => {
    expect(() => sha256Hex("a", { input: "latin1" as "utf8" })).toThrow(RangeError);
  });
});

/** This function gives a seeded JSON value of at most `depth` levels. */
function valueOf(r: Random, depth: number): unknown {
  const kind = r.int(0, depth > 0 ? 7 : 4);
  switch (kind) {
    case 0:
      return null;
    case 1:
      return r.chance(0.5);
    case 2:
      return r.pick([0, -1, 1.5, 0.1, 1e21, 1e-7, -0, 333333333.33333329, Number.MAX_SAFE_INTEGER, r.range(-1e6, 1e6)]);
    case 3:
      return r.int(-1000, 1000);
    case 4:
      return textOf(r, r.int(0, 6));
    case 5:
      return Array.from({ length: r.int(0, 4) }, () => valueOf(r, depth - 1));
    default: {
      const o: Record<string, unknown> = {};
      for (let i = r.int(0, 5); i > 0; i--) o[textOf(r, r.int(0, 3))] = valueOf(r, depth - 1);
      return o;
    }
  }
}

/** This function gives a copy of a value with the keys of each object in the reverse order. */
function reversed(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reversed);
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)]));
}

describe("canonicalJson", () => {
  it("gives the output of the example of RFC 8785, section 3.2.2", () => {
    const input = JSON.parse(String.raw`{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"€$\u000F\u000aA'B\"\\\\\"\/","literals":[null,true,false]}`);
    expect(canonicalJson(input)).toBe(String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`);
  });

  it("sorts the keys by their UTF-16 code units, at each depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 0, y: 1 }], c: 2 } })).toBe('{"a":{"c":2,"d":[3,{"y":1,"z":0}]},"b":1}');
    expect(canonicalJson({ "é": 1, z: 2, "😀": 3, "｡": 4 })).toBe('{"z":2,"é":1,"😀":3,"｡":4}');
  });

  it("drops a key with undefined, and writes null for an undefined item or value", () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("writes the numbers of JSON.stringify", () => {
    expect(canonicalJson([-0, 1e21, 1e-7, 0.1 + 0.2, 100])).toBe("[0,1e+21,1e-7,0.30000000000000004,100]");
  });

  it("refuses NaN, an infinite number and a lone surrogate in the form jcs, and writes them as JSON.stringify does in the form json", () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, [Number.NEGATIVE_INFINITY], "\ud800", { "\udc00": 1 }]) {
      expect(() => canonicalJson(v), String(v)).toThrow(RangeError);
    }
    expect(canonicalJson([Number.NaN, Number.POSITIVE_INFINITY], { form: "json" })).toBe("[null,null]");
    expect(canonicalJson("a\ud800", { form: "json" })).toBe(JSON.stringify("a\ud800"));
  });

  it("refuses a bigint by default, and writes the digits and n with the option suffix", () => {
    expect(() => canonicalJson({ a: 12n })).toThrow(TypeError);
    expect(canonicalJson({ a: 12n, b: [-3n] }, { bigint: "suffix" })).toBe('{"a":12n,"b":[-3n]}');
  });

  it("refuses a function, a symbol and a cycle", () => {
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    for (const v of [() => 1, Symbol("s"), { f: () => 1 }, cycle]) expect(() => canonicalJson(v)).toThrow(TypeError);
  });

  it("writes a value that is twice in a tree, which is not a cycle", () => {
    const shared = { a: 1 };
    expect(canonicalJson({ x: shared, y: [shared] })).toBe('{"x":{"a":1},"y":[{"a":1}]}');
  });

  it("uses toJSON, as JSON.stringify does", () => {
    const d = new Date(Date.UTC(2026, 10, 8));
    expect(canonicalJson({ d })).toBe('{"d":"2026-11-08T00:00:00.000Z"}');
  });

  it("refuses an unknown option", () => {
    expect(() => canonicalJson(1, { form: "yaml" as "jcs" })).toThrow(RangeError);
    expect(() => canonicalJson(1, { bigint: "string" as "error" })).toThrow(RangeError);
  });

  it("is idempotent, does not depend on the key order, and gives the same text for JSON.parse of its output (500 seeded values)", () => {
    const r = random("canonicalJson");
    for (let i = 0; i < 500; i++) {
      const v = valueOf(r, 4);
      const out = canonicalJson(v);
      expect(canonicalJson(JSON.parse(out))).toBe(out);
      expect(canonicalJson(reversed(v))).toBe(out);
      expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(v)));
    }
  });
});

describe("canonicalHash", () => {
  it("is sha256Hex of canonicalJson, so the key order does not change it", () => {
    expect(canonicalHash({ b: 1, a: 2 })).toBe(sha256Hex('{"a":2,"b":1}'));
    expect(canonicalHash({ b: 1, a: 2 })).toBe(canonicalHash({ a: 2, b: 1 }));
    expect(canonicalHash({ a: 1n }, { bigint: "suffix" })).toBe(sha256Hex('{"a":1n}'));
  });
});
