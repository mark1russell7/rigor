import { STATUS_CODES } from "node:http";
import type { AnswerFault } from "@mark1russell7/rigor-chaos";

/** These statuses have no body, thus their response has no `content-length`. */
const NO_BODY: ReadonlySet<number> = new Set([204, 304]);

/**
 * This function gives the bytes of the HTTP/1.1 response of an `answer`. The status line has the reason of Node.js, or
 * no reason for a status that Node.js does not know. The fields go in their order. Then `content-length` and
 * `connection: close` follow. A response with the status 204 or 304 has no `content-length`.
 */
export function answerBytes(answer: Omit<AnswerFault, "kind">): Uint8Array {
  const encoder = new TextEncoder();
  const body = encoder.encode(answer.body ?? "");
  const lines = [`HTTP/1.1 ${answer.status} ${STATUS_CODES[answer.status] ?? ""}`];
  for (const [name, value] of Object.entries(answer.fields ?? {})) lines.push(`${name}: ${value}`);
  if (!NO_BODY.has(answer.status)) lines.push(`content-length: ${body.length}`);
  lines.push("connection: close");
  const head = encoder.encode(`${lines.join("\r\n")}\r\n\r\n`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}
