/**
 * The WebSocket routes of the scripted server of the entry `/http`, as data. These are the reply to the handshake, the
 * steps of the server and the records of each connection. This module imports no peer. The module `websocket-server.ts`
 * operates the scripts, and it loads the frame codec of `@mark1russell7/rigor-proxy`.
 */
import { createHash } from "node:crypto";
import { STATUS_CODES, validateHeaderName, validateHeaderValue } from "node:http";

/** The reply of the server to the handshake of a WebSocket connection (RFC 6455, section 4.2.2). */
export interface WebSocketHandshake {
  /**
   * The status. The default is 101. With another status, the server sends that status with no body and closes the
   * connection. Then the session has no steps.
   */
  readonly status?: number;
  /** More fields of the reply, in their order. The names of `HANDSHAKE_RESERVED_FIELDS` are not fields. */
  readonly fields?: Readonly<Record<string, string>>;
  /**
   * The field `sec-websocket-accept`. `right` is the value of RFC 6455 for the key of the request. `wrong` is the value for
   * another key. `none` sends no field. The default is `right`.
   */
  readonly accept?: "right" | "wrong" | "none";
  /** The value of the field `sec-websocket-protocol`. Without a value, the reply has no such field. */
  readonly protocol?: string;
  /** The time in ms before the reply. The default is 0. */
  readonly delayMs?: number;
}

/** These field names are not fields of a handshake, because the fields `accept` and `protocol` set them. */
export const HANDSHAKE_RESERVED_FIELDS = ["upgrade", "connection", "sec-websocket-accept", "sec-websocket-protocol", "content-length"] as const;

/**
 * The server sends one frame. A string is a text frame with the UTF-8 bytes of the string. Bytes are a binary frame.
 * `opcode`, `fin`, `rsv` and `mask` change the frame, for example a ping, a fragment or a frame with a mask.
 */
export interface SendStep {
  readonly send: string | Uint8Array;
  /** The opcode. The default is 1 for a string and 2 for bytes. */
  readonly opcode?: number;
  /** The default is `true`. */
  readonly fin?: boolean;
  /** The bits RSV1, RSV2 and RSV3 as a number from 0 to 7. The default is 0. */
  readonly rsv?: number;
  /** A masking key of 4 bytes. A server masks no frame, thus a key makes a frame that breaks RFC 6455. */
  readonly mask?: Uint8Array;
  readonly delayMs?: number;
}

/** The server sends these bytes as they are, for example a part of a frame or a frame that breaks the protocol. */
export interface RawStep {
  readonly raw: string | Uint8Array;
  readonly delayMs?: number;
}

/**
 * The server waits until it has this number of messages from the client, counted from the start of the connection. A
 * message is a text or binary frame with its continuation frames. After `limitMs`, the server goes to the next step.
 */
export interface ReceiveStep {
  readonly receive: number;
  /** The default is no limit: the server waits until the end of the connection. */
  readonly limitMs?: number;
  readonly delayMs?: number;
}

/** The server sends a close frame. With no code, the frame has no payload. */
export interface CloseStep {
  readonly close: { readonly code?: number; readonly reason?: string };
  readonly delayMs?: number;
}

/** The server closes its side of the TCP connection, with no close frame. */
export interface EndStep {
  readonly end: true;
  readonly delayMs?: number;
}

/** The server resets the TCP connection. */
export interface DestroyStep {
  readonly destroy: true;
  readonly delayMs?: number;
}

/** One step of the server on a WebSocket connection. */
export type WebSocketStep = SendStep | RawStep | ReceiveStep | CloseStep | EndStep | DestroyStep;

/** The script of one WebSocket connection. */
export interface WebSocketSession {
  /** The reply to the handshake. The default is a reply of 101 with the right accept value. */
  readonly handshake?: WebSocketHandshake;
  /** The steps of the server after the handshake, in order. After the last step, the server keeps the connection open. */
  readonly steps?: readonly WebSocketStep[];
  /** The server sends a pong with the payload of each ping of the client. The default is `true`. */
  readonly answerPing?: boolean;
  /**
   * The server answers a close frame of the client with a close frame with the same code, and then closes the TCP
   * connection. The default is `true`. With `false`, the server records the close frame and does nothing.
   */
  readonly answerClose?: boolean;
}

/** A WebSocket route. An upgrade request gets the sessions of the first route that matches its target. */
export interface WebSocketRoute {
  /** A path with `?` matches the whole target of a request. A path with no `?` matches the path of the target, with any query. */
  readonly path: string;
  /** The scripts of the connections, in their order. The server gives the last script again after the end of the list. */
  readonly sessions: readonly WebSocketSession[];
}

