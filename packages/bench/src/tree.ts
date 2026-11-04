/** The hard stop of a child process, which the fresh runner and the supervisor share. */

import { type ChildProcess, spawn } from "node:child_process";

/** This function sends a signal to a child and its tree. The child leads its own process group on POSIX. On Windows, each signal is a hard stop. */
export function stopTree(proc: ChildProcess, name: NodeJS.Signals): void {
  const pid = proc.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    // TerminateProcess stops only the direct child. The flag /T of taskkill also stops its tree.
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => proc.kill());
    return;
  }
  try {
    process.kill(-pid, name);
  } catch {
    proc.kill(name);
  }
}
