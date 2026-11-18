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
| `runCost(cells, probes, options)` | The minutes of a bench run before it starts, on each CPU model: the cells times the calls times the time of one call. |
| `firstArm(round, offset)` | The arm that runs first. The order turns each round, and an odd offset starts with arm `b`. |
| `armOrder(arms, round)` | The order of any count of arms in a round. Each pair of arms has each order within 1 after each count of rounds. A report that keeps no `first` for each pair states the order that it used, so that a reader can make `first` again. |
| `balancedRounds(arms)` | The count of rounds that balances `armOrder`: 2 times the count of arms. Each arm is then at each position 2 times. |
| `mergeCaseModules(modules)` | The cases of a list of modules in one record, and the module of each case. Two cases with one name are an error. |
| `moduleListGaps(files, listed)` | The modules of a folder that are not in the list, and the listed modules that are not in the folder. |
| `checkPairedTime(record)` | The record, or a `RangeError` for a time that is not a finite number above 0. |
| `caseRatios(records)` | The ratio of each case. It refuses 2 records of one round, and an order that did not turn. |
| `orderSize(records)` | The count of records per first arm, the order effect, and the amount that unequal counts can move a mean. This size is a guide, because a verdict reads a median. |
| `aaBand(aa, options)` | The band of the A/A arm, symmetric on a log scale. The kind `median` (the default) holds the A/A median, and the kind `case` holds one A/A case. It needs 5 cases or more. |
| `timeVerdict(candidate, aa, options)` | The outcome of the rule `difference` (the default) or `band`. |
| `verdictMargin(options)` | The margin of the rule `difference` on a log scale: the larger of `margin` and the noise of the pooled band. An interval in `[exp(-margin), exp(margin)]` is `same`. |
| `aaSpread(aa, level)` | The A/A spread: the `level` quantile of `abs(log(ratio))` over the A/A cases. The default level is 0.9. |
| `pooledBand(pool, level)` | The pooled band: the larger of the floor and the A/A spread of the records of earlier runs. |
| `caseIntervals(records, level)` | The ratio of each case with a distribution-free interval of its median over the rounds. The level 0.95 needs 6 rounds or more. |
| `limitVerdict(candidate, aa, options)` | The verdict of the claim "the ratio of each case is at most `limit`": `within`, `beyond` or `cannot decide`. `aaFrom: "rounds"` takes the A/A noise from the rounds of each case. |
| `tailLimitVerdict(candidate, aa, options)` | The verdict of the claim "the median and a high value of each case are at most their limits", for a bench with few rounds. |
| `caseTails(records, rank)` | The value at one rank of the ratios of each case, from the largest. |
| `processVerdict(reads, options)` | The verdict of each case over its first k valid processes: the median against a limit, and the count above a slow line. |
| `processCaseLine(case)` | One line of a case of `processVerdict`: the outcome, the median, the slow count and the ratio of each process. |
| `isValidRead(read)` | True when the A/A band of a process read contains 1, or when the read has no band. |
| `modelTest(reads, options)` | The read of each CPU model against the rest, for each case: `differs`, `no read`, `too-few` or `not asked`. |
| `visibleShift(values, rest, level, direction, options)` | The smallest shift in one direction that a test can see at this count and level, and the smallest p of this count. |
| `modelRowText(row, family)` | The words of one row. No word says that a model is the same as the rest. |
| `limitOnModel(limits, model)` | The limit of a gain on one CPU model: the gain limit, or the ceiling with its words. |
| `cpuEntry(table, cpu)` | The entry of a table whose key is a part of the CPU name, with the case ignored, or the entry `other`. |
| `armModels(pairs)` | The CPU models of each arm of a set of pairs, and if all the reads come from one known model. |
| `candidateLimits(reads, rule)` | The candidate limit of each case on each CPU model: the mean plus k standard deviations, from 5 reads or more. |
| `freezeLimits(measure, candidates, stamp, rule)` | A file of frozen limits, with the values, the commit and the date of each limit. |
| `runLimit(values, options)` | The limit of the rule of the gate limits: the worst value of 5 runs or more plus their spread, rounded away from the values. |
| `aaStats(aa, level)` | The A/A statistics of each case of one job: the median log ratio and the spread of the rounds. |
| `aaOrders(aa, level)` | The A/A ratio of each case over all rounds and over the rounds of each order, with the interval of each median. |
| `aaLimits(jobs, options)` | The margin and the noise cap of each family of cases from the A/A statistics of the jobs, and the jobs that went out. |
| `aaLimitOf(limits, family)` | The options `margin` and `noiseCap` of `timeVerdict` for a family, or the fallback limits. |
| `checkModelLimits(file)` | The faults of a file of frozen limits. The function computes each limit again from its values. |
| `modelLimitRead(file, read)` | The read of one value against the frozen limit of its CPU model: `within`, `beyond` or `no read`. |
| `limitChanges(before, after)` | The change of each limit between two files, and each looser limit that has no new reason. |
| `tailFalseFails(aa, options)` | The cases of an A/A arm that the rule of `tailLimitVerdict` fails, and apart from these the cases with a limit under 1. |
| `gateOf(cases)` | The gate of a list of case outcomes: `pass`, `block` or `no read`. |
| `gateLine(cases, options)` | The check line of a read: the blocks and the no-reads with each case, the reason and the CPU models, or undefined when each case passed. |
| `jobModels(envs, options)` | The count of the jobs on each CPU model, sorted by model, for the job form of the models of `gateLine`. The option `cores` keeps the cores. |
| `writeGateLine(line, outputs)` | The line as an annotation of GitHub Actions, an error for an enforced gate or a warning, and as a line of the step summary. |
| `gateLineCli(argv, io)` | The command of the bin `rigor-gate-line`: a gate line from a JSON document of a shell step. |
| `notSlowerVerdict(jobs, options)` | The gate of the claim "not slower by more than the margin", with looks and a family level. |
| `budgetVerdict(rounds, aa, options)` | The verdict of the claim "the median of each case is at most `limit`", for one build: `within`, `beyond` or `cannot decide`. |
| `budgetLooksVerdict(rounds, aa, options)` | The budget verdict of a run that adds rounds to the cases with no outcome, up to a stated budget. |
| `budgetLookSpend(looks)` | The chance of error that a list of looks spends. |
| `overLimit(firstMs, limitMs)` | True when a first run is over the limit. With no limit, no run is over it. |
| `runMethod(firstMs, options)` | The method of one case: `two runs`, `sentinel` or `one run`. |
| `sameResult(method, firstHash, secondHash)` | The claim that the result stays the same: `true`, `false`, or `null` for one run. |
| `sentinelCases(cases, options)` | The cases that keep their second run over the limit: the smallest one, and one rotating case of each group. |
| `firstAgainstSecond(rows)` | The ratio of the second time over the first time of each group, with `firstAgainstSecondLine` for its text. |
| `timeRounds(arms, options)` | The timed rounds of one case in one process: a warm-up, a batch of at least the target time, and the order of `firstArm`. |
| `slopeVerdict(rounds, options)` | The verdict of a slope claim from a ladder on a log-log scale, with the A/A check of each run: `within`, `beyond` or `cannot decide`. |
| `roundSlope(rungs)` | The least-squares slope of `log value` against `log size` of one round of 3 rungs or more. |
| `timeArmRounds(options)` | The timed rounds of one case in one process for a base and 1 or more candidates, with the order of `armOrder`, an A/A pair and the span of each timed batch. |
| `verdictPower(options)` | The share of each outcome over seeded benches with a known ratio: the power test of a rule. |
| `familyRead(items, level)` | The reads of a family of cases as a report: Holm over the cases, each job alone, and both. Each read changes only `slower` and `faster`. |
| `familyPower(options)` | The false-slower share of a family and the share of a slow case read, for each read, over seeded families. |
| `balanceOrders(records)` | The records of each case with a turned order. It removes the extra records of the larger order, with the highest rounds first. |
| `poolRecords(jobs)` | The pool of the jobs: the merged and balanced records, the records of each job, and the skipped cases. |
| `pooledVerdict(jobs, options)` | The verdict of the merged records of all jobs, with the verdict of each job alone as a guard. |
| `pooledLimitVerdict(jobs, options)` | The limit verdict of the merged records of all jobs, with the limit verdict of each job alone as a guard. |
| `armVerdicts(run, aaPair, options)` | The verdict of each candidate pair of a run against its A/A pair. |
| `benchEnv()` | From `/fresh`: the computer of this process, with the CPU model and the runner. |
| `childLine(stdout)` | From `/fresh`: the last JSON line of a child, with its time `ms`, its `hash` and the reason of a skip. |
| `pairOrder(pairs, round, caseIndex)` | From `/fresh`: the order of the pairs of one case in one round, and the first arm of each pair. |
| `startProcess(argv, options)` | From `/fresh`: the default start of a child, with no shell, and a stop at the time limit or the output limit. |
| `freshRun(options)` | From `/fresh`: the records of each pair, with each arm in its own fresh child process. With `order: "arms"`, the pairs of a round share one base child. |
| `freshArms(options)` | From `/fresh`: one fresh child for each arm in each round, in the order of `armOrder`, with A/A records and fixture hashes. |
| `armTimes(processes)` | From `/fresh`: the median, the 10th and the 90th percentiles, their ratio, and the least and the greatest time of each arm over its children. |
| `checkFixtures(folder, files, options)` | From `/fresh`: the hash and the size of each fixture file, or an error that names each file that is not the pinned file. |
| `fixtureDifferences(a, b)` | From `/fresh`: the fixture files that two records do not share with the same hash. |
| `timeArm(run, options)` | The child side of `freshRun`: the median time of one call of one arm, over calibrated samples. |
| `peakRss()` | From `/fresh`: the memory peak of this process in bytes, for the child line. |
| `checkoutArm(options)` | From `/fresh`: an arm on a git worktree of a commit, built by its setup commands. |
| `repoCommit(ref, options)` | From `/fresh`: the full hash of the commit of a ref, for the arm of the job. |
| `eventProbe(options)` | From `/fresh`: the GC events, the GC time and the deopts of a child in each half of its counted samples. |
| `caseWarms(records, arm)` | The median warm check of each case over its rounds, for one arm of the records. |
| `warmVerdict(pairs, options)` | The warm rule of a fresh run: each pair against the A/A pair, and the steady cases. |
| `pairedChild(options)` | The samples of one paired child: the base, the candidate and a copy of the base in one process, in turn. |
| `pairedChildOrder(round, offset, steps)` | The order of the samples of a paired child: a block A B B A for each pair at each step. |
| `childRecords(case, round, offset, order, times)` | The `PairedTime` of the candidate pair and of the A/A pair of a paired child, from the medians. |
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

