# rigor

Shared libraries for measured work: seeded generators, statistics, gates, test generation, chaos and load.

Many engines make their own copies of these tools. The duplication atlas ([codeatlas](https://mark1russell7.github.io/codeatlas/)) found the same seeded generator written by hand approximately 40 times, in more than 10 repositories. This monorepo keeps one tested copy of each tool. Each engine moves to it one function at a time, and its records stay byte-equal.

**Site:** https://mark1russell7.github.io/rigor/ (try the generator in the browser, the status and the releases).

## Packages

| Package | State | What it gives |
| --- | --- | --- |
| [`@mark1russell7/rigor-generators`](packages/generators) | 0.1.0 | A seeded generator (mulberry32) and its draws: integers, picks, weights, shuffles, samples, normal values and named streams. |
| [`@mark1russell7/rigor-bench`](packages/bench) | 0.2.6 | The paired-time records of a bench, the order that turns each round, the time and limit verdicts against an A/A arm, and the budget verdict of one build. |
| statistics | planned | Bootstrap intervals, paired permutation tests, Holm, Wilson, Sobol, Brier and the noise rule of 5 seeds. |
| gates | planned | The determinism gate, the promotion test and the performance evidence of a release. |
| testgen | planned | Property tests on fast-check, pairwise and covering arrays, metamorphic relations. |
| [`@mark1russell7/rigor-testkit`](packages/testkit) | new | Test helpers: the code blocks of Markdown files as test cases. Property, pairwise and metamorphic helpers come here too. |
| [`@mark1russell7/rigor-chaos`](packages/chaos) | 0.1.0 | Open-loop load schedules from a rate profile, and a measure of latency from the planned time. Fault injection is planned. |
| [`@mark1russell7/rigor-mutation`](packages/mutation) | 0.1.0 | Mutation tests with Stryker for each package: the Stryker config of each package or part, a score with a gate for each package, and a check of the disabled mutants. |

The roadmap is in [docs/ROADMAP.md](docs/ROADMAP.md). The win test that layout-contract, packing and highways share is in [docs/WIN-TEST.md](docs/WIN-TEST.md).

## Use

```sh
npm install @mark1russell7/rigor-generators
```

```ts
import { random, seedsFrom } from "@mark1russell7/rigor-generators";

for (const seed of seedsFrom(process.env.SEED, [1, 2, 3, 4, 5])) {
  const r = random(seed);
  const lanes = r.fork("lanes"); // an independent stream for one part of the work
  const n = r.int(10, 1000); // 10 to 1000, both included
}
```

## Work in this repository

```sh
pnpm install
pnpm test
pnpm typecheck
node packages/site/src/build.ts --out dist   # the site, in packages/site/dist
```

CI does the tests, the typecheck, the conventions, the API reports and the STE lint on each pull request. The release workflow publishes each new version to npm (refer to [RELEASING.md](RELEASING.md)).

## License

MIT
