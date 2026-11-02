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
| `verdictPower(options)` | The share of each outcome over seeded benches with a known ratio: the power test of a rule. |

## The outcomes

| Outcome | The rule `difference` (the default) | The rule `band` |
| --- | --- | --- |
| `faster` | The whole interval is below 1. | The interval of the median ratio is below the band. |
| `slower` | The whole interval is above 1. | The interval is above the band. |
| `same` | The interval is in `[exp(-margin), exp(margin)]`. The default margin is 0.05. | The interval is in the band. |
| `cannot decide` | The interval holds 1 and crosses the margin. | The interval crosses an end of the band. |

Both rules give `cannot decide` when the A/A arm has fewer than 5 cases, or when the candidate has no cases.

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
