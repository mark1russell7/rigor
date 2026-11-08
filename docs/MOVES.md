# Moves to rigor-generators (R3)

This file lists each hand-written copy of mulberry32 in the public repositories, and the steps of a move. The list comes from the duplication atlas of 2026-10-29 (classes with the topic "generators") and from a search for the constant `0x6D2B79F5`. The search also finds the copies that are too small for the atlas.

## The steps of one move

1. Add `@mark1russell7/rigor-generators` (`^0.1.0`) to the package of the copy.
2. Replace the copy with the import. Use the table of the package README for the helpers (`int`, `below`, `chance`, `pick`, `normal`, `fork`).
3. Before the change, write the records of one run (a bench, a fixture or a snapshot). After the change, write them again and compare the bytes. They must be equal.
4. Remove the copy, and its tests that test only the generator.
5. One pull request for each repository. Write "R3" in its title.

A copy with a different algorithm, or with different constants, is not a move. Keep it, and write it in the table below as "different".

## The copies

| Repository | Files | State |
| --- | --- | --- |
| AsyncBrowserContext | `test/interleave/order-variation.test.ts` | next |
| client | `packages/client/test/faults/random.ts` (also `integerOf`, `seedsOf`: `int`, `seedsFrom`) | next |
| coeval | `packages/core/src/generate.ts` (`random`: `next`, `below`, `chance`, `pick`) | next |
| crawler | `packages/polite-crawler/bench/find.mts`, `packages/site/src/lib/daemon-sim.ts`, `pace-compare.ts`, `site-visit.ts` | next |
| grafana-infra | `scripts/send-sample-data.mjs` | next |
| highways | `packages/core/src/fixtures.ts`, `src/highways/search/index.ts`, `src/plugs/assign/index.test.ts`, `src/routers/frames.test.ts`, `scripts/queue.ts`, `packages/site/src/boards.ts` | next |
| ireko | `packages/site/src/playground/fuzz.ts` | next |
| Jqy | `packages/site/src/playground/fuzz.ts` | next |
| lag | `packages/load/src/rng.ts` (`createRng`), `packages/site/src/fixtures/sample-results.ts`, `packages/site/build/og-image.ts` | next |
| layout-contract | `packages/layout-contract/src/balance.test.ts`, `measures.test.ts`, `text.test.ts`, `text-cache.test.ts` (layout-contract#279). `src/random.ts` uses `mulberry32` and `fnv1a32` of the package since layout-contract 0.8.0 (layout-contract#277). | done |
| packing | `packages/packing/src/strategy.ts`, `free.test.ts`, `pack.test.ts`, `shelf.test.ts`, `bench/coverage.ts`, `packages/site/src/model.ts` | next |
| systems | `packages/service/src/fakes.ts` (`seeded`) | next |

12 repositories, approximately 32 files. When the table has no "next" row, R3 is done. Then the atlas shows no class of mulberry32 across the repositories.

## The statistics copies (rigor-statistics)

The package README has the function for each copy, and the tests prove the numbers are equal to the bit. The steps of a move are the same as above.

| Repository | Files | State |
| --- | --- | --- |
| coeval | `packages/core/bench/cases.ts` (`median`) | next |
| crawler | `packages/site/src/lib/eval-b.ts` (`median`) | next |
| highways | `src/bench/measures/stats.ts` (`quantile`, `summarize`, `kendallTau`), `src/bench/screen/gap.ts` (`bootstrapMedian`), `src/bench/screen/set.ts` (`signTestPower`), `scripts/queue.ts` (`spearman`, `bootstrap`) | next |
| lag | `packages/experiments/src/e8-async-context/runner/stats.ts` (`median`, `quantile`), `packages/site/src/lib/stats.ts` (`percentile`) | next |
| lag-hud | `packages/hud/src/meter.ts` (`quantile`) | next |
| layout-contract | `packages/joint/src/analysis.ts` (`bootstrap`, `quantileOf`) | next |
| layout-contract | `packages/layout-contract/src/verdict.ts` (the stratified bootstrap, the pooled bootstrap, the permutation test, the sign test) | done in layout-contract 0.8.0 (mark1russell7/layout-contract#277) |
| packing | `src/measures.ts` (`quantile`, `medianRatio`), `bench/promote.ts` (`signTestP`, `bootstrapMedian`), `bench/coverage.ts` (`wilson`), `bench/run.ts` (`median`) | next |

Three copies are not equal to the package. Keep the call as it is, or accept the change in a separate commit with the records:
- The sign test of `verdict` of layout-contract gives a p that is closer to the exact p than `signTest`. For 80 counts or fewer, the error of `signTest` is at most 2.5e-14 of the p (#158). The p is a report only, so layout-contract accepts the change.
- The backtest `bootstrap` of highways does not skip a run with a NaN statistic. The package skips it.
- `summarize` of highways gives the 0.5 quantile as the median. The package gives the midpoint, which can differ in the last bit.
