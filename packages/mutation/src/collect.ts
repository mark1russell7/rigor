#!/usr/bin/env node
/**
 * The collect of `load-check --collect`. The CLI starts this file in a new process for each package:
 * `node collect.ts <request> <out>`. The request is a `CollectRequest` as JSON. The script loads the Vitest that the
 * folder resolves. That Vitest collects each test file, and the script writes a `Collected` as JSON to `<out>`.
 *
 * The option `staticParse: false` makes Vitest start each file. Under Vitest 5 the default form only parses a file, so
 * it does not find a missing package. Then for each selection, the script sets `related` to its mutated files. It reads
 * the test files that the related mode starts, as the runner of Stryker does.
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Collected, CollectRequest } from "./load.ts";

const [requestFile, out] = process.argv.slice(2);
if (requestFile === undefined || out === undefined) throw new Error("collect.ts takes <request> <out>");
const request = JSON.parse(readFileSync(requestFile, "utf8")) as CollectRequest;
const root = resolve(request.dir);
const fromRoot = (file: string): string => relative(root, file).replaceAll("\\", "/");
// Each package reads the Vitest of its own folder, as the runner of Stryker does.
const entry = createRequire(join(root, "package.json")).resolve("vitest/node");
const vitestNode = (await import(pathToFileURL(entry).href)) as typeof import("vitest/node");
process.chdir(root);
const config = request.config === undefined ? {} : { config: resolve(root, request.config) };
const vitest = await vitestNode.createVitest("test", { root, watch: false, ...config });
try {
  const { testModules, unhandledErrors } = await vitest.collect(undefined, { staticParse: false });
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const unhandled = unhandledErrors.map(message);
  const selections: Record<string, string[]> = {};
  for (const [name, files] of Object.entries(request.selections)) {
    selections[name] = [];
    // An empty list of related files makes Vitest start each test file, so a selection with no file starts none.
    if (files.length === 0) continue;
    (vitest.config as { related?: string[] }).related = files.map((f) => resolve(root, f));
    try {
      const specifications = await vitest.getRelevantTestSpecifications();
      selections[name] = [...new Set(specifications.map((s) => fromRoot(s.moduleId)))].toSorted();
    } catch (e) {
      unhandled.push(`the related mode of Vitest failed for the selection ${name}: ${message(e)}`);
    }
  }
  const collected: Collected = {
    version: vitestNode.version,
    path: realpathSync(entry).replaceAll("\\", "/"),
    files: testModules.map((m) => ({ file: fromRoot(m.moduleId), errors: m.errors().map((e) => e.message), children: m.children.size })),
    unhandled,
    selections,
  };
  writeFileSync(out, `${JSON.stringify(collected)}\n`);
  // Vitest sets the exit code 1 for a file that does not load. The file of the collect gives that fault.
  process.exitCode = 0;
} finally {
  await vitest.close();
}
