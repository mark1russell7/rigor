import { type AddressInfo, type Socket, connect, createServer } from "node:net";
import { type Cancel, type Clock, platformClock } from "@mark1russell7/algebra/clock";
import { type Direction, type Fault, type FaultPlan, checkFaultPlan } from "@mark1russell7/rigor-chaos";
import type { FaultRecord } from "./applier.ts";
import { type ConnectionStep, connectionOf } from "./connection.ts";
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
  /**
   * The time of the clock at the start of the plan. The windows of the plan count from it. The default is the time of
   * the clock when the proxy starts. A case gives the time of its own start, so its windows and the proxy agree.
   */
  readonly origin?: number;
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
  /** The start of the connection, in ms from the start of the plan. */
  readonly opened: number;
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
  /**
   * This method stops the proxy and destroys each open connection. The promise resolves after each connection closes.
   * Then `connections` has the summary of each connection, also of each connection that was open at the call.
   */
  close(): Promise<void>;
}

interface Side {
  readonly direction: Direction;
  readonly from: Socket;
  readonly to: Socket;
  readonly framer: Framer;
  write: Cancel | undefined;
  wake: Cancel | undefined;
  stall: Cancel | undefined;
  stalled: boolean;
  draining: boolean;
  read: number;
}

/**
 * This function starts a proxy that puts the faults of a plan into the connections between clients and a target. The
 * proxy numbers the connections from 0, in the order that it accepts them. It throws a `RangeError` for a plan with problems.
 * The rules of each connection come from `connectionOf`. The proxy adds the sockets, the timers and the back pressure.
 */
export async function startFaultProxy(options: ProxyOptions): Promise<FaultProxy> {
  const problems = checkFaultPlan(options.plan);
  if (problems.length > 0) throw new RangeError(`startFaultProxy: ${problems.join(" ")}`);
  const clock = options.clock ?? platformClock();
  if (options.origin !== undefined && !Number.isFinite(options.origin)) throw new RangeError(`startFaultProxy: the origin is a finite time, not ${String(options.origin)}.`);
  const origin = options.origin ?? clock.now();
  const makeFramers = options.framers ?? (options.protocol === undefined || options.protocol === "tcp" ? tcpFramers : httpFramers);
  const records: FaultRecord[] = [];
  const connections: ConnectionSummary[] = [];
  const open = new Set<Socket>();
  let next = 0;

  const server = createServer({ allowHalfOpen: true }, (client) => {
    const connection = next;
    next += 1;
    const start = clock.now();
    const opened = start - origin;
    const now = (): number => clock.now() - start;
    const upstream = connect({ host: options.target.host ?? "127.0.0.1", port: options.target.port, allowHalfOpen: true, noDelay: true });
    // Each write goes out at once, thus a split or a gap of the plan stays on the wire.
    client.setNoDelay(true);
    open.add(client);
    open.add(upstream);
    const pair = makeFramers();
    const model = connectionOf(options.plan, connection, opened);
    const side = (direction: Direction, from: Socket, to: Socket): Side => ({
      direction,
      from,
      to,
      framer: pair[direction],
      write: undefined,
      wake: undefined,
      stall: undefined,
      stalled: false,
      draining: false,
      read: 0,
    });
    const sides = [side("up", client, upstream), side("down", upstream, client)] as const;
    const sideOf = (direction: Direction): Side => (direction === "up" ? sides[0] : sides[1]);
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
      for (const send of model.due(s.direction, t)) {
        if (!s.to.write(send.bytes) && !s.draining) {
          s.draining = true;
          s.from.pause();
          s.to.once("drain", () => {
            s.draining = false;
            resume(s);
          });
        }
      }
      const next = model.next(s.direction);
      if (next !== undefined) s.write = clock.after(next - t, () => pump(s));
      else if (model.ending(s.direction) && !s.to.writableEnded) s.to.end(() => (end === "cut" ? s.to.destroy() : undefined));
    };

    /** This function stops the reads of a side until `until`, the latest end of its stalls. */
    const stall = (s: Side, until: number): void => {
      s.stalled = true;
      s.from.pause();
      s.stall?.();
      s.stall = clock.after(until - now(), () => {
        s.stall = undefined;
        s.stalled = false;
        resume(s);
      });
    };

    /** This function acts on a step of the connection that a read, a tick or an end of the side `s` gave. */
    const apply = (s: Side, step: ConnectionStep): void => {
      for (const record of step.records) {
        records.push(record);
        options.onFault?.(record);
      }
      for (const pause of step.pauses) stall(sideOf(pause.direction), pause.until);
      if (step.close !== undefined) shut(step.close.kind);
      for (const one of sides) if (one.write === undefined && (step.sends[one.direction].length > 0 || model.ending(one.direction))) pump(one);
      rearm(s);
    };

    const rearm = (s: Side): void => {
      s.wake?.();
      s.wake = undefined;
      const wake = model.wake(s.direction);
      if (wake !== undefined && end === undefined) s.wake = clock.after(Math.max(0, wake - now()), () => apply(s, model.tick(s.direction, now())));
    };

    const finish = (s: Side): void => {
      if (model.ending(s.direction)) return;
      for (const frame of s.framer.end()) apply(s, model.read(s.direction, frame, now()));
      apply(s, model.end(s.direction, now()));
    };

    const shut = (kind: "cut" | "reset"): void => {
      if (end !== undefined) return;
      end = kind;
      for (const s of sides) s.from.pause();
      if (kind === "reset") {
        // The writes at or before the reset go out. The connection lost each write after it.
        const t = now();
        for (const s of sides) for (const send of model.due(s.direction, t)) s.to.write(send.bytes);
        cancelTimers();
        client.resetAndDestroy();
        upstream.resetAndDestroy();
        return;
      }
      // The connection ended the two appliers. Each side writes what waits, and then ends its target.
      for (const s of sides) {
        s.wake?.();
        s.wake = undefined;
        s.stall?.();
        s.stall = undefined;
      }
    };

    for (const s of sides) {
      s.from.on("data", (bytes: Buffer) => {
        if (end !== undefined) return;
        s.read += bytes.length;
        for (const frame of s.framer.push(bytes)) {
          apply(s, model.read(s.direction, frame, now()));
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
          opened,
          end: end ?? "close",
          bytes: { up: sides[0].read, down: sides[1].read },
          missed: model.pending(),
        };
        connections.push(summary);
        options.onClose?.(summary);
      });
    }
    // A fault at 0 ms occurs before the first byte.
    for (const s of sides) apply(s, model.tick(s.direction, 0));
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
    close: async () => {
      // A socket emits "close" only after its handle closes, after server.close calls back. The connection gives its
      // summary in its own "close" listener, which comes before these listeners. Thus the wait ends after each summary.
      const sockets = [...open];
      const socketsClosed = sockets.map((socket) => new Promise<void>((resolve) => socket.once("close", () => resolve())));
      const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      await Promise.all([serverClosed, ...socketsClosed]);
    },
  };
}
