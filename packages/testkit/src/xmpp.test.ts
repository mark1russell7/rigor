import { type Socket, connect } from "node:net";
import { StringDecoder } from "node:string_decoder";
import * as tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testCertificates } from "./tls.ts";
import { type XmppServer, type XmppServerOptions, checkXmppServer, checkXmppStep, startXmppServer } from "./xmpp.ts";

const servers: XmppServer[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close();
});

const start = async (options: XmppServerOptions): Promise<XmppServer> => {
  const server = await startXmppServer(options);
  servers.push(server);
  return server;
};

// One set of certificates serves each test of this file. The client of a test trusts it with the option `ca`.
const certs = testCertificates({ names: ["example.org"] });
const account = { username: "operator", password: "a-password" };
const HEADER = "<?xml version='1.0'?><stream:stream xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' to='example.org' version='1.0'>";
const NS_TLS = "urn:ietf:params:xml:ns:xmpp-tls";
const NS_SASL = "urn:ietf:params:xml:ns:xmpp-sasl";
const NS_STREAMS = "urn:ietf:params:xml:ns:xmpp-streams";
const plain = (username: string, password: string): string => Buffer.from(`\u0000${username}\u0000${password}`, "utf8").toString("base64");
const auth = (text: string, mechanism = "PLAIN"): string => `<auth xmlns='${NS_SASL}' mechanism='${mechanism}'>${text}</auth>`;
const bind = (resource?: string): string =>
  `<iq type='set' id='b1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'>${resource === undefined ? "" : `<resource>${resource}</resource>`}</bind></iq>`;

/** A raw XMPP client: a TCP connection that can start TLS, with the text that the server sent. */
interface RawClient {
  send(data: string | Uint8Array): void;
  /** This method waits for the pattern in the text after the last match, and gives the text up to the end of the match. */
  until(pattern: RegExp, limitMs?: number): Promise<string>;
  /** This method starts TLS on the connection, as a client after `<proceed/>`. */
  upgrade(): Promise<void>;
  /** The events of the connection: `end`, `error <code>` and `close`. */
  readonly events: string[];
  readonly closed: Promise<void>;
}

