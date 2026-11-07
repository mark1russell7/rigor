# @mark1russell7/rigor-bench

The paired-time records of a bench, and the time verdict against an A/A arm. This package is the first part of the shared bench harness of rigor.

```sh
npm install @mark1russell7/rigor-bench
```

## The method

- Each round runs the two arms of a pair on one case, one after the other. Arm `a` is the baseline, and arm `b` is the candidate.
- The order turns each round (`firstArm`). Thus a warm cache or a slow start does not always help the same arm.
- A run with three or more arms in one child order uses `armOrder`. A plain turn of the arms does not turn each pair evenly.
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
| `growthVerdict(rounds, options)` | The growth of a cost for each step of size, from a ratio inside each job, against a limit, for example 15 times for each 10 times. |
| `firstArm(round, offset)` | The arm that runs first. The order turns each round, and an odd offset starts with arm `b`. |
| `armOrder(arms, round)` | The order of any count of arms in a round. Each pair of arms has each order within 1 after each count of rounds. A report that keeps no `first` for each pair states the order that it used, so that a reader can make `first` again. |
| `checkPairedTime(record)` | The record, or a `RangeError` for a time that is not a finite number above 0. |
| `caseRatios(records)` | The ratio of each case. It refuses 2 records of one round, and an order that did not turn. |
| `orderSize(records)` | The count of records per first arm, the order effect, and the amount that unequal counts can move a mean. This size is a guide, because a verdict reads a median. |
| `aaBand(aa, options)` | The band of the A/A arm, symmetric on a log scale. The kind `median` (the default) holds the A/A median, and the kind `case` holds one A/A case. It needs 5 cases or more. |
| `timeVerdict(candidate, aa, options)` | The outcome of the rule `difference` (the default) or `band`. |
| `verdictMargin(options)` | The margin of the rule `difference` on a log scale: the larger of `margin` and the noise of the pooled band. An interval in `[exp(-margin), exp(margin)]` is `same`. |
| `aaSpread(aa, level)` | The A/A spread: the `level` quantile of `abs(log(ratio))` over the A/A cases. The default level is 0.9. |
| `pooledBand(pool, level)` | The pooled band: the larger of the floor and the A/A spread of the records of earlier runs. |
| `caseIntervals(records, level)` | The ratio of each case with a distribution-free interval of its median over the rounds. The level 0.95 needs 6 rounds or more. |
| `limitVerdict(candidate, aa, options)` | The verdict of the claim "the ratio of each case is at most `limit`": `within`, `beyond` or `cannot decide`. |
| `tailLimitVerdict(candidate, aa, options)` | The verdict of the claim "the median and a high value of each case are at most their limits", for a bench with few rounds. |
| `caseTails(records, rank)` | The value at one rank of the ratios of each case, from the largest. |
| `modelTest(reads, options)` | The read of each CPU model against the rest, for each case: `differs`, `no read`, `too-few` or `not asked`. |
| `visibleShift(values, rest, level, direction, options)` | The smallest shift in one direction that a test can see at this count and level, and the smallest p of this count. |
| `modelRowText(row, family)` | The words of one row. No word says that a model is the same as the rest. |
| `limitOnModel(limits, model)` | The limit of a gain on one CPU model: the gain limit, or the ceiling with its words. |
| `armModels(pairs)` | The CPU models of each arm of a set of pairs, and if all the reads come from one known model. |
| `tailFalseFails(aa, options)` | The cases of an A/A arm that the rule of `tailLimitVerdict` fails, and apart from these the cases with a limit under 1. |
| `gateOf(cases)` | The gate of a list of case outcomes: `pass`, `block` or `no read`. |
| `notSlowerVerdict(jobs, options)` | The gate of the claim "not slower by more than the margin", with looks and a family level. |
| `budgetVerdict(rounds, aa, options)` | The verdict of the claim "the median of each case is at most `limit`", for one build: `within`, `beyond` or `cannot decide`. |
| `budgetLooksVerdict(rounds, aa, options)` | The budget verdict of a run that adds rounds to the cases with no outcome, up to a stated budget. |
| `budgetLookSpend(looks)` | The chance of error that a list of looks spends. |
| `timeRounds(arms, options)` | The timed rounds of one case in one process: a warm-up, a batch of at least the target time, and the order of `firstArm`. |
| `verdictPower(options)` | The share of each outcome over seeded benches with a known ratio: the power test of a rule. |
| `balanceOrders(records)` | The records of each case with a turned order. It removes the extra records of the larger order, with the highest rounds first. |
| `poolRecords(jobs)` | The pool of the jobs: the merged and balanced records, the records of each job, and the skipped cases. |
| `pooledVerdict(jobs, options)` | The verdict of the merged records of all jobs, with the verdict of each job alone as a guard. |
| `pooledLimitVerdict(jobs, options)` | The limit verdict of the merged records of all jobs, with the limit verdict of each job alone as a guard. |
| `armVerdicts(run, aaPair, options)` | The verdict of each candidate pair of a run against its A/A pair. |
| `benchEnv()` | From `/fresh`: the computer of this process, with the CPU model and the runner. |
| `childLine(stdout)` | From `/fresh`: the last JSON line of a child, with its time `ms`, its `hash` and the reason of a skip. |
| `pairOrder(pairs, round, caseIndex)` | From `/fresh`: the order of the pairs of one case in one round, and the first arm of each pair. |
| `freshRun(options)` | From `/fresh`: the records of each pair, with each arm in its own fresh child process. |
| `codeStamp(options)` | From `/code-stamp`: the stamp of the code of a run, from the code that its entries reach, the lock closure of its engines and its data files. |
| `lockClosure(text, importer, names)` | From `/code-stamp`: each package that an engine pulls in, from a pnpm lock file. |
| `superviseCases(options)` | From `/supervise`: each case in a child process, held to a time budget, with a hard stop and a resume. |
| `caseProgress(file)` | From `/supervise`: the writer of the progress file of a child. |
| `startSupervisedProcess(argv, options)` | From `/supervise`: a child process that `superviseCases` can stop with its tree. |

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
- The option `share` permits some cases out of the limit. With `share: 0.95` and 20 cases, 1 case can be other than `within`. The verdict is `within` when that number of cases or fewer are other than `within`. It is `beyond` when more cases are `beyond`. The field `allowed` gives the number.

