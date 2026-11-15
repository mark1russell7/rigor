import { describe, expect, it } from "vitest";
import { deriveSeed, fnv1a32, mulberry32, random, randomOf, seedOf, seedsFrom, stablePick } from "./random.ts";

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

  it("gives the hash of the bytes of TextEncoder for utf8, with no API of the platform", () => {
    const encoder = new TextEncoder();
    const bytes = (s: string): number => {
      let h = 0x811c9dc5;
      for (const b of encoder.encode(s)) h = Math.imul(h ^ b, 0x01000193);
      return h >>> 0;
    };
    for (const s of strings()) expect(fnv1a32(s)).toBe(bytes(s));
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

  it("reads a list of seeds and ranges, as the seed lists of the algebra benches", () => {
    expect(seedsFrom("1,3,9-11", [])).toEqual([1, 3, 9, 10, 11]);
    expect(seedsFrom(" 4 , 2-3 ,-7", [1])).toEqual([4, 2, 3, -7]);
    expect(seedsFrom("5-5", [])).toEqual([5]);
    expect(() => seedsFrom("5-2", [])).toThrow(RangeError);
    expect(() => seedsFrom("x", [])).toThrow(RangeError);
    expect(() => seedsFrom("1,,2", [])).toThrow(/empty part/);
    expect(() => seedsFrom("1,", [])).toThrow(/empty part/);
    expect(() => seedsFrom("0-1000000", [])).toThrow(/at most/);
    expect(seedsFrom("0-999999", [])).toHaveLength(1_000_000);
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

  it("gives Gumbel samples with the known mean and variance", () => {
    const r = random("gumbel");
    const n = 40_000;
    const xs = draws(() => r.gumbel(2, 3), n);
    const mean = xs.reduce((sum, x) => sum + x, 0) / n;
    const variance = xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
    // The mean is 2 + 3γ and the variance is (π · 3)² / 6. The bounds are about 5 standard errors.
    expect(Math.abs(mean - (2 + 3 * 0.5772156649))).toBeLessThan(0.08);
    expect(Math.abs(variance / ((Math.PI * 3) ** 2 / 6) - 1)).toBeLessThan(0.06);
  });

  it("gives the inverse of the Gumbel CDF, a finite value at 0, and an error for a bad scale", () => {
    expect(randomOf(() => Math.exp(-1), 0).gumbel()).toBe(0);
    expect(randomOf(() => Math.exp(-1), 0).gumbel(5, 2)).toBe(5);
    expect(Number.isFinite(randomOf(() => 0, 0).gumbel())).toBe(true);
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => random(1).gumbel(0, scale)).toThrow(RangeError);
    const a = random("same");
    const b = random("same");
    expect(draws(() => a.gumbel(), 5)).toEqual(draws(() => b.gumbel(), 5));
  });

  it("puts each item first with a probability in proportion to its weight (Gumbel-max)", () => {
    const r = random("gumbel-max");
    const weights = [1, 2, 3, 4];
    const firsts = [0, 0, 0, 0];
    const n = 40_000;
    for (let i = 0; i < n; i++) {
      const keys = weights.map((w) => Math.log(w) + r.gumbel());
      firsts[keys.indexOf(Math.max(...keys))]! += 1;
    }
    // The probability of index i is weights[i] / 10. Each bound is about 6 standard errors.
    for (const [i, count] of firsts.entries()) expect(Math.abs(count / n - (weights[i] as number) / 10)).toBeLessThan(0.015);
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

describe("stablePick", () => {
  const SEEDS = 10_000;
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i + 1}`);
  /** The share of the seeds where the two lists give another item, and the items that those draws give with `after`. */
  function moved(before: readonly string[], after: readonly string[]): { share: number; to: Set<string>; from: Set<string> } {
    const to = new Set<string>();
    const from = new Set<string>();
    let count = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const a = stablePick(seed, before);
      const b = stablePick(seed, after);
      if (a !== b) {
        count += 1;
        from.add(a);
        to.add(b);
      }
    }
    return { share: count / SEEDS, to, from };
  }

  it("moves only the draws that a new item wins, at each size of the list", () => {
    for (const n of [2, 9, 50]) {
      const { to } = moved(names(n), names(n + 1));
      expect([...to]).toEqual([`s${n + 1}`]);
    }
  });

  it("moves a share of the draws near 1 / (n + 1)", () => {
    expect(moved(names(1), names(2)).share).toBeGreaterThan(0.47);
    expect(moved(names(1), names(2)).share).toBeLessThan(0.53);
    expect(moved(names(9), names(10)).share).toBeGreaterThan(0.085);
    expect(moved(names(9), names(10)).share).toBeLessThan(0.115);
  });

  it("gives no item a large share, on keys that differ in one character", () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const item = stablePick(seed, names(10));
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    expect(counts.size).toBe(10);
    for (const count of counts.values()) {
      expect(count / SEEDS).toBeGreaterThan(0.085);
      expect(count / SEEDS).toBeLessThan(0.115);
    }
  });

  it("does not depend on the order of the list", () => {
    const list = names(12);
    const reversed = [...list].reverse();
    const shuffled = random(5).shuffle(list);
    for (let seed = 0; seed < SEEDS; seed++) {
      const item = stablePick(seed, list);
      expect(stablePick(seed, reversed)).toBe(item);
      expect(stablePick(seed, shuffled)).toBe(item);
    }
  });

  it("moves only the draws of an item that the list loses", () => {
    const list = names(9);
    const { from } = moved(list, list.filter((name) => name !== "s4"));
    expect([...from]).toEqual(["s4"]);
  });

  it("reads the key with keyOf, and gives the item", () => {
    const items = names(5).map((name) => ({ name }));
    const item = stablePick(7, items, (x) => x.name);
    expect(items).toContain(item);
    expect(item.name).toBe(stablePick(7, names(5)));
  });

  it("gives the small key on a tie of the weights, in each order of the list", () => {
    const weight = (key: string): number => mulberry32(deriveSeed(1, key))();
    expect(weight("k1445")).toBe(weight("k56133"));
    expect(stablePick(1, ["k1445", "k56133"])).toBe("k1445");
    expect(stablePick(1, ["k56133", "k1445"])).toBe("k1445");
  });

  it("gives a seed and the next seed the same item with a share near 1 / n", () => {
    const list = names(4);
    let same = 0;
    for (let seed = 0; seed < SEEDS; seed++) if (stablePick(seed, list) === stablePick(seed + 1, list)) same += 1;
    expect(same / SEEDS).toBeGreaterThan(0.225);
    expect(same / SEEDS).toBeLessThan(0.275);
  });

  it("refuses an empty list and a key that occurs twice", () => {
    expect(() => stablePick(1, [])).toThrow(RangeError);
    expect(() => stablePick(1, ["a", "b", "a"])).toThrow(/occurs twice/);
  });

  describe("the frozen table", () => {
    // Stored rows depend on these choices. A change to `stablePick`, `deriveSeed` or `mulberry32` turns this test red, and such a change needs a new version of each corpus that reads them.
    const FROZEN_SEEDS = [0, 1, 2, 7, 1000, 123456789, 4294967295];
    const FORMS = ["fixed", "freeHeight", "freeAspect", "freeArea"];
    const FROZEN_FORMS = ["fixed", "freeAspect", "freeArea", "fixed", "fixed", "fixed", "fixed"];

    it("gives these choices for each seed and list", () => {
      const at = (list: readonly string[]): string[] => FROZEN_SEEDS.map((seed) => stablePick(seed, list));
      expect(at(["s1", "s2", "s3", "s4"])).toEqual(["s2", "s4", "s4", "s3", "s1", "s3", "s2"]);
      expect(at(FORMS)).toEqual(FROZEN_FORMS);
      expect(at(["I", "II", "III", "IV", "V", "VI"])).toEqual(["III", "V", "I", "III", "II", "VI", "IV"]);
      expect(at(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"])).toEqual(["4", "5", "10", "6", "8", "8", "5"]);
    });

    it("holds the seeds of the weights", () => {
      expect(deriveSeed(0, "s1")).toBe(4035012447);
      expect(deriveSeed(1, "fixed")).toBe(1171189756);
      expect(deriveSeed(4294967295, "I")).toBe(846015251);
    });

    it("goes red on a changed form of the key", () => {
      const changed = FROZEN_SEEDS.map((seed) => stablePick(seed, FORMS, (key) => `${key}!`));
      expect(changed).toEqual(["freeHeight", "fixed", "fixed", "freeArea", "freeArea", "freeAspect", "freeAspect"]);
      expect(changed).not.toEqual(FROZEN_FORMS);
    });
  });
});
