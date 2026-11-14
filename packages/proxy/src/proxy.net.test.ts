/**
 * These tests use real sockets on the loopback, and some measure time. Only CI starts them, in the workflow
 * `proxy-net.yml`, and `pnpm test` does not. Start them with `pnpm --filter @mark1russell7/rigor-proxy test:net`.
 */
import { createHash } from "node:crypto";
import { once } from "node:events";
import { type IncomingMessage, createServer as createHttpServer, request } from "node:http";
import { type AddressInfo, type Server, type Socket, connect, createServer } from "node:net";
import { fakeClock } from "@mark1russell7/algebra/clock";
import { type Fault, faultPlanOf } from "@mark1russell7/rigor-chaos";
import { afterEach, describe, expect, it } from "vitest";
import { type ConnectionSummary, type FaultProxy, startFaultProxy } from "./proxy.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const listen = async (server: Server): Promise<number> => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as AddressInfo).port;
};

/** A TCP server that keeps each read of each connection, and sends back what it reads when `echo` is true. */
const recorder = async (echo: boolean): Promise<{ port: number; reads: Buffer[]; sockets: Socket[] }> => {
  const reads: Buffer[] = [];
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.setNoDelay(true);
    socket.on("data", (bytes: Buffer) => {
      reads.push(bytes);
      if (echo) socket.write(bytes);
    });
    socket.on("error", () => undefined);
    socket.on("end", () => socket.end());
  });
  cleanups.push(() => {
    for (const socket of sockets) socket.destroy();
  });
  return { port: await listen(server), reads, sockets };
};

const proxy = async (port: number, faults: readonly Fault[], extra: Partial<Parameters<typeof startFaultProxy>[0]> = {}): Promise<FaultProxy> => {
  const started = await startFaultProxy({ target: { port }, plan: faultPlanOf(faults), ...extra });
  cleanups.push(() => started.close());
  return started;
};

const client = async (port: number): Promise<Socket> => {
  const socket = connect({ port, host: "127.0.0.1", noDelay: true });
  socket.on("error", () => undefined);
  await once(socket, "connect");
  cleanups.push(() => {
    socket.destroy();
  });
  return socket;
};

