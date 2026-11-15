import { describe, expect, it } from "vitest";
import { type Framer, httpFramers, readHttpHead, tcpFramers, webSocketFrameLength, webSocketFramer } from "./framers.ts";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const show = (frames: readonly Uint8Array[]): string[] => frames.map((frame) => new TextDecoder("latin1").decode(frame));
const join = (frames: readonly Uint8Array[]): string => show(frames).join("");

/** This function pushes the bytes in reads of `size` bytes, and gives each frame. */
const feed = (framer: Framer, bytes: Uint8Array, size: number): Uint8Array[] => {
  const out: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) out.push(...framer.push(bytes.subarray(at, at + size)));
  return [...out, ...framer.end()];
};

/** This function makes a WebSocket frame with a payload of `length` bytes. */
const wsFrame = (length: number, masked: boolean): Uint8Array => {
  const head = length < 126 ? [0x82, length] : length < 65_536 ? [0x82, 126, length >> 8, length & 0xff] : [0x82, 127, 0, 0, 0, 0, length >>> 24, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff];
  if (masked) head[1] = (head[1] as number) | 0x80;
  const out = new Uint8Array(head.length + (masked ? 4 : 0) + length);
  out.set(head, 0);
  out.fill(7, head.length);
  return out;
};

describe("the TCP framer", () => {
  it("gives each read as one frame", () => {
    const { up } = tcpFramers();
    expect(show(up.push(text("abc")))).toEqual(["abc"]);
    expect(up.push(new Uint8Array(0))).toEqual([]);
    expect(up.end()).toEqual([]);
  });
});

describe("the WebSocket framer", () => {
  it("reads the three forms of the length, with and without a mask", () => {
    expect(webSocketFrameLength(wsFrame(5, false))).toBe(7);
    expect(webSocketFrameLength(wsFrame(5, true))).toBe(11);
    expect(webSocketFrameLength(wsFrame(300, false))).toBe(304);
    expect(webSocketFrameLength(wsFrame(70_000, true))).toBe(70_014);
    expect(webSocketFrameLength(new Uint8Array([0x82]))).toBeUndefined();
    expect(webSocketFrameLength(new Uint8Array([0x82, 126, 1]))).toBeUndefined();
    expect(webSocketFrameLength(new Uint8Array([0x82, 127, 0xff, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("gives each frame whole, for each size of read", () => {
    const frames = [wsFrame(3, true), wsFrame(200, false), wsFrame(0, false), wsFrame(70_000, false)];
    const stream = new Uint8Array(frames.reduce((sum, frame) => sum + frame.length, 0));
    let at = 0;
    for (const frame of frames) {
      stream.set(frame, at);
      at += frame.length;
    }
    for (const size of [1, 2, 3, 7, 100, 100_000]) {
      const out = feed(webSocketFramer(), stream, size);
      expect(out.map((frame) => frame.length)).toEqual(frames.map((frame) => frame.length));
    }
  });

  it("gives each read as one frame after a length that it cannot read, and keeps each byte", () => {
    const framer = webSocketFramer();
    const bad = new Uint8Array([0x82, 127, 0xff, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
    expect(framer.push(bad)).toEqual([bad]);
    expect(framer.push(new Uint8Array([9]))).toEqual([new Uint8Array([9])]);
  });
});

describe("the HTTP framers", () => {
  it("read the start line and the fields of a head", () => {
    expect(readHttpHead(text("GET /a HTTP/1.1\r\nHost: x\r\nAccept: a\r\naccept: b\r\n\r\n"))).toEqual({
      method: "GET",
      status: null,
      fields: new Map([
        ["host", "x"],
        ["accept", "a, b"],
      ]),
    });
    expect(readHttpHead(text("HTTP/1.1 204 No Content\r\n\r\n"))?.status).toBe(204);
    expect(readHttpHead(text("hello\r\n\r\n"))).toBeUndefined();
    expect(readHttpHead(text("GET / HTTP/1.1\r\nno colon\r\n\r\n"))).toBeUndefined();
  });

  it("give the head, each read of a body with a length, and each chunk", () => {
    const up = text("POST /a HTTP/1.1\r\nContent-Length: 5\r\n\r\nhelloGET /b HTTP/1.1\r\n\r\n");
    expect(show(feed(httpFramers().up, up, 1000))).toEqual(["POST /a HTTP/1.1\r\nContent-Length: 5\r\n\r\n", "hello", "GET /b HTTP/1.1\r\n\r\n"]);
    const chunked = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n";
    const body = ["5;x=1\r\nhello\r\n", "3\r\nabc\r\n", "0\r\nTrailer: t\r\n\r\n"];
    const stream = text(chunked + body.join("") + "HTTP/1.1 304 Not Modified\r\n\r\n");
    for (const size of [1, 4, 1000]) {
      const pair = httpFramers();
      pair.up.push(text("GET / HTTP/1.1\r\n\r\nGET / HTTP/1.1\r\n\r\n"));
      expect(show(feed(pair.down, stream, size))).toEqual([chunked, ...body, "HTTP/1.1 304 Not Modified\r\n\r\n"]);
    }
  });

  it("give no body to a HEAD, a 204, a 304 or a 1xx, and read a body until the close with no length", () => {
    const pair = httpFramers();
    pair.up.push(text("HEAD / HTTP/1.1\r\n\r\nGET / HTTP/1.1\r\n\r\n"));
    const down = "HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nHTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\n\r\nrest of it";
    expect(show(feed(pair.down, text(down), 1000))).toEqual(["HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\n", "HTTP/1.1 100 Continue\r\n\r\n", "HTTP/1.1 200 OK\r\n\r\n", "rest of it"]);
  });

  it("switch to WebSocket frames after a 101 to an upgrade", () => {
    const pair = httpFramers();
    const request = "GET /ws HTTP/1.1\r\nConnection: keep-alive, Upgrade\r\nUpgrade: websocket\r\n\r\n";
    expect(show(pair.up.push(text(request)))).toEqual([request]);
    const response = text("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    const first = wsFrame(4, false);
    const both = new Uint8Array(response.length + first.length);
    both.set(response, 0);
    both.set(first, response.length);
    expect(pair.down.push(both).map((frame) => frame.length)).toEqual([response.length, first.length]);
    expect(feed(pair.up, new Uint8Array([...wsFrame(2, true), ...wsFrame(3, true)]), 3).map((frame) => frame.length)).toEqual([8, 9]);
  });

  it("give each read as one frame after bytes that are not HTTP, and keep each byte", () => {
    const framer = httpFramers().up;
    const bytes = text("\x16\x03\x01 not http\r\n\r\nmore");
    expect(join(feed(framer, bytes, 4))).toBe("\x16\x03\x01 not http\r\n\r\nmore");
  });
});
