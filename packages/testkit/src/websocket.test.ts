import { type Socket, connect } from "node:net";
import { encodeWebSocketFrame, readWebSocketFrame, type WebSocketFrame } from "@mark1russell7/rigor-proxy/applier";
import { afterEach, describe, expect, it } from "vitest";
import { type ScriptedServer, type ScriptedServerOptions, checkScriptedServer, messagesOf, startScriptedServer, webSocketAccept } from "./http.ts";

const servers: ScriptedServer[] = [];
const sockets: Socket[] = [];
const clients: WebSocket[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close();
});

const start = async (options: ScriptedServerOptions): Promise<ScriptedServer> => {
  const server = await startScriptedServer(options);
  servers.push(server);
  return server;
};

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const key = new Uint8Array([1, 2, 3, 4]);

/** The events of a WebSocket client of Node.js, in order. */
interface ClientLog {
  readonly client: WebSocket;
  readonly events: string[];
  readonly closed: Promise<CloseEvent>;
}

/** This function starts a WebSocket client of Node.js and records its events. `onMessage` answers each message. */
const open = (url: string, onMessage?: (client: WebSocket, data: string | Uint8Array) => void, protocols?: string[]): ClientLog => {
  const client = new WebSocket(url, protocols);
  client.binaryType = "arraybuffer";
  clients.push(client);
  const events: string[] = [];
  client.addEventListener("open", () => events.push("open"));
  client.addEventListener("error", () => events.push("error"));
  client.addEventListener("message", (event: MessageEvent) => {
    const data = typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer);
    events.push(typeof data === "string" ? `text ${data}` : `binary ${[...data].join(",")}`);
    onMessage?.(client, data);
  });
  const closed = new Promise<CloseEvent>((resolve) =>
    client.addEventListener("close", (event: CloseEvent) => {
      events.push(`close ${event.code} ${event.reason}`);
      resolve(event);
    }),
  );
  return { client, events, closed };
};

/** A raw client: a TCP connection after the handshake, with the frames that the server sent. */
interface RawClient {
  readonly socket: Socket;
  readonly head: string;
  readonly frames: WebSocketFrame[];
  readonly ended: Promise<void>;
}

/** This function sends the request of a handshake on a TCP connection, and reads the frames of the server after the head. */
const raw = async (port: number, path: string): Promise<RawClient> => {
  const socket = connect({ port, host: "127.0.0.1" });
  sockets.push(socket);
  // A reset of the server gives an error on the socket. The test examines the end, not the error.
  socket.on("error", () => undefined);
  const frames: WebSocketFrame[] = [];
  let bytes = Buffer.alloc(0);
  let head = "";
  // `once` of node:events rejects on an error, thus a plain listener waits for the close.
  const ended = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  const headed = new Promise<void>((resolve) => {
    socket.on("data", (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (head === "") {
        const end = bytes.indexOf("\r\n\r\n");
        if (end === -1) return;
        head = bytes.subarray(0, end).toString("latin1");
        bytes = bytes.subarray(end + 4);
        resolve();
      }
      for (let read = readWebSocketFrame(bytes); read !== undefined && read !== null; read = readWebSocketFrame(bytes)) {
        frames.push(read.frame);
        bytes = bytes.subarray(read.length);
      }
    });
  });
  socket.write(`GET ${path} HTTP/1.1\r\nhost: 127.0.0.1\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nsec-websocket-version: 13\r\n\r\n`);
  await Promise.race([headed, ended]);
  return { socket, head, frames, ended };
};

