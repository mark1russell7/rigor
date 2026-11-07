# @mark1russell7/rigor-statistics

The statistics of measured work. It gives quantiles, bootstrap intervals, the sign test, the paired permutation test, Wilson intervals and the Holm correction. It gives the interval of a median from order statistics, and the central interval of a binomial count. It also gives least squares, rank correlation, the comparison with a baseline beyond the noise, and the Brier score of predictions. It fits response records that a browser can evaluate from plain JSON.

```sh
npm install @mark1russell7/rigor-statistics
```

## Compare a candidate with a baseline

```ts
import { compareRatios, noiseFloor, noiseVerdict } from "@mark1russell7/rigor-statistics";

// The ratio candidate / baseline of each input, and the measure of 5 seeds or folds of the same run.
const noise = noiseFloor(foldMedians);           // 2 standard deviations; it needs 5 values or more
const c = compareRatios(ratios, { noise });

c.wins, c.losses, c.signP;                       // how often, by any amount
c.effect;                                        // by how much: the median, p10 and p90 of the inputs that are not ties
c.gains, c.drops;                                // how often beyond the noise, with Wilson intervals

// A difference (candidate - baseline) of each seed: beyond max(2 SD, margin)? Equal values give "no-spread".
const v = noiseVerdict(foldDiffs, { margin: 0.02 }); // give the reason of the margin from the problem of the user
v.state;                                         // "gain", "loss", "noise" or "no-spread"
```

A promotion reads `gains` against `drops` and `effect`. A sign test alone is not enough, because it counts a win of any size. Judge a change of a default against the current default, not against "no change".

## Fit and show a response

The format `response-records/1` keeps the measured points of a study, a model for each measure and the held-out error of each fold. A record is plain JSON, and the functions use no Node API. Thus a browser reads a record and evaluates its models.

```ts
import { fitResponse, parseResponseRecord, sliceResponse } from "@mark1russell7/rigor-statistics";

const record = fitResponse(
  {
    schema: "response-records/1",
    name: "time of a placement",
    dimensions: [
      { id: "boxes", label: "Boxes", kind: "continuous", range: [10, 10000], unit: "", log: true },
      { id: "strategy", label: "Strategy", kind: "categorical", levels: ["shelf", "skyline"], unit: "" },
      // Only the arm "skyline" has this parameter. Each other point has null.
      { id: "depth", label: "Depth", kind: "continuous", range: [1, 8], unit: "", when: { dimension: "strategy", levels: ["skyline"] } },
    ],
    measures: [{ id: "ms", label: "Time", unit: "ms", direction: "lower" }],
    points, // { id, values, measures, group }: repeats of one input have one group
  },
  { log: ["ms"], logFloor: 0.001 },
);

// A server writes the text. A browser reads it, and it asks for one dimension with the other dimensions held.
const text = JSON.stringify(record);
const parsed = parseResponseRecord(JSON.parse(text));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.faults));
const slice = sliceResponse(parsed.record, "ms", { vary: "depth", hold: { boxes: 1000 } });
slice.curve; // { at, value, low, high, nearest } along the dimension
slice.points; // the measured points with the held values
slice.error; // the held-out error of the folds
```

A test of this package compiles and starts this example, and it examines that the two texts are equal.

`fitResponse` keeps all the points of one `group` in one fold, so repeats of a group are not on both sides of a split. Each fold chooses its penalty from the other folds only. The folds thus measure the prediction of an unseen group.

There are two kinds of model. A `ridge` model is a sum of weighted terms. Each term is a product of powers of number inputs and one-hot columns of levels. A `table` model has one cell for each combination of levels. `fitResponse` gives a table when each dimension is categorical, and a ridge model in other cases.

A dimension with `when` is conditional: only some levels of its parent have the dimension. This suits a benchmark in which each arm has its own parameters. A point at another level has `null`. In a ridge model, a term with an absent dimension is 0, so the columns of the parent carry the mean of that level. A table keeps `null` in its cells. For each kind of model, `predictResponse` refuses `null` at a dimension with no condition.

To vary a conditional dimension, `sliceResponse` needs its parent at a level inside `when`. With no held value, the parent takes the most common level inside `when`. A held conditional dimension reads `null` when its parent is outside `when`.

The band of a curve is `value ± width × RMSE`, from the held-out error of the folds. On a log scale, the band is a ratio. The band has one width along the curve. It is the mean error of the model.

A measure with the field `range` keeps each view inside it, for example `[0, 1]` for a share. `sliceResponse` and `surfaceResponse` move `value`, `low` and `high` to the nearest end. Such a place has the field `clipped`, and the field `clipped` of the view counts these places. `predictResponse` gives the value that the model fitted, and a fit does not use the range. `parseResponseRecord` refuses a measured value outside the range.