The band of the A/A arm needs 5 A/A cases or more. A bench with fewer cases gives `aaFrom: "rounds"`:

```ts
const v = limitVerdict(records, aaRecords, { limit: 1.1, aaFrom: "rounds" });
```

- The A/A rounds of each case give the noise of that case. The noise is the larger distance from 0 of an end of the interval of the A/A median, on a log scale.
- A case with no A/A rounds cannot decide. The verdict has no `band`, and the field `noise` of each case gives its noise.

The verdict has no correction for many cases. Each case has its own interval at the level `caseLevel`. Thus with many cases, a verdict `beyond` can come from noise only. Set `caseLevel` higher when a bench has many cases. A correction of Holm is an option for a later version.

## A claim on a slope

A claim, for example "the walk takes time linear in the size", needs a ladder of sizes. One ratio of two sizes cannot tell a constant factor from a power. `slopeVerdict` reads rounds of 3 rungs or more:

```ts
const rounds = [{ run: "job-0", rungs: [{ size: 1000, value: 2.1 }, { size: 2000, value: 4.3 }, { size: 4000, value: 8.4 }], aa: 1.01 }];
const v = slopeVerdict(rounds, { limit: 1.2, holds: 1, band: 0.05 });
```

- `roundSlope` fits the slope of `log value` against `log size` in each round. A linear cost gives 1, and a square cost gives 2.
- `aa` is the ratio of a second copy of one rung to the first copy, in the same passes. A run counts only when its A/A band contains 1.
- The interval of the slopes reads the rounds of the counted runs. The default `"spread"` is the 5th to the 95th percentile. `interval: "median"` gives the interval of the median slope.
- The outcome is `within` when the high end is at most `limit`. With `holds`, the interval must also meet the band `holds` plus or minus `band`.
- The outcome is `beyond` when the low end is above `limit`, or when the interval is outside that band. `gateOf` reads the outcome.
- The claim "at most linear" gives only `limit`. Then a slope well under 1, from a large fixed part of a call, also passes.
- `growthVerdict` reads the growth of each step of size in each job, with no A/A check. Use it when one step can grow faster than the others. `slopeVerdict` fits one power over all rungs.

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

