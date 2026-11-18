# @mark1russell7/rigor-testkit

Test helpers:

- `markdownExamples` makes each code block of a Markdown file into a test case. Then the doc and the code cannot drift.
- `runModel` runs model-based tests on `fast-check`, from the entry `@mark1russell7/rigor-testkit/model`.
- `checkRelations` examines the metamorphic relations of a function on random inputs, from the entry `@mark1russell7/rigor-testkit/metamorphic`.
- `uniformDouble` draws numbers over a range, uniform by value, from the entry `@mark1russell7/rigor-testkit/arbitrary`.
- `rejects` examines an asynchronous operation that must fail, and gives its error.
- `propagationGate` examines one context id over each transport, from the entry `@mark1russell7/rigor-testkit/propagation`.
- `behaviorCheck` gives two functions the same seeded inputs and compares their outputs, from the entry `@mark1russell7/rigor-testkit/behavior`.
- `startOtlpCollector` receives the OTLP exports of a program in another process, from the entry `@mark1russell7/rigor-testkit/otlp`.
- `createFakeEventTarget` records the listeners of browser code in a Node test, from the entry `@mark1russell7/rigor-testkit/fakes`.
- `startChildServer` starts a server of a test in a child process on the port 0, and reads the port that the child got. It is in the entry `@mark1russell7/rigor-testkit/child`.
- `runToStop` stops a program of a test at a step or a time of a stop plan, from the entry `@mark1russell7/rigor-testkit/stop`. The entry `/stop-point` has the child side, with no packages.
- `startXmppServer` gives an XMPP server for a client test, with STARTTLS, a login and steps as data. It is in the entry `@mark1russell7/rigor-testkit/xmpp`.
- `testCertificates` makes the certificates of a TLS server of a test at the time of the test, from the entry `@mark1russell7/rigor-testkit/tls`.
- `countProcessStarts` counts the process starts of each test file and holds each file under a budget. It is in the entry `@mark1russell7/rigor-testkit/process-starts`.
- `gitFixtures` makes the git repositories of a test file with few git starts, from the entry `@mark1russell7/rigor-testkit/git-fixture`.

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

## Metamorphic relations

A metamorphic relation tells how the output of a function changes when its input changes in a known way. For example, add `c` to each element of a list, and the mean of the list increases by `c`. A test of a relation needs no oracle of the correct output.

`checkRelations(f, relations, inputs)` examines each relation on random inputs. When one or more relations do not hold, it throws one error. The error names each relation that does not hold, with its counterexample. The set of these relations helps to find the fault.

The entry `@mark1russell7/rigor-testkit/metamorphic` imports `fast-check`, and no module of Node.js.

```ts no-run
import fc from "fast-check";
import { it } from "vitest";
import { checkRelations, composeRelations, equivariant, permutationInvariant, withinTolerance } from "@mark1russell7/rigor-testkit/metamorphic";

const close = withinTolerance({ absolute: 1e-9, relative: 1e-9 });
const shift = equivariant<readonly number[], number, number>("shift", {
  param: fc.integer({ min: -100, max: 100 }),
  change: (xs, c) => xs.map((x) => x + c),
  map: (mean, c) => mean + c,
  equal: close,
});
const scale = equivariant<readonly number[], number, number>("scale", {
  param: fc.integer({ min: -5, max: 5 }),
  change: (xs, k) => xs.map((x) => x * k),
  map: (mean, k) => mean * k,
  equal: close,
});

it("keeps the relations of a mean", () => {
  const lists: fc.Arbitrary<readonly number[]> = fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1 });
  const relations = [permutationInvariant<number, number>({ equal: close }), shift, scale, composeRelations(shift, scale)];
  checkRelations(myMean, relations, lists);
});
```

The functions:

| Function | What it gives |
| --- | --- |
| `equivariant(name, { param, change, map, equal })` | A relation where the follow-up output is `map(f(x), p)`. |
| `invariant(name, { param, change, equal })` | A relation where the follow-up output is equal to the source output. |
| `permutationInvariant({ name, equal })` | The relation of a function of a multiset: a new order of the elements keeps the output. |
| `composeRelations(first, second, { equal })` | The relation of the second change after the first change. The second change gets the follow-up inputs of the first change. |
| `withinTolerance({ absolute, relative })` | A comparison of numbers, arrays and plain objects, with a tolerance on each number. With no tolerance, it is the default comparison. |
| `relationCases(relation, inputs)` | The arbitrary of the cases of a relation, for a property of your own. |
| `relationProperty(f, relation, inputs)` | The property of one relation, for `fc.assert`. `relationPropertyAsync` is for an async function. |
| `checkRelationsAsync(f, relations, inputs)` | The same check as `checkRelations`, for an async function. |

