import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { canonicalJsonV023 } from "./canonical-0.2.3.fixture.ts";
import { type CanonicalOptions, canonicalHash, canonicalJson, createSha256, type Sha256, sha256Hex } from "./hash.ts";
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

describe("sha256Hex with no node:crypto, as in a browser", () => {
  /** This function loads a fresh copy of the module while `process.getBuiltinModule` gives nothing, so the portable code runs. */
  async function portable(): Promise<typeof sha256Hex> {
    vi.resetModules();
    const spy = vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined as never);
    try {
      const mod = await import("./hash.ts");
      const hash = mod.sha256Hex;
      hash("");
      expect(spy).toHaveBeenCalledWith("node:crypto");
      return hash;
    } finally {
      spy.mockRestore();
    }
  }

  it("gives the same digest as node:crypto for the test vectors, the block edges, lone surrogates and 300 seeded strings", async () => {
    const hash = await portable();
    expect(hash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const n of [0, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) expect(hash("x".repeat(n)), String(n)).toBe(sha256Hex("x".repeat(n)));
    for (const s of ["�", "a�b", "�", "x�😀"]) expect(hash(s), JSON.stringify(s)).toBe(sha256Hex(s));
    const r = random("sha256Hex portable");
    for (let i = 0; i < 300; i++) {
      const s = textOf(r, r.int(0, 200));
      expect(hash(s)).toBe(sha256Hex(s));
      expect(hash(s, { input: "wtf8" })).toBe(sha256Hex(s, { input: "wtf8" }));
    }
  });

  it("uses the portable code when getBuiltinModule throws", async () => {
    vi.resetModules();
    const spy = vi.spyOn(process, "getBuiltinModule").mockImplementation(() => {
      throw new Error("no builtins here");
    });
    try {
      const mod = await import("./hash.ts");
      expect(mod.sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    } finally {
      spy.mockRestore();
    }
  });
});

/** The test vectors of FIPS 180-4 (the examples of NIST for SHA-256), as text and digest. */
const FIPS_VECTORS: readonly (readonly [string, string])[] = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  [
    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
  ],
];
/** The digest of one million bytes "a", the long vector of FIPS 180-4. */
const MILLION_A = "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0";

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

/** This function cuts the bytes at the given points, in order, and gives the parts. A part can be empty. */
function partsOf(bytes: Uint8Array, cuts: readonly number[]): Uint8Array[] {
  const points = cuts.map((c) => c % (bytes.length + 1)).sort((a, b) => a - b);
  const parts: Uint8Array[] = [];
  let from = 0;
  for (const p of points) {
    parts.push(bytes.subarray(from, p));
    from = p;
  }
  parts.push(bytes.subarray(from));
  return parts;
}

/** This function gives the digest of the parts through one hash of parts. */
function digestOf(make: () => Sha256, parts: readonly Uint8Array[]): string {
  const hash = make();
  for (const part of parts) expect(hash.update(part)).toBe(hash);
  return hash.digest();
}

