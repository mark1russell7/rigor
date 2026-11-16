import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as stop from "./stop.ts";
import * as point from "./stop-point.ts";

const posix = process.platform !== "win32";

let folder = "";
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "rigor-stop-point-test-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** A copy of the module without its types, alone in an empty folder, as a harness puts it into a container. */
async function lonelyCopy(): Promise<string> {
  const source = await readFile(new URL("./stop-point.ts", import.meta.url), "utf8");
  const file = join(folder, "stop-point.mjs");
  await writeFile(file, stripTypeScriptTypes(source, { mode: "strip" }));
  return pathToFileURL(file).href;
}

/** A child with ten points that imports the copy and runs from the empty folder, with the order in its environment. */
function runCopy(url: string, order: unknown): SpawnSyncReturns<string> {
  const script = `const { stopPoint } = await import(${JSON.stringify(url)}); for (let step = 0; step < 10; step += 1) stopPoint("write " + step);`;
  const env = { ...process.env, [point.STOP_ENV]: JSON.stringify(order) };
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: folder, env, encoding: "utf8" });
}

describe("the entry /stop-point", { timeout: 30_000 }, () => {
  it("gives the same functions as the entry /stop, so a program has one state of its points", () => {
    expect(stop.stopPoint).toBe(point.stopPoint);
    expect(stop.parseProgress).toBe(point.parseProgress);
    expect(stop.STOP_ENV).toBe(point.STOP_ENV);
  });

  it("stops a copy with no packages at the step of the order", async () => {
    const progress = join(folder, "progress.jsonl");
    const result = runCopy(await lonelyCopy(), stop.stopOrderOf({ at: { step: 3 }, signal: "SIGKILL" }, progress));
    expect(result.status).not.toBe(0);
    if (posix) expect(result.signal).toBe("SIGKILL");
    const lines = point.parseProgress(await readFile(progress, "utf8"));
    expect(lines.map((line) => line.step)).toEqual([0, 1, 2, 3]);
    expect(lines.at(-1)).toEqual({ step: 3, label: "write 3", stop: true });
  });

  it("records each point of a copy with no stop in the order", async () => {
    const progress = join(folder, "progress.jsonl");
    const result = runCopy(await lonelyCopy(), { progress });
    expect(result.status).toBe(0);
    expect(point.parseProgress(await readFile(progress, "utf8"))).toHaveLength(10);
  });

  it("refuses a signal that the system does not know, before the first write", async () => {
    const progress = join(folder, "progress.jsonl");
    const result = runCopy(await lonelyCopy(), { progress, step: 1, signal: "SIGNOTHING" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("RangeError");
    expect(result.stderr).toContain("SIGNOTHING");
    await expect(readFile(progress, "utf8")).rejects.toThrow();
  });
});
