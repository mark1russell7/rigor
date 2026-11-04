import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caseProgress, startSupervisedProcess, superviseCases, type SupervisedCase, type SupervisedEnd, type SupervisedChild } from "./supervise.ts";

const LONG = 60_000;
const SHORT = 300;

/**
 * The child of the tests. It reads its ids from the arguments, and it runs each id in order.
 * An id with the word `slow` blocks in a loop that does not yield, so only a hard stop ends it.
 * The stage of an id is the part of the id after the colon.
 */
const CHILD = `
const { appendFileSync } = require("node:fs");
const [, progress, log, ...ids] = process.argv;
const write = (event) => appendFileSync(progress, JSON.stringify(event) + "\\n");
for (const id of ids) {
  const stage = id.includes(":") ? id.split(":")[1] : "";
  write({ event: "start", id, stage, at: Date.now() });
  appendFileSync(log, id + "\\n");
  if (id.includes("slow")) for (;;);
  write({ event: "end", id });
}
`;

function setup(): { readonly progressFile: string; readonly log: string; readonly start: (left: readonly string[]) => SupervisedChild; readonly ran: () => string[] } {
  const dir = mkdtempSync(join(tmpdir(), "supervise-"));
  const script = join(dir, "child.cjs");
  const progressFile = join(dir, "progress.ndjson");
  const log = join(dir, "log.txt");
  writeFileSync(script, CHILD);
  writeFileSync(log, "");
  return {
    progressFile,
    log,
    start: (left) => startSupervisedProcess([process.execPath, script, progressFile, log, ...left]),
    ran: () => readFileSync(log, "utf8").split("\n").filter((line) => line !== ""),
  };
}

const fast = (id: string): SupervisedCase => ({ id, budgetMs: LONG });
const slow = (id: string, groups?: Readonly<Record<string, string>>): SupervisedCase => ({ id, budgetMs: SHORT, ...(groups === undefined ? {} : { groups }) });

