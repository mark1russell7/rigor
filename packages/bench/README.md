# @mark1russell7/rigor-bench

The paired-time records of a bench, and the time verdict against an A/A arm. This package is the first part of the shared bench harness of rigor.

```sh
npm install @mark1russell7/rigor-bench
```

## The method

- Each round runs the two arms of a pair on one case, one after the other. Arm `a` is the baseline, and arm `b` is the candidate.
- The order turns each round (`firstArm`). Thus a warm cache or a slow start does not always help the same arm.
- An A/A pair runs the same code in its two arms. Its ratios show how far apart two equal arms come on the machine.
- The ratio of a case is `b / a` over its rounds (`caseRatios`).
- The default rule `difference` gives the bootstrap interval of the candidate median over the A/A median. The verdict compares it with 1.

## Give a verdict

```ts
import { firstArm, timeVerdict, type PairedTime } from "@mark1russell7/rigor-bench";

const first = firstArm(round, caseIndex);         // "a" or "b": run this arm first
const records: PairedTime[] = [{ case: "board-1", round: 0, first: "a", a: 12.1, b: 10.4 }];
const v = timeVerdict(records, aaRecords);

v.outcome;                                        // "faster", "slower", "same" or "cannot decide"
v.reason;                                         // one sentence with the interval and the band
v.comparison;                                     // the cases that gain and drop beyond the band
```

## The functions

| Function | What it gives |
| --- | --- |
| `firstArm(round, offset)` | The arm that runs first. The order turns each round, and an odd offset starts with arm `b`. |
| `checkPairedTime(record)` | The record, or a `RangeError` for a time that is not a finite number above 0. |
| `caseRatios(records)` | The ratio of each case. It refuses 2 records of one round, and an order that did not turn. |
| `aaBand(aa, options)` | The band of the A/A arm, symmetric on a log scale. The kind `median` (the default) holds the A/A median, and the kind `case` holds one A/A case. It needs 5 cases or more. |
| `timeVerdict(candidate, aa, options)` | The outcome of the rule `difference` (the default) or `band`. |
| `aaSpread(aa, level)` | The A/A spread: the `level` quantile of `abs(log(ratio))` over the A/A cases. The default level is 0.9. |
| `pooledBand(pool, level)` | The pooled band: the larger of the floor and the A/A spread of the records of earlier runs. |
| `caseIntervals(records, level)` | The ratio of each case with a distribution-free interval of its median over the rounds. The level 0.95 needs 6 rounds or more. |
| `limitVerdict(candidate, aa, options)` | The verdict of the claim "the ratio of each case is at most `limit`": `within`, `beyond` or `cannot decide`. |
| `timeRounds(arms, options)` | The timed rounds of one case in one process: a warm-up, a batch of at least the target time, and the order of `firstArm`. |
| `verdictPower(options)` | The share of each outcome over seeded benches with a known ratio: the power test of a rule. |
| `balanceOrders(records)` | The records of each case with a turned order. It removes the extra records of the larger order, with the highest rounds first. |
| `pooledVerdict(jobs, options)` | The verdict of the merged records of all jobs, with the verdict of each job alone as a guard. |
| `armVerdicts(run, aaPair, options)` | The verdict of each candidate pair of a run against its A/A pair. |
| `benchEnv()` | From `/fresh`: the computer of this process, with the CPU model and the runner. |
| `childLine(stdout)` | From `/fresh`: the last JSON line of a child, with its time `ms`, its `hash` and the reason of a skip. |
| `pairOrder(pairs, round, caseIndex)` | From `/fresh`: the order of the pairs of one case in one round, and the first arm of each pair. |
| `freshRun(options)` | From `/fresh`: the records of each pair, with each arm in its own fresh child process. |

## A claim with a limit

`timeVerdict` compares the ratio with 1. A claim with a limit needs `limitVerdict`. An example is "the new code takes at most 2 times the time of the old code":

```ts
const v = limitVerdict(records, aaRecords, { limit: 2 });

v.outcome;                                        // "within", "beyond" or "cannot decide"
v.cases;                                          // the interval, the bound and the outcome of each case
```

- The A/A band widens the interval of each case. The bound is the high end of the interval times the high end of the band.
- A case is `within` when its bound is at most the limit. It is `beyond` when its low end times the low end of the band is above the limit.
- The verdict is `beyond` when a case is `beyond`, and `within` when each case is `within`.

The verdict has no correction for many cases. Each case has its own interval at the level `caseLevel`. Thus with many cases, a verdict `beyond` can come from noise only. Set `caseLevel` higher when a bench has many cases. A correction of Holm is an option for a later version.

