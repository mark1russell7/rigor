import { matchesGlob, posix } from "node:path";
import { STOP_MINUTES, TARGET_MINUTES } from "./plan.ts";

/**
 * The lane file of a repository (`mutation.json`) names the packages that the mutation tests mutate. A package has
 * its folder, its globs and an optional gate. A big package has parts, so that each part has its own runner.
 */

/** The mutation tests of one package. */
export interface PackageLane {
  /** This field gives the folder of the package, from the folder of the lane file. Stryker starts in this folder. */
  readonly dir: string;
  /**
   * These globs give the files to mutate, from `dir`. A glob with `!` removes the files of the globs before it. A glob
   * with the suffix `:<from>-<to>` gives only those lines of its files, as Stryker reads it.
   */
  readonly mutate: readonly string[];
  /**
   * Each part has its own globs. The `!` globs of `mutate` also apply to each part. Each file of `mutate` must be in
   * exactly one part, so that a full run mutates each file one time. Line ranges can cut one file into parts: then the
   * ranges of the parts must cover each line of the file one time. `partErrors` examines this.
   */
  readonly parts?: Readonly<Record<string, readonly string[]>>;
  /** This field gives the lowest mutation score in percent that passes. Without a gate, the lane only reports the score. */
  readonly gate?: number;
  /**
   * This field tells what the gate of a package with parts reads. With `part`, the default, each part must have a score
   * at the gate. With `package`, the sum of the mutants of the parts must have a score at the gate.
   */
  readonly gateOver?: "part" | "package";
  /** This field gives the Vitest config file, from `dir`. Without it, Vitest finds its config in `dir`. */
  readonly vitestConfig?: string;
  /**
   * This field gives the time in milliseconds that the clock adds to the time of the tests for each mutant. The
   * default is 120000. A short time on a loaded runner stops mutants that the tests detect later.
   */
  readonly timeoutMS?: number;
  /** This field gives the time in minutes for the run of the tests without mutants. The default is 15. */
  readonly dryRunTimeoutMinutes?: number;
  /**
   * These options go into the Stryker config of each selection of the package, for example `ignoreStatic`. The lane
   * owns the keys of `STRYKER_OWNED`, so the field cannot have them.
   */
  readonly stryker?: Readonly<Record<string, unknown>>;
  /**
   * Each test file of this field is on the disk, and no report reads it. The value gives the reason. `scores
   * --test-files` fails for each other test file on the disk that the report does not read. The file is from `dir`.
   */
  readonly notRead?: Readonly<Record<string, string>>;
  /**
   * Each file of this field has a dynamic import with a computed path, and the value gives the reason. The related walk
   * of Vitest does not follow this type of import. `load-check --collect` fails for each other file of the run with one.
   */
  readonly computedImports?: Readonly<Record<string, string>>;
  /**
   * This field gives the most static runs in the plan of each file, from `dir`. The key `*` gives the limit of each other
   * file. A static run starts each test. `plan-check` fails a file over its limit.
   */
  readonly staticLimits?: Readonly<Record<string, number>>;
}

/** The keys of the Stryker config that the lane owns. The field `stryker` of a package cannot have them. */
export const STRYKER_OWNED: readonly string[] = ["mutate", "thresholds", "jsonReporter", "htmlReporter", "timeoutMS", "dryRunTimeoutMinutes"];

/** The lane file: the packages of the mutation tests, and the list of the disabled mutants. */
export interface Lane {
  readonly packages: Readonly<Record<string, PackageLane>>;
  /** This field gives the list of the disabled mutants, from the folder of the lane file. The default is `mutation-disables.json`. */
  readonly disables?: string;
  /**
   * This field gives the highest fall of the test count in percent against the last good count. The default is 20.
   * `scores --last` fails a selection with a higher fall: the report did not read all the tests.
   */
  readonly maxTestFall?: number;
  /** Each selection of this field can have a higher fall of its test count. The value gives the reason. */
  readonly plannedFalls?: Readonly<Record<string, string>>;
  /** This field gives the planned net time of one minute of the clock, for the estimate of `plan-check`. The default is 9.8. */
  readonly planPerClock?: number;
  /** This field gives the target of the estimate of a selection, in minutes. `plan-check` warns of a selection over it. The default is 100. */
  readonly targetMinutes?: number;
  /** This field gives the stop of the estimate of a selection, in minutes. `plan-check` fails a selection over it. The default is 140. */
  readonly stopMinutes?: number;
}

/** The default of `maxTestFall` of the lane, in percent. */
export const MAX_TEST_FALL = 20;

/** A selection is one Stryker run: a package (`collections`) or a part of a package (`collections.impl`). */
export interface Selection {
  readonly name: string;
  readonly pkg: string;
  readonly dir: string;
  readonly mutate: readonly string[];
  readonly gate: number | undefined;
  readonly vitestConfig: string | undefined;
  readonly timeoutMS: number | undefined;
  readonly dryRunTimeoutMinutes: number | undefined;
  readonly stryker: Readonly<Record<string, unknown>> | undefined;
}

