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
- `parts` divides a big package. A part has its own globs, and the `!` globs of `mutate` also apply to it.
- `vitestConfig` names the Vitest config of the package, from `dir`. Without it, Vitest finds its config.
- `disables` (at the root of the lane) names the list of the disabled mutants. The default is `mutation-disables.json`.

A selection is one Stryker run: a package (`collections`) or a part (`collections.impl`).

## A run

```sh
pnpm exec rigor-mutation config collections --out reports/stryker.json
cd "$(pnpm exec rigor-mutation dir collections)"
pnpm exec stryker run ../../reports/stryker.json
cd -
pnpm exec rigor-mutation scores collections
```

`rigor-mutation scores` reads `<dir>/reports/mutation/mutation.json` and applies the gate. It exits with 1 when a selection fails. With `--summary "$GITHUB_STEP_SUMMARY"`, it adds a table of the scores to the summary of the job. The shared workflow `reusable-mutation.yml` of the template starts these steps on one runner for each selection.

A run of mutation tests is long and it uses much memory. Start it in CI, and on a local computer start one part with `--concurrency 2`.

## The score

The score counts the mutants with the status `Killed` or `Timeout`, out of the mutants that a test covers or that survive. Compile errors, runtime errors and ignored mutants do not count. A selection fails in these conditions:

- The report has no mutants that count. Stryker found no files, or it did not start.
- The report has mutants that count, but the tests detect none. The test runner started no test on the mutants.
- The selection has a gate, and the score is under it.

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

The package also exports `selectionNames`, `summaryMarkdown`, `findDisables`, `compareDisables` and `runCli`.