/** One frame that the server got from the client. */
export interface ReceivedWebSocketFrame {
  /** The time of the frame in ms after the request of the handshake. */
  readonly at: number;
  readonly fin: boolean;
  /** The bits RSV1, RSV2 and RSV3 as a number from 0 to 7. */
  readonly rsv: number;
  readonly opcode: number;
  /** The masking key, or `undefined` for a frame with no mask. A client masks each frame. */
  readonly mask: Uint8Array | undefined;
  /** The payload with no mask. */
  readonly payload: Uint8Array;
}

/** The place of the bytes of one write of the server in the bytes that the server sent on the connection. */
export interface WebSocketWire {
  /** The step of the write, or -1 for the reply to the handshake and for an answer to a ping or a close. */
  readonly step: number;
  /** The bytes that the server sent on the connection before this write. */
  readonly offset: number;
  readonly length: number;
}

/** The record of one WebSocket connection. The server fills it in while the connection is open. */
export interface WebSocketConnection {
  /** The connection. The server numbers the connections from 0, in the order that it accepts them, with the HTTP connections. */
  readonly connection: number;
  /** The target of the request of the handshake: the path and the query. */
  readonly target: string;
  /** The fields of the request of the handshake, with lower-case names. Repeated fields are joined with a comma. */
  readonly fields: Readonly<Record<string, string>>;
  /** The position of the route in the list, or -1 when no route matches. */
  readonly route: number;
  /** The position of the session in the list of the route, or -1 when no route matches. */
  readonly session: number;
  /** The frames from the client, in order. */
  readonly frames: readonly ReceivedWebSocketFrame[];
  /** The writes of the server, in order. */
  readonly wire: readonly WebSocketWire[];
  /** The steps that the server completed. */
  readonly steps: number;
  /** This value is true when the client sent bytes that are not a WebSocket frame. Then the server reset the connection. */
  readonly invalid: boolean;
  /** The time in ms after the request of the handshake when the TCP connection closed, or `undefined` while it is open. */
  readonly closedAt: number | undefined;
}

/** The GUID of RFC 6455, section 1.3, for the value of `sec-websocket-accept`. */
const ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** This function gives the value of `sec-websocket-accept` for the value of `sec-websocket-key` (RFC 6455, section 4.2.2). */
export function webSocketAccept(key: string): string {
  return createHash("sha1").update(`${key}${ACCEPT_GUID}`).digest("base64");
}

/**
 * This function gives the messages of a list of frames: the text of each text message and the bytes of each binary
 * message. A message joins a first frame and its continuation frames. The function skips control frames, a continuation
 * frame with no first frame, and a message with no last frame.
 */
export function messagesOf(frames: readonly Pick<ReceivedWebSocketFrame, "fin" | "opcode" | "payload">[]): (string | Uint8Array)[] {
  const out: (string | Uint8Array)[] = [];
  let open: { readonly opcode: number; readonly parts: Uint8Array[] } | undefined;
  for (const frame of frames) {
    if (frame.opcode >= 8) continue;
    if (frame.opcode === 1 || frame.opcode === 2) open = { opcode: frame.opcode, parts: [frame.payload] };
    else if (frame.opcode === 0 && open !== undefined) open.parts.push(frame.payload);
    else continue;
    if (!frame.fin) continue;
    const bytes = Buffer.concat(open.parts);
    out.push(open.opcode === 1 ? bytes.toString("utf8") : Uint8Array.from(bytes));
    open = undefined;
  }
  return out;
}

