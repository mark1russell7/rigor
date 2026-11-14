# @mark1russell7/rigor-testkit

Test helpers:

- `markdownExamples` makes each code block of a Markdown file into a test case. Then the doc and the code cannot drift.
- `runModel` runs model-based tests on `fast-check`, from the entry `@mark1russell7/rigor-testkit/model`.
- `rejects` examines an asynchronous operation that must fail, and gives its error.
- `propagationGate` examines one context id over each transport, from the entry `@mark1russell7/rigor-testkit/propagation`.

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
- Vitest does not compile the packages in `node_modules`. Thus, when this package comes from npm, Vitest does not compile the blocks that it imports. Then a mapped source with `.js` imports of `.ts` files fails. Add this package to `server.deps.inline`:

  ```ts no-run
  // vitest.config.ts
  export default defineConfig({
    test: { server: { deps: { inline: ["@mark1russell7/rigor-testkit"] } } },
  });
  ```

- The default cache folder is `.cache/rigor-testkit` under the option `root`. The default root is the current folder. When the function makes the folder, it writes a `.gitignore` there, so git ignores the files.
- Do not put the cache folder under `node_modules`. Node does not strip the types of a file there, so a TypeScript block fails under `node:test`.
- Under `node:test`, Node runs the mapped source files with no transform. A relative import of a `.ts` file with the extension `.js` fails there. Use `vitest` for that source, or map to the build.

`fencedBlocks(text)` gives each fenced block of a Markdown text with its language, its flags and its line. `mapImports(code, imports, root)` changes the mapped import specifiers of a code text to file URLs.

## An operation that must fail

`rejects(start, what)` starts an operation that must give a rejected promise, and gives the reason of the rejection. It fails, and the message starts with `what`, in these conditions:

- `start` throws at once, before it gives a promise.
- `start` gives a value that is not a promise.
- The promise resolves.

`assert.rejects` of `node:assert` passes when the operation throws at once, and it gives no error. Thus it does not find an API method that throws at once when it must give a rejected promise. For the other checks of a test, use `node:assert`: `assert.ok`, and `assert.deepStrictEqual` for JSON values and maps.

```ts
import assert from "node:assert/strict";
import { rejects } from "@mark1russell7/rigor-testkit";

const store = { get: async (id: string): Promise<string> => Promise.reject(new Error(`no item ${id}`)) };
const error = await rejects(() => store.get("a"), "get of a missing id");
assert.equal((error as Error).message, "no item a");
```

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
| `numRuns` | the `numRuns` of `fc.configureGlobal`, or 200 | The number of runs. A long-run lane sets `fc.configureGlobal({ numRuns })`, and each model test uses it. |
| `dispose` | | It releases the implementation after each run, also when a check throws. Use it for timers. |
| `clear` | | It runs before each run, the runs of a shrink included. Use it to clear a spy, so that the spy keeps only the calls of one run. |
| `parameters` | | More parameters of `fc.assert`, for example `seed`. A `numRuns` here replaces the option `numRuns`. |

A spy that keeps each call of each run uses memory for all the runs. Clear it with `clear`. For a property that does not use `runModel`, use the plugin of `fast-check` 4.10: `fc.assert(property, { plugins: [fc.beforeEach(() => spy.mockClear())] })`.

A global plugin of `fast-check` also operates on `runModel`. Before each run, the `beforeEach` plugins run first, then `clear`, then `create`. Thus, with a global plugin that clears the spies, for example `fc.installGlobalPlugin(fc.beforeEach(() => vi.clearAllMocks()))`, `runModel` does not need `clear`.

## The propagation gate

The entry `@mark1russell7/rigor-testkit/propagation` examines one claim: one context id goes from a client to a server. From there, it goes to the spans, the log records and the metrics. It uses the OpenTelemetry API only. Install `@opentelemetry/api` and `@opentelemetry/api-logs` to use it.

```ts no-run
import { localTransport, propagationGate, formatPropagationReport } from "@mark1russell7/rigor-testkit/propagation";

const report = await propagationGate({
  key: "request.id",
  capture,
  transports: [localTransport(withInternalCall), httpTransport, { name: "port", noRead: "no worker in this test" }],
});
console.log(formatPropagationReport(report));
expect(report.ok).toBe(true);
```

For each transport, the gate sets the value of `key` on the client side and makes one call. The handler on the server side writes a span, a log record and a metric. It also injects the context into the headers of a call to a third party. The gate then examines these claims:

- The handler reads the same value.
- The span and the log record of the handler are in the trace of the client, and have the value as an attribute.
- No metric point has the key as an attribute. For a key of low cardinality, give `cardinality: "low"`.
- The call to the third party has no `baggage` header.

### The rules

- The program under test registers the context manager, the propagator and the processors. The option `capture` gives its records, for example from the in-memory exporters of the SDK.
- A transport with `noRead` gets a "no read" line. That line is not a failure, but it is not a pass.
- The flip: the gate also runs a broken copy of each transport that passes, and the copy must fail. The default copy, `losingContext`, runs the handler in the root context. Give your own function in `flip`, for example a copy that removes a header.
- `withValue` and `readValue` set and read the value. The default uses the baggage. Give `withContext` and `contextValue` of the program when it keeps the value in a different way.
- `localTransport(internalCall)` sends the context through a carrier in the same process. `internalCall` marks the call as internal, for a propagator that sends the baggage only on internal calls.
- `formatPropagationReport(report)` gives a Markdown table for the summary of a CI job.

## The capture of the OpenTelemetry SDK

The entry `@mark1russell7/rigor-testkit/otel` gives the spans, the log records and the metric points of a test. Install `@opentelemetry/api`, `@opentelemetry/api-logs`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-logs` and `@opentelemetry/sdk-metrics` to use it. The other entries do not load the SDK.

```ts no-run
import { captureTelemetry } from "@mark1russell7/rigor-testkit/otel";

const capture = captureTelemetry({ spanProcessors: [createContextSpanProcessor()] });
const unregister = capture.register();
trace.getTracer("test").startActiveSpan("work", (span) => span.end());
expect((await capture.spans()).map((span) => span.name)).toEqual(["work"]);
await capture.reset();
```

When the program under test starts the SDK, give it the exporters and the reader of the capture:

```ts no-run
const capture = captureTelemetry({ sdk: "external" });
const telemetry = startNodeTelemetry({
  traceExporter: capture.spanExporter,
  logExporter: capture.logExporter,
  metricReaders: [capture.metricReader],
});
const report = await propagationGate({ key: "request.id", capture, transports });
```

### The rules

- With `sdk: "own"` (the default), the capture makes a tracer provider, a logger provider and a meter provider. `register()` sets them as the global providers, and `shutdown()` stops them.
- The options `spanProcessors` and `logProcessors` give the processors of the program. They run before the processor of the capture. The option `views` gives the metric views.
- With `sdk: "external"`, the program starts the SDK. `spans()` and `logRecords()` flush the global providers before they read.
- The metric reader collects only when the test asks, with the delta temporality. Thus `metricPoints()` gives the points after the last collection.
- `reset()` removes all spans, log records and metric points.
- The capture is also a `PropagationCapture` of the propagation gate.
- The capture serves the SDK 2 and the SDK 3 of OpenTelemetry. They use different logs APIs. The SDK 3 uses the logs API of `@opentelemetry/api` 1.10, and the SDK 2 uses `@opentelemetry/api-logs`. `register()` sets the logger provider in each of the two APIs. With `sdk: "external"`, `logRecords()` flushes the provider of each API. The propagation gate writes its log record through the API that has a provider.

## License

MIT