const NAME = /^[\w-]+$/;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** This function tells if a value is an object of names, each with a reason that is not empty. */
const isReasons = (x: unknown): x is Record<string, string> => isRecord(x) && Object.values(x).every((r) => typeof r === "string" && r.trim() !== "");

const isGlobs = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.every((g) => typeof g === "string" && g !== "");

/** This function examines a package of the lane file. It gives the errors, with the name of the package. */
function packageErrors(name: string, p: unknown): string[] {
  if (!NAME.test(name)) return [`the package name "${name}" has a character that is not a letter, a digit, "_" or "-"`];
  if (!isRecord(p)) return [`${name}: the package is not an object`];
  const errors: string[] = [];
  if (typeof p["dir"] !== "string" || p["dir"] === "") errors.push(`${name}: "dir" is not a folder name`);
  if (!isGlobs(p["mutate"])) errors.push(`${name}: "mutate" is not a list of globs`);
  else if (p["mutate"].every((g) => g.startsWith("!"))) errors.push(`${name}: "mutate" has only "!" globs`);
  const gate = p["gate"];
  const gateOver = p["gateOver"];
  if (gateOver !== undefined && gateOver !== "part" && gateOver !== "package") errors.push(`${name}: "gateOver" is not "part" or "package"`);
  else if (gateOver === "package" && p["parts"] === undefined) errors.push(`${name}: "gateOver" is "package", but the package has no parts`);
  if (gate !== undefined && (typeof gate !== "number" || !(gate >= 0 && gate <= 100))) errors.push(`${name}: "gate" is not a percent from 0 to 100`);
  if (p["vitestConfig"] !== undefined && typeof p["vitestConfig"] !== "string") errors.push(`${name}: "vitestConfig" is not a file name`);
  for (const field of ["timeoutMS", "dryRunTimeoutMinutes"]) {
    const v = p[field];
    if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v > 0)) errors.push(`${name}: "${field}" is not a positive integer`);
  }
  const stryker = p["stryker"];
  if (stryker !== undefined) {
    if (!isRecord(stryker)) errors.push(`${name}: "stryker" is not an object`);
    else {
      const owned = Object.keys(stryker).filter((k) => STRYKER_OWNED.includes(k));
      if (owned.length > 0) errors.push(`${name}: "stryker" has ${owned.map((k) => `"${k}"`).join(", ")}, but the lane owns these keys`);
    }
  }
  if (p["notRead"] !== undefined && !isReasons(p["notRead"])) errors.push(`${name}: "notRead" is not an object of files, each with a reason`);
  if (p["computedImports"] !== undefined && !isReasons(p["computedImports"])) errors.push(`${name}: "computedImports" is not an object of files, each with a reason`);
  const limits = p["staticLimits"];
  if (limits !== undefined && !(isRecord(limits) && Object.values(limits).every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0))) {
    errors.push(`${name}: "staticLimits" is not an object of files, each with a count of 0 or more`);
  }
  const parts = p["parts"];
  if (parts !== undefined) {
    if (!isRecord(parts) || Object.keys(parts).length === 0) errors.push(`${name}: "parts" is not an object with parts`);
    else {
      for (const [part, globs] of Object.entries(parts)) {
        if (!NAME.test(part)) errors.push(`${name}: the part name "${part}" has a character that is not a letter, a digit, "_" or "-"`);
        if (!isGlobs(globs) || globs.some((g) => g.startsWith("!"))) errors.push(`${name}.${part}: the part is not a list of globs without "!"`);
      }
    }
  }
  return errors;
}

/**
 * This function examines the JSON of a lane file and gives the lane.
 *
 * @throws Error with each problem of the file
 */
