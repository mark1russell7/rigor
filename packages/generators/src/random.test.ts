import { describe, expect, it } from "vitest";
import { deriveSeed, fnv1a32, mulberry32, random, randomOf, seedOf, seedsFrom } from "./random.ts";

/** mulberry32 in its first published form (`| 0` on the state, `(t + imul) ^ t`), as in layout-contract. */
function original(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** lag's createRng (packages/load/src/rng.ts): int, normal and pick. */
function lagRng(seed: number) {
  const next = mulberry32(seed);
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    normal: () => {
      const u1 = Math.max(next(), 1e-12);
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)] as T,
  };
}

const draws = (f: () => number, n: number): number[] => Array.from({ length: n }, f);

describe("mulberry32", () => {
  it("gives the known first values of seed 1", () => {
    expect(draws(mulberry32(1), 3)).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it("gives the numbers of the first published form for each seed", () => {
    const seeds = [0, 1, 2, 42, 0x7fffffff, 0x80000000, 0xffffffff, -1, 2 ** 40 + 3];
    for (let i = 0; i < 200; i++) seeds.push(Math.imul(i, 2654435761) >>> 0);
    for (const seed of seeds) expect(draws(mulberry32(seed), 64)).toEqual(draws(original(seed), 64));
  });
});

describe("fnv1a32", () => {
  it("gives the reference hashes, of the UTF-8 bytes", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
    expect(fnv1a32("é")).not.toBe(fnv1a32("é".normalize("NFD")));
  });

  /** The UTF-16 form of highways (`fnv1a` of `src/highways/corridors`): one code unit for each step. */
  function units(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** The WTF-8 form of highways (`fnv1a32` of `src/bench/screen/hash.ts`): the UTF-8 bytes of each code point. */
  function codePointBytes(text: string): number {
    const out: number[] = [];
    for (const ch of text) {
      const c = ch.codePointAt(0) as number;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    let h = 0x811c9dc5;
    for (const byte of out) {
      h ^= byte;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** 1000 strings from a seeded source: ASCII, two-byte, three-byte and astral characters, and lone surrogates. */
  function strings(): string[] {
    const r = random("fnv1a32-input");
    const pool = [0x41, 0x7a, 0x30, 0x20, 0xe9, 0x3b1, 0x4e2d, 0xffff, 0xd800, 0xdbff, 0xdc00, 0xdfff];
    const out = ["", "\uD800", "a\uDC00b", "\uDC00\uD800", "😀"];
    while (out.length < 1000) {
      let s = "";
      const length = r.int(0, 12);
      for (let i = 0; i < length; i++) {
        const kind = r.below(4);
        if (kind === 0) s += String.fromCharCode(r.int(0x20, 0x7e));
        else if (kind === 1) s += String.fromCharCode(r.pick(pool));
        else if (kind === 2) s += String.fromCodePoint(r.int(0x10000, 0x10ffff));
        else s += String.fromCharCode(r.int(0, 0xffff));
      }
      out.push(s);
    }
    return out;
  }

  /** `true` when the string has no lone surrogate. */
  const wellFormed = (s: string): boolean => !/\p{Cs}/u.test(s);

  it("keeps the old hashes when the input is utf8 or not given", () => {
    for (const s of strings()) expect(fnv1a32(s, { input: "utf8" })).toBe(fnv1a32(s));
    expect(fnv1a32("foobar", { input: "utf8" })).toBe(0xbf9cf968);
    expect(fnv1a32("\uD800")).toBe(55024714);
  });

  it("gives the hash of the UTF-16 code units, equal to the copy of highways", () => {
    for (const s of strings()) expect(fnv1a32(s, { input: "utf16" })).toBe(units(s));
    expect(fnv1a32("", { input: "utf16" })).toBe(0x811c9dc5);
    expect(fnv1a32("\uD800", { input: "utf16" })).toBe(75617567);
    expect(fnv1a32("a\uDC00b", { input: "utf16" })).toBe(176117714);
  });

  it("gives the hash of the WTF-8 bytes, equal to the copy of highways", () => {
    for (const s of strings()) expect(fnv1a32(s, { input: "wtf8" })).toBe(codePointBytes(s));
    expect(fnv1a32("", { input: "wtf8" })).toBe(0x811c9dc5);
    expect(fnv1a32("\uD800", { input: "wtf8" })).toBe(1973925784);
    expect(fnv1a32("a\uDC00b", { input: "wtf8" })).toBe(2014720891);
  });

  it("gives the utf8 hash for wtf8 when the string has no lone surrogate", () => {
    const whole = strings().filter(wellFormed);
    expect(whole.length).toBeGreaterThan(100);
    for (const s of whole) expect(fnv1a32(s, { input: "wtf8" })).toBe(fnv1a32(s));
  });

  it("refuses an unknown input", () => {
    expect(() => fnv1a32("a", { input: "latin1" as "utf8" })).toThrow(RangeError);
  });
});

describe("seeds", () => {
  it("reads a number as 32 bits and a string by its hash", () => {
    expect(seedOf(-1)).toBe(0xffffffff);
    expect(seedOf(2 ** 32 + 5)).toBe(5);
    expect(seedOf("night-2026-10-29")).toBe(fnv1a32("night-2026-10-29"));
    expect(() => seedOf(Number.NaN)).toThrow(RangeError);
  });

  it("forks as layout-contract's stepRandom: mulberry32(fnv1a32(`<seed>:<step>`))", () => {
    const step = (seed: number, name: string) => mulberry32(fnv1a32(`${seed}:${name}`));
    expect(draws(random(7).fork("lanes").next, 32)).toEqual(draws(step(7, "lanes"), 32));
    expect(random(7).fork("lanes").seed).toBe(deriveSeed(7, "lanes"));
    expect(random(7).fork("a").next()).not.toBe(random(7).fork("b").next());
  });

  it("reads the seed of an environment variable, else the defaults", () => {
    expect(seedsFrom(undefined, [1, 2])).toEqual([1, 2]);
    expect(seedsFrom("  ", [1, 2])).toEqual([1, 2]);
    expect(seedsFrom("17", [1, 2])).toEqual([17]);
    expect(() => seedsFrom("x", [1])).toThrow(/integer/);
  });
});

describe("random", () => {
  it("draws as lag's createRng, coeval's random and client's integerOf", () => {
    for (const seed of [1, 99, 123456789]) {
      const ours = random(seed);
      const lag = lagRng(seed);
      const items = ["a", "b", "c", "d", "e"];
      for (let i = 0; i < 50; i++) {
        expect(ours.int(-3, 9)).toBe(lag.int(-3, 9));
        expect(ours.normal()).toBe(lag.normal());
        expect(ours.pick(items)).toBe(lag.pick(items));
        // coeval: int(below) = floor(next() * below); chance(p) = next() < p.
        expect(ours.below(7)).toBe(Math.floor(lag.next() * 7));
        expect(ours.chance(0.3)).toBe(lag.next() < 0.3);
      }
    }
  });

  it("gives each integer of a small range, and no other", () => {
    const r = random(3);
    const seen = new Set(draws(() => r.int(1, 6), 6000));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refuses bad bounds and empty lists", () => {
    const r = random(1);
    expect(() => r.int(2, 1)).toThrow(RangeError);
    expect(() => r.int(0.5, 2)).toThrow(RangeError);
    expect(() => r.below(0)).toThrow(RangeError);
    expect(() => r.pick([])).toThrow(RangeError);
    expect(() => r.weighted([0, 0])).toThrow(RangeError);
    expect(() => r.weighted([1, -1])).toThrow(RangeError);
    expect(() => r.sample([1, 2], 3)).toThrow(RangeError);
  });

  it("picks by weight, and never a weight of 0", () => {
    const r = random(5);
    const counts = [0, 0, 0];
    for (let i = 0; i < 9000; i++) counts[r.weighted([1, 0, 2])]! += 1;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(1.8);
    expect(counts[2]! / counts[0]!).toBeLessThan(2.2);
  });

  it("shuffles to a permutation, and samples different items", () => {
    const r = random(11);
    const items = Array.from({ length: 20 }, (_, i) => i);
    const shuffled = r.shuffle(items);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
    const picked = r.sample(items, 8);
    expect(new Set(picked).size).toBe(8);
    expect(r.sample(items, 0)).toEqual([]);
    expect(items[0]).toBe(0);
  });

  it("gives the same draws for the same seed, and starts at the seed", () => {
    const a = random("same");
    const b = random("same");
    expect([a.shuffle([1, 2, 3, 4, 5]), a.normal(10, 2), a.range(-1, 1)]).toEqual([b.shuffle([1, 2, 3, 4, 5]), b.normal(10, 2), b.range(-1, 1)]);
    expect(a.seed).toBe(fnv1a32("same"));
  });

  it("uses a source that you give, also for the forks", () => {
    const counter = (seed: number) => {
      let i = seed;
      return () => ((i++ % 10) + 0.5) / 10;
    };
    const r = random(0, counter);
    expect(r.below(10)).toBe(0);
    expect(r.below(10)).toBe(1);
    expect(randomOf(() => 0.99, 4).int(0, 9)).toBe(9);
    expect(r.fork("x").seed).toBe(deriveSeed(0, "x"));
  });
});
