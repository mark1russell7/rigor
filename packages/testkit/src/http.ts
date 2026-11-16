import { type IncomingMessage, type ServerResponse, createServer, validateHeaderName, validateHeaderValue } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { checkWebSocketRoutes, type WebSocketConnection, type WebSocketRoute } from "./websocket.ts";

export {
  type CloseStep,
  type DestroyStep,
  type EndStep,
  type RawStep,
  type ReceiveStep,
  type ReceivedWebSocketFrame,
  type SendStep,
  type WebSocketConnection,
  type WebSocketHandshake,
  type WebSocketRoute,
  type WebSocketSession,
  type WebSocketStep,
  type WebSocketWire,
  HANDSHAKE_RESERVED_FIELDS,
  checkWebSocketHandshake,
  checkWebSocketRoutes,
  checkWebSocketStep,
  messagesOf,
  webSocketAccept,
} from "./websocket.ts";

/**
 * A scripted HTTP/1.1 server for the fixtures of a client test. Each route has a list of replies, as data. The server
 * gives the replies of a route in their order, and gives the last reply again after the end of the list. It keeps a
 * record of each request. A fault proxy of `@mark1russell7/rigor-proxy` can stand between the client and this server.
 */

/**
 * How the server marks the end of a body. `length` sends `content-length`. `chunked` sends each part of the body as
 * one chunk. `close` sends no length and closes the connection after the body. Thus with `close`, a client cannot
 * see a cut inside the body.
 */
export type Framing = "length" | "chunked" | "close";

/** These are the framings of a reply. */
export const FRAMINGS: readonly Framing[] = ["length", "chunked", "close"];

/** These field names are not fields of a reply, because the framing of the reply sets them. */
export const REPLY_RESERVED_FIELDS = ["connection", "content-length", "transfer-encoding"] as const;

/** A part of a body. The server writes a string in UTF-8. */
export type BodyPart = string | Uint8Array;

/** One reply of a route. */
export interface ScriptedReply {
  /** The status, from 200 to 599. The default is 200. */
  readonly status?: number;
  /** The fields, in their order. The names of `REPLY_RESERVED_FIELDS` are not fields. */
  readonly fields?: Readonly<Record<string, string>>;
  /** The body. A list of parts gives one write for each part, and one chunk for each part with `chunked`. */
  readonly body?: BodyPart | readonly BodyPart[];
  /** The framing of the body. The default is `length`. */
  readonly framing?: Framing;
  /** The time in ms before the head. The default is 0. */
  readonly delayMs?: number;
  /** The time in ms between two parts of the body. The default is 0. */
  readonly gapMs?: number;
  /** The server writes only this number of parts, and then it writes nothing more and keeps the connection open. */
  readonly stopAfter?: number;
}

/** A route. A request gets the replies of the first route that matches it. */
export interface ScriptedRoute {
  /** The method. The default is `GET`. */
  readonly method?: string;
  /** A path with `?` matches the whole target of a request. A path with no `?` matches the path of the target, with any query. */
  readonly path: string;
  readonly replies: readonly ScriptedReply[];
}

/** The record of one request. */
export interface ScriptedRequest {
  /** The connection of the request. The server numbers the connections from 0, in the order that it accepts them. */
  readonly connection: number;
  readonly method: string;
  /** The target of the request: the path and the query. */
  readonly target: string;
  /** The fields, with lower-case names. Repeated fields are joined with a comma. */
  readonly fields: Readonly<Record<string, string>>;
  /** The body, as UTF-8 text. */
  readonly body: string;
  /** The position of the route in the list, or -1 when no route matches. */
  readonly route: number;
  /** The position of the reply in the list of the route, or -1 when no route matches. */
  readonly reply: number;
  /** The place of the reply in the bytes that the server sent on the connection. The server fills it in as it sends. */
  readonly wire: ReplyWire;
}

