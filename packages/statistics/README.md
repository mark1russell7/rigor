# @mark1russell7/rigor-statistics

The statistics of measured work. It gives quantiles, bootstrap intervals, the sign test, the paired permutation test, Wilson intervals and the Holm correction. It also gives least squares, rank correlation, the comparison with a baseline beyond the noise, and the Brier score of predictions.

```sh
npm install @mark1russell7/rigor-statistics
```

## Compare a candidate with a baseline

```ts
import { compareRatios, noiseFloor } from "@mark1russell7/rigor-statistics";

// The ratio candidate / baseline of each input, and the measure of 5 seeds or folds of the same run.
const noise = noiseFloor(foldMedians);           // 2 standard deviations; it needs 5 values or more
const c = compareRatios(ratios, { noise });

c.wins, c.losses, c.signP;                       // how often, by any amount
c.effect;                                        // by how much: the median, p10 and p90 of the inputs that are not ties
c.gains, c.drops;                                // how often beyond the noise, with Wilson intervals
```

A promotion reads `gains` against `drops` and `effect`. A sign test alone is not enough, because it counts a win of any size. Judge a change of a default against the current default, not against "no change".

## The functions

| Function | What it gives |
| --- | --- |
| `mean`, `sd`, `median`, `summarize` | The descriptive statistics. `sd` is the sample standard deviation. |
| `quantile(values, p, method)`, `quantileSorted` | The `p` quantile, with the `"linear"` method (type 7, the default) or the `"nearest-rank"` method (type 1). |
| `bootstrap(data, statistic, options)` | A percentile bootstrap interval of any statistic. The options are `runs`, `level` or `ends`, `seed` and `method`. |
| `bootstrapMedian`, `bootstrapClusters` | The interval of the median, and a bootstrap that draws whole clusters (boards, seeds, sites). |
| `bootstrapTwo(a, b, statistic, options)` | A bootstrap interval of a statistic of two independent samples, for example two arms of a benchmark. Each run draws all of `a`, then all of `b`. |
| `bootstrapMedianRatio(numerator, denominator, options)` | The interval of `median(numerator) / median(denominator)`. It is the uncertainty of the ratio, not the spread of the samples. |
| `leastSquares(x, y, { intercept })` | The ordinary least-squares fit of `y` on the rows of `x`, with a QR decomposition. It gives the coefficients, `residualSd`, `r2`, `n` and `k`. A singular design gives NaN coefficients. |
| `bootstrapLeastSquares(x, y, options)` | One bootstrap interval for each coefficient of `leastSquares`, from the same draws of whole rows. A singular draw does not count. |
| `signTest(better, worse, sides)`, `signTestPower(n, level)` | The sign test, and the fewest wins out of `n` that the test calls significant. |
| `pairedPermutation(candidate, baseline, options)` | The paired permutation test (random sign flips). It uses the size of each difference. |
| `wilson(k, n, z)` | The Wilson interval of a proportion. |
| `holm(pValues, level)` | The Holm correction of a family of tests. |
| `spearman`, `kendallTau`, `ranks` | The rank correlations, with mean ranks for ties. |
| `compareRatios`, `noiseFloor` | The comparison with a baseline, and the noise floor of the 5-seed rule. |
| `brier`, `calibration` | The Brier score of predictions, and the hit rate of each stated level. |

Each function throws a RangeError for an empty list, for a NaN and for a parameter out of its range. Thus a missing value cannot make a quiet NaN in a record.

## Moves from the copies

The tests prove that these functions give the same numbers as the copies in the engines, to the bit:

| The copy | The function |
| --- | --- |
| `quantile` of highways, packing and layout-contract (`quantileOf`) | `quantile(values, p)` |
| `quantile` of lag and lag-hud, `percentile` of lag (with `p / 100`) | `quantile(values, p, "nearest-rank")` |
| `median` of coeval, lag, crawler and packing | `median(values)` |
| `bootstrapMedian` of packing | `bootstrapMedian(sortedValues, { runs, level, seed })`. Give the values sorted, because packing draws from the sorted list. |
| `bootstrapMedian` of highways | `bootstrap(values, (s) => quantile(s, 0.5), { runs, level, seed })` |
| `bootstrap` of layout-contract | `bootstrapClusters(rows, (r) => r.cluster, statistic, { runs, seed, ends: [0.025, 0.975] })` |
| `signTestP` of packing | `signTest(better, worse)` |
| `signTestPower` of highways | `signTestPower(n, level)` |
| `wilson` of packing | `wilson(k, n, z)`. packing rounds the ends to 4 places at the call. |
| `spearman` of the highways backtest, `kendallTau` of highways | `spearman`, `kendallTau` |

A copy that gives NaN, 0 or `undefined` for an empty list must test the list at the call, because these functions throw.

`median(values)` gives the midpoint `(a + b) / 2` of the two middle values. `quantile(values, 0.5)` gives `a + 0.5 * (b - a)`. These two can differ in the last bit (at most 1 ulp). Use the function that the copy used.

## License

MIT