The verdict has no correction for many cases. Each case has its own interval at the level `caseLevel`. Thus with many cases, a verdict `beyond` can come from noise only. Set `caseLevel` higher when a bench has many cases. A correction of Holm is an option for a later version.

## A claim with a limit on a tail

`limitVerdict` needs an interval of the median, and a few rounds give a wide interval. `tailLimitVerdict` reads each value as it is. An example is a gate with 7 rounds and one limit for each module:

```ts
const v = tailLimitVerdict(records, aaRecords, {
  limit: (name) => limits[name],
  aaCap: 1.3,
});
v.outcome;                                        // "within", "beyond" or "cannot decide"
v.aaTail;                                         // the largest tail of the A/A arm
```

The rule of the verdict:

- The tail of a case is the value at `rank` of its ratios, from the largest. The default rank is 2, so one slow process cannot move it.
- A case is `beyond` when its median is over `limit.median`.
- A case is also `beyond` when its tail is over `limit.tail` and over the largest tail of the A/A arm of the run.
- Each case is `cannot decide` when the largest tail of the A/A arm is over `aaCap`. A loud run has no power, and this is not a pass. The caller takes another read.
- The option `aaCap` has no default, because a run with no cap passes each row when it is loud.
- The option `expected` names the cases that the run must have. A case of that list with no record reads `cannot decide`. Without this option, a run that loses a case reads the other cases only.
- `gateOf(v.cases)` gives the gate of the verdict: `pass`, `block` or `no read`.

With the default rank, a real cost in 1 round cannot fail the tail limit. This is by design: of 7 rounds, 1 round passes the tail, because 1 round cannot be told from noise. A cost in 2 rounds or more can fail it.

The verdict has no interval, so a limit needs a margin from the spread of earlier runs. `tailFalseFails` applies the rule to each case of an A/A arm. Each case reads the tail of the other cases. Print the count of `fails` on the gate, to state what the rule costs on noise.

A limit under 1 states a gain, and an A/A pair shows no gain. So the A/A arm has no read of that case, and the case goes in `gains` with that reason. The false fails of a gain limit come from repeat reads of an unchanged tree against its fixed base.

## A read of each CPU model

Runners of one label have different CPU models. A check of the pool passes when most reads come from the other models, so it can hide a model that reads apart. `modelTest` reads each model against the rest of its case. It uses a two-sample permutation test of the median, with one Holm family over all the rows.

