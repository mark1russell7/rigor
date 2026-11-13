import { type AddressInfo, type Socket, connect, createServer } from "node:net";
import { type Cancel, type Clock, platformClock } from "@mark1russell7/algebra/clock";
import { type Direction, type Fault, type FaultPlan, checkFaultPlan } from "@mark1russell7/rigor-chaos";
import { type Applier, type FaultRecord, type Send, type Step, applierOf } from "./applier.ts";
import { type Framer, type FramerPair, httpFramers, tcpFramers } from "./framers.ts";

/** The protocol of the streams. `http` and `websocket` use the same framers: a WebSocket starts as an HTTP upgrade. */
export type Protocol = "tcp" | "http" | "websocket";

/** The options of a fault proxy. */
export interface ProxyOptions {
  /** The server that the proxy connects each client to. The default host is `127.0.0.1`. */
  readonly target: { readonly host?: string; readonly port: number };
  readonly plan: FaultPlan;
  /** The protocol sets the framers. The default is `tcp`. */
  readonly protocol?: Protocol;
  /** This function makes the framers of each connection. It replaces the framers of `protocol`. */
  readonly framers?: () => FramerPair;
  /** The address of the proxy. The default is `127.0.0.1`, with a free port. */
  readonly listen?: { readonly host?: string; readonly port?: number };
  /** The clock of the times and the timers. The default is `platformClock()`. A test can give `fakeClock()`. */
  readonly clock?: Clock;
  /** This function gets each record when the fault occurs. */
  readonly onFault?: (record: FaultRecord) => void;
  /** This function gets the summary of each connection when the connection closes. */
  readonly onClose?: (summary: ConnectionSummary) => void;
}

/** How a connection ended. */
export type ConnectionEnd = "close" | "cut" | "reset" | "error";

/** The summary of one connection. */
export interface ConnectionSummary {
  readonly connection: number;
  readonly end: ConnectionEnd;
  /** The bytes that the proxy read in each direction. */
  readonly bytes: { readonly up: number; readonly down: number };
  /** The faults of the connection that did not occur, with their positions in the plan. */
  readonly missed: readonly { readonly index: number; readonly fault: Fault }[];
}

/** A fault proxy that listens. */
export interface FaultProxy {
  readonly host: string;
  readonly port: number;
  /** The records of the faults, in the order that they occurred. */
  readonly records: readonly FaultRecord[];
  /** The summaries of the connections that closed. */
  readonly connections: readonly ConnectionSummary[];
  /** This method stops the proxy and destroys each open connection. */
  close(): Promise<void>;
}

interface Side {
  readonly direction: Direction;
  readonly from: Socket;
  readonly to: Socket;
  readonly framer: Framer;
  readonly applier: Applier;
  readonly queue: Send[];
  write: Cancel | undefined;
  wake: Cancel | undefined;
  stall: Cancel | undefined;
  stalled: boolean;
  draining: boolean;
  ending: boolean;
  read: number;
}

/**
 * This function starts a proxy that puts the faults of a plan into the connections between clients and a target. The
 * proxy numbers the connections from 0, in the order that it accepts them. It throws a `RangeError` for a plan with problems.
 */
