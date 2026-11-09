/**
 * A pseudo-random number generator with a seed, and the draws that tests and benchmarks make from it.
 *
 * The generator is mulberry32. It is fast, it has 32 bits of state and it gives the same sequence for
 * the same seed on each platform. It is not for cryptography. Each repository that copied mulberry32
 * gets the same numbers from `random(seed).next`, so a move to this package keeps the records equal.
 */

/** A source of uniform numbers from 0 (included) to 1 (not included). */
export type Source = () => number;

/** The generator mulberry32. The seed is read as a 32-bit unsigned integer. */
export function mulberry32(seed: number): Source {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The FNV-1a hash of 32 bits of a string. The option `input` selects the units that the hash reads:
 *
 * - `"utf8"` (the default): the UTF-8 bytes, equal to the bytes of `TextEncoder`. A lone surrogate becomes the bytes of U+FFFD.
 * - `"utf16"`: the UTF-16 code units of the string, one unit for each step, from `charCodeAt`.
 * - `"wtf8"`: the UTF-8 bytes of each code point. A lone surrogate becomes its own 3 bytes (WTF-8).
 *
 * For a string without a lone surrogate, `"utf8"` and `"wtf8"` give the same hash. The function uses no API of Node or
 * of the browser, so the hash is the same on each platform.
 */
export function fnv1a32(text: string, options?: { readonly input?: "utf8" | "utf16" | "wtf8" }): number {
  const input = options?.input ?? "utf8";
  let h = 0x811c9dc5;
  if (input === "utf16") {
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }
  if (input !== "utf8" && input !== "wtf8") throw new RangeError(`fnv1a32: input is "utf8", "utf16" or "wtf8", not ${String(input)}.`);
  for (const ch of text) {
    let c = ch.codePointAt(0) as number;
    // A string iterator gives a lone surrogate as one code point. UTF-8 writes U+FFFD in its place, as TextEncoder does.
    if (input === "utf8" && c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) h = Math.imul(h ^ c, 0x01000193);
    else if (c < 0x800) {
      h = Math.imul(h ^ (0xc0 | (c >> 6)), 0x01000193);
      h = Math.imul(h ^ (0x80 | (c & 63)), 0x01000193);
    } else if (c < 0x10000) {
      h = Math.imul(h ^ (0xe0 | (c >> 12)), 0x01000193);
      h = Math.imul(h ^ (0x80 | ((c >> 6) & 63)), 0x01000193);
      h = Math.imul(h ^ (0x80 | (c & 63)), 0x01000193);
    } else {
      h = Math.imul(h ^ (0xf0 | (c >> 18)), 0x01000193);
      h = Math.imul(h ^ (0x80 | ((c >> 12) & 63)), 0x01000193);
      h = Math.imul(h ^ (0x80 | ((c >> 6) & 63)), 0x01000193);
      h = Math.imul(h ^ (0x80 | (c & 63)), 0x01000193);
    }
  }
  return h >>> 0;
}

/** The 32-bit seed of a number (its low 32 bits, unsigned) or of a string (its FNV-1a hash). */
export function seedOf(seed: number | string): number {
  if (typeof seed === "string") return fnv1a32(seed);
  if (!Number.isFinite(seed)) throw new RangeError(`seedOf: a seed is a finite number or a string, not ${seed}.`);
  return seed >>> 0;
}

/** The seed of the stream with the name `label` under `seed`: the hash of `"<seed>:<label>"`. */
export function deriveSeed(seed: number, label: string): number {
  return fnv1a32(`${seed}:${label}`);
}

/**
 * One item of a list, chosen by highest random weight: each key has a weight from `seed`, and the largest weight wins.
 *
 * - The order of the list does not change the choice. The smaller key wins a tie of weights.
 * - When a list gains an item, only the draws that the new item wins change. For `n` items, the share of those draws is approximately `1 / (n + 1)`.
 * - When a list loses an item, only the draws of that item change.
 *
 * The function reads one hash for each item, so a choice costs O(n). The list is not empty, and each key occurs once.
 */
export function stablePick<T>(seed: number, items: readonly T[], keyOf: (item: T) => string = String): T {
  if (items.length === 0) throw new RangeError("stablePick: the list is empty.");
  const start = seedOf(seed);
  const seen = new Set<string>();
  let best: { item: T; key: string; weight: number } | undefined;
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) throw new RangeError(`stablePick: the key ${JSON.stringify(key)} occurs twice.`);
    seen.add(key);
    const weight = mulberry32(deriveSeed(start, key))();
    if (best === undefined || weight > best.weight || (weight === best.weight && key < best.key)) best = { item, key, weight };
  }
  return (best as { item: T }).item;
}

