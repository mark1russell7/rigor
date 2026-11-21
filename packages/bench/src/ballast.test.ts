import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startBallast } from "./fresh.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** This function gives `true` when no process has the id. */
function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** This function waits until no process has the id, for 10 s at most, and gives `true` when the process is gone. */
async function waitGone(pid: number): Promise<boolean> {
  for (let k = 0; k < 200; k++) {
    if (gone(pid)) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return gone(pid);
}

describe("startBallast", () => {
  it("starts a ballast with the resident set of a bare Node for a small target, and stops it", async () => {
    const ballast = await startBallast(0);
    expect(Number.isSafeInteger(ballast.pid) && ballast.pid > 0).toBe(true);
    expect(ballast.rss).toBeGreaterThan(1024 * 1024);
    expect(ballast.ms).toBeGreaterThan(0);
    expect(gone(ballast.pid)).toBe(false);
    await ballast.stop();
    expect(await waitGone(ballast.pid)).toBe(true);
    // A second stop does nothing.
    await ballast.stop();
  });

  it("holds a resident set of the target or more for a target above a bare Node", async () => {
    const bare = await startBallast(0);
    await bare.stop();
    const bytes = bare.rss + 64 * 1024 * 1024;
    const ballast = await startBallast(bytes);
    try {
      expect(ballast.rss).toBeGreaterThanOrEqual(bytes);
      // The chunks are 1 MiB, so the ballast stops near the target.
      expect(ballast.rss).toBeLessThan(bytes + 32 * 1024 * 1024);
    } finally {
      await ballast.stop();
    }
  });

  it("ends when its parent exits, and does not keep its parent alive", async () => {
    const url = JSON.stringify(new URL("./fresh.ts", import.meta.url).href);
    const script = `const { startBallast } = await import(${url}); const ballast = await startBallast(0); console.log(JSON.stringify({ pid: ballast.pid }));`;
    // The parent has no other work, so it exits after its line. The time limit catches a ballast that keeps it alive.
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000 });
    const { pid } = JSON.parse(out) as { pid: number };
    expect(await waitGone(pid)).toBe(true);
  });

  it("rejects a ballast that exits before its line with its exit code, and a program that does not start", async () => {
    // Node refuses a bad flag in NODE_OPTIONS with the exit code 9, before the program runs.
    vi.stubEnv("NODE_OPTIONS", "--no-such-flag-of-rigor");
    await expect(startBallast(0)).rejects.toThrow("startBallast: the ballast exited before its line, with the code 9.");
    vi.unstubAllEnvs();
    await expect(startBallast(0, { execPath: "D:/no/such/node-of-rigor" })).rejects.toThrow(/^startBallast: the ballast did not start: /);
  });

  it("refuses a target that is not a whole number of 0 or more, and an empty program", () => {
    for (const bytes of [-1, 1.5, Number.NaN, 2 ** 53]) expect(() => startBallast(bytes)).toThrow(RangeError);
    expect(() => startBallast(0, { execPath: "" })).toThrow(RangeError);
  });
});
