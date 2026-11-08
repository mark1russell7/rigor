// Real runs of load-check --collect on the fixture package of parts.json. The clean package passes, and the runner
// file names its Vitest. Then each fault in a test file gives exit code 1, the name of the file and its reason.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "..", "build", "cli.js");
const lane = join(here, "parts.json");
const src = join(here, "parts", "src");
const out = mkdtempSync(join(tmpdir(), "load-collect-"));
const runner = join(out, "runner.json");
const MISSING = "rigor-mutation-missing-package";
const TEST = 'import { expect, it } from "vitest";\n\nit("passes", () => {\n  expect(1).toBe(1);\n});\n';

/** The files that a fault writes. The function fail removes them before it stops the check. */
const written = new Set<string>();

/** This function writes an error line for GitHub Actions and stops the check. */
const fail = (message: string): never => {
  console.log(`::error::${message}`);
  for (const file of written) rmSync(file, { force: true });
  process.exit(1);
};

/** This function starts load-check --collect on the fixture package. */
const check = (): { status: number | null; text: string } => {
  const r = spawnSync(process.execPath, [cli, "load-check", "two", "--collect", "--lane", lane, "--runner", runner], { cwd: here, encoding: "utf8" });
  const text = `${r.stdout}${r.stderr}`;
  console.log(text);
  return { status: r.status, text };
};

const clean = check();
if (clean.status !== 0) fail(`load-check --collect on the clean package exited with ${String(clean.status)}, not 0.`);
if (!/^load-check two: Vitest \S+ loads 2 test files$/m.test(clean.text)) fail("load-check --collect did not load the 2 test files of the package.");
const runners = JSON.parse(readFileSync(runner, "utf8")) as Record<string, { version?: string; path?: string }>;
const two = runners["two"];
if (typeof two?.version !== "string" || !two.path?.endsWith("/dist/node.js")) fail(`the runner file does not name the Vitest of the package: ${JSON.stringify(runners)}`);

/** Each fault: its files, and the texts that the output must hold. */
const faults: { name: string; files: Record<string, string>; expect: string[] }[] = [
  { name: "a missing package, direct", files: { "flip.test.ts": `import "${MISSING}";\n${TEST}` }, expect: ["flip.test.ts: the file does not load", MISSING] },
  {
    name: "a missing package through a helper",
    files: { "flip.test.ts": `import "./flip-helper.ts";\n${TEST}`, "flip-helper.ts": `import "${MISSING}";\n` },
    expect: ["flip.test.ts: the file does not load", MISSING],
  },
  { name: "a test file with no test", files: { "flip.test.ts": "export {};\n" }, expect: ["flip.test.ts: the file holds no test"] },
  {
    name: "a dynamic import by a computed path",
    files: { "flip.test.ts": `const name = ["rigor-mutation", "missing", "package"].join("-");\nawait import(name);\n${TEST}` },
    expect: ["flip.test.ts: the file does not load", MISSING],
  },
];

for (const fault of faults) {
  for (const [file, text] of Object.entries(fault.files)) {
    written.add(join(src, file));
    writeFileSync(join(src, file), text);
  }
  try {
    const bad = check();
    if (bad.status !== 1) fail(`${fault.name}: load-check --collect exited with ${String(bad.status)}, not 1.`);
    for (const text of [...fault.expect, "No read: 1 packages"]) if (!bad.text.includes(text)) fail(`${fault.name}: the output does not hold "${text}".`);
  } finally {
    for (const file of Object.keys(fault.files)) rmSync(join(src, file), { force: true });
  }
  console.log(`${fault.name}: exit code 1, with the file and the reason.`);
}
rmSync(out, { recursive: true, force: true });
console.log("load-check --collect passes the clean package, and fails each test file that does not load or holds no test.");
