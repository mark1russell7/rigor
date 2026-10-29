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

const UTF8 = new TextEncoder();

/** The FNV-1a hash of 32 bits of the UTF-8 bytes of a string. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of UTF8.encode(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
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
    fork(label) {
      const child = deriveSeed(seed, label);
      return randomOf(source(child), child, source);
    },
  };
}

/**
 * The seeds of a run: the seed in `given` (the text of an environment variable, for example
 * `process.env.SEED`), else the default seeds. An empty text gives the defaults.
 */
export function seedsFrom(given: string | undefined, defaults: readonly number[]): number[] {
  if (given === undefined || given.trim() === "") return [...defaults];
  const seed = Number(given);
  if (!Number.isSafeInteger(seed)) throw new RangeError(`seedsFrom: a seed is an integer, not ${given}.`);
  return [seed];
}