## Time the rounds

`timeRounds` times one case in one process. Start a fresh process for each case and each pair, and give the index of the case as `offset`:

```ts
const { records } = timeRounds({ a: () => oldCode(input), b: () => newCode(input) }, { case: "board-1", rounds: 31, offset: 0 });
```

Each arm gives a number. The engine cannot remove the work of a call, because the sum of these numbers uses it.

## The fresh runner

The entry `@mark1russell7/rigor-bench/fresh` starts child processes, so it is for Node only. The root entry stays free of `node:child_process`.

`freshRun` starts each arm of each pair, case and round in a fresh child. The child prints one JSON line, for example `{"ms": 12.5, "hash": "9f3a"}`:

```ts
import { freshRun } from "@mark1russell7/rigor-bench/fresh";

const run = await freshRun({
  base: { id: "old", command: ["node", "bench/arm.js", "--entry", "old"] },
  candidates: [{ id: "new", command: ["node", "bench/arm.js", "--entry", "new"] }],
  cases: ["board-1", "board-2"],
  rounds: 5,
  roundOffset: job * 5,                           // global rounds over the jobs
  job: String(job),
});

run.pairs["new"];                                 // the records of the pair (old, new)
run.pairs["old~aa"];                              // the records of the A/A pair (old, old)
```

- Each candidate is a pair (base, candidate) with its own base child. The A/A pair is (base, base).
- `pairOrder` gives the order. Pair `p` starts with `firstArm(round, caseIndex + p)`, and the pair that starts first turns each second round.
- The arguments of a case come after the command. The default is `--case <id>`.
- A child that exits with an error, takes too long or prints no JSON line stops the run with an error. The error names the arm, the case, the round and the tail of `stderr`.
- Only a line with `skipped` skips a case. A skip line does not need a time.
- A skip in the first round of the job removes the case from each pair, and the run starts no more children for it. A skip after the first round stops the run with an error, because the child is not deterministic.
- A child that does not stop at the time limit gets SIGTERM, and SIGKILL after 1 second. The signals go to its process group. On Windows, `taskkill /T /F` stops its tree.
- A child must stop each process that it starts before it exits. On Windows, the runner cannot find a process that a child leaves after a normal exit.
- Two different hashes of one arm on one case stop the run with an error.
- Each record keeps its job and the computer of its job (`benchEnv`).

A run of many jobs sets `roundOffset` to `job * rounds`. Then the merged records have one record of each case and round. Without it, each job repeats the first orders, and the merge removes more records.

### Why pairs, and not a rotation of all arms

A rotation of N arms turns the order of two arms only when they are N/2 apart in the rotation. For 4 arms, two arms 1 apart come in the order 3:1 over 4 rounds. Thus each pair of `freshRun` has its own two children, and the order of each pair turns each round.

## The pooled verdict

`pooledVerdict` gives the verdict of the records of all jobs together:

```ts
const v = pooledVerdict(
  jobs.map((j) => ({ job: j.job, candidate: j.pairs["new"], aa: j.pairs["old~aa"] })),
  { margin: 0.05 },
);

v.outcome;                                        // the pooled outcome, or "cannot decide" when a job decides the opposite direction
v.jobs;                                           // the verdict of each job alone
v.opposed;                                        // the jobs against the pooled direction
v.trimmed;                                        // the records that balanceOrders removed
```

- The function merges the records, and balances the merged records with `balanceOrders`. A caller cannot pool records without a turned order.
- The verdict of each job uses the same options as the pooled verdict.
- A job with `cannot decide` or `same` does not change the outcome. Only a job with `faster` against a pooled `slower`, or the reverse, makes the outcome `cannot decide`.
- A pooled `same` stays `same`, also with a job that gives `slower` or `faster`. Only the opposite direction opposes.
- Each record with a field `job` has the label of its job, or `pooledVerdict` stops with an error.
- A job can give its `skipped` list from `freshRun`. `pooledVerdict` then removes each skipped case from all jobs, and `dropped` lists these cases.
- Two jobs with a record of one case and one round are an error. Set `roundOffset` of each job.
- `armVerdicts` gives the verdict of each candidate pair of one run against its A/A pair.

## The noise cap and the pooled band

Two options of `timeVerdict` keep a noisy run from a decision. Both are off by default, so the output stays the same as in 0.1.0.

The option `noiseCap` caps the A/A spread of the run. The spread is the quantile `spreadLevel` (default 0.9) of `abs(log(ratio))` over the A/A cases. Above the cap, the outcome is `cannot decide`:

