# @mark1russell7/rigor-testkit

Test helpers:

- `markdownExamples` makes each code block of a Markdown file into a test case. Then the doc and the code cannot drift.
- `runModel` runs model-based tests on `fast-check`, from the entry `@mark1russell7/rigor-testkit/model`.

```sh
npm install --save-dev @mark1russell7/rigor-testkit
```

## Markdown examples

`markdownExamples(files, options)` gives one case for each fenced block of the selected languages. Each case has a name, `<file>:<line>`, and a function `run`. The function `run` writes the block to a module file and imports it. A failed check in a block rejects `run`. The message of the error starts with the name, so it points at the line of the doc.

With Vitest:

```ts no-run
import { describe, it } from "vitest";
import { markdownExamples } from "@mark1russell7/rigor-testkit";

const cases = markdownExamples(["README.md", "docs/guides/lists.md"], {
  imports: { "my-package": "src/index.ts", "my-package/extra": "src/extra.ts" },
});

describe("the examples of the docs", () => {
  for (const example of cases) it(example.name, example.run);
});
```

With `node:test`:

```ts no-run
import { test } from "node:test";
import { markdownExamples } from "@mark1russell7/rigor-testkit";

for (const example of markdownExamples(["README.md"], { imports: { "my-package": "src/index.ts" } })) {
  test(example.name, example.run);
}
```

Write each check of an example as a `node:assert` call. Then the example runs in a test, and a reader can also run it:

````md
```ts
import assert from "node:assert/strict";
import { double } from "my-package";

assert.equal(double(2), 4);
```
````

### The rules

- The option `imports` maps an import specifier to a source file. A block that imports a mapped name gets that file. The other names resolve from the cache folder, so the packages of the project resolve.
- The option `lang` selects the languages, from the first word of the fence. The default is `["ts"]`. The languages are `ts`, `typescript`, `mts`, `tsx`, `js`, `javascript`, `mjs` and `jsx`.
- A block with the flag `no-run`, for example `ts no-run`, gives no case. Use it for a block that does not run alone.
- Each call of `run` writes a new module file, so a block runs again on each call. The file goes away after the run.
- A block runs as a module, so it can use `await` at the top level.
- The loader of the test runner compiles the block. Vitest compiles TypeScript. `node:test` runs TypeScript only with the type stripping of Node.
- The default cache folder is `.cache/rigor-testkit` under the option `root`. The default root is the current folder. When the function makes the folder, it writes a `.gitignore` there, so git ignores the files.
- Do not put the cache folder under `node_modules`. Node does not strip the types of a file there, so a TypeScript block fails under `node:test`.
- Under `node:test`, Node runs the mapped source files with no transform. A relative import of a `.ts` file with the extension `.js` fails there. Use `vitest` for that source, or map to the build.

`fencedBlocks(text)` gives each fenced block of a Markdown text with its language, its flags and its line. `mapImports(code, imports, root)` changes the mapped import specifiers of a code text to file URLs.

## Model-based tests

`runModel(options)` runs random sequences of steps against a new implementation and a new plain model. It calls `check` before the first step and after each step. `fast-check` shrinks a failure to a short sequence, and the counterexample shows the label of each step.

The entry `@mark1russell7/rigor-testkit/model` imports `fast-check`. Install `fast-check` 4 next to this package:

```sh
npm install --save-dev fast-check
```

```ts no-run
import fc from "fast-check";
import { expect, it } from "vitest";
import { runModel, step } from "@mark1russell7/rigor-testkit/model";

it("agrees with an array", () => {
  runModel({
    create: () => ({ sut: new MyStack<number>(), model: [] as number[] }),
    steps: fc.oneof(
      fc.integer().map((value) => step(`push(${value})`, (sut, model) => {
        sut.push(value);
        model.push(value);
      })),
      fc.constant(step("pop", (sut, model) => expect(sut.pop()).toBe(model.pop()))),
    ),
    check: (sut, model) => expect(sut.toArray()).toEqual(model),
  });
});
```

The options:

| Option | Default | What it does |
| --- | --- | --- |
| `create` | | It makes a new implementation and a new model for each run. |
| `steps` | | An arbitrary that gives one step. Make each step with `step(label, run)`. |
| `check` | | It compares the implementation with the model, and throws when they do not agree. |
| `maxSteps` | 120 | The maximum length of a sequence. The sequences use the size `medium` of `fast-check`, so some reach this length. |
| `numRuns` | 200 | The number of runs. |
| `dispose` | | It releases the implementation after each run, also when a check throws. Use it for timers. |
| `clear` | | It runs before each run, the runs of a shrink included. Use it to clear a spy, so that the spy keeps only the calls of one run. |
| `parameters` | | More parameters of `fc.assert`, for example `seed`. A `numRuns` here replaces the option `numRuns`. |

A spy that keeps each call of each run uses memory for all the runs. Clear it with `clear`. For a property that does not use `runModel`, use the plugin of `fast-check` 4.10: `fc.assert(property, { plugins: [fc.beforeEach(() => spy.mockClear())] })`.

## License

MIT