const until = async (test: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("the condition did not become true in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const closed = (started: FaultProxy, count = 1): Promise<readonly ConnectionSummary[]> => until(() => started.connections.length >= count).then(() => started.connections);

describe("a TCP fault proxy", () => {
  it("passes each byte with no fault, and gives a summary at the close", async () => {
    const server = await recorder(true);
    const started = await proxy(server.port, []);
    const socket = await client(started.port);
    const got: Buffer[] = [];
    socket.on("data", (bytes: Buffer) => got.push(bytes));
    socket.end("hello");
    await once(socket, "end");
    expect(Buffer.concat(got).toString()).toBe("hello");
    const [summary] = await closed(started);
    expect(summary).toEqual({ connection: 0, end: "close", bytes: { up: 5, down: 5 }, missed: [] });
  });

  it("splits a frame into writes that the server reads one by one", async () => {
    const server = await recorder(false);
    const started = await proxy(server.port, [{ connection: 0, direction: "up", at: { frame: 0 }, kind: "split", pieces: 3, gapMs: 100 }]);
    const socket = await client(started.port);
    socket.write("aaabbbccc");
    await until(() => Buffer.concat(server.reads).length === 9);
    expect(server.reads.map(String)).toEqual(["aaa", "bbb", "ccc"]);
    expect(started.records).toMatchObject([{ index: 0, connection: 0, direction: "up", kind: "split", frame: 0, byte: 0, bytes: 9 }]);
  });

  it("delays the bytes of the window by the planned time", async () => {
    const server = await recorder(true);
    const started = await proxy(server.port, [{ connection: 0, direction: "down", at: { frame: 0 }, kind: "delay", ms: 300, forMs: 1000 }]);
    const socket = await client(started.port);
    const sent = performance.now();
    socket.write("ping");
    await once(socket, "data");
    expect(performance.now() - sent).toBeGreaterThanOrEqual(295);
  });

  it("cuts the connection at a byte point with a FIN to both sides", async () => {
    const server = await recorder(false);
    const started = await proxy(server.port, [{ connection: 0, direction: "up", at: { byte: 4 }, kind: "cut" }]);
    const socket = await client(started.port);
    socket.write("abcdefgh");
    await once(socket, "end");
    await until(() => Buffer.concat(server.reads).toString() === "abcd");
    const [summary] = await closed(started);
    expect(summary?.end).toBe("cut");
    expect(started.records[0]).toMatchObject({ kind: "cut", byte: 4 });
  });

  it("resets the connection, and the client gets ECONNRESET", async () => {
    const server = await recorder(false);
    const started = await proxy(server.port, [{ connection: 0, direction: "up", at: { frame: 1 }, kind: "reset" }]);
    const socket = await client(started.port);
    const failed = new Promise<NodeJS.ErrnoException>((resolve) => socket.on("error", resolve));
    socket.write("one");
    await until(() => server.reads.length === 1);
    socket.write("two");
    expect((await failed).code).toBe("ECONNRESET");
    expect((await closed(started))[0]?.end).toBe("reset");
  });

  it("numbers the connections in the order of their accept, and reports the faults that did not occur", async () => {
    const server = await recorder(true);
    const started = await proxy(server.port, [
      { connection: 1, direction: "down", at: { frame: 0 }, kind: "duplicate", copies: 1 },
      { connection: 1, direction: "up", at: { byte: 1000 }, kind: "cut" },
    ]);
    const first = await client(started.port);
    first.end("x");
    await closed(started, 1);
    const second = await client(started.port);
    const got: Buffer[] = [];
    second.on("data", (bytes: Buffer) => got.push(bytes));
    second.end("y");
    await once(second, "end");
    expect(Buffer.concat(got).toString()).toBe("yy");
    const summaries = await closed(started, 2);
    expect(summaries[1]?.missed.map((entry) => entry.index)).toEqual([1]);
  });

  it("holds the delayed bytes until a fake clock moves", async () => {
    const clock = fakeClock();
    const server = await recorder(false);
    const started = await proxy(server.port, [{ connection: 0, direction: "up", at: { frame: 0 }, kind: "delay", ms: 1000, forMs: 1000 }], { clock });
    const socket = await client(started.port);
    socket.write("late");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.reads).toEqual([]);
    await clock.advance(1000);
    await until(() => server.reads.length === 1);
    expect(String(server.reads[0])).toBe("late");
  });

  it("stalls the reads of a direction, and the bytes after the point wait for the end of the stall", async () => {
    const server = await recorder(false);
    const started = await proxy(server.port, [{ connection: 0, direction: "up", at: { byte: 2 }, kind: "stall", ms: 300 }]);
    const socket = await client(started.port);
    const sent = performance.now();
    socket.write("abcd");
    await until(() => Buffer.concat(server.reads).length === 4);
    expect(performance.now() - sent).toBeGreaterThanOrEqual(295);
    expect(Buffer.concat(server.reads).toString()).toBe("abcd");
  });
});

describe("an HTTP fault proxy", () => {
  it("splits the head of a response, and the HTTP client still reads it", async () => {
    const server = createHttpServer((_, response) => response.end("body"));
    const port = await listen(server);
    const started = await proxy(port, [{ connection: 0, direction: "down", at: { frame: 0 }, kind: "split", pieces: 5, gapMs: 20 }], { protocol: "http" });
    const response = await new Promise<IncomingMessage>((resolve, reject) => request({ port: started.port, host: "127.0.0.1", path: "/", agent: false }, resolve).on("error", reject).end());
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(chunk as Buffer);
    expect(response.statusCode).toBe(200);
    expect(Buffer.concat(chunks).toString()).toBe("body");
    expect(started.records[0]).toMatchObject({ kind: "split", direction: "down", frame: 0 });
  });
});

describe("a WebSocket fault proxy", () => {
  it("reverses three messages of the server", async () => {
    const server = createHttpServer();
    server.on("upgrade", (incoming: IncomingMessage, socket: Socket) => {
      const accept = createHash("sha1")
        .update(`${incoming.headers["sec-websocket-key"] as string}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      for (const text of ["one", "two", "three"]) socket.write(Buffer.concat([Buffer.from([0x81, text.length]), Buffer.from(text)]));
      socket.on("error", () => undefined);
      cleanups.push(() => {
        socket.destroy();
      });
    });
    const port = await listen(server);
    // The down frame 0 is the head of the 101 response, thus the messages are the frames 1, 2 and 3.
    const started = await proxy(port, [{ connection: 0, direction: "down", at: { frame: 1 }, kind: "reorder", count: 3, holdMs: 2000 }], { protocol: "websocket" });
    const socket = new WebSocket(`ws://127.0.0.1:${started.port}/`);
    cleanups.push(() => socket.close());
    const messages: string[] = [];
    socket.addEventListener("message", (event) => messages.push(String(event.data)));
    await until(() => messages.length === 3);
    expect(messages).toEqual(["three", "two", "one"]);
    expect(started.records[0]).toMatchObject({ kind: "reorder", frame: 1 });
  });
});
