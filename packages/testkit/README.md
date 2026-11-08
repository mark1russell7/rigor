# @mark1russell7/rigor-testkit

Test helpers. The first helper makes each code block of a Markdown file into a test case, so each example of a doc runs in a test. Then the doc and the code cannot drift.

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

## License

MIT
