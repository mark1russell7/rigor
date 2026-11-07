import { matchesGlob, posix } from "node:path";

/**
 * The lane file of a repository (`mutation.json`) names the packages that the mutation tests mutate. A package has
 * its folder, its globs and an optional gate. A big package has parts, so that each part has its own runner.
 */

/** The mutation tests of one package. */
export interface PackageLane {
  /** This field gives the folder of the package, from the folder of the lane file. Stryker starts in this folder. */
  readonly dir: string;
  /** These globs give the files to mutate, from `dir`. A glob with `!` removes the files of the globs before it. */
  readonly mutate: readonly string[];
  /**
   * Each part has its own globs. The `!` globs of `mutate` also apply to each part. Each file of `mutate` must be in
   * exactly one part, so that a full run mutates each file one time. `partErrors` examines this.
   */
  readonly parts?: Readonly<Record<string, readonly string[]>>;
  /** This field gives the lowest mutation score in percent that passes. Without a gate, the lane only reports the score. */
  readonly gate?: number;
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

/**
 * This function tells if globs select a file. It reads the globs as Stryker does. A glob adds its files. A glob with
 * `!` removes its files from the files of the globs before it.
 */
export function globsSelect(globs: readonly string[], file: string): boolean {
  let selected = false;
  for (const g of globs) {
    if (g.startsWith("!")) {
      if (selected && matchesGlob(file, g.slice(1))) selected = false;
    } else if (!selected && matchesGlob(file, g)) selected = true;
  }
  return selected;
}

/**
 * This function gives the changed files of a selection, from the folder of its package. The globs of the selection
 * select the files.
 *
 * @param changed - the changed paths, from the folder of the lane file, with `/`
 */
export function changedFiles(selection: Selection, changed: readonly string[]): string[] {
  const dir = posix.normalize(selection.dir.replaceAll("\\", "/"));
  return changed
    .map((f) => posix.relative(dir, posix.normalize(f.replaceAll("\\", "/"))))
    .filter((f) => f !== "" && !f.startsWith("../") && !posix.isAbsolute(f) && globsSelect(selection.mutate, f));
}

/**
 * This function examines the parts of a package against its files. It gives an error for each file of `mutate` in no
 * part. It also gives an error for each file in two parts, and for each file of a part that is not in `mutate`. A
 * package with no parts has no errors.
 *
 * @param files - the source files of the package, from its folder, with `/`
 */
export function partErrors(lane: Lane, pkg: string, files: readonly string[]): string[] {
  const p = lane.packages[pkg];
  if (p?.parts === undefined) return [];
  const parts = Object.keys(p.parts).map((part) => ({ part, mutate: select(lane, `${pkg}.${part}`).mutate }));
  const errors: string[] = [];
  for (const file of files) {
    const inMutate = globsSelect(p.mutate, file);
    const inParts = parts.filter((x) => globsSelect(x.mutate, file)).map((x) => x.part);
    if (inMutate && inParts.length === 0) errors.push(`${pkg}: the file ${file} is in no part, so a full run does not mutate it`);
    else if (inParts.length > 1) errors.push(`${pkg}: the file ${file} is in more than one part: ${inParts.join(", ")}`);
    else if (!inMutate && inParts.length === 1) errors.push(`${pkg}: the file ${file} is in the part ${inParts.join("")}, but not in "mutate"`);
  }
  return errors;
}
