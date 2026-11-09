// Real runs of Stryker over the two parts of a package (parts.json). They check that the paths of "testFiles" in the
// reports match the test files on the disk: scores --test-files over all the parts gives no fault. Then a test file
// that no part loads gives a fault (LANE.FILES over the parts).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "..", "build", "cli.js");
const lane = join(here, "parts.json");
const pkg = join(here, "parts");
const out = mkdtempSync(join(tmpdir(), "stryker-files-"));
const reports = join(out, "reports");
const orphan = join(pkg, "src", "orphan.test.ts");

/** This function writes an error line for GitHub Actions and stops the check. */
const fail = (message: string): never => {
  console.log(`::error::${message}`);
  process.exit(1);
};

for (const name of ["two.a", "two.b"]) {
  const config = join(out, `${name}.json`);
  const made = spawnSync(process.execPath, [cli, "config", name, "--lane", lane, "--concurrency", "1", "--out", config], { stdio: "inherit" });
  if (made.status !== 0) fail(`config of ${name} exited with ${String(made.status)}.`);
  rmSync(join(pkg, "reports"), { recursive: true, force: true });
  rmSync(join(pkg, ".stryker-tmp"), { recursive: true, force: true });
  const run = spawnSync("pnpm", ["exec", "stryker", "run", config], { cwd: pkg, encoding: "utf8" });
  if (run.status !== 0) fail(`Stryker of ${name} exited with ${String(run.status)}:\n${run.stdout}\n${run.stderr}`);
  const report = join(pkg, "reports", "mutation", "mutation.json");
  const keys = Object.keys((JSON.parse(readFileSync(report, "utf8")) as { testFiles?: object }).testFiles ?? {});
  console.log(`${name}: the report reads the test files ${JSON.stringify(keys)}`);
  mkdirSync(join(reports, `mutation-${name}`), { recursive: true });
  copyFileSync(report, join(reports, `mutation-${name}`, "mutation.json"));
}

/** This function starts scores over both parts, as the gate job starts it. */
const scores = (): { status: number | null; text: string } => {
  const r = spawnSync(process.execPath, [cli, "scores", "two.a", "two.b", "--lane", lane, "--reports", reports, "--test-files"], { cwd: here, encoding: "utf8" });
  const text = `${r.stdout}${r.stderr}`;
  console.log(text);
  return { status: r.status, text };
};

const good = scores();
if (good.status !== 0) fail(`scores over the parts exited with ${String(good.status)}, not 0: the paths of the reports do not match the disk.`);
if (/read by no selection|not read:/.test(good.text)) fail("scores gave a test file with no read, but each part read its test file.");
if (!/^two\.a: .*, 1 tests\), no gate: pass$/m.test(good.text) || !/^two\.b: .*, 1 tests\), no gate: pass$/m.test(good.text)) fail("scores did not read one test of each part.");

writeFileSync(orphan, 'import { expect, it } from "vitest";\n\nit("loads no file of a part", () => {\n  expect(1).toBe(1);\n});\n');
try {
  const bad = scores();
  if (bad.status !== 1) fail(`scores with a test file that no part loads exited with ${String(bad.status)}, not 1.`);
  if (!bad.text.includes("  read by no selection: parts/src/orphan.test.ts\n")) fail("scores did not name the test file that no part loads.");
} finally {
  rmSync(orphan, { force: true });
}
console.log("The reports of real runs match the test files on the disk, and a test file that no part loads fails.");
