#!/usr/bin/env node
// The bin `rigor-gate-line`. The work is in gate-line-cli.ts, so a test can start the same command.
import { readFileSync } from "node:fs";
import { gateLineCli } from "./gate-line-cli.ts";

process.exitCode = gateLineCli(process.argv.slice(2), {
  readFile: (path) => readFileSync(path, "utf8"),
  readStdin: () => readFileSync(0, "utf8"),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
});