export function parseLane(json: unknown): Lane {
  if (!isRecord(json) || !isRecord(json["packages"])) throw new Error(`the lane has no object "packages"`);
  const errors = Object.entries(json["packages"]).flatMap(([name, p]) => packageErrors(name, p));
  if (Object.keys(json["packages"]).length === 0) errors.push(`the lane has no packages`);
  if (json["disables"] !== undefined && typeof json["disables"] !== "string") errors.push(`"disables" is not a file name`);
  const fall = json["maxTestFall"];
  if (fall !== undefined && (typeof fall !== "number" || !(fall >= 0 && fall <= 100))) errors.push(`"maxTestFall" is not a percent from 0 to 100`);
  const planned = json["plannedFalls"];
  if (planned !== undefined && !isReasons(planned)) errors.push(`"plannedFalls" is not an object of selections, each with a reason`);
  const positive = (v: unknown): v is number => typeof v === "number" && v > 0 && Number.isFinite(v);
  for (const field of ["planPerClock", "targetMinutes", "stopMinutes"]) {
    if (json[field] !== undefined && !positive(json[field])) errors.push(`"${field}" is not a positive number`);
  }
  const target = json["targetMinutes"] ?? TARGET_MINUTES;
  const stop = json["stopMinutes"] ?? STOP_MINUTES;
  if (positive(target) && positive(stop) && stop < target) errors.push(`"stopMinutes" (${String(stop)}) is less than "targetMinutes" (${String(target)})`);
  if (errors.length > 0) throw new Error(`the lane is not valid:\n  ${errors.join("\n  ")}`);
  const lane = json as unknown as Lane;
  const names = new Set(selectionNames(lane));
  const unknown = Object.keys(lane.plannedFalls ?? {}).filter((n) => !names.has(n));
  if (unknown.length > 0) throw new Error(`the lane is not valid:\n  "plannedFalls" names no selection of the lane: ${unknown.join(", ")}`);
  return lane;
}

/** This function gives the names of all the selections of a lane: each package, then each part of the package. */
export function selectionNames(lane: Lane): string[] {
  return Object.entries(lane.packages).flatMap(([name, p]) => [name, ...Object.keys(p.parts ?? {}).map((part) => `${name}.${part}`)]);
}

/** This function gives the selections of a full run: the parts of each package with parts, else the package. Each file is in one run. */
export function runSelections(lane: Lane): string[] {
  return Object.entries(lane.packages).flatMap(([name, p]) => (p.parts === undefined ? [name] : Object.keys(p.parts).map((part) => `${name}.${part}`)));
}

/**
 * This function gives the selection of a name: a package, or a part of a package.
 *
 * @throws Error when the lane has no package or part of that name
 */
export function select(lane: Lane, name: string): Selection {
  const [pkg = "", part, ...rest] = name.split(".");
  const p = lane.packages[pkg];
  const globs = part === undefined ? undefined : p?.parts?.[part];
  if (p === undefined || rest.length > 0 || (part !== undefined && globs === undefined)) {
    throw new Error(`the lane has no package or part "${name}". It has: ${selectionNames(lane).join(", ")}`);
  }
  // Stryker applies a "!" glob to the globs before it, so the "!" globs of the package go after the globs of the part.
  const mutate = globs === undefined ? p.mutate : [...globs, ...p.mutate.filter((g) => g.startsWith("!"))];
  return { name, pkg, dir: p.dir, mutate, gate: p.gate, vitestConfig: p.vitestConfig, timeoutMS: p.timeoutMS, dryRunTimeoutMinutes: p.dryRunTimeoutMinutes, stryker: p.stryker };
}

/** A `mutate` entry with a range, as Stryker reads it: `src/a.ts:1-300`, or `src/a.ts:1:4-300:2` with columns. */
const RANGE = /^(.+?):(\d+)(?::(\d+))?-(\d+)(?::(\d+))?$/;

/** This type is a `mutate` entry with a range of lines. */
interface LineRange {
  readonly entry: string;
  readonly glob: string;
  readonly from: number;
  readonly to: number;
  readonly columns: boolean;
}

function rangeOf(entry: string): LineRange | undefined {
  const m = RANGE.exec(entry);
  if (m?.[1] === undefined) return undefined;
  return { entry, glob: m[1], from: Number(m[2]), to: Number(m[4]), columns: m[3] !== undefined || m[5] !== undefined };
}

/** This function gives the glob of a `mutate` entry, with no range. */
const globOf = (entry: string): string => rangeOf(entry)?.glob ?? entry;

/**
 * This function tells if globs select a file. It reads the globs as Stryker does. A glob adds its files. A glob with
 * `!` removes its files from the files of the globs before it. A glob with a line range selects its files.
 */
export function globsSelect(globs: readonly string[], file: string): boolean {
  let selected = false;
  for (const g of globs) {
    if (g.startsWith("!")) {
      if (selected && matchesGlob(file, globOf(g.slice(1)))) selected = false;
    } else if (!selected && matchesGlob(file, globOf(g))) selected = true;
  }
  return selected;
}

/**
 * This function gives what globs select of a selected file. The value is "all" when a glob with no range selects the
 * file. Otherwise it is the line ranges of the file.
 */
function coverOf(globs: readonly string[], file: string): "all" | LineRange[] {
  const adds = globs.filter((g) => !g.startsWith("!") && matchesGlob(file, globOf(g)));
  if (adds.some((g) => rangeOf(g) === undefined)) return "all";
  return adds.flatMap((g) => rangeOf(g) ?? []);
}

/** A test file and its source file of the same name: `src/a.test.ts` tests `src/a.ts`. */
const TEST_FILE = /^(.+)\.(?:test|spec)(\.[^./]+)$/;