describe("superviseCases", () => {
  it("stops a case over its budget, tags it, and runs the cases after it", async () => {
    const { progressFile, start, ran } = setup();
    const ends: SupervisedEnd[] = [];
    const result = await superviseCases({ cases: [fast("a"), slow("slow"), fast("b")], progressFile, start, onEnd: (end) => ends.push(end), pollMs: 20 });
    expect(ends).toEqual([{ kind: "over-budget", id: "slow", budgetMs: SHORT, stage: "" }]);
    expect(ran()).toEqual(["a", "slow", "b"]);
    expect(result).toEqual({ code: 0, starts: 2, ends, left: [] });
  }, 20_000);

  it("skips the other cases of a group after 2 overruns, and names the 2 overruns", async () => {
    const { progressFile, start, ran } = setup();
    const group = { "": "router" };
    const cases = [slow("slow-1", group), fast("a"), slow("slow-2", group), slow("slow-3", group), { id: "other", budgetMs: LONG, groups: group }, fast("b")];
    const result = await superviseCases({ cases, progressFile, start, onEnd: () => undefined, pollMs: 20 });
    expect(result.ends.map((end) => [end.kind, end.id])).toEqual([
      ["over-budget", "slow-1"],
      ["over-budget", "slow-2"],
      ["not-run", "slow-3"],
      ["not-run", "other"],
    ]);
    expect(result.ends[2]).toMatchObject({ group: "router", because: ["slow-1", "slow-2"], budgetMs: SHORT });
    expect(ran()).toEqual(["slow-1", "a", "slow-2", "b"]);
  }, 20_000);

  it("counts an overrun for the group of its stage only", async () => {
    const { progressFile, start, ran } = setup();
    const of = (router: string) => ({ pack: "packer", route: router });
    const cases = [slow("slow-1:route", of("r1")), slow("slow-2:route", of("r2")), { id: "a", budgetMs: LONG, groups: of("r3") }];
    const result = await superviseCases({ cases, progressFile, start, onEnd: () => undefined, pollMs: 20 });
    expect(result.ends.map((end) => end.kind)).toEqual(["over-budget", "over-budget"]);
    expect(ran()).toEqual(["slow-1:route", "slow-2:route", "a"]);
  }, 20_000);

  it("skips each case of a group that overran in a stage, whichever stage the case is at", async () => {
    const { progressFile, start, ran } = setup();
    const of = (router: string) => ({ pack: "packer", route: router });
    const cases = [slow("slow-1:pack", of("r1")), slow("slow-2:pack", of("r2")), { id: "a", budgetMs: LONG, groups: of("r3") }];
    const result = await superviseCases({ cases, progressFile, start, onEnd: () => undefined, pollMs: 20 });
    expect(result.ends.map((end) => [end.kind, end.id])).toEqual([
      ["over-budget", "slow-1:pack"],
      ["over-budget", "slow-2:pack"],
      ["not-run", "a"],
    ]);
    expect(ran()).toEqual(["slow-1:pack", "slow-2:pack"]);
  }, 20_000);

  it("runs no case twice on a resume, and a case of `done` does not run", async () => {
    const first = setup();
    const cases = [fast("a"), slow("slow"), fast("b"), fast("c")];
    const ended: string[] = [];
    await superviseCases({ cases, progressFile: first.progressFile, start: first.start, onEnd: (end) => ended.push(end.id), pollMs: 20 });
    expect([...first.ran()].sort()).toEqual(["a", "b", "c", "slow"]);
    const second = setup();
    const result = await superviseCases({ cases, done: new Set(["a", "slow"]), progressFile: second.progressFile, start: second.start, onEnd: () => undefined, pollMs: 20 });
    expect(second.ran()).toEqual(["b", "c"]);
    expect(result.ends).toEqual([]);
    expect(ended).toEqual(["slow"]);
  }, 20_000);

  it("starts no child when each case is done", async () => {
    const { progressFile } = setup();
    const result = await superviseCases({ cases: [fast("a")], done: new Set(["a"]), progressFile, start: () => expect.fail("A child started."), onEnd: () => undefined });
    expect(result).toEqual({ code: null, starts: 0, ends: [], left: [] });
  });

  it("gives the code of a child that ends, and the cases that it left", async () => {
    const { progressFile } = setup();
    const result = await superviseCases({ cases: [fast("a"), fast("b")], progressFile, start: () => ({ stop: () => undefined, exited: Promise.resolve(3) }), onEnd: () => undefined, pollMs: 5 });
    expect(result).toEqual({ code: 3, starts: 1, ends: [], left: ["a", "b"] });
  });

  it("gives no overrun to a case that ended before the stop", async () => {
    const { progressFile } = setup();
    let clock = 0;
    const progress = caseProgress(progressFile, () => clock);
    let starts = 0;
    const start = (): SupervisedChild => {
      starts += 1;
      if (starts === 2) return { stop: () => undefined, exited: Promise.resolve(0) };
      progress.start("a");
      clock = 100;
      let exit: (code: number | null) => void = () => undefined;
      const exited = new Promise<number | null>((resolve) => (exit = resolve));
      return {
        stop: () => {
          progress.end("a");
          progress.start("b");
          exit(null);
        },
        exited,
      };
    };
    const result = await superviseCases({ cases: [{ id: "a", budgetMs: 10 }, fast("b")], progressFile, start, onEnd: () => undefined, pollMs: 5, now: () => clock });
    expect(result.ends).toEqual([]);
    expect(result.left).toEqual(["b"]);
    expect(starts).toBe(2);
  });

  it("does not read a line that is not whole", async () => {
    const { progressFile } = setup();
    let release: (code: number | null) => void = () => undefined;
    const exited = new Promise<number | null>((resolve) => (release = resolve));
    const start = (): SupervisedChild => {
      appendFileSync(progressFile, '{"event":"st');
      setTimeout(() => release(0), 30);
      return { stop: () => undefined, exited };
    };
    expect((await superviseCases({ cases: [fast("a")], progressFile, start, onEnd: () => undefined, pollMs: 5 })).code).toBe(0);
  });
});
