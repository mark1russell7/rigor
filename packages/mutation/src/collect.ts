#!/usr/bin/env node
/**
 * The collect of `load-check --collect`. The CLI starts this file in a new process for each package:
 * `node collect.ts <dir> <out> [<vitest config>]`. It loads the Vitest that the folder of the package resolves. That
 * Vitest collects each test file, and the script writes a `Collected` as JSON to `<out>`.
 *
 * The option `staticParse: false` makes Vitest start each file. Under Vitest 5 the default form only parses a file, so
 * it does not find a missing package.
 */
import { realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Collected } from "./load.ts";

const [dir, out, config] = process.argv.slice(2);
if (dir === undefined || out === undefined) throw new Error("collect.ts takes <dir> <out> [<vitest config>]");
const root = resolve(dir);
// Each package reads the Vitest of its own folder, as the runner of Stryker does.
const entry = createRequire(join(root, "package.json")).resolve("vitest/node");
const vitestNode = (await import(pathToFileURL(entry).href)) as typeof import("vitest/node");
process.chdir(root);
const vitest = await vitestNode.createVitest("test", { root, watch: false, ...(config === undefined ? {} : { config: resolve(root, config) }) });
try {
  const { testModules, unhandledErrors } = await vitest.collect(undefined, { staticParse: false });
  const collected: Collected = {
    version: vitestNode.version,
    path: realpathSync(entry).replaceAll("\\", "/"),
    files: testModules.map((m) => ({
      file: relative(root, m.moduleId).replaceAll("\\", "/"),
      errors: m.errors().map((e) => e.message),
      children: m.children.size,
    })),
    unhandled: unhandledErrors.map((e) => (e instanceof Error ? e.message : String(e))),
  };
  writeFileSync(out, `${JSON.stringify(collected)}\n`);
  // Vitest sets the exit code 1 for a file that does not load. The file of the collect gives that fault.
  process.exitCode = 0;
} finally {
  await vitest.close();
}