- `differs`: the adjusted p is under `alpha`, and the shift is at `resolution` or more, when the caller gives one.
- `no read`: the test finds no difference. Few reads have little power, so this does not say that the model is the same. The row gives `floor`, the smallest p of that count, and `level`, the first level of Holm in the family. When `floor` is over `level`, the words of `modelRowText` say that this size cannot reach the level, with no flip. A row of that size reads `differs` only if other rows read `differs` before it, because each of those rows raises the level. When the level is in reach, `visible` gives the smallest shift that this test can see at that count and family. The option `searchVisible` set to false stops only that search.
- `too-few`: the model has under `minReads` reads, or the case has no other model. The row keeps its facts, and it stays out of the family.
- `not asked`: the option `asked` leaves the row out of the question. State the question before the reads, because a family that is chosen after a read has no valid p.

A read of `differs` tells where to look. It does not name a cause, because the reads of one model can share a runner image and a date.

`limitOnModel` gives the limit of a gain that reads on some models only. A model with no earlier reads gets the ceiling, and its read carries the words of `CEILING_ONLY`. A pass at the ceiling stops a loss, and it does not hold the gain.

`armModels` reads the models of the two arms of a set of pairs. When the arms come from different computers, a ratio compares the computers. A record with no model reads as `unknown`, and `unknown` is not one known model.

## A gate that can fail

A check that blocks a merge needs a result that can fail. `gateOf` reads the case outcomes of a verdict, and `notSlowerVerdict` gives the claim of a speed gate.

```ts
const gate = notSlowerVerdict(jobs, { margin: Math.log(1.015) });

gate.outcome;                                     // "pass", "block" or "no read"
gate.cases;                                       // "not slower", "slower" or "no read" for each case, with the facts of each job
gate.more;                                        // the next look of each case with no outcome
```

- The claim is "not slower by more than the margin". A one-sided bound answers it, thus a case can read `not slower` when its interval holds 1. The word `same` of `timeVerdict` asks for more.
- The outcome of each case uses the words of `LimitOutcome`: `within` is `not slower`, `beyond` is `slower`, and `cannot decide` is `no read`. Thus `gateOf` also reads `limitVerdict` and `budgetVerdict`.
- A case needs its bound in each of `jobs` jobs, by default 2. More rounds do not remove a difference between jobs.
- The claim "the bound holds in at least `r` of `J` jobs" is a partial conjunction. Its p is `(J - r + 1)` times the `r`-th smallest p of the jobs (Benjamini and Heller, 2008). With 2 jobs of 2, this p is the larger p.
- The sign test compares the median difference with the margin in each job. It uses no random numbers.
- A pair holds two records with the same first arm. A runner can give the two arms opposite orders in one round, and a difference of two orders holds the effect of the order.
- The `level` is for the family. `holm` corrects each look over all cases. Each look has an equal share of the level.
- The first look with an outcome decides a case. `GATE_LOOKS` is 12, 24 and 48 rounds.
- Take 16 cases and the default looks. The first test of a family at 12 rounds needs 12 of 12 pairs below the margin in both jobs. Thus a noisy case needs more rounds, or it stays `no read`.
- `no read` is not a pass. A caller adds the rounds of `more`, then more jobs. A job that it adds after the last look is one more look, and the level does not count it.

The level needs independent rounds. Rounds with a shared cause, for example a slow computer for one job, do not have it.

## A claim with a budget

`limitVerdict` judges a ratio of two arms. A budget is an absolute limit on one build. An example is "the median blocking time of this page is at most 450 ms". A budget needs `budgetVerdict`:

```ts
const v = budgetVerdict(rounds, aaRounds, { limit: 450, maxDifference: 200 });

v.outcome;                                        // "within", "beyond" or "cannot decide"
v.cases;                                          // the medians, the interval, the outcome and the reason of each case
```

- Each round has the fields `case`, `round` and `value`. A value of 0 is valid, so a case with no blocking time has a verdict.
- The arm `aa` is a second arm of the same build. When the two medians differ by more than `maxDifference`, the run is too noisy, and the case is `cannot decide`.
- This check uses a difference, not a ratio. Two medians of 249 and 102 are a healthy run with a ratio of 2.4.
- The level 0.95 needs 6 rounds or more in each arm. With fewer rounds, the case is `cannot decide`.
- A case is `within` when the high end of the interval of its median is at most the limit. A case is `beyond` when the low end is above the limit.

### Add rounds up to a budget

