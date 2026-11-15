import { once } from "node:events";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FRAMINGS, type ScriptedServer, type ScriptedServerOptions, checkScriptedReply, checkScriptedServer, startScriptedServer } from "./http.ts";

const servers: ScriptedServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

const start = async (options: ScriptedServerOptions): Promise<ScriptedServer> => {
  const server = await startScriptedServer(options);
  servers.push(server);
  return server;
};

/** This function sends raw request bytes and gives the bytes that the server sends until the connection ends. */
const exchange = async (port: number, request: string): Promise<string> => {
  const socket = connect({ port, host: "127.0.0.1" });
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  socket.write(request);
  await once(socket, "close");
  return Buffer.concat(chunks).toString("latin1");
};

const split = (raw: string): { head: string; body: string } => {
  const end = raw.indexOf("\r\n\r\n");
  return { head: raw.slice(0, end).toLowerCase(), body: raw.slice(end + 4) };
};

describe("a scripted server", () => {
  it("gives the replies of a route in their order, gives the last reply again, and records each request", async () => {
    const server = await start({
      routes: [{ path: "/alerts/active", replies: [{ body: "one" }, { status: 503, fields: { "retry-after": "30" }, body: "busy" }] }],
    });
    const got: [number, string, string | null][] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`${server.url}/alerts/active?area=KS`, { headers: { "user-agent": "test" } });
      got.push([response.status, await response.text(), response.headers.get("retry-after")]);
    }
    expect(got).toEqual([
      [200, "one", null],
      [503, "busy", "30"],
      [503, "busy", "30"],
    ]);
    expect(server.requests.map((request) => [request.method, request.target, request.route, request.reply])).toEqual([
      ["GET", "/alerts/active?area=KS", 0, 0],
      ["GET", "/alerts/active?area=KS", 0, 1],
      ["GET", "/alerts/active?area=KS", 0, 1],
    ]);
    expect(server.requests[0]?.fields["user-agent"]).toBe("test");
    // The client keeps the connection, so each reply starts where the reply before it ended.
    expect(new Set(server.requests.map((request) => request.connection)).size).toBe(1);
    const [first, second, third] = server.requests.map((request) => request.wire);
    expect(first?.offset).toBe(0);
    expect(second?.offset).toBe((first?.offset ?? 0) + (first?.head ?? 0) + (first?.body ?? 0));
    expect(third?.offset).toBe((second?.offset ?? 0) + (second?.head ?? 0) + (second?.body ?? 0));
    expect([first?.body, second?.body, first?.whole]).toEqual([3, 4, true]);
  });

  it("matches the whole target for a path with a query, the method, and gives 404 to the other requests", async () => {
    const server = await start({
      routes: [
        { path: "/a?x=1", replies: [{ body: "a" }] },
        { method: "POST", path: "/send", replies: [{ body: "sent" }] },
      ],
    });
    const status = async (path: string, init?: RequestInit): Promise<number> => (await fetch(`${server.url}${path}`, init)).status;
    expect(await status("/a?x=1")).toBe(200);
    expect(await status("/a?x=2")).toBe(404);
    expect(await status("/send")).toBe(404);
    expect(await status("/send", { method: "POST", body: "token=t&message=m" })).toBe(200);
    expect(server.requests.map((request) => [request.route, request.reply])).toEqual([
      [0, 0],
      [-1, -1],
      [-1, -1],
      [1, 0],
    ]);
    expect(server.requests[3]?.body).toBe("token=t&message=m");
  });

  it("frames a body by its length, by chunks, or by the close of the connection", async () => {
    const parts = { body: ["ab", "c"] } as const;
    const server = await start({
      routes: [
        { path: "/length", replies: [{ ...parts, framing: "length" }] },
        { path: "/chunked", replies: [{ ...parts, framing: "chunked" }] },
        { path: "/close", replies: [{ ...parts, framing: "close" }] },
      ],
    });
    const length = split(await exchange(server.port, "GET /length HTTP/1.1\r\nhost: a\r\nconnection: close\r\n\r\n"));
    expect(length.head).toContain("content-length: 3");
    expect(length.head).not.toContain("transfer-encoding");
    expect(length.body).toBe("abc");
    const chunked = split(await exchange(server.port, "GET /chunked HTTP/1.1\r\nhost: a\r\nconnection: close\r\n\r\n"));
    expect(chunked.head).toContain("transfer-encoding: chunked");
    expect(chunked.body).toBe("2\r\nab\r\n1\r\nc\r\n0\r\n\r\n");
    // The request asks to keep the connection, and the server still closes it to end the body.
    const close = split(await exchange(server.port, "GET /close HTTP/1.1\r\nhost: a\r\n\r\n"));
    expect(close.head).not.toContain("content-length");
    expect(close.head).not.toContain("transfer-encoding");
    expect(close.head).toContain("connection: close");
    expect(close.body).toBe("abc");
  });

  it("records the place of the head and the body of each reply on the wire, for each framing", async () => {
    const server = await start({ routes: FRAMINGS.map((framing) => ({ path: `/${framing}`, replies: [{ body: ["ab", "", "c"], framing }] })) });
    for (const [at, framing] of FRAMINGS.entries()) {
      const raw = await exchange(server.port, `GET /${framing} HTTP/1.1\r\nhost: a\r\nconnection: close\r\n\r\n`);
      const end = raw.indexOf("\r\n\r\n") + 4;
      const wire = server.requests[at]?.wire;
      expect(wire, framing).toEqual({ offset: 0, head: end, body: raw.length - end, whole: true });
      // A byte point at offset + head cuts the reply at the first byte of its body.
      expect(raw.slice((wire?.offset ?? 0) + (wire?.head ?? 0)), framing).toBe(framing === "chunked" ? "2\r\nab\r\n1\r\nc\r\n0\r\n\r\n" : "abc");
    }
  });

  it("writes only the parts before stopAfter, and keeps the connection open", async () => {
    const server = await start({ routes: [{ path: "/hang", replies: [{ body: ["a", "b"], stopAfter: 1 }] }] });
    const socket = connect({ port: server.port, host: "127.0.0.1" });
    let raw = "";
    socket.on("data", (chunk: Buffer) => {
      raw += chunk.toString("latin1");
    });
    socket.write("GET /hang HTTP/1.1\r\nhost: a\r\n\r\n");
    while (!raw.endsWith("\r\n\r\na")) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(socket.readyState).toBe("open");
    await server.close();
    await once(socket, "close");
    expect(split(raw)).toMatchObject({ body: "a" });
    expect(split(raw).head).toContain("content-length: 2");
    expect(server.requests[0]?.wire).toMatchObject({ offset: 0, head: raw.length - 1, body: 1, whole: false });
  });

  it("sends no body for 304, and gives the bytes of a part as they are", async () => {
    const server = await start({
      routes: [
        { path: "/same", replies: [{ status: 304, fields: { etag: '"v1"' } }] },
        { path: "/bytes", replies: [{ body: new Uint8Array([0xc3, 0xa9]), delayMs: 1 }] },
      ],
    });
    const same = await fetch(`${server.url}/same`);
    expect([same.status, same.headers.get("etag"), await same.text()]).toEqual([304, '"v1"', ""]);
    expect(await (await fetch(`${server.url}/bytes`)).text()).toBe("é");
  });
});