export interface Random {
  /** The 32-bit seed that the generator started with. Write it in each failure message, so a run can replay. */
  readonly seed: number;
  /** A uniform number from 0 (included) to 1 (not included). */
  next(): number;
  /** A uniform integer from `min` to `max`, both included. */
  int(min: number, max: number): number;
  /** A uniform integer from 0 (included) to `n` (not included). */
  below(n: number): number;
  /** A uniform number from `min` (included) to `max` (not included). */
  range(min: number, max: number): number;
  /** `true` with the probability `p`. */
  chance(p: number): boolean;
  /** One item of a list that is not empty, each with the same probability. */
  pick<T>(items: readonly T[]): T;
  /** The index of a weight, with a probability in proportion to the weight. One draw. */
  weighted(weights: readonly number[]): number;
  /** A new list with the items in a uniform random order (Fisher–Yates, from the end). */
  shuffle<T>(items: readonly T[]): T[];
  /** `k` different items of a list, in the order of the draw (a partial Fisher–Yates). */
  sample<T>(items: readonly T[], k: number): T[];
  /** A normal sample (Box–Muller, two draws). */
  normal(mean?: number, sd?: number): number;
  /**
   * A Gumbel sample with the mode `location` and the scale `scale` (the inverse of the CDF, one draw).
   * The mean is `location + 0.5772 * scale`.
   * Add a Gumbel draw with the scale 1 to the log of each weight, and sort by the sums.
   * The order then has the Plackett-Luce law of the weights (the Gumbel-max method).
   */
  gumbel(location?: number, scale?: number): number;
  /** An independent generator for the part of the work with the name `label`. The same labels give the same streams. */
  fork(label: string): Random;
}

function wholeOrThrow(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name}: ${value} is not a safe integer.`);
}

/** A generator with draws, from a seed. The default source is mulberry32. */
export function random(seed: number | string, source: (seed: number) => Source = mulberry32): Random {
  const start = seedOf(seed);
  return randomOf(source(start), start, source);
}

/** A generator with draws, from a source that you give. `fork` uses `source` for the new streams. */
export function randomOf(next: Source, seed: number, source: (seed: number) => Source = mulberry32): Random {
  const below = (n: number): number => {
    wholeOrThrow("below", n);
    if (n < 1) throw new RangeError(`below: n is 1 or more, not ${n}.`);
    return Math.floor(next() * n);
  };
  return {
    seed,
    next,
    int(min, max) {
      wholeOrThrow("int", min);
      wholeOrThrow("int", max);
      if (min > max) throw new RangeError(`int: min ${min} is more than max ${max}.`);
      return min + Math.floor(next() * (max - min + 1));
    },
    below,
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick(items) {
      if (items.length === 0) throw new RangeError("pick: the list is empty.");
      return items[below(items.length)] as (typeof items)[number];
    },
    weighted(weights) {
      let total = 0;
      for (const w of weights) {
        if (!(Number.isFinite(w) && w >= 0)) throw new RangeError(`weighted: each weight is finite and 0 or more, not ${w}.`);
        total += w;
      }
      if (!(total > 0)) throw new RangeError("weighted: the sum of the weights is 0.");
      let left = next() * total;
      for (let i = 0; i < weights.length; i++) {
        left -= weights[i] as number;
        if (left < 0) return i;
      }
      // Rounding can leave a small remainder: give the last index with a weight.
      for (let i = weights.length - 1; ; i--) if ((weights[i] as number) > 0) return i;
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = below(i + 1);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
    sample(items, k) {
      wholeOrThrow("sample", k);
      if (k < 0 || k > items.length) throw new RangeError(`sample: k is from 0 to ${items.length}, not ${k}.`);
      const out = [...items];
      for (let i = 0; i < k; i++) {
        const j = i + below(out.length - i);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out.slice(0, k);
    },
    normal(mean = 0, sd = 1) {
      const u1 = Math.max(next(), 1e-12);
      const u2 = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    gumbel(location = 0, scale = 1) {
      if (!(Number.isFinite(scale) && scale > 0)) throw new RangeError(`gumbel: the scale is finite and more than 0, not ${scale}.`);
      // The same floor as normal: a draw of 0 gives a finite value, not minus infinity.
      const u = Math.max(next(), 1e-12);
      return location - scale * Math.log(-Math.log(u));
    },
    fork(label) {
      const child = deriveSeed(seed, label);
      return randomOf(source(child), child, source);
    },
  };
}

/** The largest count of seeds that one range gives. A larger range is an error, not a long run. */
const MAX_RANGE = 1_000_000;

/**
 * The seeds of a run: the seeds in `given` (the text of an environment variable, for example
 * `process.env.SEED`), else the default seeds. An empty text gives the defaults.
 *
 * The text is one seed (`17`) or a list of seeds and ranges with commas (`1,3,9-11` gives 1, 3, 9, 10
 * and 11), in the order of the list. A range has two whole numbers, the low one first. An empty part, a
 * part that is not an integer and a range with the low end last are each a `RangeError`.
 */
export function seedsFrom(given: string | undefined, defaults: readonly number[]): number[] {
  if (given === undefined || given.trim() === "") return [...defaults];
  return given.split(",").flatMap((raw) => {
    const part = raw.trim();
    const range = /^(\d+)\s*-\s*(\d+)$/u.exec(part);
    if (range !== null) {
      const [low, high] = [Number(range[1]), Number(range[2])];
      if (!Number.isSafeInteger(high) || high < low || high - low >= MAX_RANGE) {
        throw new RangeError(`seedsFrom: the range ${part} is not low-high with at most ${MAX_RANGE} seeds.`);
      }
      return Array.from({ length: high - low + 1 }, (_, i) => low + i);
    }
    const seed = part === "" ? Number.NaN : Number(part);
    if (!Number.isSafeInteger(seed)) throw new RangeError(`seedsFrom: a seed is an integer, not ${part === "" ? "an empty part" : part}.`);
    return [seed];
  });
}