/**
 * This function gives the changed files of a selection, from the folder of its package. The globs of the selection
 * select the files. A file that the selection takes in line ranges gives one entry for each range, `src/a.ts:1-300`.
 * A changed test file gives its source file of the same name, when the selection takes it and `exists` finds it.
 *
 * @param changed - the changed paths, from the folder of the lane file, with `/`
 * @param exists - this function tells if a file, from the folder of the package, exists. The default finds each file.
 */
export function changedFiles(selection: Selection, changed: readonly string[], exists: (file: string) => boolean = () => true): string[] {
  const dir = posix.normalize(selection.dir.replaceAll("\\", "/"));
  const sourceOf = (f: string): string | undefined => {
    if (globsSelect(selection.mutate, f)) return f;
    const source = f.replace(TEST_FILE, "$1$2");
    return source !== f && globsSelect(selection.mutate, source) && exists(source) ? source : undefined;
  };
  const files = changed
    .map((f) => posix.relative(dir, posix.normalize(f.replaceAll("\\", "/"))))
    .flatMap((f) => (f === "" || f.startsWith("../") || posix.isAbsolute(f) ? [] : (sourceOf(f) ?? [])));
  return [...new Set(files)]
    .flatMap((f) => {
      const cover = coverOf(selection.mutate, f);
      return cover === "all" ? [f] : cover.map((r) => `${f}${r.entry.slice(r.glob.length)}`);
    });
}

/** This function gives the errors of the line ranges of one file in the parts of a package. */
function rangeErrors(pkg: string, file: string, ranges: readonly { part: string; range: LineRange }[], lines: number | undefined): string[] {
  const errors: string[] = [];
  for (const { part, range } of ranges) {
    if (range.columns) errors.push(`${pkg}: the range ${range.entry} of the part ${part} has columns. A part can cut a file only by lines`);
    else if (range.from < 1 || range.from > range.to) errors.push(`${pkg}: the range ${range.entry} of the part ${part} has no lines`);
  }
  if (errors.length > 0) return errors;
  let next = 1;
  let last = "";
  for (const { part, range } of ranges.toSorted((x, y) => x.range.from - y.range.from || x.range.to - y.range.to)) {
    if (range.from > next) errors.push(`${pkg}: the lines ${String(next)}-${String(range.from - 1)} of ${file} are in no part`);
    else if (range.from < next) errors.push(`${pkg}: the lines ${String(range.from)}-${String(Math.min(range.to, next - 1))} of ${file} are in the parts ${last} and ${part}`);
    if (range.to >= next) {
      next = range.to + 1;
      last = part;
    }
  }
  if (lines !== undefined && next <= lines) errors.push(`${pkg}: the lines ${String(next)}-${String(lines)} of ${file} are in no part`);
  return errors;
}

/**
 * This function examines the parts of a package against its files. It gives an error for each file of `mutate` in no
 * part. It also gives an error for each file in two parts, and for each file of a part that is not in `mutate`. A
 * package with no parts has no errors.
 *
 * Parts can cut one file by line ranges. Then the function gives an error for each gap and each overlap of the
 * ranges. With `lines`, it also gives an error for the lines after the last range.
 *
 * @param files - the source files of the package, from its folder, with `/`
 * @param lines - this function gives the number of lines of a file of `files`
 */
export function partErrors(lane: Lane, pkg: string, files: readonly string[], lines?: (file: string) => number): string[] {
  const p = lane.packages[pkg];
  if (p?.parts === undefined) return [];
  const parts = Object.keys(p.parts).map((part) => ({ part, mutate: select(lane, `${pkg}.${part}`).mutate }));
  const errors: string[] = [];
  for (const file of files) {
    const inMutate = globsSelect(p.mutate, file);
    const inParts = parts.filter((x) => globsSelect(x.mutate, file)).map((x) => x.part);
    const covers = parts.filter((x) => inParts.includes(x.part)).map((x) => ({ part: x.part, cover: coverOf(x.mutate, file) }));
    const ranged = covers.every((x) => x.cover !== "all");
    if (inMutate && inParts.length === 0) errors.push(`${pkg}: the file ${file} is in no part, so a full run does not mutate it`);
    else if (inParts.length > 1 && !ranged) errors.push(`${pkg}: the file ${file} is in more than one part: ${inParts.join(", ")}`);
    else if (!inMutate && inParts.length > 0) errors.push(`${pkg}: the file ${file} is in the part ${inParts.join(", ")}, but not in "mutate"`);
    else if (inParts.length > 0 && ranged) {
      const ranges = covers.flatMap((x) => (x.cover === "all" ? [] : x.cover.map((range) => ({ part: x.part, range }))));
      errors.push(...rangeErrors(pkg, file, ranges, lines?.(file)));
    }
  }
  return errors;
}
