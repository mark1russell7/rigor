// One real run of Stryker with the config of `config --plan`. It checks that the reporter rigor-partial writes
// plan.json and stops Stryker after the plan, before a mutant runs, and that plan-check reads the plan.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "..", "build", "cli.js");
const lane = join(here, "mutation.json");
const pkg = join(here, "pkg");
const out = mkdtempSync(join(tmpdir(), "stryker-plan-"));
const reports = join(pkg, "reports", "mutation");
const planFile = join(reports, "plan.json");

/** This function writes an error line for GitHub Actions and stops the check. */
const fail = (message: string): never => {
  console.log(`::error::${message}`);
  process.exit(1);
};

const config = spawnSync(process.execPath, [cli, "config", "slow", "--plan", "--lane", lane, "--concurrency", "1", "--out", join(out, "stryker.json")], { stdio: "inherit" });
if (config.status !== 0) fail(`config --plan exited with ${String(config.status)}.`);
rmSync(join(pkg, "reports"), { recursive: true, force: true });
rmSync(join(pkg, ".stryker-tmp"), { recursive: true, force: true });

const stryker = spawnSync("pnpm", ["exec", "stryker", "run", join(out, "stryker.json")], { cwd: pkg, encoding: "utf8", timeout: 300_000 });
console.log(stryker.stdout, stryker.stderr);
if (stryker.status !== 0) fail(`Stryker exited with ${String(stryker.status)} (signal ${String(stryker.signal)}), not 0, after the plan.`);
if (/Unknown stryker config option "rigorPartial"/u.test(`${stryker.stdout}${stryker.stderr}`)) fail("Stryker does not know the option rigorPartial, so it did not read the schema of the plugin.");
if (!existsSync(planFile)) fail(`Stryker wrote no plan at ${planFile}.`);
if (existsSync(join(reports, "mutation.json"))) fail("Stryker wrote mutation.json, so the reporter did not stop it after the plan.");
const partial = readFileSync(join(reports, "partial.jsonl"), "utf8");
if (/"status":"(Killed|Survived|Timeout)"/u.test(partial)) fail("A mutant ran after the plan.");

const plan = JSON.parse(readFileSync(planFile, "utf8")) as { files: Record<string, { runs: number; netMs: number; lines: unknown[] }>; tests: unknown[] };
console.log("== plan.json");
console.log(JSON.stringify(plan, null, 2));
const count = plan.files["src/count.ts"];
if (count === undefined || count.runs < 1 || count.lines.length < 1) fail("The plan has no runs and no lines for src/count.ts.");
if (plan.tests.length < 1) fail("The plan has no tests, so the reporter did not get the tests of the dry run.");

const pass = spawnSync(process.execPath, [cli, "plan-check", "slow", "--lane", lane], { cwd: here, encoding: "utf8" });
console.log(pass.stdout, pass.stderr);
if (pass.status !== 0 || !/^plan-check: each plan of 1 selections is in its limits$/mu.test(pass.stdout)) fail(`plan-check exited with ${String(pass.status)}, not 0, on the plan.`);

/** This function starts plan-check on the plan with a lane of the limits `limits`, in minutes. */
const checkWith = (limits: object) => {
  const tight = join(out, "mutation.json");
  writeFileSync(tight, JSON.stringify({ packages: { slow: { dir: "pkg", mutate: ["src/count.ts"] } }, ...limits }));
  const result = spawnSync(process.execPath, [cli, "plan-check", "slow", "--lane", tight, "--report", planFile], { cwd: here, encoding: "utf8" });
  console.log(result.stdout, result.stderr);
  return result;
};
// A target of almost 0 minutes gives a warning, and a stop of almost 0 minutes fails the same plan.
const warned = checkWith({ targetMinutes: 1e-9 });
if (warned.status !== 0 || !/WARN: slow: the estimate of .* is over the target/u.test(warned.stdout)) fail(`plan-check exited with ${String(warned.status)}, not 0 with a warning, on a plan over its target.`);
const over = checkWith({ targetMinutes: 1e-9, stopMinutes: 1e-9 });
if (over.status !== 1 || !/FAIL: slow: the estimate of .* is over the stop/u.test(over.stdout)) fail(`plan-check exited with ${String(over.status)}, not 1, on a plan over its stop.`);
rmSync(out, { recursive: true, force: true });
console.log("The plan run stopped after the plan, and plan-check read the plan.");