const isWhole = (value: unknown, least: number, most: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= least && value <= most;
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isData = (value: unknown): value is string | Uint8Array => typeof value === "string" || value instanceof Uint8Array;

/** This function gives each problem of one step. An empty list means that the step is valid. */
export function checkWebSocketStep(step: WebSocketStep): readonly string[] {
  const out: string[] = [];
  const keys = ["send", "raw", "receive", "close", "end", "destroy"].filter((key) => Object.hasOwn(step, key));
  if (keys.length !== 1) return [`A step has one of send, raw, receive, close, end and destroy, not ${keys.length === 0 ? "none" : keys.join(" and ")}.`];
  if (step.delayMs !== undefined && !isTime(step.delayMs)) out.push(`The delayMs is a time of 0 or more, not ${String(step.delayMs)}.`);
  if ("send" in step) {
    if (!isData(step.send)) out.push("The send is text or bytes.");
    if (step.opcode !== undefined && !isWhole(step.opcode, 0, 15)) out.push(`The opcode is a whole number from 0 to 15, not ${String(step.opcode)}.`);
    if (step.rsv !== undefined && !isWhole(step.rsv, 0, 7)) out.push(`The rsv is a whole number from 0 to 7, not ${String(step.rsv)}.`);
    if (step.fin !== undefined && typeof step.fin !== "boolean") out.push("The fin is true or false.");
    if (step.mask !== undefined && !(step.mask instanceof Uint8Array && step.mask.length === 4)) out.push("The mask is 4 bytes.");
  } else if ("raw" in step) {
    if (!isData(step.raw)) out.push("The raw is text or bytes.");
  } else if ("receive" in step) {
    if (!isWhole(step.receive, 1, Number.MAX_SAFE_INTEGER)) out.push(`The receive is a whole number of 1 or more, not ${String(step.receive)}.`);
    if (step.limitMs !== undefined && !isTime(step.limitMs)) out.push(`The limitMs is a time of 0 or more, not ${String(step.limitMs)}.`);
  } else if ("close" in step) {
    const { code, reason } = step.close ?? {};
    if (typeof step.close !== "object" || step.close === null) out.push("The close is an object with an optional code and reason.");
    else {
      if (code !== undefined && !isWhole(code, 0, 65_535)) out.push(`The code is a whole number from 0 to 65535, not ${String(code)}.`);
      if (reason !== undefined && typeof reason !== "string") out.push("The reason is text.");
      if (reason !== undefined && code === undefined) out.push("A close with a reason has a code.");
    }
  } else if ("end" in step) {
    if (step.end !== true) out.push("The end is true.");
  } else if ("destroy" in step && step.destroy !== true) out.push("The destroy is true.");
  return out;
}

/** This function gives each problem of the reply to a handshake. An empty list means that the reply is valid. */
export function checkWebSocketHandshake(handshake: WebSocketHandshake): readonly string[] {
  const out: string[] = [];
  const status = handshake.status ?? 101;
  if (!isWhole(status, 100, 599) || STATUS_CODES[status] === undefined) out.push(`The status is a status of HTTP from 100 to 599, not ${String(handshake.status)}.`);
  if (handshake.accept !== undefined && !["right", "wrong", "none"].includes(handshake.accept)) out.push(`The accept is right, wrong or none, not ${String(handshake.accept)}.`);
  if (handshake.delayMs !== undefined && !isTime(handshake.delayMs)) out.push(`The delayMs is a time of 0 or more, not ${String(handshake.delayMs)}.`);
  const named: Record<string, unknown> = { ...handshake.fields, ...(handshake.protocol === undefined ? {} : { "sec-websocket-protocol": handshake.protocol }) };
  for (const [name, value] of Object.entries(named)) {
    try {
      validateHeaderName(name);
      if (typeof value !== "string") throw new TypeError("not text");
      validateHeaderValue(name, value);
    } catch {
      out.push(`The field ${JSON.stringify(name)} with the value ${JSON.stringify(value)} is not a field of HTTP.`);
    }
  }
  for (const name of Object.keys(handshake.fields ?? {})) {
    if ((HANDSHAKE_RESERVED_FIELDS as readonly string[]).includes(name.toLowerCase())) out.push(`The handshake does not set the field ${name} in its fields.`);
  }
  return out;
}

/** This function gives each problem of a list of WebSocket routes. An empty list means that the routes are valid. */
export function checkWebSocketRoutes(routes: readonly WebSocketRoute[]): readonly string[] {
  if (!Array.isArray(routes)) return ["The WebSocket routes are a list."];
  const out: string[] = [];
  routes.forEach((route, index) => {
    const at = `The WebSocket route ${index}`;
    if (typeof route.path !== "string" || !route.path.startsWith("/")) out.push(`${at}: the path starts with /, not ${JSON.stringify(route.path)}.`);
    if (!Array.isArray(route.sessions) || route.sessions.length === 0) {
      out.push(`${at}: the sessions are a list with one session or more.`);
      return;
    }
    route.sessions.forEach((session: WebSocketSession, place: number) => {
      const where = `${at}, the session ${place}`;
      out.push(...checkWebSocketHandshake(session.handshake ?? {}).map((problem) => `${where}: ${problem}`));
      if (session.steps !== undefined && !Array.isArray(session.steps)) out.push(`${where}: the steps are a list.`);
      else (session.steps ?? []).forEach((step, number) => out.push(...checkWebSocketStep(step).map((problem) => `${where}, the step ${number}: ${problem}`)));
      for (const name of ["answerPing", "answerClose"] as const) {
        if (session[name] !== undefined && typeof session[name] !== "boolean") out.push(`${where}: the ${name} is true or false.`);
      }
    });
  });
  return out;
}