Six rounds give an interval from the lowest to the highest value. One slow load makes the case `cannot decide`, and a rerun hides this. `budgetLooksVerdict` adds rounds to the cases with no outcome:

```ts
let v = budgetLooksVerdict(rounds, aaRounds, { limit: 450, maxDifference: 200 });
while (v.more.length > 0) {
  // Add rounds to both arms, so each case in v.more has its v.more[i].rounds.
  v = budgetLooksVerdict(rounds, aaRounds, { limit: 450, maxDifference: 200 });
}

v.fails;                                          // true only when an interval is above the limit
```

- `BUDGET_LOOKS` has looks at 6, 12 and 24 rounds. The interval of 6 rounds is the same as in `budgetVerdict`.
- Each extra look at the data adds a chance of error. The levels of the looks are high, so the sum of the chances is 0.0442, under the overall 0.05.
- The sum comes from the real coverage of each interval, not from the nominal level. A list that spends more than the overall level gives a `RangeError`.
- Each coverage needs independent rounds. This limit stays: a slow computer for one whole run moves all its rounds.
- The first look with an outcome decides a case. Later rounds of the case do not change it.
- A final `cannot decide` does not fail. Show it to the reader of the run. A median near the limit can have this outcome.

We tested the default looks by resampling 48 blocking times of a noisy web page, with the median moved. Each row has 20000 seeded runs, and the limit is 450.

| True median | Six rounds: outcome `beyond` | Looks: outcome `beyond` | Looks: final `cannot decide` | Mean rounds |
| ---: | ---: | ---: | ---: | ---: |
| 300 | 0% | 0% | 0% | 6.9 |
| 376 | 0% | 0% | 2.8% | 12.4 |
| 450 | 1.5% | 2.0% | 96.1% | 23.4 |
| 500 | 38.6% | 89.0% | 11.0% | 15.1 |
| 550 | 44.6% | 93.9% | 6.1% | 13.8 |

## A claim at each size: the ladder

A ladder is the scale plan of a product, as data. It has rungs at sizes that grow, for example 1, 10 and 100 tenants. Each rung has budgets, and it names the test that holds it. A number in a document is not a rung: a rung is held only when a record of its test shows each budget `within`.

```ts
const ladder: Ladder = {
  format: LADDER_FORMAT,
  subject: "reference service",
  dimensions: [{ name: "tenants", describe: "one customer" }],
  rungs: [{
    name: "1,000 tenants",
    at: { tenants: 1000 },
    test: "load-1000",
    locked: true,
    budgets: [
      { kind: "median", measure: "read", unit: "ms", limit: 50, maxDifference: 20 },
      { kind: "rate", measure: "failed requests", limit: 0.0001 },
      { kind: "worst", measure: "lost writes", unit: "writes", limit: 0, minDrills: 3 },
    ],
  }],
};

const v = ladderVerdict(ladder, records, { now: new Date().toISOString(), maxAgeDays: 8 });

v.held;                                           // the highest rung with each rung up to it within
v.next;                                           // the first rung that is not within
v.failed;                                         // true when a locked rung is not within
```

There are four kinds of budget:

| Kind | Evidence | The verdict |
| --- | --- | --- |
| `median` | Rounds and an A/A arm | `budgetVerdict`, so the rules of a budget apply. |
| `quantile` | The values, and optional `censored` bounds | The distribution-free interval of the quantile at 95 % against the limit. |
| `rate` | Failures and trials | The Wilson interval at 95 % against the limit. |
| `worst` | The value of each drill | The largest value against the limit. One bad drill is `beyond`. |

- A p99 needs 368 independent values for an upper bound at 95 %. A p95 needs 72 and a p99.9 needs 3,688. `quantileSamples` gives the count. With fewer values, the verdict is `cannot decide` or `beyond`. It is not `within`. Latencies of one run can follow each other: space the samples apart, or give one value for each run.
- An arrival with no reply goes in `censored`, and an arrival that was not sent goes there too. Each value is a lower bound: the time that the arrival waited. The low end of the interval reads the bounds, and the high end reads each censored value as `Infinity`. Thus a `beyond` can come from the bounds alone, and a `within` needs real replies up to the upper rank. Do not put a censored value in `values`: its bound is low, and the verdict can be a false `within`.
- A failed rate of 0 of 38,500 holds a limit of 0.01 %. A failed rate of 0 of 30,000 is `cannot decide`, because the Wilson bound of that run is 0.0128 %.
- A locked rung fails when it is `beyond` and when it is `cannot decide`. A skipped test is not a pass.
- The verdict reads the newest record of each rung, so an old pass does not hide a new failure. With `maxAgeDays`, an older record gives `cannot decide`.
- A high rung does not count over a gap: `held` stops at the first rung that is not `within`.
- A record states what was real and what was synthetic. A record with no entry in `real` gives `cannot decide`.
- `checkLadder` gives each problem of a ladder as data. `ladderVerdict` throws a `RangeError` for a ladder with problems.