The field `nearest` of each place tells how far the place is from a measurement. It goes from 0 to 1, and 0 means that a point was measured there. A viewer can fade the band away from the data. A table cell with the `fallback` value has `nearest` above 0.

### The error of one cell

Each fold keeps one error for each measure. To get the error of a chosen set of points, fit with the option `outOfFold`. Each fold then stores the prediction of each held-out point with a value, on the scale of the model. The default is off, and a record with no option has the same bytes as a record of an earlier version.

`heldOutErrorAt(record, "ms", ids)` gives the fields of `heldOutError` for these points. The baseline of a point is the mean of the training points of its fold. The set of all the points gives the pooled error of the folds, to the rounding of the sums. A test examines this at 24 seeds, with a relative tolerance of 1e-12.

### The reason that a measure is absent

A measure with `null` has no value. To tell why, declare the reasons in the field `reasons` of the data. Then map the measure to a reason in the field `absent` of the point:

```json
{
  "reasons": [{ "id": "budget", "label": "Out of budget" }],
  "points": [{ "id": "p7", "values": { "boxes": 10000 }, "measures": { "ms": null }, "absent": { "ms": "budget" } }]
}
```

`parseResponseRecord` refuses a reason on a measure with a number, and a reason with no declaration. A measure with `null` and no reason is good. `fitResponse` treats each of them as `null`, and it keeps the reasons in the record.

`sliceResponse` and `surfaceResponse` give these points in a list `absent`, beside the list `points`. Each item has `id`, `at`, `reason` and `group`. The value of `reason` is `null` when the point states no reason. Thus a chart can draw each reason apart.

### Many levels with few pairs

The default expansion has one product for each pair of levels of two dimensions. Two dimensions with 76 and 33 levels thus give 2508 products, and the limit `RESPONSE_MAX_TERMS` refuses them. With the option `interactions: "seen"`, a ridge fit keeps only the terms that are not 0 at one point or more. This choice looks only at the inputs of the points. A term with no point has the weight 0, so the choice does not change a prediction. The limit applies after the choice.

## The functions