```ts
const v = timeVerdict(records, aaRecords, { noiseCap: 0.06 });

v.noise;                                          // { spread, cap, noisy, aaMedian, biased }
v.reason;                                         // the spread, the cap and the outcome without the cap
```

Since 0.2.0, the noise cap also examines the bias of the A/A arm. An A/A median ratio out of `[exp(-noiseCap), exp(noiseCap)]` gives `cannot decide`. A bias of this size comes from the order or from the arm slots, not from the candidate. With a `spreadLevel` of 0.5 or more, a biased run is also noisy. More than half of its A/A cases are out of the cap. Thus the bias check decides alone only below the level 0.5. The fields `aaMedian` and `biased` keep the facts of the check.

The option `pool` gives a band from the A/A records of earlier quiet runs, with a floor. The caller keeps the pool, for example in a file of the repository:

```ts
const pool = { records: quietAaRecords, floor: Math.log(1.05) };   // each run has its own case names
const v = timeVerdict(records, aaRecords, { noiseCap: 0.06, pool });

v.band;                                           // the pooled band: its noise is at least the floor
v.pool;                                           // { cases, runs, spread, floor, pooled }
```

- The noise of the pooled band is the larger of the floor and the spread of the pooled cases. The floor and the noise are on a log scale.
- With fewer pooled cases than `minimum` (default 5), the band uses the floor alone.
- The option `run` gives the run of each record, so `v.pool.runs` counts the runs. The cases of one run share one runner, so they are not independent.
- The pooled band replaces the band of the run in the rule `band` and in `comparison`.
- The rule `difference` uses the larger of `margin` and the noise of the pooled band as its margin.
- The run still needs its own A/A arm of 5 cases or more. The noise cap uses that arm.

For a fixed limit, for example 1.10 against a fixed base, use `limitVerdict`.

## The outcomes

| Outcome | The rule `difference` (the default) | The rule `band` |
| --- | --- | --- |
| `same` | The interval is in `[exp(-margin), exp(margin)]`. The default margin is 0.05. The rule examines this outcome first. | The interval is in the band. |
| `faster` | The whole interval is below 1, and it is not in the margin. | The interval of the median ratio is below the band. |
| `slower` | The whole interval is above 1, and it is not in the margin. | The interval is above the band. |
| `cannot decide` | The interval holds 1 and crosses the margin. | The interval crosses an end of the band. |

Both rules give `cannot decide` when the A/A arm has fewer than 5 cases, or when the candidate has no cases. With `noiseCap`, an A/A spread of the run above the cap also gives `cannot decide`. So does an A/A median ratio of the run out of the cap.

Since 0.2.0, the rule `difference` examines the margin before 1. An interval in the margin is `same`, also when it is wholly below 1. An example is the interval `[0.96, 0.98]` with the margin 0.05: it is `same`, and 0.1.2 gave `faster`. An interval below 1 that crosses `exp(-margin)` is still `faster`. With the margin 0, each outcome stays the same.

## The power test

`verdictPower` drew 200 seeded benches for each cell. Each case had 5 rounds. The log time of each arm in each round had a normal noise of 0.1. The bootstrap had 1000 runs.

| Rule | Cases | Finds a true speedup of 7% | Calls that speedup `same` | False `faster` or `slower` on equal arms |
| --- | --- | --- | --- | --- |
| `band`, kind `case` | 5 | 0.025 | 0.185 | 0 |
| `band`, kind `case` | 10 | 0 | 0.515 | 0 |
| `band`, kind `case` | 20 | 0 | 0.755 | 0 |
| `band`, kind `median` | 5 | 0.025 | 0.22 | 0 |
| `band`, kind `median` | 10 | 0.045 | 0.1 | 0 |
| `band`, kind `median` | 20 | 0.22 | 0.035 | 0 |
| `difference` | 5 | 0.235 | 0 | 0.04 |
| `difference` | 10 | 0.44 | 0 | 0.045 |
| `difference` | 20 | 0.71 | 0 | 0.04 |

The rule `band` compares an interval with a band of the same noise, so it needs a change of approximately twice that noise. With the kind `case`, it also calls a real speedup `same`. Thus `difference` is the default. Its false rate is near the 5% of a two-sided interval of level 0.95. A change of 7% needs approximately 20 cases for a power of 0.7.

Since 0.2.0, `verdictPower` takes `same` as the true outcome of a ratio in the margin of the rule `difference`. The cells of the table stay, because the ratio 0.93 is out of the margin 0.05.
