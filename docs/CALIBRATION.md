# Calibration

This file records the calibration studies of `@mark1russell7/rigor-statistics`, and the methods that a read ruled out. A ruled-out method has its read here, so nobody starts the same study again.

The registry of the studies is in `packages/statistics/src/calibration/`. The workflow `calibration.yml` starts a study in CI.

## The study `u-statistic-interval`

The study measures the coverage of the method `"tight"` of `uStatisticInterval`. It has 3 made-up kernels over pairs, and 17 cells of a population `n` and a sample `m`. `coverageMinSample` applies the bar to the hits of each cell, and gives `U_STATISTIC_TIGHT_MIN_SAMPLE`. The method `"auto"` uses `"tight"` from this sample size.

## Ruled out: the empirical Bernstein bound for U-statistics

The read of 2026-11-08 examined this bound as a third method of `uStatisticInterval`. The target was a consumer's kernel: the count of crossings of a pair of routes. The read used 5 made-up boards of 40 to 200 routes. On them, the mean of the kernel is 1.9 to 4.5, and its largest value is 10 to 24.

For this kernel, the method `"conservative"` gives an interval from 0, 7 to 16 times wider than `"tight"`. The bar for a new method was coverage at the bar at each `m`, and a width of at most 3 times `"tight"` at `m >= 1000`.

### The bound

The source is Peel, Anthoine and Ralaivola, "Empirical Bernstein inequalities for U-statistics", NeurIPS 2010, Theorem 3, equation 12.

For a kernel of order `r` with values in `[0, 1]`, and `k = floor(m / r)`, this inequality holds with a probability of at least `1 - δ`:

```text
|E U - U| <= sqrt(2 S2 ln(4 / δ) / k) + 5 ln(4 / δ) / k
```

`S2` is the estimate of the variance of the kernel. For a kernel in `[a, b]`, the right side is multiplied by `b - a`. The paper covers independent draws only.

### Three results

1. **The totals of the units do not give `S2`.** `S2` is a U-statistic of order `2r`, of the squared difference of the kernel over two disjoint sets of units. For `r = 2`, it needs `Q`, the sum of the squared kernel over the pairs of the sample. The total of each unit does not fix `Q`.
2. **A sample without replacement has a gap.** Blanc 2023 (arXiv 2302.08661, Theorem 6) bounds a U-statistic of such a sample in convex order by independent draws. Thus the Bernstein bound with the true variance holds. The proof of the empirical bound also needs the mean of `S2` to be the variance. For `r >= 2`, we know no proof of this step for a sample without replacement.
3. **The range term is too large.** Even with the true variance, the term `5 (b - a) ln(4 / δ) / k` is larger than the Hoeffding half-width up to `k` of approximately 260.

### The counterexample for result 1

Two kernels on 4 units give the same totals and different values of `Q`:

| Kernel | Pairs with a value | Totals of the units | `Q` |
|---|---|---|---|
| A | `h(0,1) = h(2,3) = 2` | 2, 2, 2, 2 | 8 |
| B | `h(0,1) = h(1,2) = h(2,3) = h(0,3) = 1` | 2, 2, 2, 2 | 4 |

The fast form of `S2` in the paper works because its kernel has the values 0 and 1 only. For such a kernel, `h² = h`.

### The width for result 3

This table gives the width of the Bernstein bound, with the true variance, divided by the width of the Hoeffding bound. The range is 24, the standard deviation of the kernel is 2.5, and the level is 0.95.

| `k` | 10 | 20 | 50 | 100 | 200 | 500 | 1000 | 2000 |
|---|---|---|---|---|---|---|---|---|
| Ratio | 5.33 | 3.83 | 2.51 | 1.84 | 1.37 | 0.95 | 0.74 | 0.59 |

The Bernstein bound is narrower than the Hoeffding bound from `k = 436`. At `k = 1000`, it is 0.74 times Hoeffding, and Hoeffding is 7 to 16 times `"tight"`. Thus the bound fails the bar of 3 times `"tight"`.

### The decision

The method is not built. The method `"auto"` takes `"tight"` above the sample size that the calibration run gives.

An optional input, the sum of the squared kernel over the sampled pairs, removes result 1. The roadmap keeps it as the parked item R10. It starts only when a consumer works at `k > 500` with a kernel of this type.