## A verdict over k processes

Each fresh process of Node.js is one sample, because each user gets one process. A gate script can time each case in a process. It gives one ratio and the A/A band of the process. `processVerdict` decides each case over its first k valid processes:

```ts
const limits = cpuEntry({ "7763": { limit: 1.1, slow: 1.2, maxSlow: 2 }, other: { limit: 1.2, slow: 1.3, maxSlow: 2 } }, cpu);
const v = processVerdict(reads, { k: 7, limits: limits.value });
v.outcome;                                        // "pass", "block" or "no read"
v.more;                                           // the processes to start before the next read
v.cases.map(processCaseLine);                     // one line for each case
```

The rule of the verdict:

- A read is `{ process, case, ratio, aa, fault }`. A process counts for a case only when its A/A band contains 1.
- Check (a): the median of the first k valid ratios is at most `limit`.
- Check (b): the count of these ratios above `slow` is at most `maxSlow`. Without `maxSlow`, the count is a record only.
- A case with a fault is `beyond`. A case with no read from a process of the option `processes` is `cannot decide`.
- With fewer than k valid processes, a case is `cannot decide`. Then `more` gives the count that it needs.
- A case that fails a check for each value of the other processes is `beyond` at once.

Check (b) is the tail rule of `tailLimitVerdict` with the rank `maxSlow + 1`. With `slow` equal to `limit` and `maxSlow` 0, check (b) is "the worst ratio is at most the limit". Thus a read can also be the median ratio of one job, and the verdict reads k jobs. Take each limit from earlier runs with `runLimit`.

## A read of each CPU model

Runners of one label have different CPU models. A check of the pool passes when most reads come from the other models, so it can hide a model that reads apart. `modelTest` reads each model against the rest of its case. It uses a two-sample permutation test of the median, with one Holm family over all the rows.

- `differs`: the adjusted p is under `alpha`, and the shift is at `resolution` or more, when the caller gives one.
- `no read`: the test finds no difference. Few reads have little power, so this does not say that the model is the same. The row gives `floor`, the smallest p of that count, and `level`, the first level of Holm in the family. When `floor` is over `level`, the words of `modelRowText` say that this size cannot reach the level, with no flip. A row of that size reads `differs` only if other rows read `differs` before it, because each of those rows raises the level. When the level is in reach, `visible` gives the smallest shift that this test can see at that count and family. The option `searchVisible` set to false stops only that search.
- `too-few`: the model has under `minReads` reads, or the case has no other model. The row keeps its facts, and it stays out of the family.
- `not asked`: the option `asked` leaves the row out of the question. State the question before the reads, because a family that is chosen after a read has no valid p.

A read of `differs` tells where to look. It does not name a cause, because the reads of one model can share a runner image and a date.

`limitOnModel` gives the limit of a gain that reads on some models only. A model with no earlier reads gets the ceiling, and its read carries the words of `CEILING_ONLY`. A pass at the ceiling stops a loss, and it does not hold the gain.

`cpuEntry` gives the entry of a table for a CPU name, for example the limits of each model. The key is a part of the name, and the case of the letters does not count. A name with no key gets the entry `other`.

`armModels` reads the models of the two arms of a set of pairs. When the arms come from different computers, a ratio compares the computers. A record with no model reads as `unknown`, and `unknown` is not one known model.

## A frozen limit on each CPU model

A measure, for example a p99 time, has no base arm in a PR job. So its gate compares the read with a limit from earlier reads on the same CPU model.

- `candidateLimits` gives the mean of the reads of each model plus `noiseFloor` of `@mark1russell7/rigor-statistics`. The default rule `MODEL_LIMIT_RULE` is 3 standard deviations from 5 reads or more.
- A model with too few reads, with equal reads or with no known model gets no limit.
- `freezeLimits` writes the limits as data, with their values, the commit and the date. `checkModelLimits` computes each limit again, so the next reader can verify it.
- `modelLimitRead` gives `no read` for a model with no frozen limit. A `no read` is not a pass.