export async function startFaultProxy(options: ProxyOptions): Promise<FaultProxy> {
  const problems = checkFaultPlan(options.plan);
  if (problems.length > 0) throw new RangeError(`startFaultProxy: ${problems.join(" ")}`);
  const clock = options.clock ?? platformClock();
  const makeFramers = options.framers ?? (options.protocol === undefined || options.protocol === "tcp" ? tcpFramers : httpFramers);
  const records: FaultRecord[] = [];
  const connections: ConnectionSummary[] = [];
  const open = new Set<Socket>();
  let next = 0;

  const server = createServer({ allowHalfOpen: true }, (client) => {
    const connection = next;
    next += 1;
    const start = clock.now();
    const now = (): number => clock.now() - start;
    const upstream = connect({ host: options.target.host ?? "127.0.0.1", port: options.target.port, allowHalfOpen: true, noDelay: true });
    // Each write goes out at once, thus a split or a gap of the plan stays on the wire.
    client.setNoDelay(true);
    open.add(client);
    open.add(upstream);
    const pair = makeFramers();
    const side = (direction: Direction, from: Socket, to: Socket): Side => ({
      direction,
      from,
      to,
      framer: pair[direction],
      applier: applierOf(options.plan, connection, direction),
      queue: [],
      write: undefined,
      wake: undefined,
      stall: undefined,
      stalled: false,
      draining: false,
      ending: false,
      read: 0,
    });
    const sides = [side("up", client, upstream), side("down", upstream, client)] as const;
    let end: ConnectionEnd | undefined;
    let closed = 0;

    const cancelTimers = (): void => {
      for (const s of sides) {
        s.write?.();
        s.wake?.();
        s.stall?.();
        s.write = undefined;
        s.wake = undefined;
        s.stall = undefined;
      }
    };

    const resume = (s: Side): void => {
      if (end === undefined && !s.stalled && !s.draining) s.from.resume();
    };

    const pump = (s: Side): void => {
      s.write = undefined;
      if (end === "reset" || end === "error") return;
      const t = now();
      while (s.queue.length > 0 && (s.queue[0] as Send).at <= t) {
        const send = s.queue.shift() as Send;
        if (!s.to.write(send.bytes) && !s.draining) {
          s.draining = true;
          s.from.pause();
          s.to.once("drain", () => {
            s.draining = false;
            resume(s);
          });
        }
      }
      if (s.queue.length > 0) s.write = clock.after((s.queue[0] as Send).at - t, () => pump(s));
      else if (s.ending && !s.to.writableEnded) s.to.end(() => (end === "cut" ? s.to.destroy() : undefined));
    };

    const apply = (s: Side, step: Step): void => {
      for (const record of step.records) {
        records.push(record);
        options.onFault?.(record);
      }
      if (step.sends.length > 0) {
        s.queue.push(...step.sends);
        if (s.write === undefined) pump(s);
      }
      if (step.pauseUntil !== undefined) {
        s.stalled = true;
        s.from.pause();
        s.stall?.();
        s.stall = clock.after(step.pauseUntil - now(), () => {
          s.stall = undefined;
          s.stalled = false;
          resume(s);
        });
      }
      if (step.close !== undefined) shut(step.close.kind);
      rearm(s);
    };

    const rearm = (s: Side): void => {
      s.wake?.();
      s.wake = undefined;
      const wake = s.applier.wake;
      if (wake !== undefined && end === undefined) s.wake = clock.after(Math.max(0, wake - now()), () => apply(s, s.applier.tick(now())));
    };

    const finish = (s: Side): void => {
      if (s.ending) return;
      for (const frame of s.framer.end()) apply(s, s.applier.push(frame, now()));
      apply(s, s.applier.end(now()));
      s.ending = true;
      if (s.write === undefined) pump(s);
    };

    const shut = (kind: "cut" | "reset"): void => {
      if (end !== undefined) return;
      end = kind;
      for (const s of sides) s.from.pause();
      if (kind === "reset") {
        cancelTimers();
        client.resetAndDestroy();
        upstream.resetAndDestroy();
        return;
      }
      for (const s of sides) {
        s.wake?.();
        s.stall?.();
        apply(s, s.applier.end(now()));
        s.ending = true;
        if (s.write === undefined) pump(s);
      }
    };

    for (const s of sides) {
      s.from.on("data", (bytes: Buffer) => {
        if (end !== undefined) return;
        s.read += bytes.length;
        for (const frame of s.framer.push(bytes)) {
          apply(s, s.applier.push(frame, now()));
          if (end !== undefined) return;
        }
      });
      s.from.on("end", () => {
        if (end === undefined) finish(s);
      });
      s.from.on("error", () => {
        end ??= "error";
        cancelTimers();
        for (const other of sides) other.from.destroy();
      });
      s.from.on("close", () => {
        open.delete(s.from);
        closed += 1;
        if (closed === 1) {
          // The socket closed fully, thus the other socket gets the bytes that wait for it, and then it closes too.
          if (end === undefined) finish(s);
          if (s.to.writableFinished) s.to.destroy();
          else s.to.once("finish", () => s.to.destroy());
          return;
        }
        cancelTimers();
        const summary: ConnectionSummary = {
          connection,
          end: end ?? "close",
          bytes: { up: sides[0].read, down: sides[1].read },
          missed: [...sides[0].applier.pending(), ...sides[1].applier.pending()].sort((a, b) => a.index - b.index),
        };
        connections.push(summary);
        options.onClose?.(summary);
      });
    }
    // A fault at 0 ms occurs before the first byte.
    for (const s of sides) apply(s, s.applier.tick(0));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listen?.port ?? 0, options.listen?.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    host: address.address,
    port: address.port,
    records,
    connections,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of open) socket.destroy();
      }),
  };
}
