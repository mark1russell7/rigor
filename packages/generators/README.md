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

// The seeds of a run: the seeds of the environment variable SEED (for example "7" or "1,3,9-11"), else the defaults.
for (const seed of seedsFrom(process.env.SEED, [1, 2, 3, 4, 5])) {
  // ...
}
```

The package also exports the parts: `mulberry32(seed)` (the raw source), `fnv1a32(text, options)` (the FNV-1a hash), `seedOf(seed)`, `deriveSeed(seed, label)` and `randomOf(source, seed)` (the draws over a source that you give).

## A choice that a longer list does not move

`r.pick(items)` reads the length of the list, so a new item changes most of the choices. `stablePick(seed, items, keyOf)` gives each key a weight from the seed, and the largest weight wins:

```ts
stablePick(deriveSeed(7, "origin"), ["tall-row", "ladder", "half-wide"]);
```

- The order of the list does not change the choice.
- When a list gains an item, only the draws that the new item wins change. For `n` items, the share of those draws is approximately `1 / (n + 1)`. No form can make it 0: a new item takes the draws it wins.
- When a list loses an item, only the draws of that item change.
- A choice reads one hash for each item, so it costs O(n). `r.pick` costs O(1).

## Open families of distributions

A closed list of size names cannot grow without a change to each corpus. A `DistributionSpec` names a family and its parameters, so a corpus can name any point of the family.

| Family | Parameters | Numbers |
| --- | --- | --- |
| `lognormal` | `mu`, `sigma` | above 0, with a long tail |
| `pareto` | `scale`, `shape` | `scale` or more, with a heavy tail |
| `zipf` | `n`, `exponent` | the ranks from 1 to `n` |
| `beta` | `a`, `b` | from 0 to 1 |
| `mixture` | `parts`, each with a `weight` | one value of one part |
| `recorded` | `values` | one of the recorded values |

```ts
import { random, sampler } from "@mark1russell7/rigor-generators";

const next = sampler({ family: "lognormal", mu: [1, 2], sigma: 0.5 }, random("widths"));
const widths = Array.from({ length: 100 }, () => next());
```

A parameter is a number or a range `[min, max]`. `sampler` draws from a range once, so one sampler is one point of the family.

`Math.exp`, `Math.log` and `Math.pow` can give other results on another JavaScript engine. `dependsOnLibm` tells if a spec uses them. Only `recorded` does not, so write the numbers of the other families into a corpus when a corpus must match on each platform.

### Recorded tables

A corpus can draw real sizes. Each table has 100 midpoint quantiles of the recorded values, with its source, its license and its date. `recordedSpec` gives the spec of the family `recorded` for a table.

| Table | Values | Source | License |
| --- | --- | --- | --- |
| `DIAGRAM_BOX_AREA` | the areas of 9859 boxes of 293 real diagrams | the Ptolemy II models of the ELK model set | the Ptolemy II license. The field `notice` keeps its text |
| `GIT_BLOB_BYTES` | the sizes of 20751 files of one git tree | `microsoft/vscode` | MIT |

The tables keep the values of one measure, so a table gives no link between the width and the height of a box.

`scripts/recorded-tables.ts` rebuilds the numbers from the two sources.

Each table is a sample, and it does not show a general law:

- `DIAGRAM_BOX_AREA` reads each model of `realworld/ptolemy/flattened`. One tool drew these diagrams, so a small set of icon sizes has a large share. It leaves out the 254 models of `realworld/ptolemy/hierarchical`, and 46 of these have no flattened model. It also leaves out the hand-made graphs of `tests`, `tickets` and `examples`.
- `GIT_BLOB_BYTES` reads each file of one tree, also the binary files. It leaves out 34 empty files. One repository is one project, so a table of another repository has other values.

The npm package holds the notice of the Ptolemy II license, because the field `notice` is part of the build.

## The input of `fnv1a32`

The option `input` of `fnv1a32` selects the units that the hash reads. Use it to replace a local copy of FNV-1a with the same hashes.

| `input` | The hash reads | A copy with this form |
| --- | --- | --- |
| `"utf8"` (the default) | The bytes of `TextEncoder`. A lone surrogate becomes the bytes of U+FFFD. | `new TextEncoder().encode(text)` |
| `"utf16"` | Each UTF-16 code unit, one unit for each step. | `h ^= text.charCodeAt(i)` |
| `"wtf8"` | The UTF-8 bytes of each code point. A lone surrogate becomes its own 3 bytes. | A UTF-8 encoder over `for (const ch of text)` |

For a string without a lone surrogate, `"utf8"` and `"wtf8"` give the same hash.

## A content hash

`canonicalHash(value)` gives the SHA-256 digest of the canonical form of a value. Equal values give equal hashes, also when the keys of their objects have another order.

```ts
import { canonicalHash, canonicalJson, sha256Hex } from "@mark1russell7/rigor-generators";

canonicalJson({ b: [1, undefined], a: "x" }); // '{"a":"x","b":[1,null]}'
canonicalHash({ b: 1, a: 2 }) === canonicalHash({ a: 2, b: 1 }); // true
sha256Hex("abc"); // "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
```

The default form of `canonicalJson` is RFC 8785 (JCS). Two options change it:

| Option | The default | The other value |
| --- | --- | --- |
| `form` | `"jcs"`: `NaN`, an infinite number and a lone surrogate cause a `RangeError` | `"json"`: the form of `JSON.stringify`, so these values become `null` or an escape |
| `bigint` | `"error"`: a `bigint` causes a `TypeError` | `"suffix"`: the digits and `n`, for example `12n`. This text is not JSON, so use it only for a key |

The option `input` of `sha256Hex` has the values `"utf8"` and `"wtf8"` of `fnv1a32`. The two functions use no API of Node or of the browser. `sha256Hex` is not for passwords.

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
