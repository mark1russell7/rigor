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
  /** Each part has its own globs. The `!` globs of `mutate` also apply to each part. */
  readonly parts?: Readonly<Record<string, readonly string[]>>;
  /** This field gives the lowest mutation score in percent that passes. Without a gate, the lane only reports the score. */
  readonly gate?: number;
  /** This field gives the Vitest config file, from `dir`. Without it, Vitest finds its config in `dir`. */
  readonly vitestConfig?: string;
}

/** The lane file: the packages of the mutation tests, and the list of the disabled mutants. */
export interface Lane {
  readonly packages: Readonly<Record<string, PackageLane>>;
  /** This field gives the list of the disabled mutants, from the folder of the lane file. The default is `mutation-disables.json`. */
  readonly disables?: string;
}

/** A selection is one Stryker run: a package (`collections`) or a part of a package (`collections.impl`). */
export interface Selection {
  readonly name: string;
  readonly pkg: string;
  readonly dir: string;
  readonly mutate: readonly string[];
  readonly gate: number | undefined;
  readonly vitestConfig: string | undefined;
}

const NAME = /^[\w-]+$/;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

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
  if (errors.length > 0) throw new Error(`the lane is not valid:\n  ${errors.join("\n  ")}`);
  return json as unknown as Lane;
}

/** This function gives the names of all the selections of a lane: each package, then each part of the package. */
export function selectionNames(lane: Lane): string[] {
  return Object.entries(lane.packages).flatMap(([name, p]) => [name, ...Object.keys(p.parts ?? {}).map((part) => `${name}.${part}`)]);
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
  return { name, pkg, dir: p.dir, mutate, gate: p.gate, vitestConfig: p.vitestConfig };
}