A limit does not move by itself. When new reads go straight into the limit, a slow regression raises its own limit. So a nightly run gives only a candidate, and a change of the file goes through a pull request. `limitChanges` accepts a tighter limit, a new model and a removed model. It refuses a looser limit that has no new `reason`, for example a change of the runner image. It also refuses a change of the rule or of the measure with no new `ruleReason`.

## The limits of a gate from earlier runs

The rule of the gate limits: a limit is the worst value of 5 or more CI runs plus their spread (max - min), with no factor. `runLimit` gives it:

```ts
import { aaLimitOf, aaLimits, aaStats, runLimit, timeVerdict } from "@mark1russell7/rigor-bench";

runLimit([1.31, 1.38, 1.37, 1.38, 1.31]).limit; // 1.45: the worst value 1.38 plus the spread 0.07

const limits = aaLimits(
  jobs.map((job) => ({ job: job.job, cases: aaStats(job.aa) })),
  { family: familyOf, marginFloor: Math.log(1.015) },
);
const { margin, noiseCap } = aaLimitOf(limits, familyOf(name));
const verdict = timeVerdict(candidate, aa, { margin, noiseCap });
```

- The limit goes away from the values at its last digit, so each run of the limit stays inside it. A measure where higher is better takes `better: "higher"`.
- `aaStats` gives the A/A statistics of each case in one job: the median of `log(b / a)` over the rounds, and the 0.9 quantile of `abs(log(b / a))`.
- For each family, each job gives its worst `abs(median)` and its worst spread over the cases of the family. The margin and the noise cap are `runLimit` over the jobs.
- A job whose worst spread is far above the other jobs goes out. The test is the robust z-score of `rigor-statistics` above 3.5, on the high side. The result names each job that went out.
- A family with fewer than 5 jobs uses the fallback limits of all cases. Fewer than 5 jobs for the fallback limits is an error.
- Keep the A/A statistics of the jobs next to the limits. A later run then gives the limits again and compares them.

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

## Show a gate read on the check

A block or a no-read that shows only in a table of the summary is easy to miss. A no-read is not a pass. `gateLine` gives one line for the check of the run, and `writeGateLine` writes it.

```ts
const line = gateLine(cases, { title: "evaluator bench", enforced: false, models: armModels(pairs) });
writeGateLine(line);   // a ::warning annotation (::error when enforced), and a line of the file of GITHUB_STEP_SUMMARY
```

- The input is a list of `{ case, outcome }`. The cases of `limitVerdict` and `budgetVerdict` have this form. Give one entry for each `timeVerdict`.
- The outcomes `cannot decide` and `no read` are no-reads, and `isNoRead` tells them. The outcomes `beyond` and `slower` are blocks, and `isBlock` tells them.
- When each case passed, the line is undefined and `writeGateLine` writes nothing.
- An empty list gives a line, because `gateOf` gives `no read` for it.
- One line names the blocks and the no-reads, each with its count and the names of its cases.
  - The line names at most `GATE_LINE_NAMES` (10) cases of each kind, then "and 15 more". The counts are exact.
  - `blocks.cases` and `noReads.cases` keep each case. Only the text names fewer cases.
  - The text has at most `GATE_LINE_LIMIT` (4096) characters. A case name of more than 120 characters ends with an ellipsis in the text.
  - The Checks API of GitHub limits the message of an annotation to 64 KB and its title to 255 characters. The documents of the workflow commands give no limit. Thus 4096 is a conservative limit.
- The outcome of the line is `block` when a case blocks, else `no read`, as in `gateOf`.
- The level is `error` when `enforced` is `true`. The default is `warning`, for a read that only reports. The title of a read that only reports says so.
- With `reason`, the line tells the reason after the counts, for example "a decision needs 3 jobs, not 2".
- With `models`, the line names the CPU models. Give one of two forms, not both.
  - An `ArmModels` of `armModels` names the models of the two arms. The line tells a mixed pair, because a ratio can then compare two computers.
  - A list of `{ model, jobs }` names each model and its count of jobs, for a time budget with its ratios inside one job. The line makes no claim about the ratios. The line is `mixed` when the jobs are on more than one model.
  - `jobModels(envs)` gives this list from the computer of each job: the count of the jobs on each CPU model, sorted by model.
  - `jobModels(envs, { cores: true })` also keeps the count of the cores. Each model and count of cores has an entry, and the line names the cores: "AMD EPYC 7763 with 4 cores (2 jobs)".
  - Without the option `cores`, the entries and the text do not change.
  - An empty list gives the sentence "The jobs have no CPU model".
- Write the line also when the run is report only, so its check shows the read.
- `writeGateLine` writes the annotation to the standard output. With `stream: "stderr"`, it writes to the standard error. GitHub Actions reads the annotation from the two streams.

### A gate line from a shell step

The bin `rigor-gate-line` writes a gate line from a JSON document. A shell step uses it when the reads are in a file.

```sh
rigor-gate-line --from gate.json                  # the annotation on stdout, and a line of GITHUB_STEP_SUMMARY
rigor-gate-line --stream stderr < gate.json        # the document from stdin, the annotation on stderr
rigor-gate-line --from gate.json --summary own.md  # a summary file that is not GITHUB_STEP_SUMMARY
```

```json
{
  "reads": [{ "case": "read-1", "outcome": "beyond" }, { "case": "read-10", "outcome": "cannot decide" }],
  "options": { "title": "store gate", "enforced": false, "reason": "too few rounds" },
  "jobs": [{ "cpu": "AMD EPYC 7763", "cores": 4 }],
  "cores": true
}
```

