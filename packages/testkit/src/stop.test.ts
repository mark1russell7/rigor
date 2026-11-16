import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STOP_ENV, countStops, parseProgress, runToStop, stopOrderOf, stopPoint } from "./stop.ts";

const stopUrl = new URL("./stop.ts", import.meta.url).href;
const posix = process.platform !== "win32";

let folder = "";
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "rigor-stop-test-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** The program of a test: it imports `stopPoint` from the source, then runs the body. */
function program(body: string): { readonly command: string; readonly args: readonly string[] } {
  const script = [`import * as fs from "node:fs";`, `const { stopPoint } = await import(${JSON.stringify(stopUrl)});`, body].join("\n");
  return { command: process.execPath, args: ["--input-type=module", "-e", script] };
}

/** A program with ten points. After each point, it writes the step to the file `done`. */
function tenPoints(): { readonly command: string; readonly args: readonly string[] } {
  const done = JSON.stringify(join(folder, "done"));
  return program(`for (let step = 0; step < 10; step += 1) { stopPoint("write " + step); fs.appendFileSync(${done}, step + "\\n"); }`);
}

async function doneSteps(): Promise<number[]> {
  const text = await readFile(join(folder, "done"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map(Number);
}

describe("a stop at a step", { timeout: 30_000 }, () => {
  it("counts the stop points of a complete run", async () => {
    expect(await countStops(tenPoints())).toBe(10);
  });

  it("stops the child at the step with SIGKILL, before the work after the point", async () => {
    const run = await runToStop({ ...tenPoints(), stop: { at: { step: 4 }, signal: "SIGKILL" } });
    expect(run).toMatchObject({ stopped: true, steps: 5, lastStep: 4, lastLabel: "write 4" });
    expect(await doneSteps()).toEqual([0, 1, 2, 3]);
    expect(run.exit.code).not.toBe(0);
    if (posix) expect(run.exit.signal).toBe("SIGKILL");
  });

  it("stops at the first and at the last point", async () => {
    const first = await runToStop({ ...tenPoints(), stop: { at: { step: 0 }, signal: "SIGKILL" } });
    expect(first).toMatchObject({ stopped: true, steps: 1, lastStep: 0 });
    expect(await doneSteps()).toEqual([]);
    const last = await runToStop({ ...tenPoints(), stop: { at: { step: 9 }, signal: "SIGKILL" } });
    expect(last).toMatchObject({ stopped: true, steps: 10, lastStep: 9 });
    expect(await doneSteps()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("gives stopped false when the child ends before the step", async () => {
    const run = await runToStop({ ...tenPoints(), stop: { at: { step: 10 }, signal: "SIGKILL" } });
    expect(run).toMatchObject({ stopped: false, steps: 10, lastStep: 9, exit: { code: 0, signal: null } });
  });

  it.runIf(posix)("lets a program with a handler of SIGTERM continue until its handler ends it", async () => {
    const term = JSON.stringify(join(folder, "term"));
    // A handler of a signal does not keep the event loop open, thus the program has a timer, as a server has a socket
    const body = `process.on("SIGTERM", () => { fs.writeFileSync(${term}, "closed"); process.exit(7); }); setInterval(() => {}, 1000); for (let step = 0; step < 10; step += 1) stopPoint();`;
    const run = await runToStop({ ...program(body), stop: { at: { step: 3 }, signal: "SIGTERM" } });
    // The loop is synchronous, so the handler runs after the last point
    expect(run).toMatchObject({ stopped: true, steps: 10, lastStep: 9, lastLabel: undefined, exit: { code: 7, signal: null } });
    expect(await readFile(join(folder, "term"), "utf8")).toBe("closed");
  });

  it("does not give the order to a child of the program", async () => {
    const body = `stopPoint(); const out = (await import("node:child_process")).execFileSync(process.execPath, ["-e", "process.stdout.write(process.env.${STOP_ENV} ?? 'none')"]); console.log(String(out));`;
    const run = await runToStop(program(body));
    expect(run.stdout.trim()).toBe("none");
    expect(run.steps).toBe(1);
  });

  it("gives the order to a child that the program starts before its first stop point", async () => {
    const child = `const { stopPoint } = await import(${JSON.stringify(stopUrl)}); stopPoint("child 0"); stopPoint("child 1");`;
    const start = (env: string): string =>
      `(await import("node:child_process")).execFileSync(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(child)}], { env: ${env} }); stopPoint("parent 0");`;

    // The two processes write their steps to one progress file, each from the step 0
    const mixed = await runToStop(program(start("process.env")));
    expect(mixed).toMatchObject({ exit: { code: 0 }, steps: 3, lastStep: 0, lastLabel: "parent 0" });

    // A child with no STOP_ENV in its environment writes no step
    const apart = await runToStop(program(`const env = { ...process.env }; delete env[${JSON.stringify(STOP_ENV)}]; ${start("env")}`));
    expect(apart).toMatchObject({ exit: { code: 0 }, steps: 1, lastStep: 0, lastLabel: "parent 0" });
  });
});

describe("a stop at a time", { timeout: 30_000 }, () => {
  /** A program that gets to a point each ms, and does not end. */
  const ticks = (): { readonly command: string; readonly args: readonly string[] } => program(`let step = 0; setInterval(() => stopPoint("tick " + step++), 1);`);

  it("stops the child, and a stop at its last step replays the point", async () => {
    const run = await runToStop({ ...ticks(), stop: { at: { ms: 300 }, signal: "SIGKILL" } });
    expect(run.stopped).toBe(true);
    if (posix) expect(run.exit.signal).toBe("SIGKILL");
    expect(run.steps).toBe((run.lastStep ?? -1) + 1);
    if (run.lastStep !== undefined) expect(run.lastLabel).toBe(`tick ${run.lastStep}`);

    const step = run.lastStep ?? 0;
    const replay = await runToStop({ ...ticks(), stop: { at: { step }, signal: "SIGKILL" } });
    expect(replay).toMatchObject({ stopped: true, steps: step + 1, lastStep: step, lastLabel: `tick ${step}` });
  });

  it("gives stopped false when the child ends before the time", async () => {
    const run = await runToStop({ ...program("stopPoint('only');"), stop: { at: { ms: 30_000 }, signal: "SIGKILL" } });
    expect(run).toMatchObject({ stopped: false, steps: 1, lastStep: 0, lastLabel: "only", exit: { code: 0, signal: null } });
  });
});

describe("the errors of a run", { timeout: 30_000 }, () => {
  it("throws a RangeError for a stop or a time limit with problems", async () => {
    await expect(runToStop({ ...tenPoints(), stop: { at: { step: -1 }, signal: "SIGKILL" } })).rejects.toThrow(RangeError);
    await expect(runToStop({ ...tenPoints(), stop: { at: { step: 1 }, signal: "SIGINT" as never } })).rejects.toThrow(/signal/);
    await expect(runToStop({ ...tenPoints(), timeoutMs: 0 })).rejects.toThrow(RangeError);
  });

  it("rejects when the child does not start, and when it does not end in the time limit", async () => {
    await expect(runToStop({ command: join(folder, "no-such-program") })).rejects.toThrow(/did not start/);
    await expect(runToStop({ ...program("setInterval(() => {}, 1000);"), timeoutMs: 500 })).rejects.toThrow(/did not end in 500 ms/);
  });

  it("rejects a count when the complete run does not end with the code 0", async () => {
    await expect(countStops(program("stopPoint(); console.error('it broke'); process.exit(3);"))).rejects.toThrow(/the code 3, not the code 0[\s\S]*it broke/);
  });

  it("refuses an order that is not valid in the child", () => {
    const { command, args } = program("stopPoint();");
    const env = { ...process.env, [STOP_ENV]: "{" };
    const result = spawnSync(command, args, { env, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is not JSON");
  });

  it("throws on each call for an order that is not valid, also after a caught error", () => {
    const { command, args } = program(
      `let errors = 0; for (let call = 0; call < 3; call += 1) { try { stopPoint(); } catch (error) { if (error instanceof RangeError) errors += 1; } } process.stdout.write(String(errors));`,
    );
    const env = { ...process.env, [STOP_ENV]: JSON.stringify({ progress: join(folder, "progress.jsonl"), step: -1 }) };
    const result = spawnSync(command, args, { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("3");
  });

  it("does no work without the order", () => {
    expect(process.env[STOP_ENV]).toBeUndefined();
    expect(() => stopPoint("here")).not.toThrow();
  });
});

describe("the order and the progress file for a harness that starts the child itself", { timeout: 30_000 }, () => {
  it("puts a stop at a step into the order, and leaves a stop at a time and no stop out", () => {
    expect(stopOrderOf({ at: { step: 3 }, signal: "SIGTERM" }, "/tmp/p.jsonl")).toEqual({ progress: "/tmp/p.jsonl", step: 3, signal: "SIGTERM" });
    expect(stopOrderOf({ at: { ms: 40 }, signal: "SIGKILL" }, "/tmp/p.jsonl")).toEqual({ progress: "/tmp/p.jsonl" });
    expect(stopOrderOf(undefined, "/tmp/p.jsonl")).toEqual({ progress: "/tmp/p.jsonl" });
  });

  it("throws a RangeError for a stop with problems", () => {
    expect(() => stopOrderOf({ at: { step: -1 }, signal: "SIGKILL" }, "/tmp/p.jsonl")).toThrow(RangeError);
  });

  it("gives the order that the child reads", async () => {
    const progress = join(folder, "progress.jsonl");
    const order = stopOrderOf({ at: { step: 2 }, signal: "SIGKILL" }, progress);
    const { command, args } = tenPoints();
    const result = spawnSync(command, args, { env: { ...process.env, [STOP_ENV]: JSON.stringify(order) }, encoding: "utf8" });
    if (posix) expect(result.signal).toBe("SIGKILL");
    expect(await doneSteps()).toEqual([0, 1]);
    const lines = parseProgress(await readFile(progress, "utf8"));
    expect(lines.map((line) => line.step)).toEqual([0, 1, 2]);
    expect(lines.at(-1)).toEqual({ step: 2, label: "write 2", stop: true });
  });

  it("reads each complete line, and ignores a last line that the child did not write completely", () => {
    const text = `${JSON.stringify({ step: 0 })}\n${JSON.stringify({ step: 1, label: "b" })}\n{"step":2,"lab`;
    expect(parseProgress(text)).toEqual([{ step: 0 }, { step: 1, label: "b" }]);
    expect(parseProgress("")).toEqual([]);
  });

  it("ignores each JSON value that is not a progress line", () => {
    const bad = ["5", "null", "[]", "{}", '"step"', '{"step":-1}', '{"step":1.5}', '{"step":"1"}', '{"step":1,"label":2}', '{"step":1,"stop":false}'];
    const text = [...bad, JSON.stringify({ step: 3, label: "c", stop: true })].join("\n");
    expect(parseProgress(text)).toEqual([{ step: 3, label: "c", stop: true }]);
  });
});
