import { describe, expect, it } from "vitest";
import { type ContainerOptions, MIN_CONTAINER_MEMORY, containerArgv, containerStart } from "./container.ts";
import type { ChildExit, StartChild, StartOptions } from "./fresh.ts";

/** A target of 1011425280 bytes of memory, 2 GiB of swap and 2 CPUs, with a fixed user. */
const TARGET: ContainerOptions = {
  image: "node:24.21.0-bookworm-slim",
  memory: 1_011_425_280,
  swap: 2 * 1024 ** 3,
  cpuset: "0-1",
  mounts: ["/work", "/repo"],
  user: "1001:118",
};

interface Call {
  readonly argv: readonly string[];
  readonly options: StartOptions;
}

/** A fake start of the commands of Docker. `reply` gives the end of each command, from its argv. */
function fake(reply: (argv: readonly string[]) => Partial<ChildExit> = () => ({})): { start: StartChild; calls: Call[] } {
  const calls: Call[] = [];
  const start: StartChild = async (argv, options) => {
    calls.push({ argv, options });
    return { stdout: "", stderr: "", code: 0, ...reply(argv) };
  };
  return { start, calls };
}

describe("containerArgv", () => {
  it("gives the argv of docker run with a name, an init, no pull, no network, the limits, the mounts and the folder", () => {
    expect(containerArgv(TARGET, "box", ["node", "--expose-gc", "/repo/child.ts"], "/work/tree")).toEqual([
      "docker",
      "run",
      "--name",
      "box",
      "--init",
      "--pull",
      "never",
      "--network",
      "none",
      "--memory",
      "1011425280b",
      "--memory-swap",
      `${1_011_425_280 + 2 * 1024 ** 3}b`,
      "--cpuset-cpus",
      "0-1",
      "--user",
      "1001:118",
      "--mount",
      "type=bind,source=/work,target=/work",
      "--mount",
      "type=bind,source=/repo,target=/repo",
      "--workdir",
      "/work/tree",
      "node:24.21.0-bookworm-slim",
      "node",
      "--expose-gc",
      "/repo/child.ts",
    ]);
  });

  it("gives no swap, each CPU and the user of the image by default, and the environment and the network of the options", () => {
    const argv = containerArgv({ image: "node:24", memory: MIN_CONTAINER_MEMORY, env: { TZ: "UTC" }, network: "bridge", user: "0", docker: "/usr/bin/docker" }, "box", ["node"]);
    expect(argv.slice(0, 2)).toEqual(["/usr/bin/docker", "run"]);
    expect(argv.slice(argv.indexOf("--memory"), argv.indexOf("--memory") + 4)).toEqual(["--memory", `${MIN_CONTAINER_MEMORY}b`, "--memory-swap", `${MIN_CONTAINER_MEMORY}b`]);
    expect(argv).not.toContain("--cpuset-cpus");
    expect(argv).not.toContain("--workdir");
    expect(argv.slice(argv.indexOf("--network"), argv.indexOf("--network") + 2)).toEqual(["--network", "bridge"]);
    expect(argv.slice(argv.indexOf("--env"), argv.indexOf("--env") + 2)).toEqual(["--env", "TZ=UTC"]);
    expect(argv.slice(-2)).toEqual(["node:24", "node"]);
  });

  it("refuses each bad option with a RangeError", () => {
    const bad: Partial<ContainerOptions>[] = [
      { image: "" },
      { image: "node 24" },
      { memory: MIN_CONTAINER_MEMORY - 1 },
      { memory: 1.5e9 + 0.5 },
      { swap: -1 },
      { cpuset: "0..1" },
      { mounts: ["work"] },
      { mounts: ["/a:b"] },
      { mounts: ["/a,b"] },
      { env: { "1X": "y" } },
      { network: "a b" },
      { user: "runner" },
    ];
    for (const each of bad) expect(() => containerArgv({ ...TARGET, ...each }, "box", ["node"])).toThrow(RangeError);
    expect(() => containerStart({ ...TARGET, memory: 0 })).toThrow(/the memory is a whole number of bytes/);
  });
});

describe("containerStart", () => {
  it("starts the child in a container with the limits of the child, then reads OOMKilled and removes the container", async () => {
    const { start, calls } = fake((argv) => (argv[1] === "run" ? { stdout: '{"ms":5}\n' } : argv[1] === "inspect" ? { stdout: "false\n" } : {}));
    const exit = await containerStart({ ...TARGET, start })(["node", "child.ts"], { timeoutMs: 9000, maxBuffer: 1024, cwd: "/work/tree" });
    expect(exit).toEqual({ stdout: '{"ms":5}\n', stderr: "", code: 0 });
    expect(calls.map((call) => call.argv[1])).toEqual(["run", "inspect", "rm"]);
    const name = calls[0]!.argv[3]!;
    expect(name).toMatch(new RegExp(`^rigor-bench-${process.pid}-\\d+$`));
    expect(calls[0]!.argv).toContain("/work/tree");
    // The folder of the child is the folder in the container. The command docker run starts in the folder of this process.
    expect(calls[0]!.options).toEqual({ timeoutMs: 9000, maxBuffer: 1024 });
    expect(calls[1]!.argv).toEqual(["docker", "inspect", "--format", "{{.State.OOMKilled}}", name]);
    expect(calls[2]!.argv).toEqual(["docker", "rm", "--force", name]);
  });

  it("gives oomKilled for a child that the memory limit stopped, and a new name to each container", async () => {
    const { start, calls } = fake((argv) => (argv[1] === "run" ? { code: 137 } : argv[1] === "inspect" ? { stdout: "true\n" } : {}));
    const child = containerStart({ ...TARGET, start });
    expect(await child(["node"], { timeoutMs: 1, maxBuffer: 1 })).toEqual({ stdout: "", stderr: "", code: 137, oomKilled: true });
    await child(["node"], { timeoutMs: 1, maxBuffer: 1 });
    expect(calls[0]!.argv[3]).not.toBe(calls[3]!.argv[3]);
  });

  it("keeps the end of a child when the inspect fails, and removes the container after a start that throws", async () => {
    const failed = fake((argv) => (argv[1] === "inspect" ? { code: 1, stdout: "true\n" } : { code: 3 }));
    expect(await containerStart({ ...TARGET, start: failed.start })(["node"], { timeoutMs: 1, maxBuffer: 1 })).toEqual({ stdout: "", stderr: "", code: 3 });
    const calls: string[] = [];
    const throws: StartChild = async (argv) => {
      calls.push(argv[1]!);
      if (argv[1] !== "rm") throw new Error(`no ${argv[1]}`);
      return { stdout: "", stderr: "", code: 0 };
    };
    await expect(containerStart({ ...TARGET, start: throws })(["node"], { timeoutMs: 1, maxBuffer: 1 })).rejects.toThrow("no run");
    expect(calls).toEqual(["run", "inspect", "rm"]);
  });
});
