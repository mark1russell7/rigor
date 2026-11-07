import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readStampOs, type StampOsRead, type StampOsRow, stampOsFindings, withInjectedFault } from "./stamp-os.ts";

const row = (code: string, data = "d", engines = "e"): StampOsRow => ({ hash: `${code}${data}${engines}`, parts: { code, data, engines, bundler: "esbuild@1.0.0", node: "any" }, inputs: ["lib/old.cjs", "sub/entry.ts"] });

const read = (platform: string): StampOsRead => ({
  platform,
  rows: { checkout: row("real"), tree: row("c"), "flip-code": row("c2"), "flip-data": row("c", "d2"), "flip-engine": row("c", "d", "e2") },
});

describe("the compare of two reads", () => {
  it("has no finding when two operating systems agree and each flip moved", () => {
    expect(stampOsFindings(read("linux"), read("win32"))).toEqual([]);
  });

  it("reads two reads of one operating system as a fault", () => {
    expect(stampOsFindings(read("linux"), read("linux"))).toEqual(["both reads come from linux"]);
  });

  it("reads the injected fault", () => {
    expect(stampOsFindings(read("linux"), withInjectedFault(read("win32")))).toEqual(["tree: the part code differs"]);
  });

  it("names a hash that differs, and an input with a backslash", () => {
    const other = read("win32");
    const found = stampOsFindings(read("linux"), { ...other, rows: { ...other.rows, checkout: { ...row("real"), hash: "other", inputs: ["lib\\old.cjs", "sub/entry.ts"] } } });
    expect(found).toEqual(["checkout: the hash differs", "checkout: the inputs differ", "checkout: the input lib\\old.cjs has a backslash"]);
  });

  it("names a row that only one read has", () => {
    const { checkout: _left, ...rest } = read("win32").rows;
    expect(stampOsFindings(read("linux"), { platform: "win32", rows: rest })).toEqual(["checkout: one read has no such row"]);
  });

  it("names a flip that did not move, on each read", () => {
    const stuck = (platform: string): StampOsRead => {
      const plain = read(platform);
      return { ...plain, rows: { ...plain.rows, "flip-data": row("c") } };
    };
    expect(stampOsFindings(stuck("linux"), stuck("win32"))).toEqual([
      "flip-data on linux: the hash did not move",
      "flip-data on linux: the part data did not move",
      "flip-data on win32: the hash did not move",
      "flip-data on win32: the part data did not move",
    ]);
  });

  it("refuses a fault in a read with no row tree", () => {
    expect(() => withInjectedFault({ platform: "linux", rows: {} })).toThrow(/no row tree/);
  });
});

describe("a read on this computer", () => {
  it("gives the rows, and the line ends of the other operating system keep each row", async () => {
    const repository = fileURLToPath(new URL("../../../", import.meta.url));
    const here = await readStampOs(repository, "linux");
    const crlf = await readStampOs(repository, "win32");
    expect(Object.keys(here.rows).sort()).toEqual(["checkout", "flip-code", "flip-data", "flip-engine", "tree"]);
    expect(stampOsFindings(here, crlf)).toEqual([]);
  }, 60_000);
});
