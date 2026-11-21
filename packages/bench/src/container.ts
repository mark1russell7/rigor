/**
 * The start of one child in a Docker container with the limits of a target machine. The limits are its image, its memory,
 * its swap, its CPUs and the rates of its disks. Thus a bench on a large host can measure a child as it operates on a small machine.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { posix } from "node:path";
import type { ChildExit, StartChild, StartOptions } from "./fresh.ts";
import { startProcess, stderrTail } from "./start.ts";

/** The smallest memory limit of a container that Docker accepts: 6 MiB. */
export const MIN_CONTAINER_MEMORY: number = 6 * 1024 * 1024;

/**
 * The limits of a container on one disk of the host. Each rate is for each second. A cloud disk has such limits.
 * Docker applies them to each read and write of the container on that disk that the page cache does not serve.
 */
export interface DiskLimit {
  /** The whole disk of the host as an absolute path, for example `/dev/sda`. `diskOf` gives the disk of a folder. */
  readonly device: string;
  /** The most bytes that the container reads from the disk in each second: `--device-read-bps`. */
  readonly readBytes?: number;
  /** The most read operations of the container on the disk in each second: `--device-read-iops`. */
  readonly readOps?: number;
  /** The most bytes that the container writes to the disk in each second: `--device-write-bps`. */
  readonly writeBytes?: number;
  /** The most write operations of the container on the disk in each second: `--device-write-iops`. */
  readonly writeOps?: number;
}

/** The flag of `docker run` for each limit of a `DiskLimit`, in the order of the argv. */
const DISK_FLAGS = [
  ["readBytes", "--device-read-bps"],
  ["readOps", "--device-read-iops"],
  ["writeBytes", "--device-write-bps"],
  ["writeOps", "--device-write-iops"],
] as const;

/** The options of `containerStart`. The sizes are in bytes. */
export interface ContainerOptions {
  /** The image of each child, for example `node:24.21.0-bookworm-slim`. The image must be on the host before the start. */
  readonly image: string;
  /** The memory limit of the container: the field `memory.max` of its cgroup. Node sizes the heap of V8 from it. */
  readonly memory: number;
  /** The swap of the container, in addition to the memory. The default is 0: no swap. */
  readonly swap?: number;
  /** The CPUs of the host for the container, in the form of `--cpuset-cpus`, for example `0-1`. The default is each CPU. */
  readonly cpuset?: string;
  /** The read and write limits of the container on the disks of the host. The default is no limit. */
  readonly disks?: readonly DiskLimit[];
  /** The folders that the child reads or writes. Each folder is an absolute POSIX path, and it mounts at the same path. */
  readonly mounts?: readonly string[];
  /** The environment variables of the child, in addition to the variables of the image. */
  readonly env?: Readonly<Record<string, string>>;
  /** The network of the container. The default is `none`. Thus a child has no network. */
  readonly network?: string;
  /** The user of the child as `uid:gid`. The default is the user of this process on POSIX, and the user of the image on Windows. */
  readonly user?: string;
  /** The program of Docker. The default is `docker`. */
  readonly docker?: string;
  /** This function starts each command of Docker. The default is `startProcess`. A test gives its own. */
  readonly start?: StartChild;
}

/** The limits of the commands that examine and remove a container after its child. */
const AFTER: StartOptions = { timeoutMs: 60_000, maxBuffer: 1 << 16 };

/** The count of the containers of this process. Each container gets a name that no other container of this process has. */
let containers = 0;

/** This function gives the user of this process as `uid:gid`, or `undefined` on a system with no user ids. */
const processUser = (): string | undefined => (typeof process.getuid === "function" && typeof process.getgid === "function" ? `${process.getuid()}:${process.getgid()}` : undefined);

