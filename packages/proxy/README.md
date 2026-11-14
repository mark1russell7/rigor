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
- `clock` sets the clock of the times and the timers. A test gives `fakeClock()` of `@mark1russell7/algebra/clock`, and it moves the time itself.

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

## The pure parts

The framers (`tcpFramers`, `httpFramers`, `webSocketFramer`) and the applier (`applierOf`) read no clock and write no socket. A test gives them bytes and times, and it examines the writes that they give back.

## Tests

The tests with real sockets measure time, thus only CI starts them, in the workflow `proxy-net.yml`. `pnpm test` starts only the tests of the pure parts.