The options in braces are optional, except `param` and `change`, and `map` of `equivariant`.

A relation of your own is an object with `name`, `param`, `change` and `holds`. The method `holds` gives `true` when the relation holds. It gives `false`, or a text that tells the break, when the relation does not hold.

The `param` is an arbitrary, or a function that gives an arbitrary for each input. Use a function when the parameter changes with the input, for example an index in an array.

### The rules

- The function `f` and each `change` must not change their input. A change gives a new value.
- `withinTolerance` accepts two numbers when both are `NaN`, or when the difference is in one of the two limits.
- An infinite number is equal only to the same infinite number.
- `withinTolerance` compares other objects by identity, for example a `Map` or a `Date`. Give your own `equal` for them.
- Each relation gets its own runs. The options `numRuns` and `parameters` apply to each relation.
- The report of a break includes the error of the break. To remove it, set `includeErrorInReport: false` in `parameters`.

## Uniform numbers over a range

`fc.double({ min, max })` draws uniformly over the floats of the range, not over its values. The floats are dense near 0. With the seed 7, only 6.6 % of the values of `fc.double({ min: -1, max: 1 })` have a size above 0.2. Thus a property over a range tests almost only the values near 0.

`uniformDouble({ min, max })` draws uniformly by value. Use it in place of `fc.double` with `min` and `max`:

```ts no-run
import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";

fc.assert(fc.property(uniformDouble({ min: -1, max: 1 }), (x) => simplify(x).ok));
```

- Approximately 1 draw in 8 is near `min`, and 1 draw in 16 is near `max`. These draws test the edges of the range. The other draws are uniform.
- The step between two values is `(max - min) / (2^53 - 1)`. Each value is in the range.
- A counterexample shrinks toward `min`.
- `fc.double` with no range still has a use: it draws the special values, for example `-0`, the subnormal numbers and `Number.MAX_VALUE`.

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

## A scripted HTTP server

The entry `@mark1russell7/rigor-testkit/http` gives an HTTP/1.1 server for the fixtures of a client test. Each route has a list of replies, as data. It uses only `node:http`. Its WebSocket routes also need the optional peer `@mark1russell7/rigor-proxy`.

```ts no-run
import { startScriptedServer } from "@mark1russell7/rigor-testkit/http";

const server = await startScriptedServer({
  routes: [
    {
      path: "/alerts/active",
      replies: [
        { body: fixture, fields: { "content-type": "application/geo+json" } },
        { status: 429, fields: { "retry-after": "120" } },
        { body: ['{"features":[', "]}"], framing: "chunked" },
      ],
    },
  ],
});
// The client under test uses server.url, or a fault proxy in front of server.port.
expect(server.requests.map((request) => request.target)).toEqual(["/alerts/active?area=KS"]);
await server.close();
```

### The rules

- A request gets the replies of the first route that matches its method and path. The default method is `GET`.
- A path with `?` matches the whole target. A path with no `?` matches the path of the target, with any query.
- The replies of a route go in their order. After the end of the list, the route gives its last reply again.
- A request that no route matches gets `unmatched`. The default is the status 404 with no body.
- `requests` holds each request: its connection, method, target, fields, body, route and reply.

### The framing of a body

| `framing` | The end of the body | A cut inside the body |
|---|---|---|
| `length` (the default) | `content-length` | The client sees it. |
| `chunked` | Each part of the body is one chunk, then the last chunk. | The client sees it. |
| `close` | No length. The server closes the connection after the body. | The client cannot see it. |

- A list of parts in `body` gives one write for each part. With `chunked`, each part is one chunk. Thus each part is one frame of the HTTP framers of `@mark1russell7/rigor-proxy`.
- `delayMs` holds the head, and `gapMs` holds each part after the first. A slow or silent server uses them.
- `stopAfter` writes only that number of parts. Then the server writes nothing more, and keeps the connection open.
- The server sends no `date`. Thus the same script gives the same bytes on each run.

### The place of a reply on the wire

The record of each request has `wire`, the place of its reply in the bytes of the connection. A fault plan of `@mark1russell7/rigor-proxy` with a `byte` point uses it.

| Field | Value |
|---|---|
| `offset` | The bytes that the server sent on the connection before the reply. |
| `head` | The bytes of the status line and the fields, with the empty line. |
| `body` | The bytes of the body on the wire. With `chunked`, the size lines are in this count. |
| `whole` | True when the server sent the whole reply. |

