/**
 * The WebSocket part of the scripted server of the entry `/http`. The server loads this module only for options with
 * WebSocket routes. Thus the entry `/http` needs the optional peer `@mark1russell7/rigor-proxy` only for those routes.
 * This module is not an entry of the package.
 */
import { STATUS_CODES, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import { importPeer } from "./peer.ts";
import {
  webSocketAccept,
  type ReceivedWebSocketFrame,
  type WebSocketConnection,
  type WebSocketHandshake,
  type WebSocketRoute,
  type WebSocketSession,
  type WebSocketStep,
  type WebSocketWire,
} from "./websocket.ts";

// rigor-proxy is an optional peer dependency. It has the frame codec of RFC 6455 in its entry applier.
const { encodeWebSocketFrame, readWebSocketFrame } = await importPeer(
  () => import("@mark1russell7/rigor-proxy/applier"),
  "@mark1russell7/rigor-proxy",
  "The WebSocket routes of @mark1russell7/rigor-testkit/http",
);

/** The parts of the scripted server that the WebSocket routes use. */
export interface WebSocketHostOptions {
  readonly server: Server;
  readonly routes: readonly WebSocketRoute[];
  /** The records of the connections. The host adds each connection to this list. */
  readonly connections: WebSocketConnection[];
  /** This function gives the number of a TCP connection. */
  readonly numberOf: (socket: Socket) => number;
  /** This function tells if the path of a route matches the target of a request. */
  readonly matches: (path: string, target: string) => boolean;
  /** This function gives the fields of a request from its raw list. */
  readonly fieldsOf: (raw: readonly string[]) => Record<string, string>;
}

/** The WebSocket routes on a server. */
export interface WebSocketHost {
  /** This method stops each step and destroys each WebSocket connection. */
  stop(): void;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const utf8 = (data: string | Uint8Array): Uint8Array => (typeof data === "string" ? Buffer.from(data, "utf8") : data);

/** This function gives the head of the reply to a handshake, as bytes. */
function handshakeHead(handshake: WebSocketHandshake, key: string): Uint8Array {
  const status = handshake.status ?? 101;
  const lines = [`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}`];
  if (status === 101) {
    lines.push("upgrade: websocket", "connection: Upgrade");
    const accept = handshake.accept ?? "right";
    if (accept !== "none") lines.push(`sec-websocket-accept: ${webSocketAccept(accept === "right" ? key : `${key}-wrong`)}`);
    if (handshake.protocol !== undefined) lines.push(`sec-websocket-protocol: ${handshake.protocol}`);
  }
  for (const [name, value] of Object.entries(handshake.fields ?? {})) lines.push(`${name}: ${value}`);
  if (status !== 101) lines.push("content-length: 0", "connection: close");
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "latin1");
}

/** This function gives the payload of a close frame: the code in 2 bytes and the reason in UTF-8, or no bytes. */
function closePayload(code: number | undefined, reason: string | undefined): Uint8Array {
  if (code === undefined) return new Uint8Array(0);
  const text = Buffer.from(reason ?? "", "utf8");
  const out = new Uint8Array(2 + text.length);
  out[0] = code >> 8;
  out[1] = code & 0xff;
  out.set(text, 2);
  return out;
}

/** This function adds the WebSocket routes to a server. Use it before the server listens. */
export function attachWebSockets(options: WebSocketHostOptions): WebSocketHost {
  const { routes, connections } = options;
  const counts = routes.map(() => 0);
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;

  const wait = (ms: number): Promise<void> =>
    ms <= 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          const timer = setTimeout(() => {
            timers.delete(timer);
            resolve();
          }, ms);
          timers.add(timer);
        });

  /** The waits of the receive steps. Each frame and each close wakes them. */
  const waiters = new Set<() => void>();
  const wake = (): void => {
    for (const waiter of [...waiters]) waiter();
  };

  const run = async (
    socket: Socket,
    request: IncomingMessage,
    head: Buffer,
    script: WebSocketSession,
    record: Mutable<WebSocketConnection> & { frames: ReceivedWebSocketFrame[]; wire: WebSocketWire[] },
    start: number,
  ): Promise<void> => {
    const handshake = script.handshake ?? {};
    const open = (): boolean => !stopped && !socket.destroyed && record.closedAt === undefined;
    let sent = 0;
    let serverClosed = false;
    let clientClosed = false;
    let messages = 0;
    let inMessage = false;

    /** This function writes bytes, records their place, and waits until Node.js gives them to the socket. */
    const write = (bytes: Uint8Array, step: number): Promise<void> =>
      new Promise((resolve) => {
        if (!open() || !socket.writable) {
          resolve();
          return;
        }
        record.wire.push({ step, offset: sent, length: bytes.length });
        sent += bytes.length;
        socket.write(bytes, () => resolve());
      });

    await wait(handshake.delayMs ?? 0);
    if (!open()) return;
    const key = typeof request.headers["sec-websocket-key"] === "string" ? request.headers["sec-websocket-key"] : "";
    await write(handshakeHead(handshake, key), -1);
    if ((handshake.status ?? 101) !== 101) {
      socket.end();
      return;
    }

    let buffered: Uint8Array = new Uint8Array(0);
    const take = (chunk: Uint8Array): void => {
      buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
      for (;;) {
        const read = readWebSocketFrame(buffered);
        if (read === undefined) return;
        if (read === null) {
          record.invalid = true;
          socket.resetAndDestroy();
          return;
        }
        buffered = buffered.subarray(read.length);
        const { fin, rsv, opcode, mask, payload } = read.frame;
        record.frames.push({ at: performance.now() - start, fin, rsv, opcode, mask, payload });
        // A message is a text or binary frame and its continuation frames, as `messagesOf` counts it.
        if (opcode === 1 || opcode === 2) inMessage = true;
        if (fin && inMessage && opcode <= 2) {
          messages += 1;
          inMessage = false;
        }
        if (opcode === 9 && (script.answerPing ?? true) && !serverClosed) void write(encodeWebSocketFrame({ opcode: 10, payload }), -1);
        if (opcode === 8 && !clientClosed) {
          clientClosed = true;
          if (!serverClosed && (script.answerClose ?? true)) {
            serverClosed = true;
            void write(encodeWebSocketFrame({ opcode: 8, payload: payload.subarray(0, 2) }), -1).then(() => socket.end());
          } else if (serverClosed) socket.end();
        }
        wake();
      }
    };
    socket.on("data", (chunk: Buffer) => take(chunk));
    if (head.length > 0) take(head);

    const steps: readonly WebSocketStep[] = script.steps ?? [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index] as WebSocketStep;
      await wait(step.delayMs ?? 0);
      if (!open()) return;
      if ("send" in step) {
        const opcode = step.opcode ?? (typeof step.send === "string" ? 1 : 2);
        await write(encodeWebSocketFrame({ opcode, fin: step.fin ?? true, rsv: step.rsv ?? 0, mask: step.mask, payload: utf8(step.send) }), index);
      } else if ("raw" in step) {
        await write(utf8(step.raw), index);
      } else if ("receive" in step) {
        const count = step.receive;
        const limit = step.limitMs;
        await new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const check = (): void => {
            if (messages < count && open()) return;
            waiters.delete(check);
            if (timer !== undefined) {
              clearTimeout(timer);
              timers.delete(timer);
            }
            resolve();
          };
          waiters.add(check);
          if (limit !== undefined) {
            timer = setTimeout(() => {
              waiters.delete(check);
              if (timer !== undefined) timers.delete(timer);
              resolve();
            }, limit);
            timers.add(timer);
          }
          check();
        });
      } else if ("close" in step) {
        serverClosed = true;
        await write(encodeWebSocketFrame({ opcode: 8, payload: closePayload(step.close.code, step.close.reason) }), index);
        if (clientClosed) socket.end();
      } else if ("end" in step) {
        socket.end();
      } else {
        socket.resetAndDestroy();
      }
      record.steps = index + 1;
    }
  };

  options.server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const target = request.url ?? "/";
    const route = routes.findIndex((candidate) => options.matches(candidate.path, target));
    const session = route === -1 ? -1 : Math.min(counts[route] as number, (routes[route] as WebSocketRoute).sessions.length - 1);
    if (route !== -1) counts[route] = (counts[route] as number) + 1;
    const start = performance.now();
    const record: Mutable<WebSocketConnection> & { frames: ReceivedWebSocketFrame[]; wire: WebSocketWire[] } = {
      connection: options.numberOf(socket),
      target,
      fields: options.fieldsOf(request.rawHeaders),
      route,
      session,
      frames: [],
      wire: [],
      steps: 0,
      invalid: false,
      closedAt: undefined,
    };
    connections.push(record);
    socket.on("close", () => {
      record.closedAt = performance.now() - start;
      wake();
    });
    const script: WebSocketSession = route === -1 ? { handshake: { status: 404 } } : ((routes[route] as WebSocketRoute).sessions[session] as WebSocketSession);
    run(socket, request, head, script, record, start).catch(() => socket.destroy());
  });

  return {
    stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      wake();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
  };
}