describe("the check of a script", () => {
  it("states each problem of a reply", () => {
    expect(checkScriptedReply({})).toEqual([]);
    expect(checkScriptedReply({ status: 101 })[0]).toMatch(/status/);
    expect(checkScriptedReply({ fields: { "Content-Length": "3" } })[0]).toMatch(/framing sets it/);
    expect(checkScriptedReply({ fields: { "bad name": "1" } })[0]).toMatch(/not a field/);
    expect(checkScriptedReply({ fields: { "x-a": "1\r\nx-b: 2" } })[0]).toMatch(/not a field/);
    expect(checkScriptedReply({ status: 304, body: "x" })[0]).toMatch(/no body/);
    expect(checkScriptedReply({ body: [1] as unknown as string[] })[0]).toMatch(/text, bytes/);
    expect(checkScriptedReply({ framing: "none" as "close" })[0]).toMatch(/framing/);
    expect(checkScriptedReply({ delayMs: -1 })[0]).toMatch(/delayMs/);
    expect(checkScriptedReply({ gapMs: Number.NaN })[0]).toMatch(/gapMs/);
    expect(checkScriptedReply({ stopAfter: 1.5 })[0]).toMatch(/stopAfter/);
  });

  it("states each problem of the routes, and the start throws a RangeError for them", async () => {
    expect(checkScriptedServer({ routes: [{ path: "a", replies: [{}] }] })[0]).toMatch(/starts with/);
    expect(checkScriptedServer({ routes: [{ path: "/a", replies: [] }] })[0]).toMatch(/one reply or more/);
    expect(checkScriptedServer({ routes: [{ method: "G T", path: "/a", replies: [{}] }] })[0]).toMatch(/method/);
    expect(checkScriptedServer({ routes: [], unmatched: { status: 99 } })[0]).toMatch(/unmatched/);
    await expect(startScriptedServer({ routes: [{ path: "/a", replies: [{ status: 700 }] }] })).rejects.toThrow(RangeError);
  });
});