/** This function examines the options of `containerStart`, and it throws a `RangeError` at the first bad option. */
function check(options: ContainerOptions): void {
  const fail = (what: string): never => {
    throw new RangeError(`containerStart: ${what}`);
  };
  if (!(typeof options.image === "string" && /^\S+$/.test(options.image))) fail(`the image is a name with no space, not ${JSON.stringify(options.image)}.`);
  if (!(Number.isSafeInteger(options.memory) && options.memory >= MIN_CONTAINER_MEMORY)) fail(`the memory is a whole number of bytes, ${MIN_CONTAINER_MEMORY} or more, not ${options.memory}.`);
  const swap = options.swap ?? 0;
  if (!(Number.isSafeInteger(swap) && swap >= 0)) fail(`the swap is a whole number of bytes, 0 or more, not ${swap}.`);
  if (options.cpuset !== undefined && !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(options.cpuset)) fail(`the CPU set is a list such as 0-1 or 0,2, not ${JSON.stringify(options.cpuset)}.`);
  const devices = new Set<string>();
  for (const disk of options.disks ?? []) {
    if (!(typeof disk.device === "string" && /^\/dev\/[^\s:,]+$/.test(disk.device))) fail(`the device of a disk is a path in /dev with no colon, comma or space, not ${JSON.stringify(disk.device)}.`);
    if (devices.has(disk.device)) fail(`two disks have the device ${disk.device}. Give each limit of a device in one entry.`);
    devices.add(disk.device);
    if (DISK_FLAGS.every(([key]) => disk[key] === undefined)) fail(`the disk ${disk.device} has no limit. Give readBytes, readOps, writeBytes or writeOps.`);
    for (const [key] of DISK_FLAGS) {
      const value = disk[key];
      if (value !== undefined && !(Number.isSafeInteger(value) && value >= 1)) fail(`the ${key} of the disk ${disk.device} is a whole number of 1 or more, not ${value}.`);
    }
  }
  for (const mount of options.mounts ?? []) {
    if (!(mount.startsWith("/") && !/[,:\s]/.test(mount))) fail(`a mount is an absolute POSIX path with no comma, colon or space, not ${JSON.stringify(mount)}.`);
  }
  for (const name of Object.keys(options.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`the name of an environment variable is a letter or _, then letters, digits or _, not ${JSON.stringify(name)}.`);
  }
  if (options.network !== undefined && !/^\S+$/.test(options.network)) fail(`the network is a name with no space, not ${JSON.stringify(options.network)}.`);
  if (options.user !== undefined && !/^\d+(?::\d+)?$/.test(options.user)) fail(`the user is uid or uid:gid, not ${JSON.stringify(options.user)}.`);
}

/**
 * This function gives the argv of `docker run` for one child. The container has a name, an init process, the
 * limits of the options, and no network by default. `--pull never` makes an image that is not on the host an error.
 * A pull in the time of a child is not a part of the child. The folder of the child is `cwd`.
 * The limits of the disks follow `--cpuset-cpus`, in the order of `options.disks`.
 */