/**
 * The place of one reply in the bytes that the server sent on its connection. A fault plan with a `byte` point uses it:
 * the first byte of the body is at `offset + head`. The counts come from `bytesWritten` of the socket.
 */
export interface ReplyWire {
  /** The bytes that the server sent on the connection before the reply. It is -1 before the reply starts. */
  readonly offset: number;
  /** The bytes of the status line and the fields, with the empty line after them. */
  readonly head: number;
  /** The bytes of the body on the wire. With `chunked`, they include the size lines and the last chunk. */
  readonly body: number;
  /** True when the server sent the whole reply. False before the end, and for a reply with `stopAfter`. */
  readonly whole: boolean;
}

/** The options of a scripted server. */
export interface ScriptedServerOptions {
  readonly routes: readonly ScriptedRoute[];
  /** The reply to a request that no route matches. The default is the status 404 with no body. */
  readonly unmatched?: ScriptedReply;
  /** The address of the server. The default is `127.0.0.1`, with a free port. */
  readonly listen?: { readonly host?: string; readonly port?: number };
  /**
   * The WebSocket routes. An upgrade request to `websocket` gets the sessions of the first route that matches it. These
   * routes need the optional peer `@mark1russell7/rigor-proxy`. Without them, the server does not accept an upgrade.
   */
  readonly webSockets?: readonly WebSocketRoute[];
}

/** A scripted server that listens. */
export interface ScriptedServer {
  /** The URL of the server, for example `http://127.0.0.1:41234`, with no `/` at the end. */
  readonly url: string;
  readonly host: string;
  readonly port: number;
  /** The records of the requests, in the order that the server read them whole. */
  readonly requests: readonly ScriptedRequest[];
  /** The URL of the server for a WebSocket client, for example `ws://127.0.0.1:41234`, with no `/` at the end. */
  readonly webSocketUrl: string;
  /** The records of the WebSocket connections, in the order of their upgrade requests. */
  readonly webSockets: readonly WebSocketConnection[];
  /** This method stops the server and destroys each open connection. */
  close(): Promise<void>;
}

const isWhole = (value: unknown, least: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= least;
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isPart = (value: unknown): value is BodyPart => typeof value === "string" || value instanceof Uint8Array;
const partsOf = (body: ScriptedReply["body"]): readonly BodyPart[] => (body === undefined ? [] : Array.isArray(body) ? body : [body as BodyPart]);
const noBody = (status: number): boolean => status === 204 || status === 304;

/** This function gives each problem of one reply. An empty list means that the reply is valid. */
export function checkScriptedReply(reply: ScriptedReply): readonly string[] {
  const out: string[] = [];
  const status = reply.status ?? 200;
  if (!isWhole(status, 200) || status > 599) out.push(`The status is a whole number from 200 to 599, not ${String(reply.status)}.`);
  const fields: unknown = reply.fields ?? {};
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) out.push("The fields are an object of names and values.");
  else {
    for (const [name, value] of Object.entries(fields)) {
      try {
        validateHeaderName(name);
        if (typeof value !== "string") throw new TypeError("not text");
        validateHeaderValue(name, value);
      } catch {
        out.push(`The field ${JSON.stringify(name)} with the value ${JSON.stringify(value)} is not a field of HTTP.`);
        continue;
      }
      if ((REPLY_RESERVED_FIELDS as readonly string[]).includes(name.toLowerCase())) out.push(`The reply does not set the field ${name}, because its framing sets it.`);
    }
  }
  const body: unknown = reply.body;
  const parts = Array.isArray(body) ? body : body === undefined ? [] : [body];
  if (!parts.every(isPart)) out.push("The body is text, bytes, or a list of text and bytes.");
  else if (isWhole(status, 0) && noBody(status) && parts.some((part) => part.length > 0)) out.push(`A reply with the status ${status} has no body.`);
  if (reply.framing !== undefined && !FRAMINGS.includes(reply.framing)) out.push(`The framing is one of ${FRAMINGS.join(", ")}, not ${String(reply.framing)}.`);
  if (reply.delayMs !== undefined && !isTime(reply.delayMs)) out.push(`The delayMs is a time of 0 or more, not ${String(reply.delayMs)}.`);
  if (reply.gapMs !== undefined && !isTime(reply.gapMs)) out.push(`The gapMs is a time of 0 or more, not ${String(reply.gapMs)}.`);
  if (reply.stopAfter !== undefined && !isWhole(reply.stopAfter, 0)) out.push(`The stopAfter is a whole number of 0 or more, not ${String(reply.stopAfter)}.`);
  return out;
}

