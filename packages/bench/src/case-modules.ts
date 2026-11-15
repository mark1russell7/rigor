/**
 * The cases of a bench in several modules. A run starts each case of each module of a list. A test of the bench
 * compares the list with the modules of its folder, because a case that no run starts is not measured.
 */

/** The cases of a list of modules in one record, and the module of each case. */
export interface MergedCases<T> {
  /** The cases of all modules by name, in the order of the modules and of the cases in each module. */
  readonly cases: Readonly<Record<string, T>>;
  /** The name of the module of each case. */
  readonly moduleOf: Readonly<Record<string, string>>;
}

/**
 * This function merges the cases of a list of modules into one record. The key of `modules` is the name of a module,
 * for example its file name. Two cases with one name are an error that names the two modules.
 */
export function mergeCaseModules<T>(modules: Readonly<Record<string, Readonly<Record<string, T>>>>): MergedCases<T> {
  if (typeof modules !== "object" || modules === null || Array.isArray(modules)) throw new RangeError("mergeCaseModules: the modules are a record of modules by name.");
  const names = Object.keys(modules);
  if (names.length === 0) throw new RangeError("mergeCaseModules: the list has no module.");
  const cases = new Map<string, T>();
  const moduleOf = new Map<string, string>();
  for (const name of names) {
    const module = modules[name];
    if (typeof module !== "object" || module === null || Array.isArray(module)) throw new RangeError(`mergeCaseModules: the module ${JSON.stringify(name)} is a record of cases by name.`);
    for (const [id, value] of Object.entries(module)) {
      if (id === "") throw new RangeError(`mergeCaseModules: the module ${JSON.stringify(name)} has a case with an empty name.`);
      const other = moduleOf.get(id);
      if (other !== undefined) throw new RangeError(`mergeCaseModules: the case ${JSON.stringify(id)} is in the modules ${JSON.stringify(other)} and ${JSON.stringify(name)}. Give each case its own name.`);
      cases.set(id, value);
      moduleOf.set(id, name);
    }
  }
  // `Object.fromEntries` makes an own key of each name, also of the name `__proto__`.
  return { cases: Object.fromEntries(cases), moduleOf: Object.fromEntries(moduleOf) };
}

/** The differences between the modules of a folder and the list of modules of a bench. */
export interface ModuleListGaps {
  /** The modules of the folder that are not in the list, in sorted order. No run starts their cases. */
  readonly unlisted: readonly string[];
  /** The modules of the list that are not in the folder, in sorted order. */
  readonly missing: readonly string[];
}

/**
 * This function compares the modules of a folder with the list of modules of a bench. The test of a bench reads its
 * folder, removes each file that is not a module of cases, and expects no difference.
 */
export function moduleListGaps(files: readonly string[], listed: readonly string[]): ModuleListGaps {
  for (const [what, names] of [["files", files], ["listed modules", listed]] as const) {
    if (!Array.isArray(names) || names.some((n) => typeof n !== "string" || n === "")) throw new RangeError(`moduleListGaps: the ${what} are a list of strings that are not empty.`);
  }
  const inFolder = new Set(files);
  const inList = new Set(listed);
  return { unlisted: [...inFolder].filter((f) => !inList.has(f)).sort(), missing: [...inList].filter((m) => !inFolder.has(m)).sort() };
}
