# @mark1russell7/rigor-generators

A seeded random number generator (mulberry32) with the draws that tests and benchmarks make. It operates in Node and in a browser, and it has no dependencies.

The same seed gives the same numbers on each platform. The generator is not for cryptography.

```sh
npm install @mark1russell7/rigor-generators
```

## Use

```ts
import { random, seedsFrom } from "@mark1russell7/rigor-generators";

const r = random(42); // or random("night 2026-10-29"): a text seed is hashed
r.next(); // a number from 0 (included) to 1 (not included)
r.int(1, 6); // an integer from 1 to 6, both included
r.below(10); // an integer from 0 to 9
r.range(-1, 1); // a number from -1 (included) to 1 (not included)
r.chance(0.3); // true with the probability 0.3
r.pick(["a", "b", "c"]); // one item
r.weighted([1, 2, 3]); // an index: 2 has the probability 3/6
r.shuffle([1, 2, 3, 4]); // a new list in a random order
r.sample([1, 2, 3, 4], 2); // 2 different items
r.normal(10, 2); // a normal value with the mean 10 and the standard deviation 2
r.fork("lanes"); // an independent generator for one part of the work
r.seed; // the 32-bit seed: write it in each failure message

// The seeds of a run: the seed of the environment variable SEED, else the defaults.
for (const seed of seedsFrom(process.env.SEED, [1, 2, 3, 4, 5])) {
  // ...
}
```

The package also exports the parts: `mulberry32(seed)` (the raw source), `fnv1a32(text)` (the FNV-1a hash of the UTF-8 bytes), `seedOf(seed)`, `deriveSeed(seed, label)` and `randomOf(source, seed)` (the draws over a source that you give).

## Move from a copy of mulberry32

Each common form of mulberry32 gives the same numbers as `random(seed).next`: the first published form (`| 0` on the state) and the form with `>>> 0`. These also give the same values:

| Your code | This package |
| --- | --- |
| `min + Math.floor(next() * (max - min + 1))` | `r.int(min, max)` |
| `Math.floor(next() * n)` | `r.below(n)` |
| `next() < p` | `r.chance(p)` |
| `items[Math.floor(next() * items.length)]` | `r.pick(items)` |
| Box–Muller with `Math.max(next(), 1e-12)` and `cos` | `r.normal()` |
| `mulberry32(fnv1a32(\`${seed}:${step}\`))` | `random(seed).fork(step)` |

The tests of the package compare each form with the package, for many seeds. After a move, start your tests and compare your records: they stay byte-equal.

## License

MIT