export function containerArgv(options: ContainerOptions, name: string, argv: readonly string[], cwd?: string): string[] {
  check(options);
  const user = options.user ?? processUser();
  return [
    options.docker ?? "docker",
    "run",
    "--name",
    name,
    "--init",
    "--pull",
    "never",
    "--network",
    options.network ?? "none",
    "--memory",
    `${options.memory}b`,
    "--memory-swap",
    `${options.memory + (options.swap ?? 0)}b`,
    ...(options.cpuset === undefined ? [] : ["--cpuset-cpus", options.cpuset]),
    ...(options.disks ?? []).flatMap((disk) => DISK_FLAGS.flatMap(([key, flag]) => (disk[key] === undefined ? [] : [flag, `${disk.device}:${disk[key]}`]))),
    ...(user === undefined ? [] : ["--user", user]),
    ...(options.mounts ?? []).flatMap((mount) => ["--mount", `type=bind,source=${mount},target=${mount}`]),
    ...Object.entries(options.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    ...(cwd === undefined ? [] : ["--workdir", cwd]),
    options.image,
    ...argv,
  ];
}

/**
 * This function gives a start of children in Docker containers. Give it as `start` to `freshRun` or to `freshArms`.
 *
 * - Each child is the argv in a new container of `options.image`. The first item of the argv is the program in the image.
 * - The time limit and the output limit of the child are the limits of the command `docker run`.
 * - After each child, the start reads the field `OOMKilled` of the container, and it removes the container. A
 *   child that the memory limit stopped gives `oomKilled: true`. A removal also stops a container after a time limit.
 * - The options are examined at once. A bad option is a `RangeError`.
 */
export function containerStart(options: ContainerOptions): StartChild {
  check(options);
  const start = options.start ?? startProcess;
  const docker = options.docker ?? "docker";
  return async (argv, limits) => {
    containers += 1;
    const name = `rigor-bench-${process.pid}-${containers}`;
    const { cwd, ...rest } = limits;
    let exit: ChildExit | undefined;
    let fault: unknown;
    try {
      exit = await start(containerArgv(options, name, argv, cwd), rest);
    } catch (error) {
      fault = error;
    }
    // The container can exist after each start of `docker run`, also after a failure. The removal of a container that does not exist fails, and it changes nothing.
    const state = await start([docker, "inspect", "--format", "{{.State.OOMKilled}}", name], AFTER).catch(() => undefined);
    await start([docker, "rm", "--force", name], AFTER).catch(() => undefined);
    if (exit === undefined) throw fault;
    return state !== undefined && state.code === 0 && state.stdout.trim() === "true" ? { ...exit, oomKilled: true } : exit;
  };
}

/** The reads of the file system that `diskOf` uses. A test gives a fake `/sys`. */
export interface DiskReads {
  /** This function gives the device number of the file system of a path: the field `dev` of `stat`. */
  readonly stat: (path: string) => { readonly dev: bigint | number };
  /** This function gives the real path of a path, with no symbolic link in it. */
  readonly realpath: (path: string) => string;
  /** This function gives the text of a file. */
  readonly readFile: (path: string) => string;
  /** This function gives `true` when a file or a folder exists at the path. */
  readonly exists: (path: string) => boolean;
}

/** The reads of `node:fs`. The `bigint` form of `stat` keeps each bit of the device number. */
const NODE_READS: DiskReads = {
  stat: (path) => statSync(path, { bigint: true }),
  realpath: (path) => realpathSync(path),
  readFile: (path) => readFileSync(path, "utf8"),
  exists: (path) => existsSync(path),
};

/**
 * This function gives the major and the minor number of a Linux device number. It is the decode of `gnu_dev_major`
 * and `gnu_dev_minor` of glibc. The 12 low bits of the major are bits 8 to 19, and its high bits are bits 44 to 63.
 */
function deviceNumbers(dev: bigint): { major: bigint; minor: bigint } {
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
  const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
  return { major, minor };
}

/**
 * This function gives the whole disk of the host that holds `path`, as `/dev/<name>`, on Linux. Give it as the
 * `device` of a `DiskLimit`. Docker sets the limits of a whole disk, not of a partition.
 *
 * - The function reads the device of the path from `stat`, and its entry in `/sys/dev/block`.
 * - For a partition, the disk is the parent folder of the entry. The name is the `DEVNAME` line of its `uevent` file.
 * - A device with no entry in `/sys/dev/block` is an `Error`. Examples are a tmpfs, an overlay and a different anonymous device.
 */
export function diskOf(path: string, read: DiskReads = NODE_READS): string {
  const { major, minor } = deviceNumbers(BigInt(read.stat(path).dev));
  const id = `${major}:${minor}`;
  const entry = `/sys/dev/block/${id}`;
  if (!read.exists(entry)) {
    throw new Error(`diskOf: the path ${path} is on the device ${id}, and ${entry} does not exist. A tmpfs, an overlay or a different device with no disk has no entry.`);
  }
  let folder = read.realpath(entry);
  if (read.exists(posix.join(folder, "partition"))) folder = posix.dirname(folder);
  const uevent = posix.join(folder, "uevent");
  const name = /^DEVNAME=(.*)$/m.exec(read.readFile(uevent))?.[1]?.trim();
  if (name === undefined || name === "") throw new Error(`diskOf: the file ${uevent} of the device ${id} of the path ${path} has no DEVNAME line.`);
  return `/dev/${name}`;
}

/**
 * The command that writes the dirty pages to the disks and drops the page cache of the host. The user of the
 * process needs `sudo` with no password for it. The flag `-n` makes a password prompt an error.
 */
export const PAGE_CACHE_DROP: readonly string[] = Object.freeze(["sudo", "-n", "sh", "-c", "sync && echo 3 > /proc/sys/vm/drop_caches"]);

/** The limits of the command of `dropPageCache`. */
const DROP: StartOptions = { timeoutMs: 60_000, maxBuffer: 1 << 16 };

/**
 * This function drops the page cache of the host with `PAGE_CACHE_DROP`, so the next child reads its files from the disk.
 * Give it in the step `before` of `freshRun` or `freshArms`, after a fresh copy of the state of the child.
 *
 * - `start` starts the command. The default is `startProcess`. The time limit is 60 seconds.
 * - An exit code that is not 0, a time-out or a fault of the start is an `Error` with the tail of `stderr`.
 * - A child that needs a cold cache must not start on a warm cache. Thus each failure is an error.
 */
export async function dropPageCache(start: StartChild = startProcess): Promise<void> {
  let exit: ChildExit;
  try {
    exit = await start(PAGE_CACHE_DROP, DROP);
  } catch (error) {
    throw new Error(`dropPageCache: the drop of the page cache did not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (exit.code === 0 && exit.timedOut !== true && exit.error === undefined) return;
  const why =
    exit.timedOut === true
      ? `took more than ${DROP.timeoutMs} ms`
      : exit.error !== undefined
        ? `failed: ${exit.error}`
        : exit.code === null
          ? "stopped on a signal"
          : `exited with the code ${exit.code}`;
  throw new Error(`dropPageCache: the drop of the page cache ${why}. The tail of stderr: ${stderrTail(exit.stderr)}`);
}