const open = async (port: number): Promise<RawClient> => {
  const raw = connect({ port, host: "127.0.0.1" });
  sockets.push(raw);
  raw.setNoDelay(true);
  await new Promise<void>((resolve) => raw.once("connect", () => resolve()));
  const decoder = new StringDecoder("utf8");
  const events: string[] = [];
  let current: Socket = raw;
  let text = "";
  let mark = 0;
  const onData = (chunk: Buffer): void => {
    text += decoder.write(chunk);
  };
  const watch = (socket: Socket): void => {
    socket.on("data", onData);
    socket.on("end", () => events.push("end"));
    socket.on("error", (error: NodeJS.ErrnoException) => events.push(`error ${error.code ?? error.message}`));
  };
  watch(raw);
  const closed = new Promise<void>((resolve) =>
    raw.on("close", () => {
      events.push("close");
      resolve();
    }),
  );
  return {
    send: (data) => current.write(data),
    until: async (pattern, limitMs = 5000) => {
      const deadline = Date.now() + limitMs;
      for (;;) {
        const rest = text.slice(mark);
        const match = pattern.exec(rest);
        if (match !== null) {
          mark += match.index + match[0].length;
          return rest.slice(0, match.index + match[0].length);
        }
        if (events.includes("close") || Date.now() > deadline) throw new Error(`The server sent no ${String(pattern)}. The text is ${JSON.stringify(rest)}.`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    upgrade: async () => {
      raw.removeAllListeners("data");
      raw.removeAllListeners("end");
      const secure = tls.connect({ socket: raw, servername: "example.org", ca: certs.ca });
      watch(secure);
      current = secure;
      await new Promise<void>((resolve, reject) => {
        secure.once("secureConnect", () => resolve());
        secure.once("error", reject);
      });
    },
    events,
    closed,
  };
};

/** This function does the negotiation of a client: STARTTLS, a login and the bind. It gives the answer to the bind. */
const login = async (client: RawClient, resource?: string): Promise<string> => {
  client.send(HEADER);
  await client.until(/<\/stream:features>/);
  client.send(`<starttls xmlns='${NS_TLS}'/>`);
  await client.until(/<proceed[^>]*\/>/);
  await client.upgrade();
  client.send(HEADER);
  await client.until(/<\/stream:features>/);
  client.send(auth(plain(account.username, account.password)));
  await client.until(/<success[^>]*\/>/);
  client.send(HEADER);
  await client.until(/<\/stream:features>/);
  client.send(bind(resource));
  return client.until(/<\/iq>/);
};

describe("a scripted XMPP server", () => {
  it("does STARTTLS, the login and the bind, then the steps, with a record of each stanza and each write", async () => {
    const server = await start({
      domain: "example.org",
      tls: certs,
      accounts: [account],
      sessions: [
        {
          steps: [
            { receive: "presence" },
            { send: "<presence from='{{to}}' to='{{jid}}'/>" },
            { send: "<message to='{{bare}}'><body>{{resource}} on {{domain}}</body></message>", delayMs: 10 },
          ],
        },
      ],
    });
    expect(server.url).toBe(`xmpp://127.0.0.1:${server.port}`);
    const client = await open(server.port);
    expect(await login(client, "lab&amp;1")).toContain("<jid>operator@example.org/lab&amp;1</jid>");
    client.send("<presence to='room@conference.example.org/lab'/>");
    expect(await client.until(/<\/message>/)).toBe(
      "<presence from='room@conference.example.org/lab' to='operator@example.org/lab&amp;1'/><message to='operator@example.org'><body>lab&amp;1 on example.org</body></message>",
    );
    const record = server.connections[0];
    await vi.waitFor(() => expect(record?.wire.at(-1)?.length).toBeGreaterThan(0));
    expect(record).toMatchObject({
      connection: 0,
      session: 0,
      negotiation: ["stream", "starttls", "stream", "auth", "stream", "iq"],
      secure: true,
      username: "operator",
      sasl: "success",
      jid: "operator@example.org/lab&1",
      stanzas: [{ name: "presence", attrs: { to: "room@conference.example.org/lab" }, xml: '<presence to="room@conference.example.org/lab"/>' }],
      steps: 3,
      error: undefined,
      clientClosed: false,
      closedAt: undefined,
    });
    expect(JSON.stringify(record)).not.toContain(account.password);
    const wire = record?.wire ?? [];
    expect(wire.map((entry) => entry.step)).toEqual([-1, -1, -1, -1, -1, -1, 1, 2]);
    // The first two writes are before TLS: each length is the length of its text.
    expect(wire[0]?.length).toBe(Buffer.byteLength(wire[0]?.xml ?? ""));
    expect(wire[1]).toMatchObject({ offset: wire[0]?.length, xml: `<proceed xmlns='${NS_TLS}'/>` });
    // After TLS, the TLS records are longer than the text, and the handshake comes between the writes.
    for (const [index, entry] of wire.entries()) {
      const before = wire[index - 1];
      if (before !== undefined) expect(entry.offset).toBeGreaterThanOrEqual(before.offset + before.length);
      if (index >= 2) expect(entry.length).toBeGreaterThan(Buffer.byteLength(entry.xml));
    }
    expect(wire[2]?.offset).toBeGreaterThan((wire[1]?.offset ?? 0) + (wire[1]?.length ?? 0));
    expect(record?.stanzas[0]?.at).toBeGreaterThan(0);
  });

  it("gives the same wire to two connections of the same script, with TLS", async () => {
    const server = await start({
      domain: "example.org",
      tls: certs,
      sessions: [{ steps: [{ receive: "presence" }, { send: "<message to='{{jid}}'><body>one</body></message>" }, { send: "<message><body>two</body></message>" }] }],
    });
    for (let run = 0; run < 2; run += 1) {
      const client = await open(server.port);
      await login(client, "lab");
      client.send("<presence/>");
      await client.until(/two<\/body><\/message>/);
      await vi.waitFor(() => expect(server.connections[run]?.wire.at(-1)?.length).toBeGreaterThan(0));
    }
    const [first, second] = server.connections.map((record) => record.wire.map(({ offset, length }) => [offset, length]));
    expect(first).toHaveLength(8);
    expect(second).toEqual(first);
  });

  it("gives the sessions in their order and the last again, and with no TLS the wire counts the bytes of each text", async () => {
    const server = await start({
      domain: "example.org",
      sessions: [{ startTls: "none", steps: [{ receive: "message" }, { send: "<message><body>first</body></message>" }] }, { startTls: "none" }],
    });
    for (const expected of [0, 1, 1]) {
      const client = await open(server.port);
      client.send(HEADER);
      const features = await client.until(/<\/stream:features>/);
      expect(features).toContain(`<mechanisms xmlns='${NS_SASL}'><mechanism>PLAIN</mechanism></mechanisms>`);
      expect(features).not.toContain("starttls");
      client.send(auth(plain("anyone", "any")));
      await client.until(/<success[^>]*\/>/);
      client.send(HEADER);
      await client.until(/<\/stream:features>/);
      client.send(bind());
      expect(await client.until(/<\/iq>/)).toContain(`<jid>anyone@example.org/rigor-${server.connections.length - 1}</jid>`);
      expect(server.connections.at(-1)?.session).toBe(expected);
    }
    const [first] = server.connections;
    await vi.waitFor(() => expect(first?.wire.at(-1)?.length).toBeGreaterThan(0));
    expect(first?.wire).toHaveLength(4);
    let offset = 0;
    for (const entry of first?.wire ?? []) {
      expect(entry).toMatchObject({ offset, length: Buffer.byteLength(entry.xml) });
      offset += entry.length;
    }
  });

  it("reads a character of UTF-8 in two parts, after the bind", async () => {
    const server = await start({ domain: "example.org", sessions: [{ startTls: "none", steps: [{ receive: "message" }, { send: "<message><body>ok</body></message>" }] }] });
    const client = await open(server.port);
    client.send(HEADER);
    await client.until(/<\/stream:features>/);
    client.send(auth(plain("anyone", "any")));
    await client.until(/<success[^>]*\/>/);
    client.send(HEADER);
    await client.until(/<\/stream:features>/);
    client.send(bind());
    await client.until(/<\/iq>/);
    const bytes = Buffer.from("<message><body>é</body></message>", "utf8");
    client.send(bytes.subarray(0, 16));
    await new Promise((resolve) => setTimeout(resolve, 20));
    client.send(bytes.subarray(16));
    expect(await client.until(/<\/message>/)).toBe("<message><body>ok</body></message>");
    expect(server.connections[0]?.stanzas[0]?.xml).toBe("<message><body>é</body></message>");
  });

  it("offers STARTTLS and the login as the mode tells", async () => {
    const server = await start({
      domain: "example.org",
      tls: certs,
      sessions: [{ startTls: "required" }, { startTls: "optional" }, { startTls: "none" }],
    });
    const required = await open(server.port);
    required.send(HEADER);
    expect(await required.until(/<\/stream:features>/)).toMatch(new RegExp(`<stream:features><starttls xmlns='${NS_TLS}'><required/></starttls></stream:features>$`));
    required.send(auth(plain("anyone", "any")));
    expect(await required.until(/<\/failure>/)).toBe(`<failure xmlns='${NS_SASL}'><encryption-required/></failure>`);
    expect(server.connections[0]?.sasl).toBe("encryption-required");

    const optional = await open(server.port);
    optional.send(HEADER);
    const features = await optional.until(/<\/stream:features>/);
    expect(features).toContain(`<starttls xmlns='${NS_TLS}'></starttls><mechanisms`);
    optional.send(auth(plain("anyone", "any")));
    await optional.until(/<success[^>]*\/>/);
    expect(server.connections[1]).toMatchObject({ secure: false, sasl: "success" });

    const none = await open(server.port);
    none.send(HEADER);
    await none.until(/<\/stream:features>/);
    none.send(`<starttls xmlns='${NS_TLS}'/>`);
    expect(await none.until(/<\/stream:stream>/)).toBe(`<failure xmlns='${NS_TLS}'/></stream:stream>`);
    await none.closed;
    expect(none.events).toContain("end");
  });

  it("answers each login: the accounts, a failure of the script, a bad mechanism and a bad initial response", async () => {
    const server = await start({
      domain: "example.org",
      accounts: [account],
      sessions: [{ startTls: "none" }, { startTls: "none", sasl: { failure: "account-disabled", text: "the account is off" } }],
    });
    const answers: string[] = [];
    for (const text of [auth(plain(account.username, "wrong")), auth(plain(account.username, account.password), "SCRAM-SHA-1"), auth("eA=="), auth(plain(account.username, account.password))]) {
      const client = await open(server.port);
      client.send(HEADER);
      await client.until(/<\/stream:features>/);
      client.send(text);
      answers.push(await client.until(/<\/failure>|<success[^>]*\/>/));
    }
    expect(answers).toEqual([
      `<failure xmlns='${NS_SASL}'><not-authorized/></failure>`,
      `<failure xmlns='${NS_SASL}'><invalid-mechanism/></failure>`,
      `<failure xmlns='${NS_SASL}'><malformed-request/></failure>`,
      `<failure xmlns='${NS_SASL}'><account-disabled/><text xml:lang='en'>the account is off</text></failure>`,
    ]);
    expect(server.connections.map((record) => [record.username, record.sasl])).toEqual([
      ["operator", "not-authorized"],
      [undefined, "invalid-mechanism"],
      [undefined, "malformed-request"],
      ["operator", "account-disabled"],
    ]);
  });

  it("gives success to each login with no option accounts, and refuses each login with an empty list", async () => {
    const answers: string[] = [];
    for (const accounts of [undefined, []]) {
      const server = await start({ domain: "example.org", ...(accounts === undefined ? {} : { accounts }), sessions: [{ startTls: "none" }] });
      const client = await open(server.port);
      client.send(HEADER);
      await client.until(/<\/stream:features>/);
      client.send(auth(plain("anyone", "any-password")));
      answers.push(await client.until(/<\/failure>|<success[^>]*\/>/));
    }
    expect(answers).toEqual([`<success xmlns='${NS_SASL}'/>`, `<failure xmlns='${NS_SASL}'><not-authorized/></failure>`]);
  });

  it("sends a stream error for a wrong domain, a stanza before the bind, bad XML, a second login and a close step", async () => {
    const server = await start({
      domain: "example.org",
      tls: certs,
      sessions: [
        { startTls: "none" },
        { startTls: "none" },
        { startTls: "none" },
        { startTls: "none" },
        { steps: [{ close: { condition: "system-shutdown", text: "the server stops" }, delayMs: 10 }] },
      ],
    });
    const error = (condition: string): RegExp => new RegExp(`<stream:error><${condition} xmlns='${NS_STREAMS}'/>(<text[^>]*>[^<]*</text>)?</stream:error></stream:stream>$`);
    const wrong = await open(server.port);
    wrong.send(HEADER.replace("to='example.org'", "to='other.org'"));
    expect(await wrong.until(/<\/stream:stream>/)).toMatch(new RegExp(`^<\\?xml version='1.0'\\?><stream:stream [^>]*from='example.org'[^>]*>${error("host-unknown").source}`));

    const early = await open(server.port);
    early.send(`${HEADER}<message><body>hello</body></message>`);
    expect(await early.until(/<\/stream:stream>/)).toMatch(error("not-authorized"));

    const bad = await open(server.port);
    bad.send(`${HEADER}<a></b>`);
    expect(await bad.until(/<\/stream:stream>/)).toMatch(error("not-well-formed"));

    // A first element that is not a stream header: the server sends its header first (RFC 6120, section 4.9.1.1).
    const headless = await open(server.port);
    headless.send("<message/>");
    expect(await headless.until(/<\/stream:stream>/)).toMatch(new RegExp(`^<\\?xml version='1.0'\\?><stream:stream [^>]*>${error("not-well-formed").source}`));

    const closing = await open(server.port);
    await login(closing);
    expect(await closing.until(/<\/stream:stream>/)).toBe(
      `<stream:error><system-shutdown xmlns='${NS_STREAMS}'/><text xmlns='${NS_STREAMS}'>the server stops</text></stream:error></stream:stream>`,
    );
    await closing.closed;
    expect(server.connections.map((record) => record.error)).toEqual(["host-unknown", "not-authorized", "not-well-formed", "not-well-formed", "system-shutdown"]);
    expect(server.connections[4]?.steps).toBe(1);
    // The close event of the server socket can come after the close of the client. close() waits for it.
    await server.close();
    expect(server.connections[4]?.closedAt).toBeGreaterThan(0);
  });

  it("sends a stream error for a second login after the first", async () => {
    const server = await start({ domain: "example.org", sessions: [{ startTls: "none" }] });
    const client = await open(server.port);
    client.send(HEADER);
    await client.until(/<\/stream:features>/);
    client.send(auth(plain("anyone", "any")));
    await client.until(/<success[^>]*\/>/);
    client.send(HEADER);
    expect(await client.until(/<\/stream:features>/)).toContain("<stream:features><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/></stream:features>");
    client.send(auth(plain("anyone", "any")));
    expect(await client.until(/<\/stream:stream>/)).toBe(`<stream:error><policy-violation xmlns='${NS_STREAMS}'/></stream:error></stream:stream>`);
  });

  it("skips the stanzas that do not match a receive, fills the tokens of the match, and goes on after a limit", async () => {
    const server = await start({
      domain: "example.org",
      tls: certs,
      sessions: [
        {
          steps: [
            { receive: "iq", attrs: { type: "get" } },
            { send: "<iq type='result' id='{{id}}' to='{{to}}'/>" },
            { receive: "message", limitMs: 30 },
            { send: "<message><body>after the limit</body></message>" },
          ],
        },
      ],
    });
    const client = await open(server.port);
    await login(client);
    client.send("<presence/><iq type='set' id='s1'/><iq type='get' id='q&amp;1' to='a@example.org'/>");
    expect(await client.until(/<\/message>/)).toBe("<iq type='result' id='q&amp;1' to='a@example.org'/><message><body>after the limit</body></message>");
    const record = server.connections[0];
    expect(record?.stanzas.map((stanza) => `${stanza.name} ${stanza.attrs["type"] ?? ""}`)).toEqual(["presence ", "iq set", "iq get"]);
    expect(record?.steps).toBe(4);
  });

  it("answers the close of the client, and with answerClose false it answers no close", async () => {
    const server = await start({ domain: "example.org", tls: certs, sessions: [{}, { answerClose: false }] });
    const answered = await open(server.port);
    await login(answered);
    answered.send("</stream:stream>");
    expect(await answered.until(/<\/stream:stream>/)).toBe("</stream:stream>");
    await answered.closed;
    expect(answered.events).toContain("end");
    expect(server.connections[0]).toMatchObject({ clientClosed: true, error: undefined });

    const silent = await open(server.port);
    await login(silent);
    silent.send("</stream:stream>");
    await vi.waitFor(() => expect(server.connections[1]?.clientClosed).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(silent.until(/<\/stream:stream>/, 10)).rejects.toThrow(/sent no/);
    expect(server.connections[1]?.closedAt).toBeUndefined();
  });

  it("sends raw text, ends the connection, and resets it before and after TLS", async () => {
    const server = await start({
      domain: "example.org",
      tls: certs,
      sessions: [
        { startTls: "none", steps: [{ raw: "<message><body>a</body></mess" }, { end: true }, { send: "<message/>" }] },
        // A reset can delete the bytes that the client did not read yet, so the reset comes after a delay.
        { startTls: "none", steps: [{ destroy: true, delayMs: 20 }] },
        { steps: [{ destroy: true, delayMs: 20 }] },
      ],
    });
    const plainLogin = async (client: RawClient): Promise<void> => {
      client.send(HEADER);
      await client.until(/<\/stream:features>/);
      client.send(auth(plain("anyone", "any")));
      await client.until(/<success[^>]*\/>/);
      client.send(HEADER);
      await client.until(/<\/stream:features>/);
      client.send(bind());
      await client.until(/<\/iq>/);
    };
    const ended = await open(server.port);
    await plainLogin(ended);
    expect(await ended.until(/<\/mess/)).toBe("<message><body>a</body></mess");
    await vi.waitFor(() => expect(ended.events).toContain("end"));
    expect(server.connections[0]?.steps).toBe(2);

    const reset = await open(server.port);
    await plainLogin(reset);
    await reset.closed;
    expect(reset.events).toContain("error ECONNRESET");

    const secureReset = await open(server.port);
    await login(secureReset);
    await secureReset.closed;
    expect(secureReset.events).toContain("error ECONNRESET");
    expect(server.connections[2]).toMatchObject({ secure: true, steps: 1 });
  });

  it("destroys each open connection when the server closes", async () => {
    const server = await startXmppServer({ domain: "example.org", tls: certs, sessions: [{}] });
    const client = await open(server.port);
    await login(client);
    await server.close();
    await client.closed;
    expect(server.connections[0]?.closedAt).toBeGreaterThan(0);
  });
});

describe("the check of a scripted XMPP server", () => {
  it("states each problem of a step", () => {
    expect(checkXmppStep({ send: "<a/><b x='{{jid}}'>text</b>" })).toEqual([]);
    const problems = (step: unknown): readonly string[] => checkXmppStep(step as Parameters<typeof checkXmppStep>[0]);
    expect(problems({})).toEqual(["A step has one of send, raw, receive, close, end and destroy, not none."]);
    expect(problems({ send: "<a/>", end: true })).toEqual(["A step has one of send, raw, receive, close, end and destroy, not send and end."]);
    expect(problems({ send: "<a>" })).toEqual(["The send is one or more whole XML elements: the text does not end with a whole element."]);
    expect(problems({ send: "<a/>text" })).toEqual(["The send is one or more whole XML elements: the text does not end with a whole element."]);
    expect(problems({ send: "<a></b>" })).toEqual(["The send is one or more whole XML elements: the end tag b does not close the element a."]);
    expect(problems({ send: "<a/>{{nope}}" })).toEqual(["The send has the token {{nope}}, which is not one of jid, bare, resource, domain, id, to."]);
    expect(problems({ raw: 5 })).toEqual(["The raw is text or bytes."]);
    expect(problems({ receive: "bad name", attrs: { type: 1 }, limitMs: -1, delayMs: Number.NaN })).toEqual([
      "The delayMs is a time of 0 or more, not NaN.",
      'The receive is the name of an element, not "bad name".',
      "The attrs are an object of names and text values.",
      "The limitMs is a time of 0 or more, not -1.",
    ]);
    expect(problems({ close: { condition: "nope" } })).toEqual(['The condition is a stream error of RFC 6120, not "nope".']);
    expect(problems({ close: { text: "x" } })).toEqual(["A close with a text has a condition."]);
    expect(problems({ end: false })).toEqual(["The end is true."]);
    expect(problems({ destroy: 1 })).toEqual(["The destroy is true."]);
  });

  it("states each problem of the options, and the start throws a RangeError for them", async () => {
    expect(checkXmppServer({ domain: "example.org", tls: certs, sessions: [{}] })).toEqual([]);
    expect(checkXmppServer({ domain: "a b", sessions: [] })).toEqual([
      'The domain is a domain name with no space, @ or /, not "a b".',
      "The sessions are a list with one session or more.",
    ]);
    expect(checkXmppServer({ domain: "example.org", sessions: [{}] })).toEqual(["The session 0: A session with the startTls required needs the tls of the options."]);
    expect(checkXmppServer({ domain: "example.org", tls: { key: "x", cert: "y" }, sessions: [{ startTls: "none" }] })[0]).toMatch(/^The tls is a key and a certificate in PEM that agree: /);
    expect(
      checkXmppServer({
        domain: "example.org",
        accounts: [{ username: "a@b", password: 1 as unknown as string }],
        sessions: [{ startTls: "maybe" as "none", sasl: { failure: "nope" }, steps: [{} as { end: true }], answerClose: "yes" as unknown as boolean }],
      }),
    ).toEqual([
      "The account 0: the username is text with no space, @ or /.",
      "The account 0: the password is text.",
      "The session 0: The startTls is one of required, optional, none, not maybe.",
      'The session 0: The sasl is check or a failure of RFC 6120, not {"failure":"nope"}.',
      "The session 0: The step 0: A step has one of send, raw, receive, close, end and destroy, not none.",
      "The session 0: The answerClose is true or false.",
    ]);
    await expect(startXmppServer({ domain: "example.org", sessions: [{}] })).rejects.toThrow(RangeError);
  });
});