/** This function gives each problem of the options of a scripted server. An empty list means that the options are valid. */
export function checkScriptedServer(options: ScriptedServerOptions): readonly string[] {
  const out: string[] = [];
  if (!Array.isArray(options.routes)) return ["The routes are a list."];
  options.routes.forEach((route, index) => {
    if (typeof route.path !== "string" || !route.path.startsWith("/")) out.push(`The route ${index}: the path starts with /, not ${JSON.stringify(route.path)}.`);
    if (route.method !== undefined) {
      try {
        validateHeaderName(route.method);
      } catch {
        out.push(`The route ${index}: the method ${JSON.stringify(route.method)} is not a token of HTTP.`);
      }
    }
    if (!Array.isArray(route.replies) || route.replies.length === 0) out.push(`The route ${index}: the replies are a list with one reply or more.`);
    else route.replies.forEach((reply: ScriptedReply, at: number) => out.push(...checkScriptedReply(reply).map((problem) => `The route ${index}, the reply ${at}: ${problem}`)));
  });
  if (options.unmatched !== undefined) out.push(...checkScriptedReply(options.unmatched).map((problem) => `The unmatched reply: ${problem}`));
  if (options.webSockets !== undefined) out.push(...checkWebSocketRoutes(options.webSockets));
  return out;
}

/** This function tells if the path of a route matches the target of a request. */
function pathMatches(path: string, target: string): boolean {
  if (path.includes("?")) return path === target;
  const query = target.indexOf("?");
  return path === (query === -1 ? target : target.slice(0, query));
}

/** This function tells if a route matches the method and the target of a request. */
function matches(route: ScriptedRoute, method: string, target: string): boolean {
  return (route.method ?? "GET").toUpperCase() === method.toUpperCase() && pathMatches(route.path, target);
}

/** This function gives the fields of a request from its raw list, with lower-case names. Repeated fields are joined with a comma. */
function fieldsOf(raw: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = (raw[i] as string).toLowerCase();
    const value = raw[i + 1] as string;
    out[name] = Object.hasOwn(out, name) ? `${out[name] as string}, ${value}` : value;
  }
  return out;
}

/**
 * This function starts a scripted server. The server reads each request whole before it replies. It throws a
 * `RangeError` for options with problems.
 */
