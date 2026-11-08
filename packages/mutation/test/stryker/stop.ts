// One real run of Stryker that a stop ends. It checks that Stryker loads the reporter rigor-partial from
// build/reporter.js and calls it, and that scores gives a partial score after a TERM, as at a time limit of CI.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "..", "build", "cli.js");
const lane = join(here, "mutation.json");
const pkg = join(here, "pkg");
const out = mkdtempSync(join(tmpdir(), "stryker-stop-"));
const partial = join(pkg, "reports", "mutation", "partial.jsonl");
const log = join(out, "stryker.log");

/** This function writes an error line for GitHub Actions, prints the log of Stryker, and stops the check. */
const fail = (message: string): never => {
  console.log(`::error::${message}`);
  if (existsSync(log)) console.log(readFileSync(log, "utf8"));
  process.exit(1);
};

/** This function gives the count of the mutants with the status Killed or Survived in the partial file. */
const tested = (): number => (existsSync(partial) ? (readFileSync(partial, "utf8").match(/"status":"(Killed|Survived)"/g) ?? []).length : 0);

const config = spawnSync(process.execPath, [cli, "config", "slow", "--lane", lane, "--concurrency", "1", "--out", join(out, "stryker.json")], { stdio: "inherit" });
if (config.status !== 0) fail(`config exited with ${String(config.status)}.`);
rmSync(join(pkg, "reports"), { recursive: true, force: true });
rmSync(join(pkg, ".stryker-tmp"), { recursive: true, force: true });

// detached gives Stryker its own process group, so one TERM stops Stryker and its workers, as timeout does.
const fd = openSync(log, "w");
const stryker = spawn("pnpm", ["exec", "stryker", "run", join(out, "stryker.json")], { cwd: pkg, detached: true, stdio: ["ignore", fd, fd] });
let ended = false;
stryker.on("exit", () => {
  ended = true;
});
const end = new Promise<void>((resolve) => stryker.on("exit", () => resolve()));

let ran = 0;
for (let i = 0; i < 600 && ran < 3; i++) {
  ran = tested();
  if (ran >= 3) break;
  if (ended) fail(`Stryker ended before the stop, with ${String(ran)} tested mutants in ${partial}.`);
  await sleep(500);
}
if (ran < 3) fail(`Stryker tested ${String(ran)} mutants in 5 minutes.`);
process.kill(-(stryker.pid ?? fail("Stryker has no process id.")), "SIGTERM");
await end;
console.log("== partial.jsonl");
console.log(readFileSync(partial, "utf8"));
if (existsSync(join(pkg, "reports", "mutation", "mutation.json"))) fail("Stryker wrote mutation.json, so the check did not stop the run.");

const scores = spawnSync(process.execPath, [cli, "scores", "slow", "--lane", lane], { cwd: here, encoding: "utf8" });
console.log(scores.stdout, scores.stderr);
if (scores.status !== 1) fail(`scores exited with ${String(scores.status)}, not 1: a partial score is a no read.`);
if (!/^slow: .*FAIL: partial: Stryker stopped after [0-9.]+ minutes and tested [1-9][0-9]* of [1-9][0-9]* mutants\./m.test(scores.stdout)) fail("scores gave no partial score.");
console.log("The stopped run gave a partial score.");
