import { describe, expect, it } from "vitest";
import { answerBytes } from "./answer.ts";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("the bytes of an answer", () => {
  it("have the status line, the fields in their order, the length and the close", () => {
    expect(text(answerBytes({ status: 503, fields: { "retry-after": "30", "x-b": "2" }, body: "down" }))).toBe(
      "HTTP/1.1 503 Service Unavailable\r\nretry-after: 30\r\nx-b: 2\r\ncontent-length: 4\r\nconnection: close\r\n\r\ndown",
    );
  });

  it("count the length of the body in bytes of UTF-8", () => {
    expect(text(answerBytes({ status: 200, body: "é" }))).toBe("HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\né");
  });

  it("have no length for 204 and 304, and no reason for a status that is not in the table", () => {
    expect(text(answerBytes({ status: 304, fields: { etag: '"v1"' } }))).toBe('HTTP/1.1 304 Not Modified\r\netag: "v1"\r\nconnection: close\r\n\r\n');
    expect(text(answerBytes({ status: 204 }))).toBe("HTTP/1.1 204 No Content\r\nconnection: close\r\n\r\n");
    expect(text(answerBytes({ status: 599 }))).toBe("HTTP/1.1 599 \r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
  });
});
