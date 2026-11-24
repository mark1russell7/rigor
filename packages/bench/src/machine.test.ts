import { describe, expect, it } from "vitest";
import { benchEnv } from "./fresh.ts";
import { cpuInfoMachine } from "./machine.ts";

/** A made-up file with two processors. The second one has other values, so the parser must read only the first. */
const CPUINFO = [
  "processor\t: 0",
  "vendor_id\t: AuthenticAMD",
  "cpu family\t: 25",
  "model\t\t: 17",
  "model name\t: Test CPU 9000",
  "stepping\t: 1",
  "microcode\t: 0xa101144",
  "cpu MHz\t\t: 2445.406",
  "cache size\t: 1024 KB",
  "flags\t\t: fpu vme",
  "",
  "processor\t: 1",
  "cpu family\t: 26",
  "model\t\t: 2",
  "stepping\t: 0",
  "microcode\t: 0xb000000",
  "cache size\t: 2048 KB",
  "",
].join("\n");

describe("cpuInfoMachine", () => {
  it("gives the fields of the first processor", () => {
    expect(cpuInfoMachine(CPUINFO)).toEqual({ family: "25", model: "17", stepping: "1", microcode: "0xa101144", cacheKb: 1024 });
  });

  it("reads CRLF lines and a blank first block", () => {
    expect(cpuInfoMachine(`\r\n\r\n${CPUINFO.replaceAll("\n", "\r\n")}`)).toEqual({ family: "25", model: "17", stepping: "1", microcode: "0xa101144", cacheKb: 1024 });
  });

  it("gives no clock speed, because the speed of the file changes in one job", () => {
    expect(Object.keys(cpuInfoMachine(CPUINFO) ?? {})).not.toContain("mhz");
  });

  it("leaves out each field that the file does not give, and a cache size in another unit", () => {
    expect(cpuInfoMachine("processor\t: 0\nmicrocode\t: 0x1\ncache size\t: 1 MB\n")).toEqual({ microcode: "0x1" });
    expect(cpuInfoMachine("processor\t: 0\nstepping\t:\n")).toBeUndefined();
  });

  it("gives undefined for a file with none of the fields", () => {
    expect(cpuInfoMachine("")).toBeUndefined();
    expect(cpuInfoMachine("processor\t: 0\nBogoMIPS\t: 50.00\n")).toBeUndefined();
  });
});

describe("benchEnv on this system", () => {
  it("gives the field machine only on Linux", () => {
    const env = benchEnv();
    if (process.platform !== "linux") expect("machine" in env).toBe(false);
    else if (env.machine !== undefined) expect(Object.keys(env.machine).length).toBeGreaterThan(0);
  });
});
