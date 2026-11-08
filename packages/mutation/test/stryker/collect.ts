// Real runs of load-check --collect on the fixture package of parts.json. The clean package passes, each part starts
// its test file, and the runner file names its Vitest. Then each fault in a test file gives exit code 1, the name of
// the file and its reason.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
if (!/^load-check two: Vitest \S+ loads 2 test files in a copy of parts, and the selections start each one$/m.test(clean.text)) {
  fail("load-check --collect did not load the 2 test files of the package in a copy, or a part did not start its test file.");
}
if (existsSync(join(here, "parts", ".stryker-tmp"))) fail("load-check --collect did not remove its copy of the folder.");
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
    // The file loads, but the related mode does not follow the import, so no part starts it.
    name: "a dynamic import of a module of the package by a computed path",
    files: { "flip.test.ts": `import { expect, it } from "vitest";\nconst { add } = (await import(["./add", "ts"].join("."))) as { add: (a: number, b: number) => number };\nit("adds", () => {\n  expect(add(1, 2)).toBe(3);\n});\n` },
    expect: ["src/flip.test.ts:2: a dynamic import with a computed path", "src/flip.test.ts: no selection starts the file"],
  },
  { name: "a test file that loads no file of a part", files: { "flip.test.ts": TEST }, expect: ["src/flip.test.ts: no selection starts the file"] },
  {
    // The path finds parts.json from the folder of the package, but not from the copy. The static check does not read a computed path.
    name: "a path that finds a file only in the folder of the package",
    files: { "flip.test.ts": `await import(["..", "..", "parts.json"].join("/"));\n${TEST}` },
    expect: ["flip.test.ts: the file does not load", "parts.json"],
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
console.log("load-check --collect passes the clean package. It fails each test file that does not load in the copy, holds no test or that no part starts.");