| Function | What it gives |
| --- | --- |
| `mean`, `sd`, `median`, `summarize` | The descriptive statistics. `sd` is the sample standard deviation. |
| `quantile(values, p, method)`, `quantileSorted` | The `p` quantile, with the `"linear"` method (type 7, the default), the `"nearest-rank"` method (type 1) or the `"higher"` method (`sorted[Math.ceil(p * (n - 1))]`, as NumPy). |
| `bootstrap(data, statistic, options)` | A percentile bootstrap interval of any statistic. The options are `runs`, `level` or `ends`, `seed`, `method` and `against`. |
| The option `against` | The interval also gives `pAbove` and `pBelow`, the bootstrap p of each side of the value, from the same draws. The smallest p is 1 / (`finite` + 1). Give `holm` enough runs: with m tests at level a, `runs` is more than m / a. |
| `bootstrapMedian`, `bootstrapClusters` | The interval of the median, and a bootstrap that draws whole clusters (boards, seeds, sites). |
| `bootstrapTwo(a, b, statistic, options)` | A bootstrap interval of a statistic of two independent samples, for example two arms of a benchmark. Each run draws all of `a`, then all of `b`. |
| `bootstrapMedianRatio(numerator, denominator, options)` | The interval of `median(numerator) / median(denominator)`. It is the uncertainty of the ratio, not the spread of the samples. |
| `leastSquares(x, y, { intercept })` | The ordinary least-squares fit of `y` on the rows of `x`, with a QR decomposition. It gives the coefficients, `residualSd`, `r2`, `n` and `k`. A singular design gives NaN coefficients. |
| `bootstrapLeastSquares(x, y, options)` | One bootstrap interval for each coefficient of `leastSquares`, from the same draws of whole rows. A singular draw does not count. |
| `ridgeSolve(gram, moment, lambda, { free })` | The ridge coefficients from the normal equations `X'X` and `X'y`, with a Cholesky factorization. The `free` coefficients have no penalty. A matrix that is not positive definite gives NaN coefficients. |
| `signTest(better, worse, sides)`, `signTestPower(n, level)` | The sign test, and the fewest wins out of `n` that the test calls significant. |
| `pairedPermutation(candidate, baseline, options)` | The paired permutation test (random sign flips). It uses the size of each difference. |
| `twoSamplePermutation(a, b, options)` | The two-sample permutation test (a split of the pooled values). It reads each split when their count is `runs` or less, so the p is exact. It compares groups of different sizes, and its default statistic is the difference of the medians. |
| `wilson(k, n, z)` | The Wilson interval of a proportion. |
| `medianInterval(values, level)` | The distribution-free interval of a median, from two order statistics. It gives `low`, `high`, the `rank` of `low` and the `coverage`. |
| `quantileInterval(values, p, level)` | The distribution-free interval of a quantile, from two order statistics. A side with no rank is infinite. The values must be independent draws. |
| `quantileSamples(p, level)` | The fewest independent values that give a quantile an upper bound. At the level 0.95: 72 values for p95, 368 for p99 and 3,688 for p99.9. |
| `binomialInterval(n, p, level)`, `negativeBinomialInterval(successes, p, level)` | The central interval of a binomial count, and of a count of failures before `successes` successes. Each tail outside holds `(1 - level) / 2` or less. |
| `holm(pValues, level)` | The Holm correction of a family of tests. |
| `partialConjunction(pValues, need)` | The p of the claim that at least `need` of these tests have a real effect. |
| `spearman`, `kendallTau`, `ranks` | The rank correlations, with mean ranks for ties. |
| `compareRatios`, `noiseFloor`, `noiseVerdict` | The comparison with a baseline, the noise floor of the 5-seed rule with a margin of practical effect, and the state of a difference over the seeds. |
| `optionFloor({ sigma, delta, tests, alpha, power })`, `tQuantile(p, df)` | The fewest values for each of two options, so that one test of a Bonferroni family finds a difference of `delta` with the stated power, from the Student t law. It assumes unpaired groups of equal size and equal `sigma`. The quantile of the Student t law. |
| `modeCount(values, { minShare, valleyRatio })` | The count of the modes of a sample, from a kernel density estimate. |
| `smoothLawScores(values)`, `bestSmoothLaw(values)` | The mean log density of the uniform, normal, exponential, log-normal and Pareto laws at their fits, and the best of them. |
| `brier`, `calibration` | The Brier score of predictions, and the hit rate of each stated level. |
| `fitResponse(data, options)` | A record of the format `response-records/1`, with one model for each measure and held-out folds. |
| `parseResponseRecord(value)` | The examination of unknown data. It gives the record, or one fault with a path for each error. |
| `predictResponse(model, inputs)`, `heldOutError(record, measure)` | The value of a model at one set of inputs, and the error of the folds of a measure. |
| `heldOutErrorAt(record, measure, ids)` | The held-out error of a chosen set of points, from the predictions of the option `outOfFold`. |
| `responseCells(record, vary, steps)` | The number of fitted places of a view, level axes included. It lets a caller bound the time of a view before the view starts. |
| `whenHolds(dimension, values)` | True when a place has the condition of a dimension. A dimension with no `when` is always present. |
| `sliceResponse(record, measure, options)`, `surfaceResponse(record, measure, options)` | A fitted curve over one dimension, or a fitted surface over two, with the matching measured points, the matching points with no value, a band and the distance to the nearest measurement. |

Each function throws a RangeError for an empty list, for a NaN and for a parameter out of its range. Thus a missing value cannot make a quiet NaN in a record.

### The limits of the shape of a sample

`modeCount` has two reads. A sample with 24 or fewer distinct values, and 4 or more copies of each value on average, gets a direct read. That read uses the counts of the values. A kernel estimate reads each other sample.

The count is the same for `x` and `-x`. Two humps join in the order of the depth of their valleys, not in the order of their positions. A test holds this on seeded random laws.

The direct read does not change with the size of the sample, so one discrete law gives one result. A test holds this table, with a gap of 100 between the groups.

| Groups of equal values | 10 values each | 50 values each | 200 values each | 1,000 values each |
| --- | --- | --- | --- | --- |
| 2 | 2 | 2 | 2 | 2 |
| 3 | 3 | 3 | 3 | 3 |
| 6 | 6 | 6 | 6 | 6 |
| 10 | 10 | 10 | 10 | 10 |
| 12 | 12 | 12 | 12 | 12 |
| 16 | 16 | 16 | 16 | 16 |
| 24 | 24 | 24 | 24 | 24 |
| 25 | 1 | 1 | 1 | 1 |

- Flat counts give one mode for each value. So a rounded uniform law with 24 or fewer steps gives one mode for each value, and two close values are two modes.
- Counts with one rise and one fall give one mode. This read needs 4 or more values. A normal law at a step of 2 SD has 3 values, so it gives 3.
- A value under 1 percent of the sample is out of this read.
- Under 1,000 values the noise of a sample can move the count of a rounded uniform law with 10 or more steps by 1.

The kernel joins more than approximately 24 evenly spaced clusters, because its grid has 96 points. A tight cluster also needs more than approximately `n ** 0.8 / 8` values in a sample of `n` values. A cluster with an SD over 5 percent of the gap to the next cluster can join it. Under these limits a test holds the count at 20 clusters. A step of rounding is no gap between clusters. So the width of the kernel stays over the median gap of the distinct values of a tight sample.

