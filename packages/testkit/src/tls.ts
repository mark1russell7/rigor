/**
 * The certificates of a TLS server of a test. The function `testCertificates` makes a certificate authority and a server
 * certificate in memory at the time of the test. Thus no key goes into git. The module uses only `node:crypto` and
 * `node:tls`, with no peer. It writes the DER of X.509 (RFC 5280) itself, because Node.js signs data but makes no
 * certificate.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import * as tls from "node:tls";

/** The certificates of a test: an authority and a server certificate that the authority signed. */
export interface TestCertificates {
  /** The certificate of the authority, in PEM. A client of the test trusts it. */
  readonly ca: string;
  /** The certificate of the server, in PEM. Its subject alternative names are the names of the options. */
  readonly cert: string;
  /** The private key of the server, in PEM (PKCS #8). It stays in memory. */
  readonly key: string;
}

/** The options of `testCertificates`. */
export interface TestCertificateOptions {
  /** The DNS names and the IP addresses of the server, one or more. The first name is also the common name. */
  readonly names: readonly string[];
  /** The time in ms of the start of the validity. The default is the time of the call, less one hour. */
  readonly from?: number;
  /** The days of the validity. The default is 1. */
  readonly days?: number;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
// The times of X.509: UTCTime from 1950 and GeneralizedTime with four digits up to 9999 (RFC 5280, section 4.1.2.5).
const FIRST_TIME = Date.UTC(1950, 0, 1);
const LAST_TIME = Date.UTC(9999, 11, 31, 23, 59, 59);

// The object identifiers of RFC 5280 and RFC 8410.
const ED25519 = "1.3.101.112";
const COMMON_NAME = "2.5.4.3";
const SUBJECT_KEY_ID = "2.5.29.14";
const KEY_USAGE = "2.5.29.15";
const ALT_NAME = "2.5.29.17";
const BASIC_CONSTRAINTS = "2.5.29.19";
const AUTHORITY_KEY_ID = "2.5.29.35";
const EXTENDED_KEY_USAGE = "2.5.29.37";
const SERVER_AUTH = "1.3.6.1.5.5.7.3.1";

/** This function gives the DER length of a body. */
function lengthOf(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const element = (tag: number, ...body: readonly Uint8Array[]): Buffer => {
  const content = Buffer.concat(body);
  return Buffer.concat([Buffer.from([tag]), lengthOf(content.length), content]);
};
const sequence = (...parts: readonly Uint8Array[]): Buffer => element(0x30, ...parts);
const boolean = (value: boolean): Buffer => element(0x01, Buffer.from([value ? 0xff : 0x00]));
const octets = (bytes: Uint8Array): Buffer => element(0x04, bytes);
// A positive INTEGER of DER has a first byte under 0x80.
const integer = (bytes: Uint8Array): Buffer => element(0x02, (bytes[0] ?? 0) >= 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const bits = (bytes: Uint8Array, unused = 0): Buffer => element(0x03, Buffer.from([unused]), bytes);

/** This function gives the DER of an object identifier in dotted form. */
function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const out = [40 * first + second];
  for (const arc of rest) {
    const group = [arc % 128];
    for (let high = Math.floor(arc / 128); high > 0; high = Math.floor(high / 128)) group.unshift((high % 128) | 0x80);
    out.push(...group);
  }
  return element(0x06, Buffer.from(out));
}

/** This function gives the DER of a time: UTCTime up to 2049, and GeneralizedTime after it (RFC 5280, section 4.1.2.5). */
function time(ms: number): Buffer {
  const iso = new Date(ms).toISOString();
  const digits = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return Number(iso.slice(0, 4)) < 2050 ? element(0x17, Buffer.from(digits.slice(2), "ascii")) : element(0x18, Buffer.from(digits, "ascii"));
}

const name = (common: string): Buffer => sequence(element(0x31, sequence(oid(COMMON_NAME), element(0x0c, Buffer.from(common, "utf8")))));
const extension = (id: string, critical: boolean, value: Uint8Array): Buffer => sequence(oid(id), ...(critical ? [boolean(true)] : []), octets(value));

/** This function gives the DER of one subject alternative name: an IP address or a DNS name. */
function altName(text: string): Buffer {
  if (isIPv4(text)) return element(0x87, Buffer.from(text.split(".").map(Number)));
  if (isIPv6(text)) {
    const [head = "", tail = ""] = text.split("::");
    const groups = (part: string): string[] => (part === "" ? [] : part.split(":"));
    const parts = [...groups(head), ...Array<string>(8 - groups(head).length - groups(tail).length).fill("0"), ...groups(tail)];
    return element(0x87, Buffer.from(parts.flatMap((group) => [Number.parseInt(group, 16) >> 8, Number.parseInt(group, 16) & 0xff])));
  }
  return element(0x82, Buffer.from(text, "ascii"));
}

/** This function gives the PEM text of a certificate in DER. */
function pem(der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

interface Signed {
  readonly subject: string;
  readonly issuer: string;
  readonly key: KeyObject;
  readonly signer: KeyObject;
  readonly from: number;
  readonly to: number;
  readonly extensions: readonly Buffer[];
}

/**
 * This function gives the DER of one certificate, signed with Ed25519. An Ed25519 signature has 64 bytes each time, and
 * the serial has 16 bytes. Thus each certificate of the same names has the same length, and so has the TLS handshake.
 */
function certificate(spec: Signed): Buffer {
  const algorithm = sequence(oid(ED25519));
  const serial = randomBytes(16);
  // The first byte is from 0x40 to 0x7f. Thus the INTEGER is positive and needs no zero byte, and DER does not permit a
  // first zero byte before a byte under 0x80. The serial has 16 bytes each time.
  serial[0] = 0x40 | ((serial[0] ?? 0) & 0x3f);
  const body = sequence(
    element(0xa0, integer(Buffer.from([2]))),
    integer(serial),
    algorithm,
    name(spec.issuer),
    sequence(time(spec.from), time(spec.to)),
    name(spec.subject),
    spec.key.export({ type: "spki", format: "der" }),
    element(0xa3, sequence(...spec.extensions)),
  );
  return sequence(body, algorithm, bits(sign(null, body, spec.signer)));
}

const keyId = (key: KeyObject): Buffer => createHash("sha1").update(key.export({ type: "spki", format: "der" })).digest();

/** This function gives each problem of the options of `testCertificates`. An empty list means that the options are valid. */
export function checkTestCertificateOptions(options: TestCertificateOptions): readonly string[] {
  const out: string[] = [];
  if (!Array.isArray(options.names) || options.names.length === 0) out.push("The names are a list with one name or more.");
  else {
    for (const text of options.names as readonly unknown[]) {
      // An IPv6 address with an IPv4 part, for example ::ffff:192.0.2.1, is not in this list.
      if (typeof text !== "string" || !(isIPv4(text) || (isIPv6(text) && !text.includes(".")) || /^[A-Za-z0-9*]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(text))) {
        out.push(`The name ${JSON.stringify(text)} is not a DNS name or an IP address.`);
      }
    }
  }
  const from = options.from ?? Date.now() - HOUR;
  const days = options.days ?? 1;
  const fromValid = Number.isFinite(from) && from >= FIRST_TIME && from <= LAST_TIME;
  const daysValid = Number.isFinite(days) && days > 0;
  if (!Number.isFinite(from)) out.push(`The from is a time in ms, not ${String(from)}.`);
  else if (!fromValid) out.push(`The from is a time from 1950-01-01 to 9999-12-31, not ${String(from)}.`);
  if (!daysValid) out.push(`The days are a number more than 0, not ${String(days)}.`);
  if (fromValid && daysValid && !(from + days * DAY <= LAST_TIME)) out.push("The validity ends after 9999-12-31. Use an earlier from or fewer days.");
  return out;
}

/**
 * This function makes a certificate authority and a server certificate for the names of the options. Each call makes
 * new keys. It throws a `RangeError` for options with problems.
 */
export function testCertificates(options: TestCertificateOptions): TestCertificates {
  const problems = checkTestCertificateOptions(options);
  if (problems.length > 0) throw new RangeError(`testCertificates: ${problems.join(" ")}`);
  const from = options.from ?? Date.now() - HOUR;
  const to = from + (options.days ?? 1) * DAY;
  const authority = generateKeyPairSync("ed25519");
  const server = generateKeyPairSync("ed25519");
  const issuer = "rigor-testkit test authority";
  const ca = certificate({
    subject: issuer,
    issuer,
    key: authority.publicKey,
    signer: authority.privateKey,
    from,
    to,
    extensions: [
      extension(BASIC_CONSTRAINTS, true, sequence(boolean(true))),
      // The bits keyCertSign (5) and cRLSign (6).
      extension(KEY_USAGE, true, bits(Buffer.from([0x06]), 1)),
      extension(SUBJECT_KEY_ID, false, octets(keyId(authority.publicKey))),
    ],
  });
  const leaf = certificate({
    subject: options.names[0] as string,
    issuer,
    key: server.publicKey,
    signer: authority.privateKey,
    from,
    to,
    extensions: [
      extension(BASIC_CONSTRAINTS, true, sequence()),
      // The bit digitalSignature (0).
      extension(KEY_USAGE, true, bits(Buffer.from([0x80]), 7)),
      extension(EXTENDED_KEY_USAGE, false, sequence(oid(SERVER_AUTH))),
      extension(ALT_NAME, false, sequence(...options.names.map(altName))),
      extension(SUBJECT_KEY_ID, false, octets(keyId(server.publicKey))),
      extension(AUTHORITY_KEY_ID, false, sequence(element(0x80, keyId(authority.publicKey)))),
    ],
  });
  return { ca: pem(ca), cert: pem(leaf), key: server.privateKey.export({ type: "pkcs8", format: "pem" }) as string };
}

/**
 * This function adds a certificate to the default authorities of `node:tls` in this process, and gives a function that
 * puts back the authorities from before. A client that takes no `ca` option, for example `@xmpp/client`, then trusts
 * the server of a test. It needs `tls.setDefaultCACertificates` of Node.js 22.19 or 24.5.
 *
 * Each undo function puts back the list of its call. Thus, after two calls, do the undo of the second call first.
 */
export function trustCertificate(ca: string): () => void {
  const { getCACertificates, setDefaultCACertificates } = tls as Partial<typeof tls>;
  if (getCACertificates === undefined || setDefaultCACertificates === undefined) {
    throw new Error(`trustCertificate needs tls.setDefaultCACertificates of Node.js 22.19 or 24.5. This Node.js is ${process.version}.`);
  }
  const before = getCACertificates("default");
  setDefaultCACertificates([...before, ca]);
  return () => setDefaultCACertificates(before);
}
