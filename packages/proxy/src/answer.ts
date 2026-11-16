import type { AnswerFault } from "@mark1russell7/rigor-chaos";

/** These statuses have no body, thus their response has no `content-length`. */
const NO_BODY: ReadonlySet<number> = new Set([204, 304]);

/**
 * The reason of each status, equal to `STATUS_CODES` of `node:http` in Node.js 24. This module keeps its own table, so a
 * browser can load it, and each runtime gives the same bytes. A test compares the table with `STATUS_CODES`.
 */
export const REASONS: Readonly<Record<number, string>> = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  509: "Bandwidth Limit Exceeded",
  510: "Not Extended",
  511: "Network Authentication Required",
};

/**
 * This function gives the bytes of the HTTP/1.1 response of an `answer`. The status line has the reason of `REASONS`, or
 * no reason for a status that is not in the table. The fields go in their order. Then `content-length` and
 * `connection: close` follow. A response with the status 204 or 304 has no `content-length`.
 */
export function answerBytes(answer: Omit<AnswerFault, "kind">): Uint8Array {
  const encoder = new TextEncoder();
  const body = encoder.encode(answer.body ?? "");
  const lines = [`HTTP/1.1 ${answer.status} ${REASONS[answer.status] ?? ""}`];
  for (const [name, value] of Object.entries(answer.fields ?? {})) lines.push(`${name}: ${value}`);
  if (!NO_BODY.has(answer.status)) lines.push(`content-length: ${body.length}`);
  lines.push("connection: close");
  const head = encoder.encode(`${lines.join("\r\n")}\r\n\r\n`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}
