# @mark1russell7/rigor-proxy

This package holds a TCP proxy that puts the faults of a plan into the streams between clients and a server. It records each fault that it applies.

A fault plan is data of `@mark1russell7/rigor-chaos`. A seed fixes the plan before the run. Thus a record keeps the plan, and a later run applies the same faults at the same points.

## A proxy

```ts
import { faultPlan } from "@mark1russell7/rigor-chaos";
import { startFaultProxy } from "@mark1russell7/rigor-proxy";

const plan = faultPlan({ connections: 10, perConnection: 2, kinds: { split: 2, delay: 1, reset: 1 }, within: { frame: 20 } }, "drill");
const proxy = await startFaultProxy({ target: { port: 8080 }, plan, protocol: "websocket" });
// The client under test connects to proxy.port.
await proxy.close();
```

- The proxy numbers the connections from 0, in the order that it accepts them. Connection `i` gets the faults of connection `i` of the plan.
- `records` holds each fault that occurred: its time, its connection, its direction, its kind, and its byte and frame position.
- `connections` holds the summary of each connection that closed: how it ended, the bytes of each direction, and the faults that did not occur.
- `onFault` and `onClose` get the same data when it occurs.
- `close()` destroys each open connection. Its promise resolves after each connection closes, so then `connections` has the summary of each connection.
- `clock` sets the clock of the times and the timers. A test gives `fakeClock()` of `@mark1russell7/algebra/clock`, and it moves the time itself.

## Windows

The proxy applies each fault of a window to each connection that is open at a time in the window. Thus a window of a plan makes an outage for each client, also for a client that keeps its connection open.

- `origin` is the time of the clock at the start of the plan. The windows count from it. The default is the time when the proxy starts.
- Give the time of the start of your case as `origin`. Then the windows of the plan and the samples of your case use the same times.
- The record of a window fault has `window: true`, and its `index` is the position in the list `windows` of the plan.
- The summary of each connection has `opened`, the start of the connection in ms from the start of the plan.
- The faults of windows are not in `missed`, because a window fault does not belong to one connection.

## Frames

A fault with a `frame` point counts frames, and `split`, `reorder` and `duplicate` change one frame. The framers of `protocol` set what a frame is.

| `protocol` | A frame |
|---|---|
| `tcp` | Each read of the socket. |
| `http` | The head of a request or a response, each read of a body with a length, or each chunk of a chunked body. |
| `websocket` | The same as `http`. After the `101` response, each WebSocket frame. |

- A framer does not change a byte. When it cannot read the stream, it gives each read as one frame.
- The proxy works on TCP. It cannot read a TLS stream, thus a TLS stream has only `tcp` frames.
- `framers` replaces the framers of `protocol` with your framers.

## An answer

An `answer` puts an HTTP/1.1 response from the plan in place of the server. The proxy writes it to the client, and ends the connection with a FIN.

| Point | What the client and the server see |
|---|---|
| `up`, `{ frame: 0 }` | The server does not get the request. The client gets the answer. |
| `down`, `{ frame: 0 }` | The server gets the request. The client gets the answer in place of the response of the server. |
| `down`, a later frame | The client gets a part of the response of the server, then the answer. This stream is not valid HTTP. |

- The proxy writes the fields in their order, then `content-length` and `connection: close`. A 204 or a 304 has no `content-length`.
- After an answer, no byte of the server goes to the client. The summary of the connection says `cut`.
- `answerBytes` gives the bytes of an answer.

## The pure parts

The framers (`tcpFramers`, `httpFramers`, `webSocketFramer`), the applier (`applierOf`) and `answerBytes` read no clock and write no socket. A test gives them bytes and times, and it examines the writes that they give back.

The entry `@mark1russell7/rigor-proxy/applier` has these parts and no module of Node.js. A browser can load it, for example to show the writes of a plan.

The frame codec of RFC 6455 is also a pure part. `readWebSocketFrame` reads the first frame of some bytes, with its bits, its mask and its payload with no mask. `encodeWebSocketFrame` writes a frame, with the shortest form of the length. `WEBSOCKET_OPCODES` names the opcodes. The scripted server of `@mark1russell7/rigor-testkit/http` uses this codec for its WebSocket routes.

```ts
import { faultPlan } from "@mark1russell7/rigor-chaos";
import { applierOf } from "@mark1russell7/rigor-proxy/applier";

const plan = faultPlan({ connections: 1, perConnection: 2, kinds: { delay: 1, cut: 1 }, within: { frame: 8 } }, 7);
const applier = applierOf(plan, 0, "up");
const step = applier.push(new TextEncoder().encode("frame 0"), 0);
// step.sends has the bytes and the time of each write. step.records has each fault that the frame started.
```

`REASONS` has the reason of each HTTP status, equal to `STATUS_CODES` of `node:http` in Node.js 24. Thus `answerBytes` gives the same bytes in each runtime.

## Tests

The tests with real sockets measure time, thus only CI starts them, in the workflow `proxy-net.yml`. `pnpm test` starts only the tests of the pure parts.
