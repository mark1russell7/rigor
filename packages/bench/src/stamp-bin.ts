#!/usr/bin/env node
// The bin `rigor-stamp`. The work is in stamp-gate.ts, so a test can start the same command.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { stampCli } from "./stamp-gate.ts";

process.exitCode = await stampCli(process.argv.slice(2), {
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, text) => writeFileSync(path, text),
  appendFile: (path, text) => appendFileSync(path, text),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  cwd: process.cwd(),
});
