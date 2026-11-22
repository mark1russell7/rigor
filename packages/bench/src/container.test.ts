import { describe, expect, it } from "vitest";
import { type ContainerOptions, type DiskLimit, type DiskReads, type Sidecar, MIN_CONTAINER_MEMORY, PAGE_CACHE_DROP, containerArgv, containerStart, diskOf, dropPageCache } from "./container.ts";
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

  it("puts the limits of each disk after the CPU set and before the user, in the order of the disks and of the four flags", () => {
    const disks = [
      { device: "/dev/sda", writeOps: 300, readBytes: 5_242_880 },
      { device: "/dev/nvme0n1", readOps: 1500, writeBytes: 1_048_576 },
      { device: "/dev/dm-0", readBytes: 1, readOps: 2, writeBytes: 3, writeOps: 4 },
    ];
    const argv = containerArgv({ ...TARGET, disks }, "box", ["node"]);
    const from = argv.indexOf("--cpuset-cpus") + 2;
    expect(argv.slice(from, argv.indexOf("--user"))).toEqual([
      "--device-read-bps",
      "/dev/sda:5242880",
      "--device-write-iops",
      "/dev/sda:300",
      "--device-read-iops",
      "/dev/nvme0n1:1500",
      "--device-write-bps",
      "/dev/nvme0n1:1048576",
      "--device-read-bps",
      "/dev/dm-0:1",
      "--device-read-iops",
      "/dev/dm-0:2",
      "--device-write-bps",
      "/dev/dm-0:3",
      "--device-write-iops",
      "/dev/dm-0:4",
    ]);
    // With no CPU set, the limits of the disks follow the swap.
    const { cpuset: _cpuset, ...rest } = TARGET;
    const plain = containerArgv({ ...rest, disks: [{ device: "/dev/sda", readBytes: 7 }] }, "box", ["node"]);
    expect(plain.slice(plain.indexOf("--memory-swap") + 2, plain.indexOf("--user"))).toEqual(["--device-read-bps", "/dev/sda:7"]);
    expect(containerArgv(TARGET, "box", ["node"]).filter((item) => item.startsWith("--device-"))).toEqual([]);
    expect(containerArgv({ ...TARGET, disks: [] }, "box", ["node"])).toEqual(containerArgv(TARGET, "box", ["node"]));
  });

  it("refuses a bad device, a disk with no limit, a limit that is not a whole number of 1 or more, and two entries of one device", () => {
    const argv = (disks: readonly DiskLimit[]) => () => containerArgv({ ...TARGET, disks }, "box", ["node"]);
    for (const device of ["sda", "/dev/", "/dev/sd a", "/dev/sda:1", "/dev/a,b", "/sys/sda", " /dev/sda"]) {
      expect(argv([{ device, readBytes: 1 }])).toThrow(/^containerStart: the device of a disk is a path in \/dev/);
    }
    expect(argv([{ device: "/dev/sda" }])).toThrow(new RangeError("containerStart: the disk /dev/sda has no limit. Give readBytes, readOps, writeBytes or writeOps."));
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      for (const key of ["readBytes", "readOps", "writeBytes", "writeOps"] as const) {
        expect(argv([{ device: "/dev/sda", [key]: value }])).toThrow(new RangeError(`containerStart: the ${key} of the disk /dev/sda is a whole number of 1 or more, not ${value}.`));
      }
    }
    expect(argv([{ device: "/dev/sda", readBytes: 1 }, { device: "/dev/sdb", readBytes: 1 }, { device: "/dev/sda", writeBytes: 1 }])).toThrow(/^containerStart: two disks have the device \/dev\/sda\./);
    expect(() => containerStart({ ...TARGET, disks: [{ device: "/dev/sda", readOps: 0 }] })).toThrow(RangeError);
  });
});

/** The device number of a major and a minor number, as `gnu_dev_makedev` of glibc gives it. */
function makedev(major: bigint, minor: bigint): bigint {
  return ((major & 0xfffn) << 8n) | ((major & ~0xfffn) << 32n) | (minor & 0xffn) | ((minor & ~0xffn) << 12n);
}

