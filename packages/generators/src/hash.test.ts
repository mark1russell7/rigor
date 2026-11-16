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

/** This function gives the RFC 8785 form of a JSON value with no `undefined`: the sorted keys and the text of `JSON.stringify`. */
function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(",")}]`;
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`)
    .join(",")}}`;
}

/** This function gives a value with a `Date`, a `RegExp`, a `Map`, a `Set` or a `bigint` at some places. */
function typedValueOf(r: Random, depth: number): unknown {
  const kind = r.int(0, depth > 0 ? 9 : 6);
  switch (kind) {
    case 0:
    case 1:
      return valueOf(r, 0);
    case 2:
      return r.chance(0.05) ? new Date(Number.NaN) : new Date(r.int(-1e12, 4e12));
    case 3:
      return new RegExp(r.pick(["a+b", "^x$", "\\d{2}", "[é😀]", "a\\/b"]), r.pick(["", "g", "gi", "u"]));
    case 4:
      return BigInt(r.int(-1e6, 1e6)) * BigInt(r.int(1, 1e6));
    case 5:
      return r.int(-1000, 1000);
    case 6:
      return textOf(r, r.int(0, 4));
    case 7:
      return new Map(Array.from({ length: r.int(0, 4) }, () => [typedValueOf(r, depth - 1), typedValueOf(r, depth - 1)] as const));
    case 8:
      return new Set(Array.from({ length: r.int(0, 4) }, () => typedValueOf(r, depth - 1)));
    default: {
      const o: Record<string, unknown> = {};
      for (let i = r.int(0, 4); i > 0; i--) o[textOf(r, r.int(0, 3))] = r.chance(0.3) ? [typedValueOf(r, depth - 1)] : typedValueOf(r, depth - 1);
      return o;
    }
  }
}

/** This function gives a copy of a typed value with new objects, and the insertion order of each object, `Map` and `Set` reversed. */
function rebuilt(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(rebuilt);
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof RegExp) return new RegExp(v.source, v.flags);
  if (v instanceof Map) return new Map([...v].reverse().map(([k, x]: [unknown, unknown]) => [rebuilt(k), rebuilt(x)] as const));
  if (v instanceof Set) return new Set([...v].reverse().map(rebuilt));
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, rebuilt(x)]));
}

/**
 * This function is the cache key of the client of procedures at its fix of the `Date` bug (mark1russell7/client afb692fa).
 * The tags of `canonicalJson` have its form, so that client keeps each key when it moves to this package.
 */
function clientKey(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(clientKey).join(",")}]`;
  if (value instanceof Date) return `Date(${value.getTime()})`;
  if (value instanceof RegExp) return `RegExp(${JSON.stringify(String(value))})`;
  if (value instanceof Map) {
    return `Map(${[...value]
      .map(([key, item]: [unknown, unknown]) => `[${clientKey(key)},${clientKey(item)}]`)
      .sort()
      .join(",")})`;
  }
  if (value instanceof Set) return `Set(${[...value].map(clientKey).sort().join(",")})`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${clientKey(obj[key])}`)
    .join(",");
  return `{${body}}`;
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

describe("canonicalJson with the option tags", () => {
  const typed = { tags: "typed" } as const;

  it("writes a Date, a RegExp, a Map, a Set and a bigint with a tag", () => {
    const value = { at: new Date(0), re: /ab+c/gi, m: new Map<unknown, unknown>([[2, "b"], [1, { y: 1, x: 2 }]]), s: new Set(["b", "a"]), n: 12n };
    expect(canonicalJson(value, typed)).toBe('{"at":Date(0),"m":Map([1,{"x":2,"y":1}],[2,"b"]),"n":12n,"re":RegExp("/ab+c/gi"),"s":Set("a","b")}');
    expect(canonicalJson([new Date(Number.NaN), new Map(), new Set()], typed)).toBe("[Date(NaN),Map(),Set()]");
    expect(canonicalJson(new Set([new Map([["k", new Set([1n])]])]), typed)).toBe('Set(Map(["k",Set(1n)]))');
  });

  it("gives other texts for two values that differ only in a Date, a RegExp, a Map or a Set", () => {
    const pairs: readonly (readonly [unknown, unknown])[] = [
      [new Date(0), new Date(1)],
      [/a/g, /a/i],
      [new Map([[1, 2]]), new Map([[1, 3]])],
      [new Map([[1, 2]]), new Map([[2, 2]])],
      [new Set([1]), new Set([2])],
      [new Map([[1, 2]]), new Set([[1, 2]])],
      [new Set([1, 2]), [1, 2]],
    ];
    for (const [a, b] of pairs) expect(canonicalHash({ key: a }, typed), `${String(a)} and ${String(b)}`).not.toBe(canonicalHash({ key: b }, typed));
  });

  it("gives other hashes for each two other Dates (500 seeded pairs)", () => {
    const r = random("canonicalJson tags dates");
    for (let i = 0; i < 500; i++) {
      const a = r.int(-1e12, 4e12);
      const b = a + r.pick([1, -1, r.int(2, 1e9)]);
      expect(canonicalHash({ at: new Date(a) }, typed)).not.toBe(canonicalHash({ at: new Date(b) }, typed));
    }
  });

  it("keeps the form of JSON.stringify by default, so no hash of an earlier version changes", () => {
    const d = new Date(Date.UTC(2026, 10, 8));
    expect(canonicalJson({ d })).toBe('{"d":"2026-11-08T00:00:00.000Z"}');
    expect(canonicalJson({ d }, { tags: "none" })).toBe('{"d":"2026-11-08T00:00:00.000Z"}');
    expect(canonicalJson({ m: new Map([[1, 2]]), s: new Set([1]), re: /a/ })).toBe('{"m":{},"re":{},"s":{}}');
    expect(() => canonicalJson({ a: 12n })).toThrow(TypeError);
  });

  it("keeps an explicit bigint error, and refuses a cycle through a Map or a Set", () => {
    expect(() => canonicalJson(1n, { tags: "typed", bigint: "error" })).toThrow(TypeError);
    const m = new Map<string, unknown>();
    m.set("self", m);
    const s = new Set<unknown>();
    s.add([s]);
    for (const v of [m, s, { a: m }]) expect(() => canonicalJson(v, typed)).toThrow(TypeError);
    const shared = new Set([1]);
    expect(canonicalJson([shared, shared], typed)).toBe("[Set(1),Set(1)]");
  });

  it("refuses an unknown value of the option", () => {
    expect(() => canonicalJson(1, { tags: "all" as "none" })).toThrow(RangeError);
  });

  it("changes nothing on JSON values, and the default is the sorted text of JSON.stringify (500 seeded values)", () => {
    const r = random("canonicalJson tags json");
    for (let i = 0; i < 500; i++) {
      const v = valueOf(r, 4);
      const expected = sortedJson(v);
      expect(canonicalJson(v)).toBe(expected);
      expect(canonicalJson(v, typed)).toBe(expected);
      expect(canonicalHash(v, typed)).toBe(canonicalHash(v));
    }
  });

  it("does not depend on the order of insertion or on the identity of the objects (500 seeded values)", () => {
    const r = random("canonicalJson tags order");
    for (let i = 0; i < 500; i++) {
      const v = typedValueOf(r, 3);
      const out = canonicalJson(v, typed);
      expect(canonicalJson(rebuilt(v), typed)).toBe(out);
      expect(canonicalJson(v, typed)).toBe(out);
    }
  });

  it("gives the cache key of the client of procedures, byte for byte (500 seeded values)", () => {
    const r = random("canonicalJson tags client");
    for (let i = 0; i < 500; i++) {
      const v = typedValueOf(r, 3);
      expect(canonicalJson(v, typed)).toBe(clientKey(v));
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