- The first byte of the body is at `offset + head` of the down direction.
- The server sends the head alone, before the body. Thus `head` is known before the first part.
- A test can measure the place with one request, then cut a second connection at the same place. The same script gives the same bytes.

### WebSocket routes

The option `webSockets` gives WebSocket routes (RFC 6455) on the same port as the HTTP routes. Each route has a list of sessions, as data. A session is the reply to the handshake and the steps of the server. Thus a test of a client that starts with HTTP and goes to WebSocket has one server.

```ts no-run
import { messagesOf, startScriptedServer } from "@mark1russell7/rigor-testkit/http";

const server = await startScriptedServer({
  routes: [{ path: "/engine.io/", replies: [{ body: openPacket }] }],
  webSockets: [
    {
      path: "/engine.io/",
      sessions: [{ steps: [{ send: "3probe" }, { receive: 2 }, { send: "", opcode: 9 }, { close: { code: 4000, reason: "bye" } }] }],
    },
  ],
});
// The client under test uses server.url for HTTP and server.webSocketUrl for WebSocket.
expect(messagesOf(server.webSockets[0].frames)).toEqual(["2probe", "5"]);
await server.close();
```

These routes load the frame codec of `@mark1russell7/rigor-proxy`. Install it next to `@mark1russell7/rigor-testkit`. A server with no WebSocket routes does not load it.

| Step | The server |
|---|---|
| `send` | Sends one frame. Text is a text frame, and bytes are a binary frame. `opcode`, `fin`, `rsv` and `mask` change the frame. |
| `raw` | Sends the bytes as they are, for example a part of a frame. |
| `receive` | Waits until it has this number of messages from the client, counted from the start. After `limitMs`, it goes to the next step. |
| `close` | Sends a close frame with `code` and `reason`, or with no payload. |
| `end` | Closes its side of the TCP connection, with no close frame. |
| `destroy` | Resets the TCP connection. |

- Each step can have `delayMs`, a time before the step. After the last step, the server keeps the connection open.
- The sessions of a route go in their order. After the end of the list, the route gives its last session again.
- An upgrade request that no route matches gets the status 404.
- `handshake` changes the reply to the handshake. A `status` other than 101 refuses the connection. `accept: "wrong"` or `"none"` breaks the accept value. `protocol` sets a subprotocol.
- The server answers a ping with a pong. It answers a close frame with a close frame and the same code, then closes the connection. `answerPing: false` and `answerClose: false` stop these answers.
- `webSockets` holds a record of each connection: its target, the fields of its request and the frames of the client. It also holds the writes of the server and the time of the close.
- `messagesOf` joins the frames of each message into its text or its bytes.
- A client that sends bytes that are not a frame gets a reset. Its record has `invalid: true`.

## A scripted XMPP server

The entry `@mark1russell7/rigor-testkit/xmpp` gives an XMPP server for the fixtures of a client test (RFC 6120). The negotiation and the steps of each connection are data. The server uses `node:net` and `node:tls`.

The entry `/xmpp` reads the XML of the client with the package `ltx`. Install it next to this package. The other entries do not load it:

```sh
npm install --save-dev ltx
```

Without `ltx`, the import of `/xmpp` throws an `Error` that gives this command. The entry loads the package with a top-level `await`, so `require()` cannot load the entry. Use `import`.

```ts no-run
import { testCertificates, trustCertificate } from "@mark1russell7/rigor-testkit/tls";
import { startXmppServer } from "@mark1russell7/rigor-testkit/xmpp";

const certs = testCertificates({ names: ["example.org"] });
const untrust = trustCertificate(certs.ca);
const server = await startXmppServer({
  domain: "example.org",
  tls: certs,
  accounts: [{ username: "operator", password: "a-password" }],
  sessions: [
    {
      steps: [
        { receive: "presence" },
        { send: "<presence from='{{to}}' to='{{jid}}'><x xmlns='http://jabber.org/protocol/muc#user'><status code='110'/></x></presence>" },
        { send: "<message from='room@conference.example.org/feed' to='{{jid}}' type='groupchat'><body>one</body></message>" },
        { close: { condition: "system-shutdown" }, delayMs: 50 },
      ],
    },
  ],
});
// The client under test connects to server.url, or to a fault proxy in front of server.port.
expect(server.connections[0].stanzas.map((stanza) => stanza.name)).toEqual(["presence"]);
await server.close();
untrust();
```

### The negotiation

The server does the negotiation of RFC 6120 from the script of the connection. Then it does the steps.