- `reads` and `options` are the two arguments of `gateLine`. `options.models` takes the two forms of `models`.
- `jobs` gives the models with `jobModels` when `options` has no `models`. With `"cores": true`, the line names the cores.
- The exit code is 0 for a line and for no line. The line informs, and the step decides its own exit.
- A bad argument or a bad document gives the exit code 2, with the reason on stderr.
- `gateLineCli(argv, io)` is the same command as a function, for a test or a script of its own.

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

## The cost of a run before it starts

A run with a time budget stops a case when the budget ends. A plan of a run needs its cost before the start. `runCost` gives this cost from the cells that the run measures and from probes of one call.

```ts
const cost = runCost(
  [
    { job: "shelf", size: 100, cells: 40 },   // only the cells that the run measures
    { job: "shelf", size: 1_000, cells: 40 },
  ],
  [
    { job: "shelf", size: 100, model: "cpu-a", ms: 2 },     // probes of the same inputs
    { job: "shelf", size: 1_000, model: "cpu-a", ms: 30 },
  ],
  { calls: 7, overhead: 1.45, budgets: [{ upTo: 10_000, ms: 60_000 }] },
);

cost.models[0].minutes;              // the minutes of the bench step on cpu-a
cost.models[0].jobs[0].stopsAt;      // the size where the job stops on its overruns, or undefined
cost.low; cost.high;                 // the range over the CPU models
```

- Give only the cells that the run measures. A cell that a job does not support at its size is not a cell. A count of all the cells of a corpus can be 4 times too large.
- Probe the same inputs that the run measures, on each CPU model. Times of other inputs can be 1.6 to 28 times off, also on one model.
- A size between two probe sizes gets a time on the line of the log scales. `extrapolated` names each size outside the probe sizes.
- More probes of one size give their mean, because a sum over cells follows the mean. The size 0 is not on the line.
- `calls` is the count of the warmup starts and the timed starts of one cell. `slow` gives a slow cell its own count.
- The probes of the nearest probe size give the spread of the times at a size. A cell over its budget costs the budget.
- When the expected count of the cells over budget at a size gets to `overruns`, the job stops. The counts of cells are expected counts.
- `overhead` is the bench step minutes over the call minutes of an earlier run. `jobMinutes` adds the fixed minutes of each job.

## Time the rounds

`timeRounds` times one case in one process. Start a fresh process for each case and each pair, and give the index of the case as `offset`:

```ts
const { records } = timeRounds({ a: () => oldCode(input), b: () => newCode(input) }, { case: "board-1", rounds: 31, offset: 0 });
```

Each arm gives a number. The engine cannot remove the work of a call, because the sum of these numbers uses it.

### More than two arms in one process

`timeArmRounds` times a base and 1 or more candidates of one case in one process. The records have the form of a fresh run:

```ts
const run = timeArmRounds({
  case: "board-1",
  base: { id: "loops", run: () => loops(input) },
  candidates: [{ id: "engine", run: () => engine(input) }],
  rounds: 16,
});
const verdicts = armVerdicts(run, "loops~aa");
```

- Each candidate makes a pair with the base. The id of the pair is the id of the candidate.
- The A/A pair `<base>~aa` times the base a second time in each round. `aa: false` removes it.
- A function in `aa` is the second arm of the A/A pair. Give it a second copy of the code of the base.
- Two builds in one process are two modules. Two modules of the same code can differ in time, and the base a second time does not show it.
- In ESM, a query on the URL of a file gives a second module of the file: `import(new URL("?copy=aa", url).href)`. Its imports stay shared.
- Each round times one batch of each arm in the order of `armOrder`. Thus each pair has each order one time in each two rounds.
- `offset` turns the arms before `armOrder`. Give the index of the case, so the cases start with different arms.
- Each pair of a round uses the one base batch of that round. `orders` has the order of the batches of each round.
- The count of calls of a batch grows until a batch of the base takes `targetMs`. Each arm uses that count.
- `warmBatches` adds untimed batches of each arm before its timed batch, in each round. No batch of another arm comes between them. The default is 0.
- `spans` keeps the start and the end of each timed batch, in the layout of `orders`. The clock `now` also times the warm-up and the calibration. Thus a record of the marks of the clock uses `spans` to find the timed batches.

## Time one arm in a child

`timeArm` is the child side of `freshRun`. Each child times only its own arm, and prints one JSON line:

```ts
import { timeArm } from "@mark1russell7/rigor-bench";

const time = timeArm(() => kernel(input), { samples: 15 });
console.log(JSON.stringify({ ms: time.ms, calls: time.calls }));
```

- The arm first operates for the warm-up time `warmMs`. Then the calls of one sample double until a sample takes `targetMs`.
- After `warmSamples` samples that do not count, the function times `samples` samples. `ms` is the median time of one call.
- Give `calls` of an earlier process. Then the function does not calibrate, and each process does the same work.
- A flip test gives `slow`, for example 1.05. Each sample then waits in the timed part, so the timer reads a real slowdown of 5 %.
- The module keeps the value of each call. Thus the engine cannot remove the work of a call.
- With 2 samples or more, `warm` is the median of the last half of the samples over the median of the first half. A value near 1 tells that the arm was warm.

A child line can also give its memory peak, its warm check and its events. `freshRun` keeps them in the field `fields` of each record:

```ts
import { timeArm } from "@mark1russell7/rigor-bench";
import { eventProbe, peakRss } from "@mark1russell7/rigor-bench/fresh";

const probe = eventProbe({ deopt: true });
const time = timeArm(() => kernel(input), { samples: 16, mark: probe.mark });
console.log(JSON.stringify({ ms: time.ms, warm: time.warm, peakRss: peakRss(), events: await probe.events(16) }));
```

