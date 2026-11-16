import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { importPeer, missingPackage } from "./peer.ts";

const peerUrl = new URL("./peer.ts", import.meta.url).href;

/** An error with the shape of the error of Node.js for a module that it cannot find. */
function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "ERR_MODULE_NOT_FOUND" });
}

/** The error that `importPeer` gives for a load that rejects with `cause`. */
async function failure(cause: unknown): Promise<unknown> {
  return importPeer(
    async () => {
      throw cause;
    },
    "@x/peer",
    "@x/entry",
  ).catch((error: unknown) => error);
}

describe("importPeer", () => {
  it("gives the module of the load", async () => {
    const module = { value: 1 };
    await expect(importPeer(async () => module, "@x/peer", "@x/entry")).resolves.toBe(module);
  });

  it("names the entry, the peer and the install command when the peer is absent", async () => {
    const cause = notFound("Cannot find package '@x/peer' imported from /a/entry.js");
    const error = await failure(cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("@x/entry needs the package @x/peer");
    expect((error as Error).message).toContain("npm install --save-dev @x/peer");
    expect((error as Error).cause).toBe(cause);
  });

  it("gives each other error as it is", async () => {
    const causes = [
      notFound("Cannot find package '@x/other' imported from /a/node_modules/@x/peer/build/index.js"),
      notFound("Cannot find module '/a/node_modules/@x/peer/build/part.js' imported from /a/node_modules/@x/peer/build/index.js"),
      new Error("Cannot find package '@x/peer' imported from /a/entry.js"),
      new SyntaxError("Unexpected token"),
    ];
    for (const cause of causes) expect(await failure(cause)).toBe(cause);
  });

  it("knows the error of Node.js for a package that it cannot find", () => {
    const script = [
      `const { importPeer } = await import(${JSON.stringify(peerUrl)});`,
      `try { await importPeer(() => import("@mark1russell7/no-such-peer"), "@mark1russell7/no-such-peer", "the entry"); }`,
      `catch (error) { process.stdout.write(error.message); }`,
    ].join("\n");
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("the entry needs the package @mark1russell7/no-such-peer");
  });
});

describe("missingPackage", () => {
  it("is true only for the error of Node.js that names the peer in quotes", () => {
    expect(missingPackage(notFound("Cannot find package '@x/peer' imported from /a.js"), "@x/peer")).toBe(true);
    expect(missingPackage(notFound("Cannot find package '@x/peer-two' imported from /a.js"), "@x/peer")).toBe(false);
    expect(missingPackage({ code: "ERR_MODULE_NOT_FOUND", message: "'@x/peer'" }, "@x/peer")).toBe(false);
    expect(missingPackage(undefined, "@x/peer")).toBe(false);
  });
});