| The client sends | The server |
|---|---|
| The stream header | Sends its own header and the features. A header to another domain gets the stream error `host-unknown`. |
| `<starttls/>` | Sends `<proceed/>`, then does the TLS handshake with the `tls` of the options. |
| `<auth mechanism='PLAIN'>` | Sends `<success/>` for an account of the options, or a SASL failure. |
| `<iq type='set'><bind/></iq>` | Sends the full JID: the user name, the domain and the resource of the client. The default resource is `rigor-<n>`. |
| Another element before the bind | Sends the stream error `not-authorized`. |
| XML that is not well formed | Sends the stream error `not-well-formed`. |

- `startTls` of a session tells how the server offers STARTTLS. With `required` (the default), the login comes only after TLS. `optional` offers the two together. `none` offers no TLS.
- A login with no TLS gets `encryption-required` when the mode is `required`.
- With no option `accounts`, each login with SASL PLAIN gets success. An empty list refuses each login.
- `sasl` of a session gives one SASL failure to each login.
- The sessions go in their order, one for each connection. After the end of the list, the server gives the last session again.
- The record of a connection keeps the user name of the login. It does not keep the password.

### The steps

| Step | The server |
|---|---|
| `send` | Sends one or more whole XML elements in one write. |
| `raw` | Sends text or bytes as they are, for example XML that is not well formed. |
| `receive` | Waits for the next stanza with this name and these `attrs`, and skips each other stanza. After `limitMs`, it goes to the next step. |
| `close` | Sends a stream error with the `condition`, when the step has one. Then it sends `</stream:stream>` and ends TCP. |
| `end` | Closes its side of the TCP connection, with no close of the stream. |
| `destroy` | Resets the TCP connection. |

- Each step can have `delayMs`, a time before the step. After the last step, the server keeps the connection open.
- A reset deletes the bytes that the client did not read yet. Thus a reset after a write needs a `delayMs`.
- A `send` can hold the tokens `{{jid}}`, `{{bare}}`, `{{resource}}` and `{{domain}}` of the bind. `{{id}}` and `{{to}}` come from the stanza of the last `receive`.
- The server writes each value of a token as XML text.
- The server answers the close of the stream of the client with its own close. With `answerClose: false`, it records the close and sends nothing.
- `checkXmppServer` and `checkXmppStep` give each problem of a script. `startXmppServer` throws a `RangeError` for them.

### The place of a write on the wire

The record of each connection has `wire`, the place of each write of the server in the bytes of the TCP connection. A fault plan of `@mark1russell7/rigor-proxy` with a `byte` point uses it.

- `offset` is the count of bytes that the server sent before the write. `length` is the count of bytes of the write.
- After STARTTLS, the counts include the TLS records and the handshake. `xml` holds the text of the write, before TLS.
- `step` is the number of the step of the write. It is -1 for a write of the negotiation.
- The keys of `/tls` are Ed25519 keys, so each set of certificates of the same names has the same size. Thus the same script gives the same counts on each run.

## The certificates of a TLS test

The entry `@mark1russell7/rigor-testkit/tls` makes a certificate authority and a server certificate at the time of the test. Thus no key goes into git. It uses only `node:crypto` and `node:tls`, with no peer.

- `testCertificates({ names })` gives `ca`, `cert` and `key` in PEM. The names are DNS names and IP addresses. A DNS name can start with the label `*`.
- The certificates are valid from one hour before the call, for one day. The options `from` and `days` change this.
- A client with the option `ca` trusts the server.
- `trustCertificate(ca)` adds the authority to the default authorities of the process. Then a client with no `ca` option trusts the server.
- `trustCertificate` gives a function that puts back the authorities from before. It needs Node.js 22.19 or 24.5.

## A stand-in OTLP collector

The entry `@mark1russell7/rigor-testkit/otlp` gives an OTLP/HTTP collector for a check of a program in another process. The capture of the SDK cannot see into that process. It uses the scripted server of the entry `/http`, and it has no dependency.

A change of the load order can break the instrumentations with no error. The service operates, and some spans are missing. A check of the service in CI finds this:

```ts no-run
import { startOtlpCollector } from "@mark1russell7/rigor-testkit/otlp";

const collector = await startOtlpCollector();
const service = spawn("node", ["server.js"], { env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint } });
const missing = await collector.waitFor(["@opentelemetry/instrumentation-http", "@opentelemetry/instrumentation-pg"], {
  poke: () => fetch("http://127.0.0.1:3000/health"),
});
expect(missing).toEqual([]);
service.kill();
await collector.close();
```

### The rules

