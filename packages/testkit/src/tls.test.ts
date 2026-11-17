import { X509Certificate, createPrivateKey } from "node:crypto";
import { type AddressInfo, createServer } from "node:net";
import * as tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkTestCertificateOptions, testCertificates, trustCertificate } from "./tls.ts";

// A fill byte makes each random byte of the module equal to it. With no fill, the bytes are random.
const random = vi.hoisted(() => ({ fill: undefined as number | undefined }));
vi.mock("node:crypto", async (original) => {
  const crypto = await original<typeof import("node:crypto")>();
  return { ...crypto, randomBytes: (size: number) => (random.fill === undefined ? crypto.randomBytes(size) : Buffer.alloc(size, random.fill)) };
});

const undo: (() => void)[] = [];
afterEach(() => {
  for (const step of undo.splice(0)) step();
  random.fill = undefined;
});

/** This function connects a TLS client to a TLS server of the certificates, and gives the result of the handshake. */
async function handshake(certs: { readonly key: string; readonly cert: string }, client: tls.ConnectionOptions): Promise<string> {
  const server = tls.createServer({ key: certs.key, cert: certs.cert }, (socket) => socket.end("hello"));
  server.on("tlsClientError", () => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<string>((resolve) => {
      const socket = tls.connect({ port, host: "127.0.0.1", ...client });
      let text = "";
      socket.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
      socket.on("end", () => resolve(`${socket.getProtocol() ?? "no protocol"} ${text}`));
      socket.on("error", (error: NodeJS.ErrnoException) => resolve(`error ${error.code ?? error.message}`));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("the certificates of a test", () => {
  it("makes an authority and a server certificate for DNS names and IP addresses", () => {
    const certs = testCertificates({ names: ["example.org", "*.example.org", "127.0.0.1", "::1"] });
    const ca = new X509Certificate(certs.ca);
    const leaf = new X509Certificate(certs.cert);
    expect(ca.ca).toBe(true);
    expect(leaf.ca).toBe(false);
    expect(ca.verify(ca.publicKey)).toBe(true);
    expect(leaf.checkIssued(ca)).toBe(true);
    expect(leaf.verify(ca.publicKey)).toBe(true);
    expect(leaf.subject).toBe("CN=example.org");
    expect(leaf.issuer).toBe("CN=rigor-testkit test authority");
    expect(leaf.subjectAltName).toBe("DNS:example.org, DNS:*.example.org, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1");
    // The check gives the name of the certificate that matches.
    expect(leaf.checkHost("a.example.org")).toBe("*.example.org");
    expect(leaf.checkIP("::1")).toBe("::1");
    expect(leaf.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"]);
    expect(createPrivateKey(certs.key).asymmetricKeyType).toBe("ed25519");
  });

  it("gives the validity of the options, and new keys and a new serial for each call", () => {
    const from = Date.UTC(2049, 11, 31);
    const first = new X509Certificate(testCertificates({ names: ["example.org"], from, days: 2 }).cert);
    const second = new X509Certificate(testCertificates({ names: ["example.org"], from, days: 2 }).cert);
    expect(first.validFromDate.getTime()).toBe(from);
    // The end is after 2049, so the certificate has a GeneralizedTime.
    expect(first.validToDate.getTime()).toBe(from + 2 * 86_400_000);
    expect(first.serialNumber).not.toBe(second.serialNumber);
    expect(first.publicKey.export({ type: "spki", format: "der" })).not.toEqual(second.publicKey.export({ type: "spki", format: "der" }));
    expect(first.raw.length).toBe(second.raw.length);
  });

  it("gives a serial of 16 bytes that DER permits for each first byte of the random bytes", () => {
    const serials: string[] = [];
    for (const fill of [0x00, 0x3f, 0x80, 0xff]) {
      random.fill = fill;
      const certs = testCertificates({ names: ["example.org"] });
      // X509Certificate refuses an INTEGER with a zero byte that DER does not permit.
      for (const text of [certs.ca, certs.cert]) serials.push(new X509Certificate(text).serialNumber);
    }
    expect(serials.map((serial) => serial.length)).toEqual(Array<number>(8).fill(32));
    expect(serials.map((serial) => serial.slice(0, 4))).toEqual(["4000", "4000", "7F3F", "7F3F", "4080", "4080", "7FFF", "7FFF"]);
  });

  it("reads a validity from 1950 and up to the end of 9999", () => {
    const from = Date.UTC(1950, 0, 1);
    const early = new X509Certificate(testCertificates({ names: ["example.org"], from }).cert);
    expect(early.validFromDate.getTime()).toBe(from);
    const last = Date.UTC(9999, 11, 30);
    const late = new X509Certificate(testCertificates({ names: ["example.org"], from: last, days: 1 }).cert);
    expect(late.validToDate.getTime()).toBe(last + 86_400_000);
  });

  it("states each problem of the options, and the function throws a RangeError for them", () => {
    expect(checkTestCertificateOptions({ names: ["example.org"] })).toEqual([]);
    expect(checkTestCertificateOptions({ names: [] })).toEqual(["The names are a list with one name or more."]);
    expect(checkTestCertificateOptions({ names: ["a b", "::ffff:192.0.2.1", "-a.org"], from: Number.NaN, days: 0 })).toEqual([
      'The name "a b" is not a DNS name or an IP address.',
      'The name "::ffff:192.0.2.1" is not a DNS name or an IP address.',
      'The name "-a.org" is not a DNS name or an IP address.',
      "The from is a time in ms, not NaN.",
      "The days are a number more than 0, not 0.",
    ]);
    expect(checkTestCertificateOptions({ names: ["example.org"], from: Date.UTC(1949, 11, 31) })).toEqual(["The from is a time from 1950-01-01 to 9999-12-31, not -631238400000."]);
    expect(checkTestCertificateOptions({ names: ["example.org"], from: Date.UTC(10_000, 0, 1) })).toEqual(["The from is a time from 1950-01-01 to 9999-12-31, not 253402300800000."]);
    expect(checkTestCertificateOptions({ names: ["example.org"], from: Date.UTC(9999, 11, 31), days: 2 })).toEqual(["The validity ends after 9999-12-31. Use an earlier from or fewer days."]);
    expect(checkTestCertificateOptions({ names: ["example.org"], days: 1e9 })).toEqual(["The validity ends after 9999-12-31. Use an earlier from or fewer days."]);
    expect(() => testCertificates({ names: [] })).toThrow(RangeError);
  });

  it("gives a TLS handshake to a client that trusts the authority, and a refusal to a client that does not", async () => {
    const certs = testCertificates({ names: ["example.org"] });
    expect(await handshake(certs, { servername: "example.org", ca: certs.ca })).toBe("TLSv1.3 hello");
    expect(await handshake(certs, { servername: "example.org" })).toBe("error UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(await handshake(certs, { servername: "other.org", ca: certs.ca })).toBe("error ERR_TLS_CERT_ALTNAME_INVALID");
  });

  it("adds the authority to the default authorities of the process, and puts back the authorities from before", async () => {
    const certs = testCertificates({ names: ["example.org"] });
    const before = tls.getCACertificates("default").length;
    const untrust = trustCertificate(certs.ca);
    undo.push(untrust);
    expect(tls.getCACertificates("default")).toHaveLength(before + 1);
    expect(await handshake(certs, { servername: "example.org" })).toBe("TLSv1.3 hello");
    untrust();
    expect(tls.getCACertificates("default")).toHaveLength(before);
    expect(await handshake(certs, { servername: "example.org" })).toBe("error UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  it("gives the same count of handshake bytes for each set of certificates of the same names", async () => {
    const count = async (): Promise<number> => {
      const certs = testCertificates({ names: ["example.org"] });
      let written = 0;
      const server = createServer((raw) => {
        const secure = new tls.TLSSocket(raw, { isServer: true, secureContext: tls.createSecureContext({ key: certs.key, cert: certs.cert }) });
        secure.on("secure", () => {
          written = raw.bytesWritten;
          secure.end();
        });
        secure.on("error", () => undefined);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      await new Promise<void>((resolve) => {
        const socket = tls.connect({ port, host: "127.0.0.1", servername: "example.org", ca: certs.ca });
        socket.on("end", () => resolve());
        socket.on("error", () => resolve());
        socket.resume();
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return written;
    };
    const first = await count();
    expect(first).toBeGreaterThan(0);
    expect(await count()).toBe(first);
  });
});