## A claim on the growth of a cost

A ladder holds each size to a limit. A growth claim holds the step between sizes, for example "the time of one publish grows less than 15 times for each 10 times more subscribers". A cost that grows as n x n grows 100 times for each 10 times. A linear cost grows 10 times.

```ts
const v = growthVerdict(
  [
    { job: "job-1", size: 1_000, value: 9.0 },
    { job: "job-1", size: 10_000, value: 51.8 },
    { job: "job-1", size: 100_000, value: 590 },
    // ... the same sizes for each other job
  ],
  { maxGrowth: 15 },
);

v.outcome;                  // "within", "beyond" or "cannot decide"
v.steps[0].median;          // the median growth of the jobs from 1,000 to 10,000, for a step of 10 times
v.steps[0].exponent;        // the cost grows as the size to this power
```

- The verdict reads a ratio inside each job: the cost at the larger size over the cost at the smaller size. Each job runs on one runner, so a slow runner changes both values and the ratio keeps its value. The verdict needs no A/A arm.
- A step that is not `per` times in size is scaled to `per` times, with the exponent of the step. The default of `per` is 10.
- The interval of each step is the distribution-free interval of the median of the jobs. With 5 jobs it is the full range, with the coverage 0.94. A step is `within` when the high end is less than `maxGrowth`.
- A job that gives more than one value at a size gives their median.
- The flip test of a growth gate is the old code: it must give `beyond`.

## Time the rounds

`timeRounds` times one case in one process. Start a fresh process for each case and each pair, and give the index of the case as `offset`:

```ts
const { records } = timeRounds({ a: () => oldCode(input), b: () => newCode(input) }, { case: "board-1", rounds: 31, offset: 0 });
```

Each arm gives a number. The engine cannot remove the work of a call, because the sum of these numbers uses it.

## Read the load of a run from a control

Runs on shared machines differ by load. A control is a case that a change does not touch, so its time measures the machine. `controlFactor` gives the load factor of each group of rows.

```ts
import { controlFactor } from "@mark1russell7/rigor-bench";

// Two runs: the median ratio of the keys that both runs have.
const two = controlFactor(rows, { base: "run-1" });
two.factors[0]; // { group: "run-2", factor: 1.35, pairs: 200, low: 1.2, high: 1.5, censored: 3 }

// One run, grouped by shard: each time against the median of its key over the shards.
const shards = controlFactor(shardRows);
```

- A key names a class of work, so equal keys in two groups mean equal work. Thus a shard with a different mix of work does not read as load. Each group has at most one row for a key.
- A key in one group has nothing to compare with, so no factor reads it. The field `unshared` counts those keys.
- Without `base`, a factor reads against the other groups. Thus a load that all groups share does not show.
- A group with too few usable keys gets an entry with `factor` undefined and a `reason`, so the other groups keep their factors. The function refuses a result where no group has a factor.
- A censored time is only a lower limit, so no ratio reads it. The field `censored` counts those keys. A run stops its slowest cases, so a factor reads low when `censored` is not 0.
- The fields `low` and `high` are the quartiles of the ratios. A wide spread means that one factor does not explain the load.
- The function refuses a group with fewer usable keys than `minPairs`. The default is 5.

## Check that a trick does not buy a measure

A control is a strategy made to win one measure and nothing else. A real entry can win that measure by the same trick. So `checkMeasures` reads the controls of a bench, and `winClaim` tells a page what to show beside a win. Each project keeps its own controls.

```ts
import { checkMeasures, winClaim } from "@mark1russell7/rigor-bench";

const check = checkMeasures(rows, {
  asOf: "2026-11-05",
  controls: ["only-fill"],
  rules: [
    { measure: "fill", sense: "higher", controls: ["only-fill"], partners: ["order"] },
    { measure: "order", sense: "lower", controls: [], partners: [], noControl: { because: "The control has no code yet.", until: "2026-11-20" } },
  ],
});
if (check.findings.length > 0) process.exitCode = 1;
const claim = winClaim(check, "fill", "my-entry");
```

