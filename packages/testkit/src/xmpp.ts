/**
 * A scripted XMPP server for the fixtures of a client test (RFC 6120). The server does the negotiation of the stream from
 * data: STARTTLS, a login with SASL PLAIN and the bind of a resource. Then it does the steps of the script of the
 * connection. It keeps a record of each stanza of the client and of each write. A fault proxy of
 * `@mark1russell7/rigor-proxy` can stand between the client and this server. The module loads the optional peer `ltx`.
 */
import { createServer, type AddressInfo, type Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { TLSSocket, createSecureContext, type SecureContext } from "node:tls";
import { importPeer } from "./peer.ts";

// ltx is an optional peer dependency. Its stream parser reads the XML of the client, as in the client `@xmpp/client`.
// The CommonJS file of the parser has types that agree with its export. The types of the ES module file do not.
const [{ default: SaxLtx }, { Element, escapeXML }] = await importPeer(
  () => Promise.all([import("ltx/lib/parsers/ltx.js"), import("ltx")]),
  "ltx",
  "The entry /xmpp of @mark1russell7/rigor-testkit",
);

type XmlElement = InstanceType<typeof Element>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * How the server offers STARTTLS (RFC 6120, section 5). `required` offers it with `<required/>`, and it offers the login
 * only after TLS. `optional` offers STARTTLS and the login together. `none` offers no STARTTLS.
 */
export type StartTls = "required" | "optional" | "none";

/** These are the modes of STARTTLS. */
export const START_TLS_MODES: readonly StartTls[] = ["required", "optional", "none"];

/** These are the conditions of a SASL failure (RFC 6120, section 6.5). */
export const SASL_FAILURES: readonly string[] = [
  "aborted",
  "account-disabled",
  "credentials-expired",
  "encryption-required",
  "incorrect-encoding",
  "invalid-authzid",
  "invalid-mechanism",
  "malformed-request",
  "mechanism-too-weak",
  "not-authorized",
  "temporary-auth-failure",
];

/** These are the conditions of a stream error (RFC 6120, section 4.9.3). */
export const STREAM_ERRORS: readonly string[] = [
  "bad-format",
  "bad-namespace-prefix",
  "conflict",
  "connection-timeout",
  "host-gone",
  "host-unknown",
  "improper-addressing",
  "internal-server-error",
  "invalid-from",
  "invalid-namespace",
  "invalid-xml",
  "not-authorized",
  "not-well-formed",
  "policy-violation",
  "remote-connection-failed",
  "reset",
  "resource-constraint",
  "restricted-xml",
  "see-other-host",
  "system-shutdown",
  "undefined-condition",
  "unsupported-encoding",
  "unsupported-feature",
  "unsupported-stanza-type",
  "unsupported-version",
];

/**
 * These are the tokens of the text of a send step. The server puts a value in place of each `{{token}}`, as XML text.
 * `jid`, `bare` and `resource` come from the bind. `id` and `to` come from the stanza of the last receive step.
 */
export const XMPP_TOKENS: readonly string[] = ["jid", "bare", "resource", "domain", "id", "to"];

/** An account for the login with SASL PLAIN. */
export interface XmppAccount {
  readonly username: string;
  readonly password: string;
}

/**
 * The answer of the server to a login. `check` gives success when the user name and the password are an account of the
 * options. With no option `accounts`, each login gets success. An empty list refuses each login. A `failure` gives this
 * SASL failure to each login.
 */
export type SaslAnswer = "check" | { readonly failure: string; readonly text?: string };

/** The server sends one or more whole XML elements in one write. The text can hold the tokens of `XMPP_TOKENS`. */
export interface XmppSendStep {
  readonly send: string;
  readonly delayMs?: number;
}

/** The server sends this text or these bytes as they are, with no tokens. An example is XML that is not well formed. */
export interface XmppRawStep {
  readonly raw: string | Uint8Array;
  readonly delayMs?: number;
}

/**
 * The server waits for the next stanza of the client with this name and these attributes. It skips each stanza before
 * it that does not match. After `limitMs`, the server goes to the next step.
 */
export interface XmppReceiveStep {
  /** The name of the stanza, for example `presence`, `message` or `iq`. */
  readonly receive: string;
  /** The stanza has each of these attributes with the same value. */
  readonly attrs?: Readonly<Record<string, string>>;
  /** The default is no limit: the server waits until the end of the connection. */
  readonly limitMs?: number;
  readonly delayMs?: number;
}

/** The server closes the stream: a stream error with the condition, when it has one, then `</stream:stream>` and the end of TCP. */
export interface XmppCloseStep {
  readonly close: { readonly condition?: string; readonly text?: string };
  readonly delayMs?: number;
}

/** The server closes its side of the TCP connection, with no close of the stream. */
export interface XmppEndStep {
  readonly end: true;
  readonly delayMs?: number;
}

/**
 * The server resets the TCP connection. A reset can delete the bytes that the client did not read yet. Thus a reset
 * after a write needs a `delayMs`.
 */
export interface XmppDestroyStep {
  readonly destroy: true;
  readonly delayMs?: number;
}

/** One step of the server after the bind. */
export type XmppStep = XmppSendStep | XmppRawStep | XmppReceiveStep | XmppCloseStep | XmppEndStep | XmppDestroyStep;

/** The script of one connection. */
export interface XmppSession {
  /** How the server offers STARTTLS. The default is `required`. A mode other than `none` needs the `tls` of the options. */
  readonly startTls?: StartTls;
  /** The answer to each login. The default is `check`. */
  readonly sasl?: SaslAnswer;
  /** The steps of the server after the bind, in order. After the last step, the server keeps the connection open. */
  readonly steps?: readonly XmppStep[];
  /**
   * The server answers the close of the stream of the client with its own close, and then it ends the TCP connection.
   * The default is `true`. With `false`, the server records the close and does nothing.
   */
  readonly answerClose?: boolean;
}

/** The options of a scripted XMPP server. */
export interface XmppServerOptions {
  /** The domain of the server. A stream header of the client to another domain gets the stream error `host-unknown`. */
  readonly domain: string;
  /** The key and the certificate of STARTTLS, in PEM. The function `testCertificates` makes them. */
  readonly tls?: { readonly key: string; readonly cert: string };
  /**
   * The accounts of the login. With no option `accounts`, each login with SASL PLAIN gets success. An empty list refuses
   * each login.
   */
  readonly accounts?: readonly XmppAccount[];
  /** The scripts of the connections, in their order. The server gives the last script again after the end of the list. */
  readonly sessions: readonly XmppSession[];
  /** The address of the server. The default is `127.0.0.1`, with a free port. */
  readonly listen?: { readonly host?: string; readonly port?: number };
}

/** One stanza that the server got from the client after the bind. */
export interface XmppStanza {
  /** The time of the stanza in ms after the server accepted the connection. */
  readonly at: number;
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** The stanza as XML text, as `ltx` writes it. */
  readonly xml: string;
}

/**
 * The place of one write of the server in the bytes that it sent on the TCP connection. After STARTTLS, the bytes are
 * TLS records. A fault plan with a `byte` point uses the offsets. The counts come from `bytesWritten` of the TCP socket.
 */
export interface XmppWire {
  /** The step of the write, or -1 for a write of the negotiation and for the answer to a close. */
  readonly step: number;
  /** The bytes that the server sent on the TCP connection before this write. */
  readonly offset: number;
  /** The bytes of this write on the TCP connection. After STARTTLS, they include the TLS records of the write. */
  readonly length: number;
  /** The text of the write, before TLS. */
  readonly xml: string;
}

/** The record of one connection. The server fills it in while the connection is open. */
export interface XmppConnection {
  /** The connection. The server numbers the connections from 0, in the order that it accepts them. */
  readonly connection: number;
  /** The position of the script of the connection in the list of sessions. */
  readonly session: number;
  /** The names of the elements of the client before the bind, in order. Each stream header has the name `stream`. */
  readonly negotiation: readonly string[];
  /** This value is true after the TLS handshake. */
  readonly secure: boolean;
  /** The user name of the last login, or `undefined` before a login. The record keeps no password. */
  readonly username: string | undefined;
  /** The answer to the last login: `success` or the condition of the failure. It is `undefined` before a login. */
  readonly sasl: string | undefined;
  /** The full JID of the bind, or `undefined` before the bind. */
  readonly jid: string | undefined;
  /** The stanzas of the client after the bind, in order. */
  readonly stanzas: readonly XmppStanza[];
  /** The writes of the server, in order. */
  readonly wire: readonly XmppWire[];
  /** The steps that the server completed. */
  readonly steps: number;
  /** The condition of the stream error that the server sent, or `undefined`. */
  readonly error: string | undefined;
  /** This value is true after the client closed its stream. */
  readonly clientClosed: boolean;
  /** The time in ms after the accept when the TCP connection closed, or `undefined` while it is open. */
  readonly closedAt: number | undefined;
}

/** A scripted XMPP server that listens. */
export interface XmppServer {
  /** The service of the server for a client, for example `xmpp://127.0.0.1:41234`. */
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly domain: string;
  /** The records of the connections, in the order that the server accepted them. */
  readonly connections: readonly XmppConnection[];
  /** This method stops the server, destroys each open connection and waits for the close of each connection. */
  close(): Promise<void>;
}

const NS_TLS = "urn:ietf:params:xml:ns:xmpp-tls";
const NS_SASL = "urn:ietf:params:xml:ns:xmpp-sasl";
const NS_BIND = "urn:ietf:params:xml:ns:xmpp-bind";
const NS_STREAMS = "urn:ietf:params:xml:ns:xmpp-streams";
const TOKEN = /\{\{([^{}]*)\}\}/g;
const NAME = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;
// The sample values of the tokens for the check of a send step.
const SAMPLE: Readonly<Record<string, string>> = { jid: "user@example.org/r", bare: "user@example.org", resource: "r", domain: "example.org", id: "1", to: "room@example.org/r" };

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isText = (value: unknown): value is string => typeof value === "string";
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The events of the reader of one XML stream. */
interface StreamEvents {
  open(attrs: Readonly<Record<string, string>>): void;
  element(element: XmlElement): void;
  close(): void;
  fault(reason: string): void;
}

/** The reader of one XML stream. */
interface StreamReader {
  write(text: string): void;
  /** This method tells if the reader has an element with no end tag yet. */
  pending(): boolean;
}

/**
 * This function gives the reader of one XML stream. The reader tells the stream header, each whole element at the top
 * level and the close of the stream. It tells a fault for an end tag that does not match and for a bad entity. A reader
 * of a fragment reads elements with no stream header.
 */
function streamReader(events: StreamEvents, fragment = false): StreamReader {
  const parser = new SaxLtx();
  let root = fragment;
  let cursor: XmlElement | undefined;
  let failed = false;
  const fail = (reason: string): void => {
    if (failed) return;
    failed = true;
    events.fault(reason);
  };
  parser.on("startElement", (name: string, attrs: Record<string, string>) => {
    if (failed) return;
    if (!root) {
      if (name !== "stream:stream") return fail(`the first element is ${name}, not stream:stream`);
      root = true;
      return events.open(attrs);
    }
    const element = new Element(name, attrs);
    cursor = cursor === undefined ? element : cursor.cnode(element);
  });
  parser.on("endElement", (name: string) => {
    if (failed) return;
    if (cursor === undefined) return !fragment && name === "stream:stream" ? events.close() : fail(`the end tag ${name} closes no element`);
    if (name !== cursor.name) return fail(`the end tag ${name} does not close the element ${cursor.name}`);
    const parent = cursor.parent as XmlElement | null | undefined;
    if (parent === null || parent === undefined) {
      const done = cursor;
      cursor = undefined;
      return events.element(done);
    }
    cursor = parent;
  });
  parser.on("text", (text: string) => {
    if (failed) return;
    if (cursor !== undefined) cursor.t(text);
    else if (root && text.trim() !== "") fail("the stream has text outside of an element");
  });
  return {
    write: (text) => {
      if (failed) return;
      try {
        parser.write(text);
      } catch (error) {
        fail(errorText(error));
      }
    },
    pending: () => cursor !== undefined,
  };
}

/** This function gives the problem of the text of a send step, or `undefined` when the text is one or more whole elements. */
function sendProblem(text: string): string | undefined {
  const unknown = [...text.matchAll(TOKEN)].map((match) => match[1] as string).find((token) => !XMPP_TOKENS.includes(token));
  if (unknown !== undefined) return `The send has the token {{${unknown}}}, which is not one of ${XMPP_TOKENS.join(", ")}.`;
  const filled = fill(text, SAMPLE);
  let elements = 0;
  let problem: string | undefined;
  const reader = streamReader({ open: () => undefined, element: () => (elements += 1), close: () => undefined, fault: (reason) => (problem ??= reason) }, true);
  reader.write(filled);
  if (problem === undefined && (elements === 0 || reader.pending() || !filled.trimEnd().endsWith(">"))) problem = "the text does not end with a whole element";
  return problem === undefined ? undefined : `The send is one or more whole XML elements: ${problem}.`;
}

/** This function puts the value of each token in a text, as XML text. A token with no value gives empty text. */
function fill(text: string, values: Readonly<Record<string, string | undefined>>): string {
  return text.replace(TOKEN, (_, token: string) => escapeXML(values[token] ?? ""));
}

/** This function gives each problem of one step. An empty list means that the step is valid. */
export function checkXmppStep(step: XmppStep): readonly string[] {
  const keys = ["send", "raw", "receive", "close", "end", "destroy"].filter((key) => Object.hasOwn(step, key));
  if (keys.length !== 1) return [`A step has one of send, raw, receive, close, end and destroy, not ${keys.length === 0 ? "none" : keys.join(" and ")}.`];
  const out: string[] = [];
  if (step.delayMs !== undefined && !isTime(step.delayMs)) out.push(`The delayMs is a time of 0 or more, not ${String(step.delayMs)}.`);
  if ("send" in step) {
    if (!isText(step.send)) out.push("The send is text.");
    else {
      const problem = sendProblem(step.send);
      if (problem !== undefined) out.push(problem);
    }
  } else if ("raw" in step) {
    if (!(isText(step.raw) || step.raw instanceof Uint8Array)) out.push("The raw is text or bytes.");
  } else if ("receive" in step) {
    if (!isText(step.receive) || !NAME.test(step.receive)) out.push(`The receive is the name of an element, not ${JSON.stringify(step.receive)}.`);
    const attrs: unknown = step.attrs ?? {};
    if (typeof attrs !== "object" || attrs === null || Array.isArray(attrs) || !Object.values(attrs).every(isText)) out.push("The attrs are an object of names and text values.");
    if (step.limitMs !== undefined && !isTime(step.limitMs)) out.push(`The limitMs is a time of 0 or more, not ${String(step.limitMs)}.`);
  } else if ("close" in step) {
    const close: unknown = step.close;
    if (typeof close !== "object" || close === null) out.push("The close is an object with an optional condition and text.");
    else {
      const { condition, text } = close as XmppCloseStep["close"];
      if (condition !== undefined && !STREAM_ERRORS.includes(condition)) out.push(`The condition is a stream error of RFC 6120, not ${JSON.stringify(condition)}.`);
      if (text !== undefined && !isText(text)) out.push("The text is text.");
      if (text !== undefined && condition === undefined) out.push("A close with a text has a condition.");
    }
  } else if ("end" in step) {
    if (step.end !== true) out.push("The end is true.");
  } else if ("destroy" in step && step.destroy !== true) out.push("The destroy is true.");
  return out;
}

/** This function gives each problem of the script of one connection. An empty list means that the script is valid. */
function checkXmppSession(session: XmppSession, tls: boolean): readonly string[] {
  const out: string[] = [];
  const mode = session.startTls ?? "required";
  if (!START_TLS_MODES.includes(mode)) out.push(`The startTls is one of ${START_TLS_MODES.join(", ")}, not ${String(session.startTls)}.`);
  else if (mode !== "none" && !tls) out.push(`A session with the startTls ${mode} needs the tls of the options.`);
  const sasl: unknown = session.sasl ?? "check";
  if (sasl !== "check") {
    const { failure, text } = (typeof sasl === "object" && sasl !== null ? sasl : {}) as { readonly failure?: unknown; readonly text?: unknown };
    if (!isText(failure) || !SASL_FAILURES.includes(failure)) out.push(`The sasl is check or a failure of RFC 6120, not ${JSON.stringify(sasl)}.`);
    if (text !== undefined && !isText(text)) out.push("The text of the sasl failure is text.");
  }
  if (session.steps !== undefined && !Array.isArray(session.steps)) out.push("The steps are a list.");
  else (session.steps ?? []).forEach((step, number) => out.push(...checkXmppStep(step).map((problem) => `The step ${number}: ${problem}`)));
  if (session.answerClose !== undefined && typeof session.answerClose !== "boolean") out.push("The answerClose is true or false.");
  return out;
}

/** This function gives each problem of the options of a scripted XMPP server. An empty list means that the options are valid. */
export function checkXmppServer(options: XmppServerOptions): readonly string[] {
  const out: string[] = [];
  if (!isText(options.domain) || !/^[^\s@/]+$/.test(options.domain)) out.push(`The domain is a domain name with no space, @ or /, not ${JSON.stringify(options.domain)}.`);
  if (options.tls !== undefined) {
    try {
      createSecureContext({ key: options.tls.key, cert: options.tls.cert });
    } catch (error) {
      out.push(`The tls is a key and a certificate in PEM that agree: ${errorText(error)}.`);
    }
  }
  if (options.accounts !== undefined) {
    if (!Array.isArray(options.accounts)) out.push("The accounts are a list.");
    else {
      options.accounts.forEach((account: XmppAccount, index: number) => {
        if (!isText(account.username) || !/^[^\s@/]+$/.test(account.username)) out.push(`The account ${index}: the username is text with no space, @ or /.`);
        if (!isText(account.password)) out.push(`The account ${index}: the password is text.`);
      });
    }
  }
  if (!Array.isArray(options.sessions) || options.sessions.length === 0) out.push("The sessions are a list with one session or more.");
  else options.sessions.forEach((session: XmppSession, index: number) => out.push(...checkXmppSession(session, options.tls !== undefined).map((problem) => `The session ${index}: ${problem}`)));
  return out;
}

/** This function gives the user name and the password of the initial response of SASL PLAIN (RFC 4616), or `undefined`. */
function plainOf(text: string): XmppAccount | undefined {
  const parts = Buffer.from(text.trim(), "base64").toString("utf8").split("\u0000");
  if (parts.length !== 3 || parts[1] === "") return undefined;
  return { username: parts[1] as string, password: parts[2] as string };
}

/**
 * This function starts a scripted XMPP server. The server reads the XML of the client as a stream, and it answers each
 * element of the negotiation at once. It throws a `RangeError` for options with problems.
 */
export async function startXmppServer(options: XmppServerOptions): Promise<XmppServer> {
  const problems = checkXmppServer(options);
  if (problems.length > 0) throw new RangeError(`startXmppServer: ${problems.join(" ")}`);
  const { domain, sessions, accounts } = options;
  const context: SecureContext | undefined = options.tls === undefined ? undefined : createSecureContext({ key: options.tls.key, cert: options.tls.cert });
  const connections: XmppConnection[] = [];
  const sockets = new Set<Socket>();
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

  const accept = (raw: Socket): void => {
    const number = next;
    next += 1;
    const place = Math.min(number, sessions.length - 1);
    const script = sessions[place] as XmppSession;
    const mode = script.startTls ?? "required";
    const start = performance.now();
    const negotiation: string[] = [];
    const stanzas: XmppStanza[] = [];
    const wire: Mutable<XmppWire>[] = [];
    const record: Mutable<XmppConnection> = {
      connection: number,
      session: place,
      negotiation,
      secure: false,
      username: undefined,
      sasl: undefined,
      jid: undefined,
      stanzas,
      wire,
      steps: 0,
      error: undefined,
      clientClosed: false,
      closedAt: undefined,
    };
    connections.push(record);
    sockets.add(raw);
    raw.setNoDelay(true);
    let secure: TLSSocket | undefined;
    let authenticated = false;
    let serverClosed = false;
    let streams = 0;
    let headerSent = false;
    let generation = 0;
    let decoder = new StringDecoder("utf8");
    let reader: StreamReader;
    let wake: (() => void) | undefined;
    let chain = Promise.resolve();
    const tokens: Record<string, string | undefined> = { domain };

    const open = (): boolean => !stopped && record.closedAt === undefined && !raw.destroyed;
    const notify = (): void => {
      const resolve = wake;
      wake = undefined;
      resolve?.();
    };

    /** This function writes one text after the writes before it, and records its place on the wire. */
    const write = (data: string | Uint8Array, step: number): Promise<void> => {
      chain = chain.then(
        () =>
          new Promise<void>((resolve) => {
            if (!open()) return resolve();
            const entry = { step, offset: raw.bytesWritten, length: 0, xml: typeof data === "string" ? data : Buffer.from(data).toString("utf8") };
            wire.push(entry);
            (secure ?? raw).write(data, () => {
              entry.length = raw.bytesWritten - entry.offset;
              resolve();
            });
          }),
      );
      return chain;
    };
    const end = (): void => {
      if (open()) (secure ?? raw).end();
    };
    // After STARTTLS, the TLS socket holds the handle of TCP. Then a reset of the raw socket can fail, and a destroy follows.
    const reset = (): void => {
      try {
        raw.resetAndDestroy();
      } catch {
        raw.destroy();
      }
      secure?.destroy();
    };
    const header = (): string =>
      `<?xml version='1.0'?><stream:stream xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0' from='${escapeXML(domain)}' id='rigor-${number}-${streams}' xml:lang='en'>`;
    // RFC 6120, section 4.9.1.1: a server that has not sent the header of the stream sends it before the error.
    const errorXml = (condition: string, text?: string): string => {
      record.error = condition;
      serverClosed = true;
      const detail = text === undefined ? "" : `<text xmlns='${NS_STREAMS}'>${escapeXML(text)}</text>`;
      const head = headerSent ? "" : header();
      headerSent = true;
      return `${head}<stream:error><${condition} xmlns='${NS_STREAMS}'/>${detail}</stream:error></stream:stream>`;
    };
    const streamError = (condition: string, text?: string): void => {
      void write(errorXml(condition, text), -1).then(end);
    };

    const features = (): string => {
      const parts: string[] = [];
      if (secure === undefined && mode !== "none") parts.push(`<starttls xmlns='${NS_TLS}'>${mode === "required" ? "<required/>" : ""}</starttls>`);
      if (!authenticated && (mode !== "required" || secure !== undefined)) parts.push(`<mechanisms xmlns='${NS_SASL}'><mechanism>PLAIN</mechanism></mechanisms>`);
      if (authenticated) parts.push(`<bind xmlns='${NS_BIND}'/>`);
      return `<stream:features>${parts.join("")}</stream:features>`;
    };
    const opened = (attrs: Readonly<Record<string, string>>): void => {
      negotiation.push("stream");
      streams += 1;
      if (attrs["to"] !== domain) return streamError("host-unknown");
      headerSent = true;
      void write(`${header()}${features()}`, -1);
    };

    const startTls = (): void => {
      if (mode === "none" || secure !== undefined || context === undefined) {
        serverClosed = true;
        void write(`<failure xmlns='${NS_TLS}'/></stream:stream>`, -1).then(end);
        return;
      }
      // The bytes after <proceed/> are TLS records. The raw socket keeps them until the TLS socket reads them.
      raw.off("data", onRaw);
      raw.pause();
      void write(`<proceed xmlns='${NS_TLS}'/>`, -1).then(() => {
        if (!open()) return;
        const tls = new TLSSocket(raw, { isServer: true, secureContext: context });
        secure = tls;
        tls.on("secure", () => (record.secure = true));
        tls.on("error", () => raw.destroy());
        tls.on("close", closed);
        restart();
        tls.on("data", (chunk: Buffer) => reader.write(decoder.write(chunk)));
      });
    };
    const login = (element: XmlElement): void => {
      const fail = (condition: string, text?: string): void => {
        record.sasl = condition;
        const detail = text === undefined ? "" : `<text xml:lang='en'>${escapeXML(text)}</text>`;
        void write(`<failure xmlns='${NS_SASL}'><${condition}/>${detail}</failure>`, -1);
      };
      if (authenticated) return streamError("policy-violation");
      if (mode === "required" && secure === undefined) return fail("encryption-required");
      if (element.attrs["mechanism"] !== "PLAIN") return fail("invalid-mechanism");
      const given = plainOf(element.getText());
      if (given === undefined) return fail("malformed-request");
      record.username = given.username;
      const answer = script.sasl ?? "check";
      if (answer !== "check") return fail(answer.failure, answer.text);
      if (accounts !== undefined && !accounts.some((account) => account.username === given.username && account.password === given.password)) return fail("not-authorized");
      authenticated = true;
      record.sasl = "success";
      void write(`<success xmlns='${NS_SASL}'/>`, -1);
      restart();
    };
    const bind = (element: XmlElement): void => {
      const asked = element.getChild("bind", NS_BIND)?.getChildText("resource") ?? "";
      const resource = asked === "" ? `rigor-${number}` : asked;
      const bare = `${record.username as string}@${domain}`;
      const jid = `${bare}/${resource}`;
      record.jid = jid;
      Object.assign(tokens, { jid, bare, resource });
      const id = escapeXML(String(element.attrs["id"] ?? ""));
      void write(`<iq type='result' id='${id}'><bind xmlns='${NS_BIND}'><jid>${escapeXML(jid)}</jid></bind></iq>`, -1).then(() => run().catch(() => raw.destroy()));
    };

    const element = (stanza: XmlElement): void => {
      if (record.jid !== undefined) {
        const attrs: Record<string, string> = Object.fromEntries(Object.entries(stanza.attrs).map(([name, value]) => [name, String(value)]));
        stanzas.push({ at: performance.now() - start, name: stanza.name, attrs, xml: stanza.toString() });
        return notify();
      }
      negotiation.push(stanza.name);
      const xmlns = stanza.attrs["xmlns"];
      if (stanza.name === "starttls" && xmlns === NS_TLS) return startTls();
      if (stanza.name === "auth" && xmlns === NS_SASL) return login(stanza);
      if (authenticated && stanza.name === "iq" && stanza.attrs["type"] === "set" && stanza.getChild("bind", NS_BIND) !== undefined) return bind(stanza);
      // RFC 6120, section 4.9.3.12: an element before the login and the bind gets the stream error not-authorized.
      streamError("not-authorized");
    };
    const clientClose = (): void => {
      record.clientClosed = true;
      notify();
      if (serverClosed) return end();
      if (script.answerClose ?? true) {
        serverClosed = true;
        void write("</stream:stream>", -1).then(end);
      }
    };
    const restart = (): void => {
      generation += 1;
      headerSent = false;
      const mine = generation;
      const current = (): boolean => mine === generation && !serverClosed;
      decoder = new StringDecoder("utf8");
      reader = streamReader({
        open: (attrs) => current() && opened(attrs),
        element: (stanza) => current() && element(stanza),
        close: () => mine === generation && clientClose(),
        fault: (reason) => current() && streamError("not-well-formed", reason),
      });
    };

    /** This function waits for the next stanza after `cursor` that matches the step, or for the limit of the step. */
    let cursor = 0;
    const take = async (step: XmppReceiveStep): Promise<XmppStanza | undefined> => {
      const deadline = step.limitMs === undefined ? undefined : performance.now() + step.limitMs;
      for (;;) {
        const index = stanzas.findIndex((stanza, at) => at >= cursor && stanza.name === step.receive && Object.entries(step.attrs ?? {}).every(([name, value]) => stanza.attrs[name] === value));
        if (index !== -1) {
          cursor = index + 1;
          return stanzas[index];
        }
        if (!open() || record.clientClosed) return undefined;
        const left = deadline === undefined ? undefined : deadline - performance.now();
        if (left !== undefined && left <= 0) return undefined;
        await new Promise<void>((resolve) => {
          wake = resolve;
          if (left === undefined) return;
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (wake === resolve) wake = undefined;
            resolve();
          }, left);
          timers.add(timer);
        });
      }
    };
    const run = async (): Promise<void> => {
      const steps = script.steps ?? [];
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i] as XmppStep;
        await wait(step.delayMs ?? 0);
        if (!open()) return;
        if ("send" in step) await write(fill(step.send, tokens), i);
        else if ("raw" in step) await write(step.raw, i);
        else if ("receive" in step) {
          const stanza = await take(step);
          if (stanza !== undefined) Object.assign(tokens, { id: stanza.attrs["id"], to: stanza.attrs["to"] });
          if (!open()) return;
        } else if ("close" in step) {
          serverClosed = true;
          const { condition, text } = step.close;
          await write(condition === undefined ? "</stream:stream>" : errorXml(condition, text), i);
          end();
        } else if ("end" in step) end();
        else reset();
        record.steps = i + 1;
        // A close, an end and a reset end the connection, so the steps after them do not occur.
        if ("close" in step || "end" in step || "destroy" in step) return;
      }
    };

    const closed = (): void => {
      record.closedAt ??= performance.now() - start;
      sockets.delete(raw);
      notify();
    };
    const onRaw = (chunk: Buffer): void => reader.write(decoder.write(chunk));
    raw.on("error", () => raw.destroy());
    raw.on("close", closed);
    restart();
    raw.on("data", onRaw);
  };

  const server = createServer(accept);
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
    url: `xmpp://${hostname}:${address.port}`,
    host: address.address,
    port: address.port,
    domain,
    connections,
    close: async () => {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      // The close event of a socket comes after the close event of its client. Thus the method waits for each, and
      // after it, each record has its `closedAt`.
      const each = [...sockets].map((socket) => new Promise<void>((resolve) => socket.once("close", () => resolve())));
      for (const socket of sockets) socket.destroy();
      await Promise.all([...each, new Promise<void>((resolve) => server.close(() => resolve()))]);
    },
  };
}