const until = async (check: () => boolean, limitMs = 2_000): Promise<boolean> => {
  const end = performance.now() + limitMs;
  while (!check()) {
    if (performance.now() > end) return false;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return true;
};

describe("the WebSocket routes of a scripted server", () => {
  it("runs the steps of a session with a client of Node.js, and records each frame of the client", async () => {
    const server = await start({
      routes: [],
      webSockets: [
        {
          path: "/socket",
          sessions: [{ steps: [{ send: "hello" }, { receive: 1 }, { send: new Uint8Array([1, 2, 3]) }, { receive: 2 }, { close: { code: 4000, reason: "bye" } }] }],
        },
      ],
    });
    const log = open(`${server.webSocketUrl}/socket?room=1`, (client, data) => client.send(typeof data === "string" ? "a" : "b"));
    const closed = await log.closed;
    expect(log.events).toEqual(["open", "text hello", "binary 1,2,3", "close 4000 bye"]);
    expect(closed.wasClean).toBe(true);
    await until(() => server.webSockets[0]?.closedAt !== undefined);
    const record = server.webSockets[0];
    expect(record).toMatchObject({ connection: 0, target: "/socket?room=1", route: 0, session: 0, steps: 5, invalid: false });
    expect(record?.fields["sec-websocket-version"]).toBe("13");
    expect(messagesOf(record?.frames ?? [])).toEqual(["a", "b"]);
    expect(record?.frames.map((frame) => frame.opcode)).toEqual([1, 1, 8]);
    expect(record?.frames.every((frame) => frame.mask?.length === 4)).toBe(true);
    expect(record?.frames[2]?.payload.subarray(0, 2)).toEqual(new Uint8Array([0x0f, 0xa0]));
    expect(record?.wire.map((write) => write.step)).toEqual([-1, 0, 2, 4]);
    expect(record?.wire[1]).toEqual({ step: 0, offset: record?.wire[0]?.length, length: 7 });
  });

  it("gives the sessions of a route in their order and the last again, and serves HTTP routes on the same port", async () => {
    const server = await start({
      routes: [{ path: "/poll", replies: [{ body: "polled" }] }],
      webSockets: [{ path: "/socket", sessions: [{ steps: [{ send: "first" }] }, { steps: [{ send: "second" }] }] }],
    });
    expect(await (await fetch(`${server.url}/poll`)).text()).toBe("polled");
    const got: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const log = open(`${server.webSocketUrl}/socket`);
      await until(() => log.events.length >= 2);
      got.push(log.events[1] as string);
      log.client.close();
      await log.closed;
    }
    expect(got).toEqual(["text first", "text second", "text second"]);
    expect(server.webSockets.map((record) => record.session)).toEqual([0, 1, 1]);
    expect(server.requests.map((request) => request.target)).toEqual(["/poll"]);
  });

  it("writes the handshake of the script: the accept value of RFC 6455, a protocol, a refusal and a wrong value", async () => {
    expect(webSocketAccept("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    const server = await start({
      routes: [],
      webSockets: [
        { path: "/chat", sessions: [{ handshake: { protocol: "two", fields: { "x-lab": "1" } } }] },
        { path: "/refused", sessions: [{ handshake: { status: 403, fields: { "x-why": "token" } } }] },
        { path: "/wrong", sessions: [{ handshake: { accept: "wrong" } }] },
      ],
    });
    const chat = open(`${server.webSocketUrl}/chat`, undefined, ["one", "two"]);
    await until(() => chat.events.includes("open"));
    expect(chat.client.protocol).toBe("two");
    expect(server.webSockets[0]?.fields["sec-websocket-protocol"]).toBe("one, two");
    const head = (await raw(server.port, "/chat")).head.toLowerCase();
    expect(head.split("\r\n")).toEqual(expect.arrayContaining(["http/1.1 101 switching protocols", "sec-websocket-accept: s3pplmbitxaq9kygzzhzrbk+xoo=", "sec-websocket-protocol: two", "x-lab: 1"]));
    for (const path of ["/refused", "/wrong", "/nothing"]) {
      const log = open(`${server.webSocketUrl}${path}`);
      expect((await log.closed).code).toBe(1006);
      expect(log.events).not.toContain("open");
    }
    expect((await raw(server.port, "/refused")).head).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n.*x-why: token/s);
    expect(server.webSockets.at(-1)).toMatchObject({ target: "/refused", route: 1, frames: [] });
    expect(server.webSockets.find((record) => record.target === "/nothing")).toMatchObject({ route: -1, session: -1 });
  });

  it("writes each frame as the step tells: fragments, bits, a mask and raw bytes", async () => {
    const server = await start({
      routes: [],
      webSockets: [
        {
          path: "/frames",
          sessions: [{ steps: [{ send: "ab", fin: false }, { send: "cd", opcode: 0 }, { send: "x", rsv: 4, mask: key }, { send: "", opcode: 9 }, { raw: new Uint8Array([0x81, 0x01, 0x7a]) }] }],
        },
      ],
    });
    const client = await raw(server.port, "/frames");
    await until(() => client.frames.length >= 5);
    expect(client.frames.map(({ fin, rsv, opcode, mask }) => ({ fin, rsv, opcode, mask }))).toEqual([
      { fin: false, rsv: 0, opcode: 1, mask: undefined },
      { fin: true, rsv: 0, opcode: 0, mask: undefined },
      { fin: true, rsv: 4, opcode: 1, mask: key },
      { fin: true, rsv: 0, opcode: 9, mask: undefined },
      { fin: true, rsv: 0, opcode: 1, mask: undefined },
    ]);
    expect(messagesOf(client.frames)).toEqual(["abcd", "x", "z"]);
  });

  it("answers a ping and a close of the client, and with answerClose false it answers no close", async () => {
    const server = await start({
      routes: [],
      webSockets: [
        { path: "/answer", sessions: [{}] },
        { path: "/silent", sessions: [{ answerClose: false }] },
      ],
    });
    const client = await raw(server.port, "/answer");
    client.socket.write(encodeWebSocketFrame({ opcode: 9, mask: key, payload: text("p") }));
    client.socket.write(encodeWebSocketFrame({ opcode: 8, mask: key, payload: new Uint8Array([0x03, 0xe8, 0x21]) }));
    await client.ended;
    expect(client.frames.map(({ opcode, payload }) => [opcode, [...payload]])).toEqual([
      [10, [0x70]],
      [8, [0x03, 0xe8]],
    ]);
    const silent = await raw(server.port, "/silent");
    silent.socket.write(encodeWebSocketFrame({ opcode: 8, mask: key, payload: new Uint8Array([0x03, 0xe8]) }));
    await until(() => server.webSockets[1]?.frames.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(silent.frames).toEqual([]);
    expect(server.webSockets[1]?.closedAt).toBeUndefined();
  });

  it("goes on after the limit of a receive step, ends or resets the connection, and resets a client that sends no frame", async () => {
    const server = await start({
      routes: [],
      webSockets: [
        { path: "/late", sessions: [{ steps: [{ receive: 1, limitMs: 50 }, { send: "late" }] }] },
        { path: "/end", sessions: [{ steps: [{ end: true }] }] },
        { path: "/reset", sessions: [{ steps: [{ send: "one" }, { destroy: true, delayMs: 20 }] }] },
        { path: "/garbage", sessions: [{}] },
      ],
    });
    const late = open(`${server.webSocketUrl}/late`);
    await until(() => late.events.length >= 2);
    expect(late.events).toEqual(["open", "text late"]);
    const ended = open(`${server.webSocketUrl}/end`);
    expect((await ended.closed).code).toBe(1006);
    const reset = await raw(server.port, "/reset");
    await reset.ended;
    expect(messagesOf(reset.frames)).toEqual(["one"]);
    const garbage = await raw(server.port, "/garbage");
    garbage.socket.write(new Uint8Array([0x82, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0]));
    await garbage.ended;
    expect(server.webSockets.find((record) => record.target === "/garbage")).toMatchObject({ invalid: true, frames: [] });
  });

  it("destroys each open WebSocket connection when the server closes", async () => {
    const server = await startScriptedServer({ routes: [], webSockets: [{ path: "/open", sessions: [{}] }] });
    const log = open(`${server.webSocketUrl}/open`);
    await until(() => log.events.includes("open"));
    await server.close();
    expect((await log.closed).code).toBe(1006);
  });
});