- The collector reads the paths `/v1/traces`, `/v1/metrics` and `/v1/logs`. Its reply to each export is the status 200 with the body `{}`.
- The collector reads OTLP JSON, the default of `@opentelemetry/exporter-trace-otlp-http`. An export in protobuf or with gzip counts in `unread`, not in `counts`.
- `counts(signal)` gives the count of the items of each scope. A scope with no name has the key `""`.
- `names(signal)` gives the names of the spans, the names of the metrics, or the event names of the log records. A log record with no event name has a count and no name.
- `waitFor` starts `poke`, then reads, until each scope has an item or the time ends. A poke that rejects does not stop the wait.
- The default signal of each method is `traces`.

## A fake event target

The entry `@mark1russell7/rigor-testkit/fakes` gives test fakes of browser objects for tests in Node. `createFakeEventTarget` records the listeners of browser code:

```ts no-run
import { createFakeEventTarget } from "@mark1russell7/rigor-testkit/fakes";

const page = createFakeEventTarget();
const stop = trackPageLifecycle({ target: page });
page.dispatch("pagehide", { persisted: false });
stop();
expect(page.listeners()).toEqual([]);
```

### The rules

- `dispatch` sends the event to the capture listeners first, then to the other listeners. A browser does the same at the target.
- A second addition with the same type, listener and phase does nothing, as in a browser. The option `true` is the same as `{ capture: true }`.
- The target removes a listener with `once` after the listener gets one event.
- A listener that an earlier listener removes does not get the event. A listener that an earlier listener adds gets the next event.
- `listeners()` gives a copy of the listeners, in the order of their addition.

## A server in a child process

The entry `@mark1russell7/rigor-testkit/child` starts a server of a test in a child process. The child listens on the port 0 and reports the port that it got. The test reads that port. It uses only `node:child_process` and `node:fs`.

Do not pick a free port, close it and give it to a child. Another process can take the port before the child listens. With the port 0, the system gives the port at the listen.

```ts no-run
import { childServerGroup } from "@mark1russell7/rigor-testkit/child";

const children = childServerGroup();
afterEach(() => children.stopAll());

const server = await children.start({
  command: process.execPath,
  args: ["server.js", "--port", "0"],
  report: { from: "stdout", pattern: /^listening on (\d+)$/ },
});
const response = await fetch(`http://localhost:${server.port}/health`);
```

### The report of the port

| `report.from` | The child reports its port | The fixture reads it |
|---|---|---|
| `stdout` (the default) or `stderr` | In a line of its standard output or of its standard error. | It tests each complete line with `pattern`. The first group is the port. The default pattern `PORT_LINE` matches a line with only the port. |
| `file` | In a ready file at `path`. | It reads the file each `pollMs`. `portOfText` gives the port of a number alone or of a JSON object with a field `port`. |
| `poll` | In a place that the test knows, for example a lockfile with the process id of the child. | It starts `read(child)` each `pollMs` until the function gives a port. |

### The rules

- `startChildServer` starts the child with no shell. The promise gives the port when the child reports it.
- The promise rejects with a `ChildServerError` when the child ends, does not start, or reports a number that is not a port.
- It also rejects when the child reports no port in `timeoutMs` (10 000 by default), or when `signal` aborts.
- With `ready`, the promise also waits for a line of the standard output or the standard error that matches `ready`. This line can come before the port or after it.
- Give `ready` the last line of the startup. Then `output()` holds each line of the startup when the promise gives the port.
- Before it rejects, the fixture stops the child. The error holds the process id, the exit and the last output of the child.
- `stop()` sends `SIGTERM`, then `SIGKILL` after `stopGraceMs` (2 000 by default). Each call gives the same promise.
- `childServerGroup()` keeps each child that it starts. `stopAll()` stops them, for the end of each test.
- `output()` gives the last 256 KiB of the standard output and the standard error of the child.

## A stop of a process

The entry `@mark1russell7/rigor-testkit/stop` applies a stop plan of `@mark1russell7/rigor-chaos` to a program of a test. The program uses `stopPoint` at each point of interest. The harness stops the child at the point of a stop, and the test examines the state that the child left.

```ts
// The program of the test, in its own file
import { stopPoint } from "@mark1russell7/rigor-testkit/stop";

stopPoint("before the commit");
db.exec("COMMIT");
stopPoint("after the commit");
```

The entry `/stop` imports `@mark1russell7/rigor-chaos`. Install it next to this package. The other entries do not load it:

```sh
npm install --save-dev @mark1russell7/rigor-chaos
```

Without `@mark1russell7/rigor-chaos`, the import of `/stop` throws an `Error` that gives this command. The entry loads the package with a top-level `await`, so `require()` cannot load the entry. Use `import`.

```ts
// The test
import { stopPlan } from "@mark1russell7/rigor-chaos";
import { countStops, runToStop } from "@mark1russell7/rigor-testkit/stop";

