import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChildServerError, type ChildServerOptions, PORT_LINE, childServerGroup, portOfText, startChildServer } from "./child.ts";

const children = childServerGroup();
const folders: string[] = [];
afterEach(async () => {
  await children.stopAll();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

/** This function gives the options of a Node child that runs `script`. */
const node = (script: string, options: Omit<ChildServerOptions, "command" | "args"> = {}): ChildServerOptions => ({
  command: process.execPath,
  args: ["-e", script],
  ...options,
});

/** The start of a script: an HTTP server that answers "ok". */
const HTTP = 'const server = require("node:http").createServer((q, s) => s.end("ok"));';

const folder = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "rigor-child-"));
  folders.push(path);
  return path;
};

/** This function gives true when a process with this id exists. */
const alive = (pid: number | undefined): boolean => {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const failure = async (options: ChildServerOptions): Promise<ChildServerError> => {
  const error: unknown = await startChildServer(options).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ChildServerError);
  return error as ChildServerError;
};

describe("startChildServer", () => {
  it("gives the port that a child on the port 0 writes on its output, and stops the child", async () => {
    const server = await children.start(node(`${HTTP} server.listen(0, "127.0.0.1", () => console.log(server.address().port));`));
    expect(server.port).toBeGreaterThan(0);
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(await response.text()).toBe("ok");
    const exit = await server.stop();
    expect(exit.code !== null || exit.signal !== null).toBe(true);
    expect(alive(server.child.pid)).toBe(false);
    // Each call gives the same promise
    expect(await server.stop()).toBe(exit);
  });

  it("joins a line that comes in two writes", async () => {
    const script = `${HTTP} server.listen(0, "127.0.0.1", () => {
      const port = String(server.address().port);
      process.stdout.write(port.slice(0, 2));
      setTimeout(() => process.stdout.write(port.slice(2) + "\\r\\n"), 50);
    });`;
    const server = await children.start(node(script));
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
  });

  it("reads the port with the pattern of a program, and skips the other lines", async () => {
    const script = `${HTTP} console.log("starting 1234"); server.listen(0, "127.0.0.1", () => console.log("listening on http://127.0.0.1:" + server.address().port + "/"));`;
    // The flag g has no effect: the fixture tests each line from its start
    const server = await children.start(node(script, { report: { from: "stdout", pattern: /listening on http:\/\/127\.0\.0\.1:(\d+)\//g } }));
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
    expect(server.output()).toContain("starting 1234");
  });

  it("reads the port from a ready file that the child writes in two parts", async () => {
    const file = join(await folder(), "ready.json");
    const script = `${HTTP} const fs = require("node:fs"); server.listen(0, "127.0.0.1", () => {
      fs.writeFileSync(${JSON.stringify(file)}, '{"po');
      setTimeout(() => fs.writeFileSync(${JSON.stringify(file)}, JSON.stringify({ port: server.address().port })), 100);
    });`;
    const server = await children.start(node(script, { report: { from: "file", path: file } }));
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
  });

  it("reads the port with a read function, from a file named by the process id of the child", async () => {
    const dir = await folder();
    const script = `${HTTP} const fs = require("node:fs"); const path = require("node:path");
      server.listen(0, "127.0.0.1", () => fs.writeFileSync(path.join(${JSON.stringify(dir)}, process.pid + ".lock"), JSON.stringify({ pid: process.pid, port: server.address().port })));`;
    const server = await children.start(
      node(script, {
        report: {
          from: "poll",
          read: async (child) => {
            const { readFile } = await import("node:fs/promises");
            const text = await readFile(join(dir, `${String(child.pid)}.lock`), "utf8").catch(() => "");
            return portOfText(text);
          },
        },
      }),
    );
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
  });

  it("rejects with the exit and the output of a child that ends before it reports a port", async () => {
    const error = await failure(node('console.error("no configuration file"); process.exit(3);'));
    expect(error.exit?.code).toBe(3);
    expect(error.output).toContain("no configuration file");
    expect(error.message).toContain("the code 3");
    expect(error.message).toContain("no configuration file");
  });

  it("stops a child that reports no port in timeoutMs, then rejects", async () => {
    const started = Date.now();
    const error = await failure(node('console.log("starting"); setInterval(() => undefined, 1000);', { timeoutMs: 300 }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    expect(error.message).toContain("no port in 300 ms");
    expect(error.exit).toBeDefined();
    expect(alive(error.pid)).toBe(false);
  });

  it("rejects a number that is not a port, and stops the child", async () => {
    const error = await failure(node('console.log("70000"); setInterval(() => undefined, 1000);'));
    expect(error.message).toContain("70000");
    expect(alive(error.pid)).toBe(false);
  });

  it("rejects when the program does not start", async () => {
    const error = await failure({ command: join(tmpdir(), "rigor-no-such-program") });
    expect(error.message).toContain("did not start");
    expect(error.pid).toBeUndefined();
  });

  it("stops the child when the signal aborts, and rejects with the reason as the cause", async () => {
    const controller = new AbortController();
    const reason = new Error("the test ended");
    setTimeout(() => controller.abort(reason), 100);
    const error = await failure(node("setInterval(() => undefined, 1000);", { signal: controller.signal }));
    expect(error.cause).toBe(reason);
    expect(alive(error.pid)).toBe(false);
    // A signal that aborted before the start starts no child
    const before = await failure(node("setInterval(() => undefined, 1000);", { signal: AbortSignal.abort(reason) }));
    expect(before.pid).toBeUndefined();
    expect(before.cause).toBe(reason);
  });

  it("stops a child that ignores SIGTERM with SIGKILL after stopGraceMs", async () => {
    const script = `${HTTP} process.on("SIGTERM", () => undefined); server.listen(0, "127.0.0.1", () => console.log(server.address().port));`;
    const server = await children.start(node(script, { stopGraceMs: 200 }));
    const exit = await server.stop();
    // On Windows, each kill ends the process at once
    if (process.platform !== "win32") expect(exit.signal).toBe("SIGKILL");
    expect(alive(server.child.pid)).toBe(false);
  });

  it("stops each child of a group", async () => {
    const group = childServerGroup();
    const script = `${HTTP} server.listen(0, "127.0.0.1", () => console.log(server.address().port));`;
    const one = await group.start(node(script));
    const two = await group.start(node(script));
    expect(one.port).not.toBe(two.port);
    await group.stopAll();
    expect(alive(one.child.pid)).toBe(false);
    expect(alive(two.child.pid)).toBe(false);
  });

  it("reads the port from a line of the standard error, and skips the lines of the standard output", async () => {
    const script = `${HTTP} console.log("80"); server.listen(0, "127.0.0.1", () => console.error(server.address().port));`;
    const server = await children.start(node(script, { report: { from: "stderr" } }));
    expect(server.port).not.toBe(80);
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
  });

  it("waits for the ready line after the port, so output() holds the lines before it", async () => {
    const script = `${HTTP} server.listen(0, "127.0.0.1", () => {
      console.log(server.address().port);
      setTimeout(() => { console.log("File root: /srv/files"); console.log("Press Ctrl+C to stop."); }, 100);
    });`;
    const server = await children.start(node(script, { ready: /^Press Ctrl\+C/ }));
    expect(server.output()).toContain("File root: /srv/files");
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
  });

  it("takes a ready line of the standard error that comes before the report of the port", async () => {
    const file = join(await folder(), "ready.txt");
    const script = `${HTTP} const fs = require("node:fs"); server.listen(0, "127.0.0.1", () => {
      console.error("ready");
      setTimeout(() => fs.writeFileSync(${JSON.stringify(file)}, String(server.address().port)), 100);
    });`;
    const server = await children.start(node(script, { report: { from: "file", path: file }, ready: /^ready$/ }));
    expect(server.output()).toContain("ready");
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
  });

  it("stops a child that reports its port but writes no ready line in timeoutMs, then rejects", async () => {
    const script = `${HTTP} server.listen(0, "127.0.0.1", () => console.log(server.address().port));`;
    const error = await failure(node(script, { ready: /^listening$/, timeoutMs: 2_000 }));
    expect(error.message).toMatch(/reported the port \d+, but no line that matches \/\^listening\$\/ in 2000 ms/);
    expect(alive(error.pid)).toBe(false);
  });

  it("rejects a child that ends after the report of its port and before the ready line", async () => {
    const error = await failure(node('console.log("4100"); process.exit(5);', { ready: /^ready$/ }));
    expect(error.message).toContain("ended before a line that matches /^ready$/");
    expect(error.exit?.code).toBe(5);
  });

  it("refuses times that are not positive, and a pattern with no group", async () => {
    const bad: Omit<ChildServerOptions, "command" | "args">[] = [{ timeoutMs: 0 }, { pollMs: -1 }, { stopGraceMs: Number.NaN }, { timeoutMs: Number.POSITIVE_INFINITY }];
    for (const options of bad) {
      await expect(startChildServer(node("", options))).rejects.toThrow(RangeError);
    }
    await expect(startChildServer(node("", { report: { from: "stdout", pattern: /port \d+/ } }))).rejects.toThrow(/no group/);
    await expect(startChildServer(node("", { report: { from: "stderr", pattern: /port \d+/ } }))).rejects.toThrow(/no group/);
  });
});

describe("portOfText and PORT_LINE", () => {
  it("give the port of a number alone or of a JSON object with a port field", () => {
    expect(portOfText("3000\n")).toBe(3000);
    expect(portOfText('{"pid": 7, "port": 4100}')).toBe(4100);
    expect(portOfText('{"po')).toBeUndefined();
    expect(portOfText("")).toBeUndefined();
    expect(portOfText('{"port": "4100"}')).toBeUndefined();
    expect(PORT_LINE.exec(" 3000 ")?.[1]).toBe("3000");
    expect(PORT_LINE.exec("port 3000")).toBeNull();
  });
});
