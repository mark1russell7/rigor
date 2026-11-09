#!/usr/bin/env node
// The bin `rigor-mutation`. The work is in run.ts, so a test can start the same CLI in a fixture folder.
import { runCli } from "./run.ts";

try {
  process.exitCode = runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
  });
} catch (error) {
  process.stderr.write(`rigor-mutation: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