export async function startScriptedServer(options: ScriptedServerOptions): Promise<ScriptedServer> {
  const problems = checkScriptedServer(options);
  if (problems.length > 0) throw new RangeError(`startScriptedServer: ${problems.join(" ")}`);
  const routes = options.routes;
  const unmatched: ScriptedReply = options.unmatched ?? { status: 404 };
  const counts = routes.map(() => 0);
  const requests: ScriptedRequest[] = [];
  const numbers = new WeakMap<Socket, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let next = 0;
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

  /**
   * This function writes one part and waits until Node.js gives it to the socket. Node.js 26 joins the chunked writes
   * of one tick into one chunk, so the next part waits for this callback.
   */
  const flush = (response: ServerResponse, part: Uint8Array): Promise<void> =>
    new Promise((resolve) => {
      response.once("close", resolve);
      response.write(part, () => {
        response.off("close", resolve);
        resolve();
      });
    });

  const send = async (request: IncomingMessage, response: ServerResponse, reply: ScriptedReply, wire: { -readonly [K in keyof ReplyWire]: ReplyWire[K] }): Promise<void> => {
    await wait(reply.delayMs ?? 0);
    if (stopped || response.destroyed) return;
    const socket = response.socket;
    const written = (): number => socket?.bytesWritten ?? 0;
    const status = reply.status ?? 200;
    const framing = reply.framing ?? "length";
    const parts = partsOf(reply.body).map((part) => (typeof part === "string" ? Buffer.from(part, "utf8") : part));
    const bodyless = noBody(status) || request.method === "HEAD";
    response.sendDate = false;
    for (const [name, value] of Object.entries(reply.fields ?? {})) response.setHeader(name, value);
    if (!bodyless && framing === "length") response.setHeader("content-length", parts.reduce((sum, part) => sum + part.length, 0));
    if (!bodyless && framing === "close") {
      // With no length and no chunks, the end of the connection marks the end of the body.
      response.removeHeader("content-length");
      response.removeHeader("transfer-encoding");
      response.setHeader("connection", "close");
    }
    wire.offset = written();
    response.writeHead(status);
    // The head goes out alone, so its length is known before the body.
    response.flushHeaders();
    wire.head = written() - wire.offset;
    response.once("finish", () => {
      wire.body = written() - wire.offset - wire.head;
      wire.whole = true;
    });
    if (bodyless) {
      response.end();
      return;
    }
    const count = Math.min(parts.length, reply.stopAfter ?? parts.length);
    for (let i = 0; i < count; i += 1) {
      if (i > 0) await wait(reply.gapMs ?? 0);
      if (stopped || response.destroyed) return;
      // An empty chunk ends a chunked body, thus the server does not write an empty part.
      if ((parts[i] as Uint8Array).length > 0) await flush(response, parts[i] as Uint8Array);
    }
    if (count === parts.length) response.end();
    else wire.body = written() - wire.offset - wire.head;
  };

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const method = request.method ?? "GET";
      const target = request.url ?? "/";
      const route = routes.findIndex((candidate) => matches(candidate, method, target));
      const reply = route === -1 ? -1 : Math.min(counts[route] as number, (routes[route] as ScriptedRoute).replies.length - 1);
      if (route !== -1) counts[route] = (counts[route] as number) + 1;
      const wire = { offset: -1, head: 0, body: 0, whole: false };
      requests.push({
        connection: numbers.get(request.socket) ?? -1,
        method,
        target,
        fields: fieldsOf(request.rawHeaders),
        body: Buffer.concat(chunks).toString("utf8"),
        route,
        reply,
        wire,
      });
      const chosen = route === -1 ? unmatched : ((routes[route] as ScriptedRoute).replies[reply] as ScriptedReply);
      send(request, response, chosen, wire).catch(() => response.destroy());
    });
  });
  server.on("connection", (socket: Socket) => {
    numbers.set(socket, next);
    next += 1;
  });
  server.on("clientError", (_, socket: Socket) => socket.destroy());
  const webSockets: WebSocketConnection[] = [];
  // The WebSocket module loads the optional peer rigor-proxy, thus the server loads it only for WebSocket routes.
  const host =
    options.webSockets === undefined || options.webSockets.length === 0
      ? undefined
      : (await import("./websocket-server.ts")).attachWebSockets({
          server,
          routes: options.webSockets,
          connections: webSockets,
          numberOf: (socket) => numbers.get(socket) ?? -1,
          matches: pathMatches,
          fieldsOf,
        });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listen?.port ?? 0, options.listen?.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const hostname = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: `http://${hostname}:${address.port}`,
    host: address.address,
    port: address.port,
    requests,
    webSocketUrl: `ws://${hostname}:${address.port}`,
    webSockets,
    close: () =>
      new Promise<void>((resolve) => {
        stopped = true;
        host?.stop();
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
