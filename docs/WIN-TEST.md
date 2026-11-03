# The win test

This file is the one home of the shared block `win-test`. The repositories layout-contract, packing and highways link to it from their `docs/PROMOTION.md`.

- Each repository pins the SHA-256 of the block in its `docs/shared.lock.json`.
- The hash is the SHA-256 of the lines between the two markers, with LF line ends and one last LF. The two marker lines are not in the hash. `scripts/check-shared.mjs` of these repositories makes this hash.
- A change of the block changes its hash. Each repository then changes its lock in its own pull request.

<!-- shared:win-test -->
## The win test

The test compares the candidate with the current default on each input of the corpus. The guard measures are the guard measures of the step, which each repository lists. The win measures are the measures that the record of the idea names in `wins`.

| Test | Rule |
|---|---|
| Hard rules | On each input, each hard count of the candidate is at most that of the default. Two runs give the same output. |
| Median | For each guard measure, the median ratio is at most `1 + medianWorse`. |
| Tail | For each guard measure, at most a `tailShare` of the inputs have a ratio above `1 + tailWorse`. |
| Gain | One win measure has a median ratio of `1 - gainMin` or better. The sign test and the bootstrap of the noise guard of the repository pass for it. |
| Time | The pooled time verdict of [The time test](#the-time-test) is `faster` or `same`, and its time tail passes. The large bench fixtures stay in their CI time limit. |
| Stability | On the base and change pairs of the corpus, each stability measure is a guard measure. It passes the median and tail tests. |

### The time test

CI does the time test, because other jobs on a local machine change the times. The package `@mark1russell7/rigor-bench` gives the records, the order of the arms and the verdict.

The records:

- The test uses `jobs` CI jobs in the mode `fresh`. Each job times the candidate pair and the A/A pair on each case and each round.
- The candidate pair is the default in arm `a` and the candidate in arm `b`. The A/A pair has the default in its two arms.
- Each arm is a fresh process for each case and each round. The order of the arms turns by the round (`firstArm` of rigor-bench).
- Each job uses its own range of rounds. Thus the records of all jobs merge into one record for each case and round.
- The balance of the orders keeps the order of each merged case turned. A job that stops early leaves a case with more records of one first arm.
- The balance removes the records of that first arm with the highest rounds, until the two counts differ by 1 or less.

The verdict:

- The ratio of a case is `exp(median(log(b / a)))` over its merged rounds.
- The interval is the bootstrap interval of the median log ratio of the candidate cases minus that of the A/A cases. The level is 0.95.
- This interval is the rule `difference` of `timeVerdict` in rigor-bench, with the option `margin` set to `timeMargin`.
- The outcome is `same` when the interval is in `[exp(-timeMargin), exp(timeMargin)]`. The test examines this outcome first, so an interval in the margin and below 1 is `same`.
- Out of the margin, the outcome is `faster` when the whole interval is below 1, and `slower` when the whole interval is above 1.
- Each other interval gives `cannot decide`. An A/A pair with fewer than 5 cases also gives `cannot decide`.
- The outcome of the merged records is the pooled outcome.

The noise cap and the A/A bias:

- The A/A spread is the 0.9 quantile of `abs(log(ratio))` over the A/A cases of the merged records.
- When the A/A spread is above `noiseCap`, the outcome is `cannot decide`. This rule is the option `noiseCap` of `timeVerdict`, with its default `spreadLevel` 0.9.
- The pooled verdict has its own cap: the spread of the merged A/A cases.
- An A/A median ratio outside `[exp(-noiseCap), exp(noiseCap)]` gives `cannot decide`. Such a median shows an order effect or a warm-up effect of the bench.

The guard of the jobs:

- Each job also gets its own verdict from its own records, with the same `timeMargin` and `noiseCap`.
- A noisy job abstains: its `cannot decide` does not oppose the pooled outcome.
- When one job alone gives the opposite direction of the pooled outcome, the outcome is `cannot decide`. An example is a job with `slower` against a pooled `faster`.
- The guard does not need the agreement of each job. With 5 jobs, that rule loses most of the power of the pooled verdict.

The time tail:

- The tail set holds the cases with a median time of the default or of the candidate of `timeFloorMs` or more, over the merged rounds.
- An input under `timeFloorMs` in the two arms is too small to be a cost to the user.
- `limitVerdict` of rigor-bench gives each case of the tail set the outcome `within`, `beyond` or `cannot decide`.
- Its option `limit` is `timeTail`, and its option `caseLevel` is `timeTailLevel`.
- The verdict of each case uses the merged rounds of the case and the A/A pair of the merged records.
- The time tail passes when at most a share `1 - timeTailQ` of the tail set is not `within`.
- The time tail fails when more than a share `1 - timeTailQ` of the tail set is `beyond`.
- Each other time tail gives `cannot decide`. With many tail cases, the share keeps one wrong `beyond` from a failure of the row.
- An empty tail set gives the line `tail: not measured, no input above timeFloorMs` in the record. It does not stop a promotion.

The result:

- The outcome `slower` or a failed time tail fails the Time test.
- The Time test has no allowance for a slowdown out of the margin. A known slowdown is a separate claim with `limitVerdict`, and the record states its limit.
- A candidate with `cannot decide` in the pooled outcome or in the time tail does not promote.
- The record keeps the pooled interval, the A/A median ratio, the A/A spread and the noise cap.
- The record keeps the verdict and the CPU model of each job, and the count of the records that the balance removed.
- The record keeps the margin, the outcome of each case of the tail set and the CI run.

Each repository states these settings. A change of a value is a measured decision.

| Setting | What it is |
|---|---|
| `timeMargin` | The half width of the margin on a log scale. An interval in `[exp(-timeMargin), exp(timeMargin)]` is `same`. |
| `noiseCap` | The largest A/A spread on a log scale. A larger spread gives `cannot decide`. It also limits the A/A median ratio. |
| `jobs` | The count of the CI jobs. Each job has its own runner. |
| `cases` | The count of the cases of each job. |
| `rounds` | The count of the rounds of each case in each job. |
| `timeFloorMs` | The smallest median time in milliseconds of a case of the tail set. |
| `timeTail` | The largest ratio of a case of the tail set. |
| `timeTailQ` | The share of the tail set that is `within` the limit `timeTail`. |
| `timeTailLevel` | The level of the interval of each case of the tail set. The default is 0.95. |

The joint bench of layout-contract states `timeMargin` 0.05, 5 jobs, 20 cases and 5 rounds.
<!-- /shared:win-test -->