/** The tests of bytes, for the hash of node:crypto and for the portable hash. */
function bytesSuite(load: () => Promise<{ sha256Hex: typeof sha256Hex; createSha256: typeof createSha256 }>): void {
  it("gives the digests of the test vectors of FIPS 180-4, also in parts of 1 byte", async () => {
    const mod = await load();
    for (const [text, digest] of FIPS_VECTORS) {
      expect(mod.sha256Hex(ascii(text)), text).toBe(digest);
      expect(digestOf(mod.createSha256, partsOf(ascii(text), [...ascii(text).keys()])), text).toBe(digest);
    }
    const million = new Uint8Array(1_000_000).fill(0x61);
    expect(mod.sha256Hex(million)).toBe(MILLION_A);
    expect(digestOf(mod.createSha256, partsOf(million, [1, 63, 64, 1000, 65_537, 999_999]))).toBe(MILLION_A);
  });

  it("gives the digest of node:crypto at each length near a block edge, and for a view with an offset", async () => {
    const mod = await load();
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
      expect(mod.sha256Hex(bytes), String(n)).toBe(nodeSha(bytes));
      const wide = new Uint8Array(n + 13);
      wide.set(bytes, 5);
      expect(mod.sha256Hex(wide.subarray(5, 5 + n)), `${n} at offset 5`).toBe(nodeSha(bytes));
    }
  });

  it("gives the digest of the whole bytes for each cut into parts (fast-check)", async () => {
    const mod = await load();
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 400 }), fc.array(fc.nat(400), { maxLength: 8 }), (bytes, cuts) => {
        const whole = mod.sha256Hex(bytes);
        expect(whole).toBe(nodeSha(bytes));
        expect(digestOf(mod.createSha256, partsOf(bytes, cuts))).toBe(whole);
      }),
      { numRuns: 300, seed: 1804 },
    );
  });

  it("gives the digest of the UTF-8 bytes of a string as the digest of the string", async () => {
    const mod = await load();
    const r = random("sha256Hex bytes");
    for (let i = 0; i < 100; i++) {
      const text = textOf(r, r.int(0, 90));
      expect(mod.sha256Hex(new TextEncoder().encode(text))).toBe(mod.sha256Hex(text));
    }
  });

  it("accepts a Buffer and bytes from another realm, and refuses other values", async () => {
    const mod = await load();
    expect(mod.sha256Hex(Buffer.from("abc"))).toBe(FIPS_VECTORS[1]![1]);
    const other = runInNewContext("new Uint8Array([0x61, 0x62, 0x63])") as Uint8Array;
    expect(mod.sha256Hex(other)).toBe(FIPS_VECTORS[1]![1]);
    for (const bad of [null, [1, 2], new Uint16Array(2), new ArrayBuffer(4), new DataView(new ArrayBuffer(4))]) {
      expect(() => mod.createSha256().update(bad as never)).toThrow(TypeError);
    }
  });

  it("refuses an update or a digest after the digest", async () => {
    const mod = await load();
    const hash = mod.createSha256().update(ascii("abc"));
    expect(hash.digest()).toBe(FIPS_VECTORS[1]![1]);
    expect(() => hash.update(ascii("d"))).toThrow(/gave its digest/);
    expect(() => hash.digest()).toThrow(/gave its digest/);
  });
}

describe("sha256Hex of bytes and createSha256, with node:crypto", () => {
  bytesSuite(async () => ({ sha256Hex, createSha256 }));
});