The default counts the modes that hold 10 percent of the mass. A caller who needs all modes passes a smaller `minShare`.

A small smooth sample can give a false extra mode. This table gives the share of 500 seeded samples of each law with a count of 1. A test holds it.

| Values | uniform | normal | exponential | log-normal | Pareto |
| --- | --- | --- | --- | --- | --- |
| 10 | 0.54 | 0.51 | 0.54 | 0.55 | 0.50 |
| 30 | 0.80 | 0.81 | 0.76 | 0.70 | 0.77 |
| 100 | 0.99 | 0.98 | 0.88 | 0.92 | 0.91 |
| 300 | 1.00 | 1.00 | 0.98 | 0.99 | 0.99 |
| 1,000 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

A discrete law with one mode can also give a false count. This table gives the share of 1,000 seeded samples with a count that is not 1. A test holds it.

| Law | 100 values | 300 values | 1,000 values |
| --- | --- | --- | --- |
| Rounded normal, SD 4 | 0.003 | 0.001 | 0.001 |
| Poisson, mean 3 | 0.006 | 0.001 | 0.000 |
| Poisson, mean 10 | 0.001 | 0.000 | 0.000 |
| Binomial, 10 trials, p 0.5 | 0.008 | 0.009 | 0.001 |
| Binomial, 100 trials, p 0.5 | 0.001 | 0.000 | 0.000 |
| Poisson, mean 1 | 0.000 | 0.000 | 0.000 |
| Geometric, p 0.1 | 0.213 | 0.028 | 0.000 |

- Do not trust one count at 100 values. Use the table to find the risk.
- In the first five rows a false count is rare, and most of them are large. A bell passes the flat test, so each of its values counts as a mode.
- The kernel reads a geometric law with p 0.1 at these sizes. A false count from it is one extra mode.

`bestSmoothLaw` is not reliable under 300 values. The laws with a fitted end have a benefit at small sizes. This table gives the share of correct results for 500 seeded samples of each law. A test holds it.

| Values | uniform | normal | exponential | log-normal | Pareto |
| --- | --- | --- | --- | --- | --- |
| 10 | 0.96 | 0.01 | 0.45 | 0.02 | 0.69 |
| 30 | 1.00 | 0.30 | 0.90 | 0.25 | 0.87 |
| 100 | 1.00 | 0.68 | 0.99 | 0.71 | 0.99 |
| 300 | 1.00 | 0.85 | 1.00 | 0.99 | 1.00 |
| 1,000 | 1.00 | 0.97 | 1.00 | 1.00 | 1.00 |

The samples use a normal law with a mean of 100 and an SD of 10, where the normal and log-normal laws are close.

## Moves from the copies

The tests prove that these functions give the same numbers as the copies in the engines, to the bit:

| The copy | The function |
| --- | --- |
| `quantile` of highways, packing and layout-contract (`quantileOf`) | `quantile(values, p)` |
| `quantile` of lag and lag-hud, `percentile` of lag (with `p / 100`) | `quantile(values, p, "nearest-rank")` |
| `median` of coeval, lag, crawler and packing | `median(values)` |
| The upper median `sorted[Math.floor(n / 2)]` of highways | `quantile(values, 0.5, "higher")` |
| `bootstrapMedian` of packing | `bootstrapMedian(sortedValues, { runs, level, seed })`. Give the values sorted, because packing draws from the sorted list. |
| `bootstrapMedian` of highways | `bootstrap(values, (s) => quantile(s, 0.5), { runs, level, seed })` |
| `bootstrap` of layout-contract | `bootstrapClusters(rows, (r) => r.cluster, statistic, { runs, seed, ends: [0.025, 0.975] })` |
| `signTestP` of packing | `signTest(better, worse)` |
| `signTestPower` of highways | `signTestPower(n, level)` |
| `wilson` of packing | `wilson(k, n, z)`. packing rounds the ends to 4 places at the call. |
| `spearman` of the highways backtest, `kendallTau` of highways | `spearman`, `kendallTau` |
| `medianInterval` of the harness and kind of systems | `medianInterval(sortedValues)`, with `low` and `high` |
| The binomial band of `targetConnections` and `negativeBinomial` of the cells of systems | `binomialInterval(n, p, cover)` and `negativeBinomialInterval(successes, p, cover)` |

A copy that gives NaN, 0 or `undefined` for an empty list must test the list at the call, because these functions throw.

`median(values)` gives the midpoint `(a + b) / 2` of the two middle values. `quantile(values, 0.5)` gives `a + 0.5 * (b - a)`. These two can differ in the last bit (at most 1 ulp). Use the function that the copy used.

## License

MIT