describe("the check of the WebSocket routes", () => {
  it("states each problem, and the start throws a RangeError for them", async () => {
    const options = {
      routes: [],
      webSockets: [
        { path: "socket", sessions: [] },
        {
          path: "/a",
          sessions: [
            {
              handshake: { status: 99, accept: "maybe", fields: { upgrade: "h2c" } },
              steps: [{ send: "x", opcode: 16 }, { send: "x", raw: "y" }, { close: { reason: "why" } }, { receive: 0 }, { send: "x", mask: new Uint8Array(3) }],
            },
          ],
        },
      ],
    } as unknown as ScriptedServerOptions;
    expect(checkScriptedServer(options)).toEqual([
      'The WebSocket route 0: the path starts with /, not "socket".',
      "The WebSocket route 0: the sessions are a list with one session or more.",
      "The WebSocket route 1, the session 0: The status is a status of HTTP from 100 to 599, not 99.",
      "The WebSocket route 1, the session 0: The accept is right, wrong or none, not maybe.",
      "The WebSocket route 1, the session 0: The handshake does not set the field upgrade in its fields.",
      "The WebSocket route 1, the session 0, the step 0: The opcode is a whole number from 0 to 15, not 16.",
      "The WebSocket route 1, the session 0, the step 1: A step has one of send, raw, receive, close, end and destroy, not send and raw.",
      "The WebSocket route 1, the session 0, the step 2: A close with a reason has a code.",
      "The WebSocket route 1, the session 0, the step 3: The receive is a whole number of 1 or more, not 0.",
      "The WebSocket route 1, the session 0, the step 4: The mask is 4 bytes.",
    ]);
    await expect(startScriptedServer(options)).rejects.toThrow(RangeError);
    expect(checkScriptedServer({ routes: [], webSockets: [{ path: "/ok", sessions: [{ steps: [{ send: "x" }, { close: {} }] }] }] })).toEqual([]);
  });

  it("joins the fragments of a message, and skips control frames and a continuation with no first frame", () => {
    const frame = (fin: boolean, opcode: number, value: string) => ({ fin, opcode, payload: text(value) });
    expect(messagesOf([frame(true, 0, "lost"), frame(false, 1, "he"), frame(true, 9, "ping"), frame(true, 0, "llo"), frame(true, 2, "b"), frame(false, 1, "open")])).toEqual([
      "hello",
      new Uint8Array([0x62]),
    ]);
  });
});
