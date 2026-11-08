# @mark1russell7/rigor-mutation

Mutation tests with [Stryker](https://stryker-mutator.io) and Vitest for each package of a repository. A mutation test changes the source a little (a mutant), and starts the tests. A good test fails on the mutant, so it detects the mutant. The score is the percent of the mutants that the tests detect.

This package gives three things:

- The Stryker config of each package, or of each part of a big package, from one lane file.
- The score of each package, with its own gate. A score under the gate fails, and the message names the package.
- A check of the disabled mutants: each `Stryker disable` comment is also in a list, with its reason.

```sh
npm install --save-dev @mark1russell7/rigor-mutation @stryker-mutator/core @stryker-mutator/vitest-runner
```

Use Stryker 10.1.0 or later with Vitest 5. Stryker 10.0 started no test on each mutant with Vitest 5 ([stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210)). The score then fails, because the tests detect no mutant.

Stryker 10.1 rewrites the `tsconfig.json` of the package in its copy with `parseConfigFileTextToJson`. TypeScript 7 does not have that function, so Stryker stops before the first test. When the folder of the package resolves TypeScript 7 or later, `config` sets `tsconfigFile` to `tsconfig.no-stryker-rewrite.json`. No project has that file, so Stryker does not start the rewrite.

The rewrite changes only a relative `extends` or `references` path. A `tsconfig.json` that extends a package needs no rewrite. To keep the rewrite, set `tsconfigFile` in the lane field `stryker`.

## The lane file

The lane file `mutation.json` is at the root of the repository:

```json
{
  "packages": {
    "collections": {
      "dir": "packages/collections",
      "mutate": ["src/**/*.ts", "!src/**/*.test.ts", "!src/index.ts"],
      "gate": 80,
      "parts": { "impl": ["src/impl/**/*.ts"], "core": ["src/core/**/*.ts"] }
    }
  }
}
```

- `dir` is the folder of the package. Stryker starts in this folder.
- `mutate` has the globs of the files to mutate, from `dir`. A glob with `!` removes the files of the globs before it.
- `gate` is the lowest score in percent that passes. Without a gate, the lane only reports the score.
- `parts` divides a big package. A part has its own globs, and the `!` globs of `mutate` also apply to it. Each file of `mutate` must be in exactly one part.
- A glob with the suffix `:<from>-<to>` gives only those lines of its files, as Stryker reads it. Thus parts can cut one big file: `"a": ["src/module.ts:1-300"]` and `"b": ["src/module.ts:301-600"]`. The ranges of the parts must cover each line of the file one time.
- `vitestConfig` names the Vitest config of the package, from `dir`. Without it, Vitest finds its config.
- `timeoutMS` is the time in milliseconds that the clock adds to the time of the tests for each mutant. The default is 120000. The default of Stryker (5000) is too short on a loaded CI runner.
- `dryRunTimeoutMinutes` is the time in minutes for the run of the tests without mutants. The default is 15.
- `stryker` has more options for the Stryker config of each selection of the package, for example `{ "ignoreStatic": true }`. Its keys replace the keys of the config, but `--concurrency` replaces its `concurrency`. The lane owns `mutate`, `thresholds`, `jsonReporter`, `htmlReporter`, `timeoutMS` and `dryRunTimeoutMinutes`, so `stryker` cannot have them.
- `disables` (at the root of the lane) names the list of the disabled mutants. The default is `mutation-disables.json`.
- `staticLimits` gives the most static runs of each file of the package, from the folder where Stryker starts. The key `*` gives the limit of the other files. `plan-check` reads it.
- `targetMinutes` (at the root of the lane) is the target of the estimate of each selection, in minutes. The default is 100.
- `stopMinutes` (at the root of the lane) is the stop of the estimate of each selection, in minutes. The default is 140. It is not less than `targetMinutes`.
- `planPerClock` (at the root of the lane) is the planned net time of one minute of the clock. The default is 9.8, from a nightly run of Vex.

A selection is one Stryker run: a package (`collections`) or a part (`collections.impl`). `rigor-mutation list --runs` gives the selections of a full run: the parts of each package with parts, else the package.

A full run mutates only the files of the parts. Thus a file in no part has no score, and a file in two parts has two scores. `list --runs`, and `config` and `scores` of a part, examine the source files of the package. They fail and name each file that is in no part, in two parts, or in a part but not in `mutate`. For a file in line ranges, they name each gap and each overlap of the ranges, and the lines after the last range. In the example, a file `src/util.ts` is in no part, so the lane fails.

## A run

```sh
pnpm exec rigor-mutation config collections --out reports/stryker.json
cd "$(pnpm exec rigor-mutation dir collections)"
pnpm exec stryker run ../../reports/stryker.json
cd -
pnpm exec rigor-mutation scores collections
```

Each run starts the tests of `dir` only. A test in another folder, for example a test of the repository root, does not detect a mutant of the package.

`rigor-mutation scores` reads `<dir>/reports/mutation/mutation.json` and applies the gate. It exits with 1 when a selection fails. With `--summary "$GITHUB_STEP_SUMMARY"`, it adds a table of the scores to the summary of the job. The shared workflow `reusable-mutation.yml` of the template starts these steps on one runner for each selection.

Each score has one of three outcomes: `pass`, `block` or `no read`. A block is a score under its gate. A no read is a score that does not read the tests. Its cause is a missing report, no mutants that count, no detected mutant, or a run that read only some of the tests. A no read is not a pass.

In GitHub Actions (`GITHUB_ACTIONS` is `true`), `scores` writes a warning annotation for each no read, each block and each planned fall. Thus the line is on the check, also when the workflow only reports. The title of a no read gives the count of the no reads and of the selections:

```text
::warning title=Mutation gate%3A no read%2C 1 of 6 selections::collections.maps: the report has no mutants that count: Stryker found no files to mutate, or it did not start
```

A run of mutation tests is long and it uses much memory. Start it in CI, and on a local computer start one part with `--concurrency 2`.

Two options make a run shorter:

- `config --dry-run` gives a config that starts only the tests without mutants. Stryker does not stop at the first failed test. Use it to see if the tests pass under Stryker before a long run.
- `--changed <file>` reads a file with one changed path on each line, from the folder of the lane file. Make the file with `git diff --name-only`. Then `list --runs` gives only the runs with a changed file, and `config` mutates only the changed files of the selection. A changed test file, for example `src/a.test.ts`, selects its source file `src/a.ts` when the selection takes it. `config` fails for a selection with no changed file.

### A run that a time limit stops

The config adds the reporter `rigor-partial` to Stryker. It writes each tested mutant to `partial.jsonl`, next to `mutation.json`, at once.

A time limit can stop Stryker before it writes `mutation.json`. Then `scores` reads `partial.jsonl` and gives a partial score:

```text
lib.rest: 50.00 % (1 of 2, 1 survived), no gate: FAIL: partial: Stryker stopped after 3.0 minutes and tested 2 of 10 mutants. The score of the mutants that ran is 50.00 %. All the mutants need an estimated 11 minutes.
```

A partial score is a no read, because it does not read all the mutants. Its field `partial` gives the costs. Use the estimate to divide the package into parts. The estimate does not count the mutants with an early result, because they take no time.

The workflow `stryker-stop.yml` checks the reporter in a real run. It stops Stryker on the fixture lane `test/stryker/mutation.json` and examines the partial score.

### The cost plan

After the run of the tests without mutants, Stryker makes a plan of the mutants. The reporter `rigor-partial` writes it to `plan.json`, next to `mutation.json`:

- `files` gives the plan of each file: its mutants, the runs, the static runs, the planned net time and the time limits in milliseconds. `lines` gives the runs, the static runs and the net time of each line.
- `tests` gives the 40 tests of the largest cost. The cost of a test is its time, times the runs that start it.

Each line of a mutant in `partial.jsonl` also gives its planned net time and its time limit.

`rigor-mutation config <selection> --plan` gives a config that stops Stryker after the plan. Stryker starts no mutant, so the plan costs only the run of the tests.

`rigor-mutation plan-check <selection>...` reads the plan of each selection. It gives the estimate of the clock. It gives a warning when the estimate is over `targetMinutes`, and in GitHub Actions also a warning annotation. The estimate has an error of 28 minutes in the mean, so the target does not fail. It fails a selection when:

- the estimate is over `stopMinutes`. Stryker cannot end the selection before the stop, so it cannot give a full score;
- a file has more static runs than its limit in `staticLimits`.

A static run starts each test, so it costs the time of all the tests. Code outside a function gives a static mutant.

```text
vex.kernel: 812 runs, 3 of them static, with a planned net time of 12.4 h. The estimate is 76 minutes of the clock, the target is 100 and the stop is 140.
plan-check: each plan of 1 selections is in its limits
```

`--report <file>` reads the plan of one selection from a file. `--reports <dir>` reads `<dir>/mutation-<selection>/plan.json`. The workflow `stryker-stop.yml` checks the plan in a real run.

## The score

The score counts the detected mutants, out of the mutants that a test covers or that survive. Compile errors, runtime errors and ignored mutants do not count.

A detected mutant has the status `Killed`, or a `Timeout` of the hit limit. Stryker gives the status `Timeout` for two events:

- The hit limit stopped the mutant. The mutant has an endless loop, and its `statusReason` starts with `Hit limit`. The mutant is detected.
- The clock stopped the mutant. The load of the runner can cause this, so the mutant is not detected for certain. It counts as not detected.

The score line gives the count of each kind of time-out. It also gives the score with the clock time-outs counted as detected, as Stryker counts them. The gate does not use that second score.

A selection fails in these conditions:

- The report has no mutants that count. Stryker found no files, or it did not start.
- The report has mutants that count, but the tests detect none. The test runner started no test on the mutants.
- The selection has a gate, and the score is under it.

The gate of a package with parts applies to each part. Each part must have a score at the gate or above it. A part under the gate fails, also when the score of all the parts together is above the gate.

With `"gateOver": "package"`, the gate reads all the parts together. `scores` sums the mutants of the parts of the package, and gives one more line for the package. A part has no gate of its own, but a part that fails for another reason makes the package a no read.

- Give `scores` all the parts in one command, so that the sum reads each part. `--reports <dir>` reads `<dir>/mutation-<selection>/mutation.json` for each selection.
- A read of some of the parts only makes the package a no read, and its line names the missing parts. A run of the changed files is usually report only, so this does not fail it.
- `--alone` gives no line for the package. The job of one part uses it, and the part then fails only for a no read.

## The tests that a run read

A score is a read of the tests only when the run read all of them. A run that read half of the tests gives a score with no meaning. Two options of `scores` find such a run. They need the field `testFiles` of the report, which the Vitest runner gives.

- Each score line gives the count of the tests of the run. `--last <file>` compares it with the last good count of the selection in the file. A fall of more than `maxTestFall` percent fails, also above the gate. The default of `maxTestFall` is 20. `--write-last <file>` writes the counts of the selections that pass.
- `--test-files` compares the test files that the run starts with the test files of the report. A test file that the run starts and that the report does not read fails.
  - The Vitest runner of Stryker starts the test files that load a file of the selection, directly or through other files. So a part does not start the test files of the other parts.
  - The check reads the relative imports of the package, and not its type imports. With `vitest.related` false in the field `stryker`, it expects each test file.
- With no `--alone`, `--test-files` also examines each package whose selections the command names in full. This is the gate job, which reads all the parts.
  - A test file on the disk that no report reads fails, unless `notRead` gives its reason. One part does not show such a file, because a part starts only its related test files.
  - An entry of `notRead` fails when its file is not on the disk, or when a report reads it.
  - The fault fails the score of the package with `"gateOver": "package"`. Else it fails each selection of the package.

The lane states each exception with its reason:

```json
{
  "plannedFalls": { "collections.impl": "the tests of the old map moved to the package maps" },
  "packages": {
    "collections": { "dir": "packages/collections", "mutate": ["src/**/*.ts"], "notRead": { "bench/hash.test.ts": "a bench, CI starts it in its own job" } }
  }
}
```

Remove a planned fall after the next good count.

## The load check

Stryker copies the folder of the package and starts the tests in the copy. A relative path that leaves the folder then finds no file. A test file that does not load gives no failed test. Thus each mutant that only that file detects survives, with no error.

`rigor-mutation load-check` examines the files that the run loads. These are the test files, the config files of Vitest and Vite, and each file that they load. It fails and names the file, the line and the path of each relative path that leaves the folder. In a config file, it examines each relative path string, for example a setup file. Start it before Stryker. To correct a path, import the file from its package, or move it into the folder.

```text
packages/compiler/src/module-sheet.test.ts:12: "../../testkit/src/fc-timeout.ts" leaves the folder packages/compiler.
```

The check does not read comments, type imports and paths with a template expression.

With `--collect`, the Vitest of each package also loads each test file, as Stryker does. The check copies the folder of the package to `.stryker-tmp/load-check-*` in that folder, and links its `node_modules`. Stryker makes its sandbox in the same form. The copy takes only the files that Stryker copies. The ignore rules of Stryker 10 and the `ignorePatterns` of the `stryker` field of the lane leave out the other files. The collect of Vitest starts in the copy, in a new process, with `staticParse: false`. Then each file starts, so the check finds a missing package, also through a helper. A path that finds a file only in the folder of the package fails in the copy too. Then for each selection of the package, Vitest gives the test files that its related mode starts for the mutated files. These are faults:

- a test file that does not load,
- a test file that holds no test,
- an error outside a test file,
- a package with no test file,
- a test file that no selection starts, and that `notRead` does not name,
- an entry of `notRead` for a file that is not on the disk, or that a selection starts,
- a dynamic import with a computed path in a file that the run loads, unless `computedImports` of the package names the file with a reason.

The related mode does not follow a computed import. A test file that reaches the mutated files only through this import thus starts in no selection, and each mutant that it detects survives.

```json
{ "computedImports": { "src/load-all.test.ts": "it imports each module of src/ops, and ops.test.ts tests each module" } }
```

On a fault, the check fails with a line that starts with `No read`. A score of that package is not a reading.

`--runner <file>` writes the version and the path of the Vitest of each package to the file, as JSON. Each package uses the Vitest that its folder resolves.

```text
rigor-mutation load-check --collect --runner reports/runner.json
```

## The disabled mutants

A comment `// Stryker disable next-line <Mutator>: <reason>` disables a mutant that is equivalent. The disable raises the score, so each one is also in the list, with its reason. `rigor-mutation disables` compares the comments of the sources of each package with the list. It fails when they are not the same, or when a comment has no reason. After you add or remove a disable, start `rigor-mutation disables --write` and examine the diff of the list.

## The API

```ts
import { parseLane, select, strykerConfig, parseReport, scoreReport, formatScore } from "@mark1russell7/rigor-mutation";

const lane = parseLane(JSON.parse(laneText));
const selection = select(lane, "collections.impl");
const config = strykerConfig(selection, { concurrency: 2 });
const score = scoreReport(parseReport(JSON.parse(reportText)), selection);
console.log(formatScore(score)); // collections.impl: 91.20 % (456 of 500, 44 survived), gate 80 %: pass
```

The package also exports `selectionNames`, `runSelections`, `summaryMarkdown`, `findDisables`, `compareDisables`, `leavingPaths`, `relatedTestFiles`, `isConfigFile`, `testCount`, `testFall`, `unreadTestFiles`, `failScore` and `runCli`.