const program = { command: process.execPath, args: ["writer.ts", file] };
const plan = stopPlan({ within: { step: await countStops(program) }, draws: 16 }, "writer");
for (const stop of plan.stops) {
  const run = await runToStop({ ...program, stop });
  // Open the file, and examine it. run.lastStep and run.lastLabel tell the point of the stop.
}
```

### The rules

- Each call of `stopPoint` is the next step, from 0. Without the variable `RIGOR_STOP`, the function does no work.
- At a stop at a step, the child writes its progress, then sends the signal to itself. Thus no work after the point runs.
- At a stop at a time, the harness sends the signal to the child. `lastStep` is the last point before the signal.
- A rerun with `{ step: run.lastStep }` replays the nearest point before a stop at a time.
- `stopped` is `false` when the child ends before the point of the stop.
- For a stop at a time, an exit code of 0 also gives `stopped: false`. The child got to its end, also if the signal went to it.
- `countStops` starts the program with no stop, and gives the number of its points. It rejects for an exit code that is not 0.
- `runToStop` rejects when the child does not start, or does not end in `timeoutMs` (60 000 by default).
- The first use of `stopPoint` removes `RIGOR_STOP` from the environment. Thus a later child of the program does not stop.

### A harness that starts the child itself

A harness that starts the program in a container or on a different machine does not use `runToStop`. It uses the same order and the same progress file:

- `stopOrderOf(stop, progress)` gives the value of `RIGOR_STOP`, with the path of the progress file in the child.
- For a stop at a time, the order has no step. The harness sends the signal at the time.
- `stopOccurred({ stop, lines, sent, exit })` gives the value of `stopped`, with the rule of `runToStop`.
- `parseProgress(text)` gives the lines of the progress file. It ignores a last line that the child did not write completely. It also ignores a JSON value that is not a progress line, for example `5` or `{}`.
- Start each child after the first stop point, or remove `STOP_ENV` from its environment. An earlier child gets the order. It writes its own steps from 0 to the same progress file, and it stops itself at the step of the stop.
- An order that is not valid stays in the environment. Each call of `stopPoint` then throws its `RangeError`.
- After `SIGTERM`, a program with a handler continues until its handler ends it. A handler does not keep the event loop open.

### A child with no packages

The entry `@mark1russell7/rigor-testkit/stop-point` has the child side: `stopPoint`, `parseProgress`, `STOP_ENV` and the types of the order. It imports only modules of Node.js. Thus a copy of its built file works in a container with no `node_modules`:

```sh
cp node_modules/@mark1russell7/rigor-testkit/build/stop-point.js subject/
```

```js
// The program in the container
import { stopPoint } from "./stop-point.js";

stopPoint("before the fsync");
```

- The entry `/stop` gives the same functions from the same module. Thus a program that imports the two entries has one sequence of steps.
- The child examines only that the signal of the order is a signal of Node.js. `stopOrderOf` of `/stop` examines the signal of the plan.
- The build stops when `build/stop-point.js` imports a module that is not a `node:` module.

### The limits

- A stop of a process is not a power cut. The kernel keeps each write that the process gave to it, also after `SIGKILL`.
- Only a power cut or a crash of the kernel loses the writes that are not on the disk. A test of a process stop does not examine that case.
- On Windows, `SIGTERM` and `SIGKILL` both end the process at once. The process cannot catch `SIGTERM`. Do the tests of `SIGTERM` on Linux or macOS.
- The signal goes only to the child. A child of the program continues after the stop.
## A behavior check

The entry `@mark1russell7/rigor-testkit/behavior` gives two functions the same seeded inputs, and compares their outputs. The result is evidence on the draws only. It is not a proof that the two functions are equal. The inputs come from an input family of `@mark1russell7/rigor-generators`, or from a list.

The entry `/behavior` imports `@mark1russell7/rigor-generators`. Install it next to this package. The other entries do not load it:

```sh
npm install --save-dev @mark1russell7/rigor-generators
```

Without `@mark1russell7/rigor-generators`, the import of `/behavior` throws an `Error` that gives this command. The entry loads the package with a top-level `await`, so `require()` cannot load the entry. Use `import`.

```ts no-run
import assert from "node:assert/strict";
import { behaviorCheck } from "@mark1russell7/rigor-testkit/behavior";