/** A fake file system for `diskOf`: the device of each path, the links of `/sys`, and the files and folders. */
function fakeSys(devices: Record<string, bigint | number>, links: Record<string, string>, files: Record<string, string>): { read: DiskReads; reads: string[] } {
  const reads: string[] = [];
  const folders = new Set(Object.keys(files).flatMap((file) => file.split("/").map((_, i, parts) => parts.slice(0, i).join("/"))));
  const read: DiskReads = {
    stat: (path) => {
      const dev = devices[path];
      if (dev === undefined) throw new Error(`ENOENT: ${path}`);
      return { dev };
    },
    realpath: (path) => links[path] ?? path,
    readFile: (path) => {
      reads.push(path);
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    exists: (path) => path in links || path in files || folders.has(path),
  };
  return { read, reads };
}

const SATA = "/sys/devices/pci0000:00/0000:00:1f.2/ata1/host0/target0:0:0/0:0:0:0/block/sda";
const NVME = "/sys/devices/pci0000:00/0000:00:1d.0/0000:3d:00.0/nvme/nvme0/nvme0n1";

describe("diskOf", () => {
  const { read, reads } = fakeSys(
    { "/work": makedev(8n, 1n), "/srv": Number(makedev(259n, 0n)), "/far": makedev(5000n, 300_000n), "/tmp": makedev(0n, 47n), "/odd": makedev(8n, 16n) },
    { "/sys/dev/block/8:1": `${SATA}/sda1`, "/sys/dev/block/259:0": NVME, "/sys/dev/block/5000:300000": "/sys/devices/virtual/block/dm-7", "/sys/dev/block/8:16": "/sys/devices/virtual/block/sdb" },
    {
      [`${SATA}/uevent`]: "MAJOR=8\nMINOR=0\nDEVNAME=sda\nDEVTYPE=disk\n",
      [`${SATA}/sda1/partition`]: "1\n",
      [`${SATA}/sda1/uevent`]: "MAJOR=8\nMINOR=1\nDEVNAME=sda1\nDEVTYPE=partition\nPARTN=1\n",
      [`${NVME}/uevent`]: "MAJOR=259\nMINOR=0\nDEVNAME=nvme0n1\nDEVTYPE=disk\n",
      "/sys/devices/virtual/block/dm-7/uevent": "MAJOR=5000\nMINOR=300000\nDEVNAME=dm-7\nDEVTYPE=disk\n",
      "/sys/devices/virtual/block/sdb/uevent": "MAJOR=8\nMINOR=16\nDEVTYPE=disk\n",
    },
  );

  it("gives the whole disk of a path on a partition, from the parent folder of the entry of the partition", () => {
    expect(diskOf("/work", read)).toBe("/dev/sda");
    expect(reads.at(-1)).toBe(`${SATA}/uevent`);
  });

  it("gives the disk of a path on a whole disk, also from a device number that is a number", () => {
    expect(diskOf("/srv", read)).toBe("/dev/nvme0n1");
    expect(reads.at(-1)).toBe(`${NVME}/uevent`);
  });

  it("decodes the high bits of the major and the minor number", () => {
    expect(diskOf("/far", read)).toBe("/dev/dm-7");
  });

  it("refuses a device with no entry in /sys/dev/block, and a disk with no DEVNAME line", () => {
    expect(() => diskOf("/tmp", read)).toThrow("diskOf: the path /tmp is on the device 0:47, and /sys/dev/block/0:47 does not exist.");
    expect(() => diskOf("/odd", read)).toThrow("diskOf: the file /sys/devices/virtual/block/sdb/uevent of the device 8:16 of the path /odd has no DEVNAME line.");
    expect(() => diskOf("/none", read)).toThrow("ENOENT: /none");
  });
});

describe("dropPageCache", () => {
  it("runs the command of the drop with a time limit of 60 s", async () => {
    expect(PAGE_CACHE_DROP).toEqual(["sudo", "-n", "sh", "-c", "sync && echo 3 > /proc/sys/vm/drop_caches"]);
    expect(Object.isFrozen(PAGE_CACHE_DROP)).toBe(true);
    const { start, calls } = fake();
    await dropPageCache(start);
    expect(calls).toEqual([{ argv: PAGE_CACHE_DROP, options: { timeoutMs: 60_000, maxBuffer: 1 << 16 } }]);
  });

  it("throws with the tail of stderr when the command fails, takes too long or does not start", async () => {
    const denied = fake(() => ({ code: 1, stderr: "sudo: a password is required\n" }));
    await expect(dropPageCache(denied.start)).rejects.toThrow("dropPageCache: the drop of the page cache exited with the code 1. The tail of stderr: sudo: a password is required");
    await expect(dropPageCache(fake(() => ({ code: null, timedOut: true })).start)).rejects.toThrow("dropPageCache: the drop of the page cache took more than 60000 ms. The tail of stderr: (empty)");
    await expect(dropPageCache(fake(() => ({ code: null })).start)).rejects.toThrow("stopped on a signal");
    await expect(dropPageCache(fake(() => ({ code: null, error: "spawn sudo ENOENT" })).start)).rejects.toThrow("dropPageCache: the drop of the page cache failed: spawn sudo ENOENT.");
    const throws: StartChild = async () => {
      throw new Error("no start");
    };
    await expect(dropPageCache(throws)).rejects.toThrow("dropPageCache: the drop of the page cache did not start: no start");
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

describe("containerStart with sidecars", () => {
  const FAKE: Sidecar = { argv: ["node", "fake.ts", "--port", "4100"], memory: 64 * 1024 * 1024, cpuset: "2", mounts: ["/repo"], cwd: "/repo", ready: ["node", "ready.ts"], readyMs: 5000 };
  const PROXY: Sidecar = { argv: ["proxy"], image: "proxy:1", memory: MIN_CONTAINER_MEMORY };
  /** The reply of Docker to a child with sidecars that each start, are ready and still run at the end of the child. */
  const running = (argv: readonly string[]): Partial<ChildExit> =>
    argv[1] === "run" && !argv.includes("--detach")
      ? { stdout: '{"ms":5}\n' }
      : argv[1] === "inspect"
        ? { stdout: argv[3]!.includes("Running") ? "true false 0\n" : "false\n" }
        : argv[1] === "logs"
          ? { stdout: `out of ${argv[2]!}\n`, stderr: "" }
          : {};

  it("starts each sidecar and waits for it, starts the child in the network of the first sidecar, then reads and removes each container", async () => {
    const { start, calls } = fake(running);
    const exit = await containerStart({ ...TARGET, network: "lab", sidecars: [FAKE, PROXY], start })(["node", "child.ts"], { timeoutMs: 9000, maxBuffer: 1024 });
    const name = calls[0]!.argv[4]!.replace(/-sidecar-0$/, "");
    expect(name).toMatch(new RegExp(`^rigor-bench-${process.pid}-\\d+$`));
    const [first, second] = [`${name}-sidecar-0`, `${name}-sidecar-1`];
    expect(calls.map((call) => call.argv.slice(1, 3).join(" "))).toEqual([
      "run --detach",
      `exec ${first}`,
      "run --detach",
      `run --name`,
      `inspect --format`,
      `logs ${first}`,
      `inspect --format`,
      `logs ${second}`,
      "inspect --format",
      `rm --force`,
      `rm --force`,
      `rm --force`,
    ]);
    // The first sidecar has the network of the options, its own limits, and the user of the child. The second joins the first.
    expect(calls[0]!.argv).toEqual(["docker", "run", "--detach", ...containerArgv({ image: TARGET.image, memory: FAKE.memory, cpuset: "2", mounts: ["/repo"], network: "lab", user: "1001:118" }, first, FAKE.argv, "/repo").slice(2)]);
    expect(calls[1]!.argv).toEqual(["docker", "exec", first, "node", "ready.ts"]);
    expect(calls[1]!.options).toEqual({ timeoutMs: 5000, maxBuffer: 1 << 16 });
    expect(calls[2]!.argv).toContain(`container:${first}`);
    expect(calls[2]!.argv).toContain("proxy:1");
    expect(calls[3]!.argv).toEqual(containerArgv({ ...TARGET, network: `container:${first}` }, name, ["node", "child.ts"]));
    expect(calls[3]!.options).toEqual({ timeoutMs: 9000, maxBuffer: 1024 });
    expect(calls[5]!.options).toEqual({ timeoutMs: 60_000, maxBuffer: 1024 });
    expect(calls.slice(-3).map((call) => call.argv[3])).toEqual([name, first, second]);
    expect(exit).toEqual({ stdout: '{"ms":5}\n', stderr: "", code: 0, sidecars: [{ stdout: `out of ${first}\n`, stderr: "" }, { stdout: `out of ${second}\n`, stderr: "" }] });
  });

  it("gives a fault outside the child for a sidecar that does not start or is not ready, and starts no child after it", async () => {
    const failed = fake((argv) => (argv.includes("--detach") ? { code: 125, stderr: "no such image" } : running(argv)));
    const exit = await containerStart({ ...TARGET, sidecars: [FAKE], start: failed.start })(["node"], { timeoutMs: 1, maxBuffer: 1 });
    expect(exit).toMatchObject({ code: null, stderr: "no such image", error: "the sidecar 0 did not start: the command exited with the code 125" });
    expect(failed.calls.some((call) => call.argv[1] === "run" && !call.argv.includes("--detach"))).toBe(false);
    expect(failed.calls.filter((call) => call.argv[1] === "rm")).toHaveLength(2);
    const slow = fake((argv) => (argv[1] === "exec" ? { code: null, timedOut: true } : running(argv)));
    const late = await containerStart({ ...TARGET, sidecars: [FAKE], start: slow.start })(["node"], { timeoutMs: 1, maxBuffer: 1 });
    expect(late.error).toBe("the sidecar 0 was not ready: the command took more than 5000 ms");
    expect(late.sidecars).toEqual([{ stdout: `out of ${slow.calls[0]!.argv[4]!}\n`, stderr: "" }]);
  });

  it("gives a fault for a sidecar that stopped or passed its memory limit before the end of the child, and keeps a fault of the child", async () => {
    const endOf = async (state: string, child: Partial<ChildExit> = {}): Promise<ChildExit> => {
      const { start } = fake((argv) => (argv[1] === "inspect" && argv[3]!.includes("Running") ? { stdout: state } : argv[1] === "run" && !argv.includes("--detach") ? child : running(argv)));
      return containerStart({ ...TARGET, sidecars: [FAKE], start })(["node"], { timeoutMs: 1, maxBuffer: 1 });
    };
    expect((await endOf("false false 1\n")).error).toBe("the sidecar 0 stopped with the code 1 before the end of the child");
    expect((await endOf("false true 137\n")).error).toBe("the sidecar 0 passed its memory limit before the end of the child");
    expect((await endOf("")).error).toBe("the state of the sidecar 0 is not known");
    expect((await endOf("false false 1\n", { error: "spawn docker ENOENT" })).error).toBe("spawn docker ENOENT");
    expect((await endOf("true false 0\n")).error).toBeUndefined();
  });

  it("refuses a sidecar with no argv, a bad command ready or readyMs, and a bad limit, with the index of the sidecar", () => {
    const refused = (sidecar: Partial<Sidecar>): (() => StartChild) => () => containerStart({ ...TARGET, sidecars: [FAKE, { ...FAKE, ...sidecar } as Sidecar] });
    expect(refused({ argv: [] })).toThrow("the argv of the sidecar 1 is a list of one text or more.");
    expect(refused({ ready: [] })).toThrow("the command ready of the sidecar 1");
    expect(refused({ readyMs: 0 })).toThrow("the readyMs of the sidecar 1");
    expect(refused({ memory: 1 })).toThrow(/^containerStart: the sidecar 1: the memory is a whole number/);
    expect(refused({ mounts: ["repo"] })).toThrow("the sidecar 1: a mount is an absolute POSIX path");
  });
});