- `events.gc` and `events.deopt` each have two counts: the first half and the last half of the counted samples.
- `events.gcMs` has the GC time of each half in milliseconds: the sum of the durations of the GC events that start in the half.
- `events.gcMaxMs` has the longest GC event of each half in milliseconds. A half with no GC event has 0.
- A long block of the event loop can be one GC event. Compare the block with `gcMaxMs`, not with the mean of `gcMs`.
- The probe counts the deopts only with `deopt: true`. Then the V8 flag `--trace-deopt` writes them to a temporary file.
- `childLine` refuses a field that is not valid. A record has `fields` only when a child of the record gives a field.
- A time line keeps each other field in `fields.extra`, with its JSON value. An example is the samples of a child, or its batch. The runner does not examine them.

### The warm rule

A child whose time goes down while it counts was not warm. `warmVerdict` compares the warm checks of each pair with the A/A pair:

```ts
import { aaBand, warmVerdict } from "@mark1russell7/rigor-bench";

const aa = "base~aa";
const band = aaBand(run.pairs[aa], { kind: "case", level: 0.8 });
const warm = warmVerdict(run.pairs, { aa, band });
warm.arms.next; // { cases: 40, median: 1.0, p10: 0.97, p90: 1.04, outside: 0.15, ok: true }
```

- The warm value of a case is the median warm check of the arm b of the pair over the rounds of the case.
- A pair is warm when its share of cases outside the band is at most the share of the A/A pair plus `slack`. Its median warm value must also be in `median`.
- The defaults are `slack: 0.1` and `median: [0.97, 1.03]`. A fixed limit on the share fails, because the A/A pair also has cases outside.
- `steady` lists the cases with each pair and the A/A pair in the band. A time gate can read only these cases.
- A pair with no warm check is an error. Thus a rule that cannot read a pair does not pass.

## Drop the second run of a slow case

A bench can run each case two times. The second run tells if the result stays the same. A slow case can drop its second run to save time. Then that case has no read of the same result. Each bench states if it keeps the second run.

```ts
const sentinels = new Set(sentinelCases(lastTimes, { limitMs: 60_000, seed: "2026-11-15" }).map((s) => s.key));
const method = runMethod(first.ms, { limitMs: 60_000, sentinel: sentinels.has(key) });
const second = method === "one run" ? undefined : run(key);
const same = sameResult(method, first.hash, second?.hash);
```

- `overLimit` reads a time over the limit, not equal to it. With no limit, each case keeps its second run.
- Each record states its method. A case with `one run` has `null` as its claim of the same result. It is not `true`.
- `sentinelCases` keeps the check live on the slow cases. The case over the limit with the smallest time keeps its second run.
- Each group with a case over the limit also gets one rotating sentinel, chosen with `stablePick` under the seed and the name of the group. A new seed for each run turns it.
- The times of `sentinelCases` can come from an earlier run, because the choice comes before the first run.
- `firstAgainstSecond` gives the ratio of the second time over the first time for each group, from the cases with two runs.
- A median under 1 tells that the second run is faster. Then a time of the first run alone is another measure, and a page that quotes it says so.

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
- **The median of a partner:** each partner read also gives `beatenBy` of `of`. `beatenBy` counts the real entries that beat the control on that partner at the same level. `of` counts the real entries with a read. `excluded` counts the real entries with too few untied keys for a read. A small `of` with a large `excluded` reads few entries, so read the two counts together. `caught` is true only when `beatenBy` is over half of `of`, so the median real entry beats the control. One outlier entry can make the status `lost`, but it cannot make `caught` true. No finding reads `caught`.
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

### A narrow spread

The finding `no-spread` reads "no pair separates". One entry far from the others stops that finding, but the measure does not separate the others. Each row of `spread` in a `MeasureCheck` thus has a report of how many entries carry the separated pairs.

| Field | Meaning |
| --- | --- |
| `entries` | The real entries with at least one pair that has a read. |
| `share` | The median, over these entries, of the share of the other entries that a test separates from the entry. A pair with no read does not count. |
| `apart` | The entries that a test separates from more than half of the others that they have a read with. |
| `narrow` | Some pair separates and `share` is under `NARROW_SPREAD_SHARE`. |

- `narrow` is a report. It gives no finding, and it fails no gate.
- `NARROW_SPREAD_SHARE` is 0.1. This value is a fitted default from a gap in the rows of one project, and it is not a gate limit.
- One Holm family holds all pairs of all strata. Thus more strata in one call give fewer separated pairs and a lower `share`. Compare a `share` only with a `share` from the same strata.

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
- A line with `skipped` skips a case. A skip line does not need a time.
- With `overLimit: "skip"`, a child over `timeoutMs` in the first round skips its case with the reason `took more than <timeoutMs> ms`. A case that does not end is then a result with a reason, and the job ends in time. The gate of the run decides what such a skip means. For a gate on a cost, it is a block.
- A skip in the first round of the job removes the case from each pair, and the run starts no more children for it. A skip after the first round stops the run with an error, because the child is not deterministic.
- A child that does not stop at the time limit gets SIGTERM, and SIGKILL after 1 second. The signals go to its process group. On Windows, `taskkill /T /F` stops its tree.
- A child must stop each process that it starts before it exits. On Windows, the runner cannot find a process that a child leaves after a normal exit.
- Two different hashes of one arm on one case stop the run with an error.
- Each record keeps its job and the computer of its job (`benchEnv`).

A run of many jobs sets `roundOffset` to `job * rounds`. Then the merged records have one record of each case and round. Without it, each job repeats the first orders, and the merge removes more records.