describe("sha256Hex of bytes and createSha256 with no node:crypto, as in a browser", () => {
  bytesSuite(async () => {
    vi.resetModules();
    const spy = vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined as never);
    try {
      const mod = await import("./hash.ts");
      mod.createSha256();
      expect(spy).toHaveBeenCalledWith("node:crypto");
      return { sha256Hex: mod.sha256Hex, createSha256: mod.createSha256 };
    } finally {
      spy.mockRestore();
    }
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

  it("keeps the ISO text of a Date by default, and refuses a Map, a Set and a RegExp with a text that names the option", () => {
    const d = new Date(Date.UTC(2026, 10, 8));
    expect(canonicalJson({ d })).toBe('{"d":"2026-11-08T00:00:00.000Z"}');
    expect(canonicalJson({ d }, { tags: "none" })).toBe('{"d":"2026-11-08T00:00:00.000Z"}');
    for (const v of [new Map([[1, 2]]), new Set([1]), /a/]) {
      expect(() => canonicalJson({ v }), String(v)).toThrow(TypeError);
      expect(() => canonicalJson({ v }), String(v)).toThrow('tags: "typed"');
    }
    expect(() => canonicalJson({ a: 12n })).toThrow(TypeError);
  });

  it("gives the tag of a Map or a Set that a method toJSON gives", () => {
    const holder = { toJSON: () => new Map([[1, new Set([2])]]) };
    expect(canonicalJson({ holder }, typed)).toBe('{"holder":Map([1,Set(2)])}');
    expect(() => canonicalJson({ holder })).toThrow(TypeError);
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

/** A class with its content in its own keys. */
class Point {
  readonly x: number;
  constructor(x: number) {
    this.x = x;
  }
}

/**
 * The classes of the strict default. Each `make` gives values with other contents for other `n` of odd distance.
 * `throws` is true for a class that keeps its content out of its own keys.
 */
const classes: readonly { readonly name: string; readonly make: (n: number) => unknown; readonly throws: boolean }[] = [
  { name: "Map", make: (n) => new Map([["k", n]]), throws: true },
  { name: "Set", make: (n) => new Set([n]), throws: true },
  { name: "WeakMap", make: (n) => new WeakMap([[{}, n]]), throws: true },
  { name: "WeakSet", make: (n) => new WeakSet([{ n }]), throws: true },
  { name: "RegExp", make: (n) => new RegExp(`x${n}`), throws: true },
  { name: "Error", make: (n) => new Error(`e${n}`), throws: true },
  { name: "Promise", make: (n) => Promise.resolve(n), throws: true },
  { name: "Symbol", make: (n) => Object(Symbol(`s${n}`)), throws: true },
  { name: "ArrayBuffer", make: (n) => new Float64Array([n]).buffer, throws: true },
  { name: "DataView", make: (n) => new DataView(new Float64Array([n]).buffer), throws: true },
  { name: "URLSearchParams", make: (n) => new URLSearchParams({ q: String(n) }), throws: true },
  { name: "Map Iterator", make: (n) => new Map([[n, n]]).entries(), throws: true },
  { name: "Proxy of a Map", make: (n) => new Proxy(new Map([[n, n]]), {}), throws: true },
  { name: "boxed BigInt", make: (n) => Object(BigInt(n)), throws: true },
  { name: "Date", make: (n) => new Date(n), throws: false },
  { name: "boxed Number", make: (n) => Object(n), throws: false },
  { name: "boxed String", make: (n) => Object(`s${n}`), throws: false },
  { name: "boxed Boolean", make: (n) => Object(n % 2 === 0), throws: false },
  { name: "Float64Array", make: (n) => new Float64Array([n]), throws: false },
  { name: "Int32Array", make: (n) => new Int32Array([n]), throws: false },
  { name: "class instance", make: (n) => new Point(n), throws: false },
  { name: "object with no prototype", make: (n) => Object.assign(Object.create(null) as object, { n }), throws: false },
];

describe("canonicalJson by default, for an object that keeps its content out of its own keys", () => {
  it("refuses each such class, and gives other hashes to other contents of each other class (100 seeded pairs a class)", () => {
    const r = random("canonicalJson strict default");
    for (const { name, make, throws } of classes) {
      for (let i = 0; i < 100; i++) {
        const n = r.int(-1e6, 1e6);
        const a = make(n);
        const b = make(n + 2 * r.int(0, 500) + 1);
        if (throws) {
          expect(() => canonicalHash({ v: a }), name).toThrow(TypeError);
          expect(() => canonicalHash({ v: b }), name).toThrow(TypeError);
        } else expect(canonicalHash({ v: a }), `${name} ${String(n)}`).not.toBe(canonicalHash({ v: b }));
      }
    }
  });

  it("gives the form of JSON.stringify for a boxed primitive and a typed array", () => {
    const values = [Object(1.5), Object("ab"), Object(false), new Uint8Array([3, 1]), { a: new Int16Array([-2]) }];
    for (const v of values) expect(canonicalJson(v), String(v)).toBe(JSON.stringify(v));
    expect(canonicalJson(Object(12n), { bigint: "suffix" })).toBe("12n");
  });

  it("names the option tags only for a type that it writes with a tag", () => {
    const messageOf = (f: () => unknown): string => {
      try {
        f();
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    expect(messageOf(() => canonicalJson(new Map()))).toContain('the type Map has no JSON form');
    expect(messageOf(() => canonicalJson(new Map()))).toContain('Use the option tags: "typed"');
    for (const [v, options] of [[new WeakMap(), undefined], [new Error("e"), { tags: "typed" as const }], [new Map(), undefined]] as const) {
      const message = messageOf(() => canonicalJson({ v }, options));
      expect(message, message).toContain("a method toJSON");
      if (!(v instanceof Map)) expect(message, message).not.toContain("tags");
    }
  });

  it("uses the internal slots, so a value from another realm gets the same form", () => {
    const foreign = runInNewContext('[new Map([[1, "a"]]), new Set([2]), /x/g, new Date(5), new Number(3), [4], { b: 1 }]') as unknown[];
    expect(canonicalJson(foreign, { tags: "typed" })).toBe('[Map([1,"a"]),Set(2),RegExp("/x/g"),Date(5),3,[4],{"b":1}]');
    expect(() => canonicalJson(foreign)).toThrow("the type Map has no JSON form");
    expect(() => canonicalJson(runInNewContext('new Error("e")'))).toThrow(TypeError);
  });

  it("does not give a tag to an object with only the name of a type, and accepts it with a method toJSON", () => {
    const spoof = { a: 1, [Symbol.toStringTag]: "Map" };
    expect(() => canonicalJson(spoof)).toThrow(TypeError);
    expect(() => canonicalJson(spoof, { tags: "typed" })).toThrow(TypeError);
    const named = { x: 1, [Symbol.toStringTag]: "Point", toJSON: () => ({ x: 1 }) };
    expect(canonicalJson(named)).toBe('{"x":1}');
  });
});

/** The result of one call: the text, or the type and the text of the error. */
function outcome(f: () => string): string {
  try {
    return `ok ${f()}`;
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message}`;
  }
}

/** The options that each comparison with version 0.2.3 uses. */
const optionSets: readonly (CanonicalOptions | undefined)[] = [
  undefined,
  { form: "json" },
  { tags: "typed" },
  { bigint: "suffix" },
  { form: "json", tags: "typed", bigint: "error" },
];

/** This function makes an object of `make`, and then gives it the prototype `Object.prototype`. Its brand stays the same. */
const plainProto = (make: () => object) => (): object => Object.setPrototypeOf(make(), Object.prototype) as object;

/** This function gives the `arguments` object of a call with `1` and `"a"`. */
function argumentsOf(..._: unknown[]): IArguments {
  return arguments;
}

/** The values with an edge of the brand path. Each value is a function, so that each call gets a new value. */
const edges: readonly (readonly [string, () => unknown])[] = [
  ["Date with the prototype Object.prototype", plainProto(() => new Date(5))],
  ["boxed Number with the prototype Object.prototype", plainProto(() => Object(3) as object)],
  ["boxed String with the prototype Object.prototype", plainProto(() => Object("ab") as object)],
  ["boxed Boolean with the prototype Object.prototype", plainProto(() => Object(true) as object)],
  ["boxed BigInt with the prototype Object.prototype", plainProto(() => Object(7n) as object)],
  ["Error with the prototype Object.prototype", plainProto(() => new Error("e"))],
  ["RegExp with the prototype Object.prototype", plainProto(() => /a/g)],
  ["Map with the prototype Object.prototype", plainProto(() => new Map([[1, 2]]))],
  ["array with the prototype Object.prototype", plainProto(() => [1, { b: 2 }])],
  ["Date with the prototype null", () => Object.setPrototypeOf(new Date(5), null) as object],
  ["Date with its own toJSON", () => Object.assign(new Date(5), { toJSON: () => ({ d: 1 }) })],
  ["plain object with its own tag Object", () => ({ a: 1, [Symbol.toStringTag]: "Object" })],
  ["plain object with its own tag Array", () => ({ a: 1, [Symbol.toStringTag]: "Array" })],
  ["plain object with its own tag Arguments", () => ({ a: 1, [Symbol.toStringTag]: "Arguments" })],
  ["plain object with its own tag Number", () => ({ a: 1, [Symbol.toStringTag]: "Number" })],
  ["plain object with its own tag Date", () => ({ a: 1, [Symbol.toStringTag]: "Date" })],
  ["plain object with a tag that is not a string", () => ({ a: 1, [Symbol.toStringTag]: 5 })],
  ["array with its own tag Object", () => Object.assign([1, 2], { [Symbol.toStringTag]: "Object" })],
  ["array with its own tag Arguments", () => Object.assign([1, 2], { [Symbol.toStringTag]: "Arguments" })],
  ["array with its own tag Map", () => Object.assign([1, 2], { [Symbol.toStringTag]: "Map" })],
  ["boxed Number with its own tag Object", () => Object.assign(Object(3) as object, { [Symbol.toStringTag]: "Object" })],
  ["Date with its own tag Object and no toJSON", () => Object.setPrototypeOf(Object.assign(new Date(5), { [Symbol.toStringTag]: "Object" }), null) as object],
  [
    "class instance with a tag on its prototype",
    () =>
      new (class Tagged {
        a = 1;
        get [Symbol.toStringTag](): string {
          return "Tagged";
        }
      })(),
  ],
  ["Uint8Array with the prototype Object.prototype", plainProto(() => new Uint8Array([1, 2]))],
  ["arguments object", () => argumentsOf(1, "a")],
  ["array with a hole", () => [1, , 3]],
  ["array subclass", () => new (class List extends Array<number> {})(3)],
  ["object with no prototype", () => Object.assign(Object.create(null) as object, { b: 1, a: [null] })],
  ["object with a symbol key and an undefined key", () => ({ [Symbol("s")]: 1, u: undefined, a: 2 })],
  [
    "getter that gives undefined at the first read",
    () => {
      let reads = 0;
      return {
        get a() {
          reads += 1;
          return reads === 1 ? undefined : reads;
        },
        b: 1,
      };
    },
  ],
  [
    "getter that gives a value at the first read only",
    () => {
      let reads = 0;
      return {
        get a() {
          reads += 1;
          return reads === 1 ? 1 : undefined;
        },
      };
    },
  ],
  ["foreign plain object, array, Date and boxed values", () => runInNewContext('[{ b: 1, a: [2] }, [3], new Date(5), new Number(3), new String("s")]')],
  ["foreign Date with the prototype Object.prototype", () => Object.setPrototypeOf(runInNewContext("new Date(5)") as object, Object.prototype) as object],
  ["foreign Error", () => runInNewContext('new Error("e")')],
  ["foreign Map", () => runInNewContext("new Map([[1, 2]])")],
  ["foreign object with a tag", () => runInNewContext('({ a: 1, [Symbol.toStringTag]: "Date" })')],
  ["foreign arguments object and typed array", () => runInNewContext("[(function () { return arguments; })(1), new Int8Array([-1])]")],
  [
    "cycle",
    () => {
      const a: Record<string, unknown> = { b: 1 };
      a["self"] = a;
      return a;
    },
  ],
  [
    "value that is used two times, with no cycle",
    () => {
      const shared = { x: 1 };
      return [shared, { s: shared }];
    },
  ],
];

/** This function gives a proxy of `target` and the log of the calls of its traps. */
function logged(target: object): { proxy: object; log: string[] } {
  const log: string[] = [];
  const proxy = new Proxy(target, {
    get(t, k, r) {
      log.push(`get ${String(k)}`);
      return Reflect.get(t, k, r) as unknown;
    },
    ownKeys(t) {
      log.push("ownKeys");
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, k) {
      log.push(`getOwnPropertyDescriptor ${String(k)}`);
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
    getPrototypeOf(t) {
      log.push("getPrototypeOf");
      return Reflect.getPrototypeOf(t);
    },
    has(t, k) {
      log.push(`has ${String(k)}`);
      return Reflect.has(t, k);
    },
  });
  return { proxy, log };
}

describe("canonicalJson against version 0.2.3", () => {
  it("gives the same text or the same error for each edge of the brand path, with each set of options", () => {
    for (const [name, make] of edges) {
      for (const options of optionSets) {
        const now = outcome(() => canonicalJson(make(), options));
        expect(now, `${name} ${JSON.stringify(options)}`).toBe(outcome(() => canonicalJsonV023(make(), options)));
      }
    }
  });

  it("keeps the brand of a Date, a boxed Number and an Error with the prototype Object.prototype", () => {
    // The Date has no toJSON on Object.prototype, but its brand stays Date. Thus it is not an empty plain object.
    expect(() => canonicalJson({ v: plainProto(() => new Date(5))() })).toThrow("the type Date has no JSON form");
    expect(canonicalJson({ v: plainProto(() => new Date(5))() }, { tags: "typed" })).toBe('{"v":Date(5)}');
    // The boxed Number keeps its brand, so it is unboxed with Number(). Without Number.prototype, Number() of it gives NaN.
    expect(() => canonicalJson(plainProto(() => Object(3) as object)())).toThrow("NaN is not a JSON number");
    expect(canonicalJson(plainProto(() => Object(3) as object)(), { form: "json" })).toBe("null");
    expect(() => canonicalJson(plainProto(() => new Error("e"))())).toThrow("the type Error has no JSON form");
    expect(() => canonicalJson(Object.setPrototypeOf(new Date(5), null) as object)).toThrow("the type Date has no JSON form");
    expect(() => canonicalJson({ a: 1, [Symbol.toStringTag]: "Array" })).toThrow("the type Array has no JSON form");
    expect(canonicalJson(Object.assign([1], { [Symbol.toStringTag]: "Object" }))).toBe("[1]");
    expect(canonicalJson(runInNewContext("new Number(4)"))).toBe("4");
  });

  it("gives the same calls to the traps of a proxy, and the same text or error", () => {
    const targets: readonly (() => object)[] = [
      () => ({ b: 1, a: { c: [2, 3] }, u: undefined }),
      () => [1, { a: 2 }, , 4],
      () => ({ toJSON: () => ({ z: 1 }) }),
      () => Object.assign(Object(3) as object, { k: 1 }),
      () => ({ a: 1, [Symbol.toStringTag]: "Map" }),
      () => new Date(5),
      () => new Map([[1, 2]]),
    ];
    for (const make of targets) {
      for (const options of optionSets) {
        const now = logged(make());
        const old = logged(make());
        const text = outcome(() => canonicalJson({ p: now.proxy }, options));
        expect(text, JSON.stringify(options)).toBe(outcome(() => canonicalJsonV023({ p: old.proxy }, options)));
        expect(now.log, `${text} ${JSON.stringify(options)}`).toEqual(old.log);
      }
    }
  });

  it("gives the same error for a revoked proxy, and for a proxy that revokes itself in the read of its tag", () => {
    const revoked = (): object => {
      const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
      revoke();
      return proxy;
    };
    expect(outcome(() => canonicalJson({ p: revoked() }))).toBe(outcome(() => canonicalJsonV023({ p: revoked() })));
    // The proxy gets the brand Object, and then the test of an array throws.
    const selfRevoking = (): object => {
      const box: { revoke?: () => void } = {};
      const { proxy, revoke } = Proxy.revocable(
        { a: 1 },
        {
          get(t, k, r) {
            if (k === Symbol.toStringTag) box.revoke?.();
            return Reflect.get(t, k, r) as unknown;
          },
        },
      );
      box.revoke = revoke;
      return proxy;
    };
    const now = outcome(() => canonicalJson({ p: selfRevoking() }));
    expect(now).toBe(outcome(() => canonicalJsonV023({ p: selfRevoking() })));
    expect(now).toMatch(/^TypeError/);
  });

  it("gives the same text or error for 400 values of fast-check, with each set of options", () => {
    const values = fc.anything({
      maxDepth: 4,
      withBigInt: true,
      withBoxedValues: true,
      withDate: true,
      withMap: true,
      withSet: true,
      withNullPrototype: true,
      withObjectString: true,
      withTypedArray: true,
      withSparseArray: true,
      withUnicodeString: true,
    });
    fc.assert(
      fc.property(values, (v) => {
        for (const options of optionSets) expect(outcome(() => canonicalJson(v, options))).toBe(outcome(() => canonicalJsonV023(v, options)));
      }),
      { numRuns: 400, seed: 8785 },
    );
  });

  it("finds a cycle at each depth, also past the 32 objects of the array of the path", () => {
    for (const depth of [1, 2, 31, 32, 33, 34, 100]) {
      for (const back of [0, Math.floor(depth / 2), depth - 1]) {
        const nodes: Record<string, unknown>[] = Array.from({ length: depth }, (_, i) => ({ i }));
        nodes.forEach((node, i) => {
          if (i + 1 < depth) node["next"] = nodes[i + 1];
        });
        const shared = { s: 1 };
        nodes[depth - 1]!["leaf"] = [shared, shared, { shared }];
        expect(outcome(() => canonicalJson(nodes[0])), `${depth} with no cycle`).toBe(outcome(() => canonicalJsonV023(nodes[0])));
        expect(canonicalJson(nodes[0])).not.toMatch(/^TypeError/);
        nodes[depth - 1]!["back"] = nodes[back];
        const now = outcome(() => canonicalJson(nodes[0]));
        expect(now, `${depth} back to ${back}`).toBe(outcome(() => canonicalJsonV023(nodes[0])));
        expect(now).toBe("TypeError: canonicalJson: the value has a cycle.");
      }
    }
    // A Map in a deep path, with the option tags.
    const deepMap: Record<string, unknown> = { v: 0 };
    let tail = deepMap;
    for (let i = 0; i < 40; i++) tail = (tail["next"] = { v: i + 1 }) as Record<string, unknown>;
    const map = new Map<unknown, unknown>([["root", deepMap]]);
    tail["map"] = map;
    expect(outcome(() => canonicalJson(map, { tags: "typed" }))).toBe(outcome(() => canonicalJsonV023(map, { tags: "typed" })));
    expect(outcome(() => canonicalJson(map, { tags: "typed" }))).toMatch(/has a cycle/);
  });

  it("gives the same text for the edges of the numbers", () => {
    const numbers = [0, -0, 1, -1, 0.1, 1e21, 1e-7, 5e-7, 123456789012345680000, 2 ** 53, -(2 ** 53) - 2, Number.MIN_VALUE, Number.MAX_VALUE, -1.5e-300, 1 / 3];
    for (const options of optionSets) {
      expect(canonicalJson(numbers, options)).toBe(canonicalJsonV023(numbers, options));
      expect(canonicalJson(numbers.map((n) => Object(n) as object), options)).toBe(canonicalJsonV023(numbers.map((n) => Object(n) as object), options));
    }
    expect(canonicalJson(numbers)).toBe(JSON.stringify(numbers));
  });

  it("sorts the keys as version 0.2.3 for each count of keys, with short and long lists", () => {
    const r = random("canonicalJson key order");
    const parts = ["a", "B", "z", "0", "9", "_", "-", "é", "ß", "€", "中", "😀", "𝄞", String.fromCharCode(0xffff), String.fromCharCode(0)];
    for (let i = 0; i < 300; i++) {
      const record: Record<string, number> = {};
      const count = r.int(0, 40);
      for (let j = 0; j < count; j++) {
        let key = "";
        for (let c = r.int(0, 4); c > 0; c--) key += r.pick(parts);
        record[key] = j;
      }
      expect(canonicalJson(record)).toBe(canonicalJsonV023(record));
    }
  });

  it("gives the same text for nested plain records from object literals and from JSON.parse", () => {
    const r = random("canonicalJson nested records");
    for (let i = 0; i < 200; i++) {
      const record = {
        id: `r-${i}`,
        meta: { at: r.int(0, 1e9), tags: [r.int(0, 9), "t"], geo: { lat: r.int(-90, 90) / 3, box: [1, 2, { z: null }] } },
        parts: Array.from({ length: r.int(0, 5) }, (_, j) => ({ name: `p${j}`, value: r.int(-50, 50) / 7, flags: { on: j % 2 === 0 } })),
        empty: {},
        list: [],
      };
      for (const v of [record, JSON.parse(JSON.stringify(record)) as unknown]) expect(canonicalJson(v)).toBe(canonicalJsonV023(v));
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