Each row has a `measure`, a `group`, a `key` and a `value`. The optional fields are `censored`, `method` and `stratum`. The function throws a `RangeError` for a repeat of a measure, a group and a key. The caller states how repeats reduce to one row.

- **Beats:** the Holm-corrected sign test passes. With a `resolution`, the median paired difference is also over it. Without one, the output says `test only`.
- **Floors:** a rule can state `floors`, one number for each group. The noise of a measure can differ by group, so one number for all groups removes real gains or passes noise. A comparison then needs a size over the larger floor of its two groups, and `floor` gives that size. A group with no floor reads `resolution`. A group with neither makes the check throw.
- **A control wins** when no real entry beats it. A tie counts for the control.
- **A control loses a partner** when one real entry beats it on that partner, at the level divided by the count of partners. One passed partner clears `uncaught`, so each partner is one more chance.
- **Families:** one Holm family holds one control on one measure, over all real entries and all strata. A second family holds the same tests in the other direction, and `beatsEntries` of `of` gives its count. One family holds the spread of one measure.
- **Too few:** the need comes from `signTestPower` at the level of that family, over the untied keys. So 31 real entries need 10 untied keys at the level 0.05. A test under the need beats nothing. A pair with enough keys that ties reads as equal.
- **Strata:** the keys of one stratum come from one family of inputs, so they are not independent draws. A result is about these keys.

Strata make a family larger, so each stratum needs more keys:

| The family | Tests | Sides | Untied keys for each test |
| --- | --- | --- | --- |
| 31 entries, no strata | 31 | 1 | 10 |
| 14 entries, 15 strata | 210 | 1 | 13 |
| 30 entries, 20 strata | 600 | 1 | 14 |
| The spread of 31 entries, 20 strata | 9,300 | 2 | 19 |

So a stratum of 10 keys reads `too-few` by construction. That result is true, and the check keeps it. A caller gets the pooled read when the rows have no `stratum`. A sign test needs independent signs and not equal distributions, so a read can pool the keys of different families. A bench reads pooled for its gate, and by stratum where the keys are sufficient.

Each finding fails a gate, and each one carries its tests with `n`, `ties`, `p` and the Holm result.

| Finding | Meaning |
| --- | --- |
| `uncaught` | A control wins the measure and loses no partner. The trick pays. |
| `weak-control` | A control with power beats no real entry on its measure, in any stratum. The trick buys nothing. A control in second place that beats other entries is not weak. |
| `censored-win` | A control wins with more censored keys than an entry it is read against. |
| `no-spread` | No pair of real entries separates on the measure. |
| `too-few` | No read of the controls or of the spread has enough keys. A control that wins and has a partner with too few keys also gives it. A small stratum alone gives only a row. |
| `mixed-method` | The rows mix methods, or a method and no method. The check has no read of the measure. |
| `no-rule` | The rows hold a measure with no rule. |
| `no-rows` | A rule names a measure or a control with no rows. This does not read as "not beaten". |
| `no-control` | A rule has no control and no `noControl`. |
| `control-late` | The date of `noControl` is before `asOf`. |

`winClaim(check, measure, entry, stratum)` gives `alone`, `show`, `likeControl`, `censored` and `open`. The fields are about this entry. The field `likeControl` is true when this entry does not beat a control on the measure and beats it on no partner. A win by another entry clears nothing. The field `alone` is true only when this entry itself beats each control on the measure, so a measure with no control is not `alone`.

`jointClaim(check, measures, entry, stratum)` reads a set of measures together, because one measure cannot call a win when each control wins a measure and loses a partner:

```ts
const joint = jointClaim(check, ["fill", "order"], "my-entry");
joint.verdict; // "survives", "dominated", "not-ahead" or "no-read"
```

| Verdict | Meaning |
| --- | --- |
| `survives` | No control dominates the entry, and the entry beats at least one control on each measure. |
| `dominated` | A control beats the entry on at least one measure, and the entry beats that control on none. The field `dominatedBy` names it. |
| `not-ahead` | The entry beats no control on a measure with each read made. The field `notAhead` names it. |
| `no-read` | A test with too few keys, or a measure with no control, decides the claim. This verdict is not a pass. |

A tie does not clear a control, and the win of another entry gives this entry no credit. The function adds no test: it reads the tests of `checkMeasures`, with their Holm families.

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