### One base child for each round

A gate that compares each candidate with one time of the base in the same round uses `order: "arms"`:

```ts
const run = await freshRun({
  base: { id: "portfolio", command: ["node", "bench/arm.js", "--entry", "portfolio"] },
  candidates: [rows, maxrects],
  cases: inputs,
  rounds: 8,                                      // balancedRounds(4): the base, 2 candidates and the A/A copy
  order: "arms",
});

run.pairs["rows"];                                // (portfolio, rows), with the base child of each round
run.orders;                                      // the order of the children of each case and round
```

- The arms are the base, each candidate and each A/A copy. Each arm starts one child for each case and round.
- The order is `armOrder` of the arms, after a turn by the index of the case. Thus each pair of arms has each order one time in each two rounds.
- Each pair gets the time of the one base child of its round. So the records of two candidates in one round share the base time, and a gate can add the times of two candidates.
- A round of k pairs has k + 1 children. The default order `"pairs"` has 2 k children.
- A multiple of `balancedRounds(k + 1)` rounds balances the order. A skip removes a case as in the default order.
- `orders` keeps the order of each case and round. The field `first` of each record tells which arm of its pair started first.
- `firstCase` turns the order of the cases in each round. Global round `r` starts with the case `(firstCase + r * max(1, floor(cases / rounds))) % cases`.
- The first place of a round can cost more. With `firstCase`, this cost does not stay on one case. The turn of the arms keeps the index of each case.
- The default start pipes the `stderr` of each child, and shows its tail in the error of a failed child. To write each `stderr` to the log, wrap `startProcess` in `start`.

### Why pairs, and not a plain rotation of all arms

A plain rotation of N arms turns the order of two arms only when they are N/2 apart in the rotation. For 4 arms, two arms 1 apart come in the order 3:1 over 4 rounds. Thus each pair of the default order has its own two children, and the order of each pair turns each round. The order `"arms"` uses `armOrder`, a mirrored rotation, and it does not have this fault.

### Two commits in one job

A claim of a change compares two commits. Two jobs can have an offset between them, so the bench measures the two builds in one job. `checkoutArm` makes the arm of the base commit, and `repoCommit` gives the commit of the job:

```ts
import { checkoutArm, freshRun, repoCommit } from "@mark1russell7/rigor-bench/fresh";

const command = ["node", "bench/arm.js"];
const base = await checkoutArm({
  id: "base",
  commit: process.env["BASE_SHA"]!,               // the base commit of the pull request
  dir: "../base",                                 // a new folder
  command,
  setup: [["pnpm", "install", "--frozen-lockfile"], ["pnpm", "build"]],
});
try {
  const head = { id: "head", command, commit: await repoCommit("HEAD") };
  const run = await freshRun({ base, candidates: [head], cases, rounds: 5, aa: "each" });
  run.pairs["head"];                              // the pair (base, head)
  run.pairs["base~aa"];                           // the A/A pair of the base build
  run.pairs["head~aa"];                           // the A/A pair of the build of the job
} finally {
  await base.remove();
}
```

- `checkoutArm` adds a detached git worktree of the commit in `dir`, and starts each setup command in it, in order. A setup command that fails removes the worktree.
- Each child of an arm starts in the folder `cwd` of the arm. The arm of `checkoutArm` has the folder of its checkout.
- Each record names the commits of its arms in the field `commits`.
- With `aa: "each"`, the run has an A/A pair of each build, because the two builds can have different noise. A gate gives `timeVerdict` the A/A records of each build. When one of the two verdicts is noisy, the run cannot decide.
- A checkout in CI needs the history of the base commit, for example `fetch-depth: 0` of `actions/checkout`.

### Many arms, one child each

A bench of absolute times has one arm for each case, and one A/A pair. `freshArms` starts one fresh child for each arm in each round:

```ts
import { aaOrders, mergeCaseModules } from "@mark1russell7/rigor-bench";
import { armTimes, freshArms } from "@mark1russell7/rigor-bench/fresh";

const { cases } = mergeCaseModules(modules);      // the cases of each module of the list
const arms = [...Object.keys(cases).map((id) => ({ id, case: id })), { id: "corpus#aa", case: "corpus" }];
const run = await freshArms({
  arms,
  command: ["node", "bench/child.js"],
  aa: ["corpus", "corpus#aa"],
  fixtures: { folder: process.env["FONTS"]!, files: pinnedFonts }, // [{ file, sha256 }] of each font
});

armTimes(run.processes);                          // the median and the spread of each arm
aaOrders(run.aa);                                 // the A/A ratio of all rounds and of each order
run.fixtures;                                     // the hash of each fixture file, for the record
```

- The arms of a round come in the order of `armOrder`, not in a plain rotation. Thus each pair of arms has each order one time in each two rounds.
- The default count of rounds is `balancedRounds` of the count of arms: 2 times the count of arms. Then each arm is at each position 2 times.
- Another count of rounds gives a warning in `warnings`, and `balanced` is `false`. Rounds that are not balanced can give the A/A pair a bias of order.
- Each record has the arm, the case, the round, the position in the round and the time. `onProcess` gets each record when its child ends.
- With `aa`, each round gives one A/A record. Arm `a` is the first id of `aa`. The two arms of `aa` have the same case, command and folder.
- `aaOrders` gives the A/A ratio of all rounds and of each order, with the interval of each median. A bias of order shows as two orders on the two sides of 1.
- With `fixtures`, the run compares the SHA-256 of each fixture file with its pinned hash before the first child. A bad file stops the run, and the error names each bad file.
- The result keeps the hashes. `fixtureDifferences` gives the files that two records do not share, so a comparison of two records can refuse different fixtures.
- The fetch of the fixture files is a step of the job before the run. The owner of the files fetches them with its own tool.
- A child that fails, takes too long, prints no JSON line or skips its case stops the run with an error. Two different hashes from children with the same argv stop it too.