const family = {
  name: "plane",
  dimensions: [
    { name: "x", min: -10, max: 10 },
    { name: "y", min: -10, max: 10 },
  ],
};
const result = behaviorCheck((p) => Math.max(p.x, p.y), (p) => (p.x > p.y ? p.x : p.y), { family, seed: "max", count: 200 });
assert.equal(result.equal, 200);

const lists = behaviorCheck(localMedian, median, { inputs: [[3, 1, 2], [4, 1], [7]] });
```

| Function | What it does |
| --- | --- |
| `behaviorCheck(a, b, options)` | It applies `a` and `b` to each draw in this process. It gives the counts and the first difference. |
| `behaviorDigest(fn, options)` | It applies one function to each draw, and gives the hash of each outcome as JSON data. |
| `compareDigests(x, y)` | It compares two digests of the same draws, and gives the counts of `behaviorCheck`. |
| `behaviorDraws(options)` | It gives the inputs of a check, in the order of the draws. |
| `behaviorForm(value)` | It gives the stable form of a value: the text that the default equality compares. |

### The draws

| Option | Default | What it does |
| --- | --- | --- |
| `family` | | The input family. Each draw is a point with one value for each dimension, by name. |
| `seed` | | The seed of the draws: a number, or a name. The same seed gives the same draws. |
| `count` | | The count of draws, an integer from 1. |
| `design` | `latin` | `latin` puts one draw in each of `count` strata of each dimension. `random` draws independent uniform points. |
| `inputs` | | A list of inputs in place of a family. Each item is one draw. |
| `equal` | the stable form | It tells if two outputs are equal. Use it for a tolerance. `behaviorCheck` only. |
| `copy` | `structuredClone` | It gives a copy of an input. Each function gets its own copy, so a change to an input does not go to the other function. |

- Give a family, a seed and a count, or give a list of inputs. The check refuses the two together, and a bad option, with a `RangeError`.
- The seed gives one random stream `random(seed)`. Its fork `family` gives the parameters of the dimensions. Its fork `design` gives the unit points.
- For one seed and two deterministic functions, the result is always the same.
- A function takes one input. To examine a function with more parameters, give a function that spreads the point, for example `(p) => clamp(p.x, p.lo, p.hi)`.
- The check accepts synchronous functions only. A promise has no stable form, so the default equality refuses it with a `TypeError`.

### The result

| Field | What it is |
| --- | --- |
| `count` | The count of draws. |
| `equal` | The draws where the two functions gave equal values. |
| `different` | The draws where the two functions gave values that are not equal. |
| `bothThrew` | The count of draws where the two functions threw. The check does not compare the two errors. These draws are not differences. |
| `onlyAThrew`, `onlyBThrew` | The index of each draw where only one function threw. Each of these draws is a difference. |
| `firstDifference` | The first draw where the values are not equal, or only one function threw: its index, its input and the two outcomes. It is absent when the functions agree on each draw. |

The sum of `equal`, `different`, `bothThrew` and the two lists is `count`. The two functions have the same behavior on the draws when `equal` is `count`.

### The stable form

The default equality compares the stable form of each output. The stable form is the canonical JSON (RFC 8785) of a tagged form. RFC 8785 has no form for some values. The tagged form writes each of them as an object with one key that starts with `$`:

| Value | Tagged form | The effect |
| --- | --- | --- |
| `NaN`, `Infinity`, `-Infinity`, `-0` | `{"$number":"NaN"}`, `{"$number":"-0"}` and the related texts | `NaN` is equal to `NaN`. `-0` and `0` are not equal. |
| `undefined` | `{"$undefined":true}` | `{ a: undefined }` and `{}` are not equal. A hole of an array is `undefined`. |
| a `bigint` | `{"$bigint":"12"}` | `12n` and `12` are not equal. |
| a string with a lone surrogate | `{"$utf16":[97,55296]}`, the code units | RFC 8785 refuses this string. The tag keeps it. |
| a `Map`, a `Set` | `{"$map":[[key, value]]}`, `{"$set":[item]}` | The order of insertion has no effect. |
| a `Date`, a `RegExp`, an `Error` | `{"$date":5}`, `{"$regexp":"/a/g"}`, `{"$error":{"message","name"}}` | Two errors with the same name and message are equal. |
| a key that starts with `$` | the key with one more `$` | A plain object cannot have the form of a tag. |

- An object with a method `toJSON` gives the form of the result of that method.
- Other objects keep their own enumerable string keys, as in JSON. The form does not keep the class of an object.
- The keys of an object have no order. The items of an array keep their order.
- A function, a symbol, a promise and a cycle have no stable form. The check refuses them with a `TypeError`. Give `equal` for such an output.

### Two repositories in two processes

When the two functions are in two repositories, each repository applies its function in its own process. `behaviorDigest` gives the digest of one function, and `compareDigests` compares two digests. Thus the check needs no process runner.

```ts no-run
// In each repository, with the same options:
import { behaviorDigest } from "@mark1russell7/rigor-testkit/behavior";

