import { X509Certificate, createPrivateKey } from "node:crypto";
import { type AddressInfo, createServer } from "node:net";
import * as tls from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { checkTestCertificateOptions, testCertificates, trustCertificate } from "./tls.ts";

const undo: (() => void)[] = [];
afterEach(() => {
  for (const step of undo.splice(0)) step();
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