### A list of case modules

A bench with cases in several modules keeps a list of the modules. `mergeCaseModules` merges their cases into one record, and it refuses two cases with one name. `moduleListGaps` compares the list with the folder. The test of the bench expects no gap, because a case that no run starts is not measured:

```ts
import { readdirSync } from "node:fs";
import { moduleListGaps } from "@mark1russell7/rigor-bench";
import { modules } from "./cases/index.ts";

it("lists each module of the folder", () => {
  const files = readdirSync(new URL("./cases/", import.meta.url)).filter((f) => f.endsWith(".ts") && f !== "index.ts" && !f.endsWith(".test.ts"));
  expect(moduleListGaps(files, Object.keys(modules))).toEqual({ unlisted: [], missing: [] });
});
```

## The paired child

Two fresh children of a pair start at different times. A slow period of the runner can fall on one child and not on the other. A paired child is one process that loads the three sources of a pair: the base, the candidate and a second copy of the base. It takes their samples in turn, so a slow period falls on each source of a pair.

```ts
import { pairedChild } from "@mark1russell7/rigor-bench";

// The caller loads each source. The copy of the base comes from a second folder, so it has its own module state.
const child = await pairedChild({
  case: "one-10",
  round,
  offset: caseIndex,
  steps: 4,
  sample: { base: base.burst, candidate: candidate.burst, copy: copy.burst },
});
console.log(JSON.stringify(child.records)); // { candidate: PairedTime, aa: PairedTime }
```

- Each source gives one warm sample first. The child does not count it.
- Each step has a block A B B A for the candidate pair and for the A/A pair. `firstArm(round, offset)` gives A.
- The two blocks change places at each step, and the first block turns each round.
- The record of each pair is one `PairedTime`, with the median of the samples of each source in that pair.
- The cost is 3 warm samples and 8 counted samples for each step.

The A/A pair is the base and its copy in the same child. Its spread is the noise of the order alone, so it gives the band of the candidate pair.

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

## A family of cases

A run reads many cases, and each case has its own interval. With no correction, the chance of one false `slower` case grows with the count of cases. At 16 cases and 0.025 for each side, this chance can be 1 - 0.975^16, approximately 0.33. With the option `pValues`, a time verdict of the rule `difference` gives `pSlower` and `pFaster` from the draws of its interval. Its outcome does not change, and the option is off by default. `familyRead` reads a family as a report:

- **Holm** (Holm, 1979) keeps a `slower` case only when the Holm correction over the cases rejects its side at `level` (default 0.025).
- **Each job** keeps a `slower` case of a pooled verdict only when each job gives `slower` alone.
- **Each job and Holm** keeps a case only when both reads keep it.

The smallest p of a bootstrap is 1 / (finite + 1). The first step of Holm is `level` over the count of cases. With too few runs, no case can pass that step, and `familyRead` prints a line that says so. At 16 cases, the first step is approximately 0.0016, so give the bootstrap more than 640 runs. The default is 10 000.

`familyPower` drew 100 seeded families for each row. Each family had 16 cases, with 12 rounds in each of 2 jobs. The log time of each arm had a normal noise of 0.01. The margin was log(1.015), and the bootstrap had 2000 runs. The first case had the ratio of the row, and the other cases had the ratio 1.

| Ratio of the first case | Read | Families with a false `slower` | First case read `slower` |
| --- | --- | --- | --- |
| 1 | no correction | 0.28 | 0.02 |
| 1 | Holm | 0.01 | 0 |
| 1 | each job | 0 | 0 |
| 1 | each job and Holm | 0 | 0 |
| 1.015 | no correction | 0.26 | 0.8 |
| 1.015 | Holm | 0.01 | 0.34 |
| 1.015 | each job | 0 | 0.28 |
| 1.015 | each job and Holm | 0 | 0.23 |
| 1.025 | no correction | 0.26 | 1 |
| 1.025 | Holm | 0.01 | 0.95 |
| 1.025 | each job | 0 | 0.87 |
| 1.025 | each job and Holm | 0 | 0.87 |

The smallest slowdown read in 80 % or more of the families is 1.5 % with no correction, and 2.5 % with each other read. At 2 %, the shares are 0.97, 0.77, 0.59 and 0.56.

This model has no shift between the jobs, so the read of each job has its best case. The option `jobShift` adds a shift to the candidate of each job. The rows below use the shift 0.0066 for each job, with the other settings of the table above.

| Ratio of the first case | Read | Families with a false `slower` | First case read `slower` |
| --- | --- | --- | --- |
| 1 | no correction | 0.48 | 0.04 |
| 1 | Holm | 0.1 | 0.01 |
| 1 | each job | 0.04 | 0 |
| 1 | each job and Holm | 0.02 | 0 |
| 1.025 | no correction | 0.46 | 0.98 |
| 1.025 | Holm | 0.09 | 0.93 |
| 1.025 | each job | 0.04 | 0.74 |
| 1.025 | each job and Holm | 0.02 | 0.74 |
| 1.03 | each job | 0.04 | 0.9 |

With this shift, the smallest slowdown read at 80 % is 2 % with no correction, 2.5 % with Holm, and 3 % with each job. A shift also adds false `slower` cases, because the candidate of a job is then not equal to its baseline.

A slowdown below the smallest slowdown at 80 % often reads `same` or `cannot decide`. Give this number beside the margin of a bench, because together they set what the bench can find.