process.stdout.write(JSON.stringify(behaviorDigest((p) => median(p.values), options)));
```

```ts no-run
// After the two processes:
import { compareDigests } from "@mark1russell7/rigor-testkit/behavior";

const comparison = compareDigests(JSON.parse(local), JSON.parse(home));
```

- A digest is JSON data. It keeps the format, the family name, the 32-bit seed, the design, the count and the SHA-256 hash of the stable form of the draws.
- For each draw, the digest keeps `{ "output": hash }`, the SHA-256 hash of the stable form of the value, or `{ "threw": class }`.
- The class of a thrown value is the name of its constructor, for example `RangeError`. A thrown string gives `string`, and `null` gives `null`.
- `compareDigests` refuses two digests of different draws with a `RangeError`: a different family, seed, design, count or hash of the draws.
- The comparison has the counts of `behaviorCheck`. Its `firstDifference` has the index and the two entries of the draw, not the input. `behaviorDraws(options)` gives the input of an index.
- The digest of a list of inputs keeps the hash of the list. Thus the inputs need a stable form.

## A budget of process starts

The entry `@mark1russell7/rigor-testkit/process-starts` counts the process starts of each test file. Each start costs time. On Windows, each start also uses kernel memory that the system does not free. Thus a suite with thousands of starts can stop the computer.

A setup file of the test runner wraps `node:child_process` one time, clears the count before each file and examines the budget after the file:

```ts no-run
// process-starts.setup.ts, in setupFiles of vitest:
import { readFileSync } from "node:fs";
import { afterAll, beforeAll } from "vitest";
import { countProcessStarts, parseStartBudgets, startBudgetBreak } from "@mark1russell7/rigor-testkit/process-starts";

const counts = countProcessStarts();
const source = "test/git-starts.json";
const budgets = parseStartBudgets(readFileSync(source, "utf8"), source);
beforeAll(() => counts.clear());
afterAll((_context, suite) => {
  const message = startBudgetBreak(suite.file.name, counts, budgets, { source, advice: "Share the fixture repositories." });
  if (message !== undefined) throw new Error(message);
});
```

- The budget file is JSON: `{ "default": 20, "files": { "test/big.test.ts": 60 } }`. A file with no entry gets `default`.
- `startBudgetBreak` counts `git` by default. Give `command` to count another command.
- A git start counts under `git-<command>`, for example `git-ls-files`. `startsIn(counts, "git")` gives the sum of each key of git.
- The wrappers also apply to the named imports of `node:child_process`, through `syncBuiltinESMExports`.
- `startsOf(name)` gives the count since the last clear. A test of a helper compares two reads of it.
- `startsReport(rows)` gives one line for each file, the most starts first, and a line of the sums. A global setup prints it at the end of a CI run.

## Git repositories with few git starts

The entry `@mark1russell7/rigor-testkit/git-fixture` makes the git repositories of a test file. One file makes one empty repository with one `git init`. Each other repository copies its `.git` folder.

```ts no-run
import { afterAll, it } from "vitest";
import { gitFixtures } from "@mark1russell7/rigor-testkit/git-fixture";

const repos = gitFixtures("my-rule-");
afterAll(() => repos.remove());

it("reads the files in the index", () => {
  const root = repos.fixture({ "package.json": { name: "a" }, "src/a.ts": "export const a = 1;\n" });
  repos.stageAll(root); // one git start
  // ...
});
```

| Function | It does | Git starts |
|---|---|---|
| `init(root)` | It makes `root` a repository with the branch `main` and no commit. | 1 for the first in a file, then 0 |
| `stageAll(root)` | It puts each file in the index. This is enough for code that reads only `git ls-files`. | 1 |
| `commitAll(root, message)` | It commits each file, for code that reads the history. | 2 |
| `commitOf(root, branch)` | It reads the commit of `HEAD` or of a branch from the files of `.git`. | 0, or 1 for a packed ref |
| `copy(root)` | It copies a repository with its work tree, for a case that changes a shared repository. | 0 |
| `shared(key, build)` | It starts `build` one time for each key, and gives each call its own copy. | The starts of one `build` |

- The git of the fixtures has a test identity, no signature and no hooks.
- It removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and the other variables of a git hook. Thus a test in a hook writes to the fixture.

## License

MIT