## A result that changes on purpose

A bench compares two arms, and two arms with different results do not do the same work. So a difference stops the merge. A pull request can change a result on purpose. Without a stated path, its author edits the case, and no gate reads that edit. A row in the diff gives that path, and it names the exact change.

```ts
import { resultRows, resultVerdict } from "@mark1russell7/rigor-bench";

const verdict = resultVerdict(
  [{ case: "facts of a tree", base: "9f3a", head: "c81e" }],            // the hash of the result of each case in the two arms
  { base: resultRows(rowsOfTheBase), head: resultRows(rowsOfTheHead) }, // the parsed file of rows in each arm
);

verdict.outcome;                                  // "pass" or "fail"
verdict.lines;                                    // the lines that the check prints
```

A row has four fields: `case`, `base`, `head` and `reason`. The fields `base` and `head` are hashes that the caller makes, so a large result stays out of the file. A reviewer can read a row against the run. A refused line prints the row to add. These rules stop the reuse of a row:

- **The hashes bind the row to one change.** The same row against one other result reads `refused`, and the line says which side moved: the base, the head or both. The fields have an order, so a row of a change does not accept its revert.
- **A row counts only if it is new.** A row that the base also has is spent and accepts nothing, even on the same change. The verdict keeps the array `spent`, and it prints one line with the count.
- **A new row that accepts nothing fails the verdict.** A row of a case with one result reads `unused`. Otherwise it merges and is spent, and a later true change is refused.
- **A row of a case with no result fails the verdict.** It reads `absent`, because a missing read is no pass. The case can be skipped or filtered out, so the line does not tell the author to delete the row.
- **A change that comes again needs two pull requests.** The first one deletes the spent row, and the second one adds it. A revert can delete the row in the same pull request.

**Time.** The verdict reads results only. An accepted result buys no time reading. Keep the accepted case in `freshRun`, so it gets its head and A/A pairs and its normal time verdict. The time of the new result counts. The hash rule of `freshRun` is per arm, so two arms with different hashes run. The test "refuses two hashes of one arm on one case, and permits other hashes for other arms" pins this rule.

## The stamp of the code of a run

The entry `@mark1russell7/rigor-bench/code-stamp` is for Node only. It uses the optional peer `esbuild`. Add `esbuild` to the dependencies of the caller, so that its lock file pins the version.

A run keeps a saved record when the stamp of the record equals the stamp of the run. A version number is a poor stamp. A release that changes no result throws away each record, and a change with no release keeps wrong records. The function `codeStamp` hashes what can change a result.

```ts
import { codeStamp } from "@mark1russell7/rigor-bench/code-stamp";

const stamp = await codeStamp({
  cwd: "packages/bench-of-my-repo",
  entries: ["src/runner.ts", "src/cover.ts"],
  engines: { names: ["my-engine"], lockFile: "../../pnpm-lock.yaml", importer: "packages/bench-of-my-repo" },
  dataFiles: ["corpus/corpus.json"],
  reads: ["readFileSync"],
});
```

| Part of `stamp.parts` | What it reads | A change that moves it |
| --- | --- | --- |
| `code` | The bundle of the entries after a tree shake, with the engines outside | A token that the entries reach, a new export of an entry, a rename |
| `engines` | The version and the integrity of each package in the lock closure of each engine | An engine version, a transitive package of an engine |
| `data` | The name and the hash of each file in `dataFiles` | A byte or the name of such a file |
| `bundler` | The version of `esbuild`. This part is not in the hash | A new version in the lock file of the caller |
| `node` | The Node major | Another major, which can change a float or a sort |

These changes keep the stamp: a comment, blank space, line ends, a type and a version in a package file. An export that the entries do not reach and another folder for the same files also keep it.

The same tree gives the same stamp on Linux and on Windows. A slash in an option can have either direction. The hash of a text data file reads each line end as LF, and a file with a NUL byte hashes as its bytes. So a parser that reads a line end as data can read another result with an equal stamp.

The stamp holds no computer. Each record keeps the computer as a field, because a time depends on it and a result does not.

### What a bundle cannot see

