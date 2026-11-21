/**
 * The start of one child in a Docker container with the limits of a target machine: its image, its memory, its swap
 * and its CPUs. Thus a bench on a large host can measure a child as it runs on a small machine.
 */
import type { ChildExit, StartChild, StartOptions } from "./fresh.ts";
import { startProcess } from "./start.ts";

/** The smallest memory limit of a container that Docker accepts: 6 MiB. */
export const MIN_CONTAINER_MEMORY: number = 6 * 1024 * 1024;

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
 * A pull in the time of a child is not a part of the child. The folder of the child is `options.cwd`.
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