- **A file that the code reads when it runs.** The bundle holds no such file. So the function looks for the words of `CODE_STAMP_READ_WORDS` in the bundle, for example `readFileSync`, `fetch` and `process.env`. A word that the option `reads` does not state refuses the stamp, and so does a stated word that the bundle does not hold. List each file that such a read opens in `dataFiles`.
- **The name of a file that a program makes at run time.** A word tells that a read exists, not which file it opens. The list in `dataFiles` is the statement of the caller.
- **The code below an engine.** An engine stays outside the bundle, so `lockClosure` hashes the resolved closure of the engine from the lock file. The name of the engine alone is not sufficient. It reads pnpm lock files of version 9 and refuses another version.

A workspace package is not an engine: `lockClosure` refuses it, because its code enters the bundle.

### The limits of the stamp

- A rename of an identifier moves the stamp, and so does the rename of an entry file. This gives a false rerun, not a false keep.
- A top-level statement with an effect stays in the bundle when its module has no `"sideEffects": false`. A change of that statement moves the stamp, also when no result depends on it.
- A new version of the bundler that gives an equal bundle keeps the stamp and the records. A new version that gives another bundle moves `code`, so it keeps no record, also when no result can change. This gives a false rerun, not a false keep. The field `bundler` of `parts` tells the cause. A caller with long runs holds automatic updates of the bundler in its own update settings. It merges an update when its next full run starts. The read of 2026-11-05 stamped 2 real entries (17 inputs) with 8 versions of the bundler, 0.27.2 to 0.28.2. Each of the 7 steps gave an equal bundle, so 0 of 7 steps gave a false rerun. The true rate is at most approximately 35 % at 95 %, and this read is of one tree only. Also, esbuild 0.27.4 crashed on a failed build of an entry in that read. That version is outside the peer range, so the read does not count it as a false rerun.

## Run cases with a time budget

The entry `@mark1russell7/rigor-bench/supervise` starts child processes, so it is for Node only.

The function `superviseCases` holds each case to a time budget. Code that does not return cannot stop itself, so the cases run in a child process and a hard stop ends the child.

```ts
import { startSupervisedProcess, superviseCases } from "@mark1russell7/rigor-bench/supervise";

const result = await superviseCases({
  cases: [{ id: "a", budgetMs: 300_000, groups: { "": "router-1" } }],
  progressFile: "out/progress.ndjson",
  start: (left) => startSupervisedProcess([process.execPath, "run-cases.js", ...left]),
  onEnd: (end) => writeRecord(end),
});
```

The child calls `caseProgress(file).start(id, stage)` before each stage, and `end(id)` after the result is on the disk.

- A stage over its budget gives `over-budget`. This time is a lower bound, so a statistic treats it as censored, not as a value. The next child runs the cases that are left.
- After 2 overruns in one group (the option `overruns`), each other case of the group gives `not-run`, with the ids of the 2 overruns. When cases have a `rank`, for example an input size, the count is for each rank. The stop is for that rank and above, and a smaller rank goes on. An overrun is measured, and a skip is not. Keep these tags different.
- An overrun counts for the group of its stage only. A slow router thus does not count against the packer of its cases.
- A case in `done` does not run, so a resume runs no case two times.
- The option `earlier` takes the ends of a stopped run. Its overruns count for their groups, so a stop and a resume give the same ends as a run with no stop. Keep each case in `cases`, and put the ids of the finished cases in `done`.
- Only an overrun starts a new child, so the other cases keep the process and the caches of a normal run.
- A case can end between a read of the file and the stop. That case has its result, so it does not get a tag.

The callback `onEnd` writes the record of each tag. The callback `start` can also repair a file that a stop cut.

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

`poolRecords` makes the pool. It does the checks, the removal of the skipped cases and the balance of the list above. `pooledVerdict` and `pooledLimitVerdict` use it, so the two verdicts have one pool.

### The pooled limit verdict

A speed gate on limits over a CI matrix needs `pooledLimitVerdict`:

```ts
const v = pooledLimitVerdict(jobs, { limit: 2 });

v.outcome;                                        // the pooled outcome, or "cannot decide" when a job gives the opposite outcome
v.pooled;                                         // the limitVerdict of the merged records
v.jobs;                                           // the limitVerdict of each job alone
v.opposed;                                        // the jobs against the pooled outcome
```

- The pool of one job gives the `limitVerdict` of that job.
- A job with `beyond` against a pooled `within`, or the reverse, makes the outcome `cannot decide`. Thus a job past the limit stops a gate that needs `within`.
- A job with `cannot decide` does not change the outcome.

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

For a fixed limit, for example 1.10 against a fixed base, use `limitVerdict`. With few rounds and a limit on a high value of each case, use `tailLimitVerdict`.

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
