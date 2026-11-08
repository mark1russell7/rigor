/**
 * The CLI `rigor-mutation`. The work is in `runCli`, so a test can start the CLI in a fixture folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { REPORT_DIR, rewritesTsconfig, strykerConfig } from "./config.ts";
import { compareDisables, findDisables, type Disable } from "./disables.ts";
import { collectFaults, computedImports, leavingPaths, relatedTestFiles, type Collected, type CollectRequest, type PackageFile } from "./load.ts";
import { changedFiles, globsSelect, MAX_TEST_FALL, parseLane, partErrors, runSelections, select, selectionNames, type Lane, type Selection } from "./lane.ts";
import { parsePlan, PLAN_FILE, readPlan } from "./plan.ts";
import { PARTIAL_FILE } from "./reporter.ts";
import { copyOfFolder, ignoreRules, minimatchOf, removeCopy, sandboxFiles, tempDirOf } from "./sandbox.ts";
import { failScore, formatScore, packageScore, parsePartial, parseReport, readFaults, partialScore, scoreReport, summaryMarkdown, testFall, testFileFaults, unreadTestFiles, type MutationReport, type Score } from "./score.ts";

/** The input and the output of the CLI. */
export interface CliIo {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** The environment. With `GITHUB_ACTIONS` set to `true`, `scores` writes an annotation for each score that does not pass and each planned fall. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The help text of the CLI. */
export const HELP: string = `rigor-mutation: the mutation tests of a repository, with Stryker and a gate for each package.

  rigor-mutation list [--runs] [--changed <file>]
                                               the packages and the parts of the lane. With --runs, the
                                               selections of a full run: the parts of a package with parts.
                                               With --changed, only the runs with a changed file.
  rigor-mutation dir <selection>               the folder of the package of a selection
  rigor-mutation config <selection> [--out <file>] [--concurrency <n>] [--dry-run | --plan] [--changed <file>]
                                               the Stryker config of a selection, as JSON. With --dry-run,
                                               Stryker starts only the tests. With --plan, Stryker also makes
                                               its plan, writes it into plan.json and stops. With --changed,
                                               it mutates only the changed files of the selection.
  rigor-mutation scores <selection>... [--report <file> | --reports <dir>] [--summary <file>]
                       [--last <file>] [--write-last <file>] [--test-files] [--alone]
                                               the score of each selection, with its gate and its count
                                               of tests. --reports reads <dir>/mutation-<selection>/mutation.json.
                                               A package with "gateOver": "package" also gets
                                               the score of its parts together, a no read without all its parts.
                                               --alone gives no line for the package: the job of one part
                                               then fails only for a no read. With --last, a fall of the count of more than
                                               maxTestFall % (default 20) against the file fails. With
                                               --write-last, the counts of the passed selections go in
                                               the file. With --test-files, a test file that the run
                                               starts and that the report does not read fails. With no
                                               --alone, a package with all its selections named also
                                               fails for a test file that no report reads, and for an
                                               entry of "notRead" that is not true.
  rigor-mutation plan-check <selection>... [--report <file> | --reports <dir>]
                                               the estimate of the clock of each selection from its plan.json,
                                               against "targetMinutes" (default 100) at "planPerClock" (default
                                               9.8). A selection over the target fails, and so does a file
                                               over its count of "staticLimits". --reports reads
                                               <dir>/mutation-<selection>/plan.json.
  rigor-mutation disables [--write]            compare the disable comments with their list
  rigor-mutation load-check [<selection>...] [--collect] [--runner <file>]
                                               refuse each relative path of a package that leaves its folder.
                                               Stryker starts the tests in a copy of the folder, so such a
                                               path finds no file. No selection checks each package.
                                               With --collect, the Vitest of each package also loads each
                                               test file in a copy of the folder, as Stryker does. A file
                                               that does not load, has no test or that no selection
                                               starts fails, and so does a computed dynamic import that
                                               "computedImports" does not name. With --runner, the
                                               version and the path of each Vitest go in the file.

  --lane <file>      the lane file. The default is mutation.json.
  --changed <file>   a file with one changed path on each line, from the folder of the lane file,
                     for example the output of git diff --name-only. A changed test file selects
                     its source file of the same name.

A selection is a package ("collections") or a part of a package ("collections.impl").
Each file of a package with parts must be in exactly one part. list --runs, and config and scores
of a part, fail when it is not.
The score of a selection reads <dir>/${REPORT_DIR}/mutation.json, or the file of --report.
`;

const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;
const TEST = /\.(?:test|spec)\.[^.]+$/;
const SKIP = new Set(["node_modules", "build", "dist", "reports", "coverage"]);

/**
 * This function gives each source file of a folder, from `root`, with `/`. It skips the outputs and the dot folders,
 * and the tests when `tests` is false.
 */
function sourcesOf(root: string, dir: string, tests = false): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .toSorted((x, y) => x.name.localeCompare(y.name))
    .flatMap((e) => {
      const path = resolve(dir, e.name);
      if (e.isDirectory()) return e.name.startsWith(".") || SKIP.has(e.name) ? [] : sourcesOf(root, path, tests);
      return e.isFile() && SOURCE.test(e.name) && (tests || !TEST.test(e.name)) ? [relative(root, path).replaceAll("\\", "/")] : [];
    });
}

/** The script of `load-check --collect`. It is beside this file, in the source and in the build. */
const COLLECT_SCRIPT = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./collect.ts" : "./collect.js", import.meta.url));

/**
 * This function starts the collect of Vitest in a copy of the folder `dir`, in a new process. The copy takes the files
 * that Stryker copies to its sandbox. The function gives the collect, or the reason when the process gives no collect.
 *
 * @param selections - the mutated files of each selection, from `dir`
 * @param config - the Stryker config of the package, for its ignore rules
 */
function collectIn(dir: string, vitestConfig: string | undefined, selections: Readonly<Record<string, readonly string[]>>, config: Readonly<Record<string, unknown>>): Collected | string {
  const Minimatch = minimatchOf(dir);
  if (typeof Minimatch === "string") return Minimatch;
  const tmp = mkdtempSync(join(tmpdir(), "rigor-mutation-collect-"));
  try {
    const copy = copyOfFolder(dir, sandboxFiles(dir, ignoreRules(config), Minimatch), tempDirOf(config));
    try {
      const out = join(tmp, "collected.json");
      const request: CollectRequest = { dir: copy, ...(vitestConfig === undefined ? {} : { config: vitestConfig }), selections };
      writeFileSync(join(tmp, "request.json"), JSON.stringify(request));
      const r = spawnSync(process.execPath, [COLLECT_SCRIPT, join(tmp, "request.json"), out], { cwd: copy, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      // Vitest sets the exit code 1 for a file that does not load, so the file of the collect decides, not the code.
      if (!existsSync(out)) {
        const why = (r.error?.message ?? `${r.stdout}${r.stderr}`).trim().split("\n").slice(-5).join(" ");
        return `the collect of Vitest exited with ${String(r.status)}: ${why}`;
      }
      return JSON.parse(readFileSync(out, "utf8")) as Collected;
    } finally {
      removeCopy(copy);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The options of `load-check`. */
interface LoadCheckOptions {
  /** With true, Vitest also collects each test file of each package (`--collect`). */
  readonly collect: boolean;
  /** The file for the version and the path of the Vitest of each package (`--runner`). */
  readonly runner: string | undefined;
}

/**
 * This function gives the faults of the collect of a package (`load-check --collect`). A test file that does not load
 * is a fault. A test file that no selection starts is a fault (LANE.FILES). A computed dynamic import that the lane
 * does not name is a fault.
 */
function collectCheck(lane: Lane, laneDir: string, pkg: string, files: readonly PackageFile[]): { readonly faults: string[]; readonly collected: Collected | undefined } {
  const p = lane.packages[pkg];
  if (p === undefined) return { faults: [], collected: undefined };
  const own = runSelections(lane).map((n) => select(lane, n)).filter((s) => s.pkg === pkg);
  const sources = files.map((f) => f.file).filter((f) => !TEST.test(f));
  const mutated = Object.fromEntries(own.map((s) => [s.name, sources.filter((f) => globsSelect(s.mutate, f))]));
  const config = own[0] === undefined ? {} : strykerConfig(own[0]);
  const collected = collectIn(resolve(laneDir, p.dir), p.vitestConfig, mutated, config);
  const computed = computedImports(files, p.vitestConfig);
  const allowed = p.computedImports ?? {};
  const faults = [
    ...computed.filter((c) => allowed[c.file] === undefined).map((c) => `${c.file}:${String(c.line)}: a dynamic import with a computed path. The related mode of Vitest does not follow it, so a test file that reaches the mutated files only through it starts in no selection. Import the file by its path, or give the reason in "computedImports"`),
    ...Object.keys(allowed).filter((f) => !computed.some((c) => c.file === f)).map((f) => `"computedImports" is not true: ${f} has no dynamic import with a computed path that the run loads`),
  ];
  if (typeof collected === "string") return { faults: [collected, ...faults], collected: undefined };
  const onDisk = files.map((f) => f.file).filter((f) => TEST.test(f));
  const started = new Set(own.flatMap((s) => (runsAllTests(s) ? onDisk : (collected.selections[s.name] ?? []))));
  const { unread, stale } = readFaults(started, onDisk, p.notRead);
  faults.push(
    ...collectFaults(collected),
    ...unread.map((f) => `${f}: no selection starts the file, and "notRead" does not give its reason`),
    ...stale.map((f) => `"notRead" is not true: ${f} is not on the disk, or a selection starts it`),
  );
  return { faults, collected };
}

/** This function checks the relative paths of the package of each selection, and with `--collect`, the load of each test file (`load-check`). */
function loadCheck(lane: Lane, laneDir: string, names: readonly string[], io: CliIo, options: LoadCheckOptions): number {
  const pkgs = [...new Set((names.length === 0 ? Object.keys(lane.packages) : names.map((n) => select(lane, n).pkg)))];
  let failed = 0;
  let unread = 0;
  const runners: Record<string, { version: string; path: string }> = {};
  for (const pkg of pkgs) {
    const s = select(lane, pkg);
    const dir = resolve(laneDir, s.dir);
    if (!existsSync(dir)) throw new Error(`${pkg}: the folder ${s.dir} does not exist`);
    const files = sourcesOf(dir, dir, true)
      .filter((f) => !f.endsWith(".d.ts"))
      .map((file) => ({ file, text: readFileSync(resolve(dir, file), "utf8") }));
    const found = leavingPaths(files, s.vitestConfig);
    for (const p of found) {
      io.stderr(`${s.dir}/${p.file}:${String(p.line)}: "${p.path}" leaves the folder ${s.dir}. In the copy of Stryker it finds no file.
`);
    }
    if (found.length === 0) io.stdout(`load-check ${pkg}: ${String(files.length)} files, no relative path leaves ${s.dir}
`);
    else failed += 1;
    if (!options.collect) continue;
    const { faults, collected } = collectCheck(lane, laneDir, pkg, files);
    for (const fault of faults) io.stderr(`${s.dir}: ${fault}\n`);
    if (collected !== undefined) {
      runners[pkg] = { version: collected.version, path: collected.path };
      if (faults.length === 0) io.stdout(`load-check ${pkg}: Vitest ${collected.version} loads ${String(collected.files.length)} test files in a copy of ${s.dir}, and the selections start each one\n`);
    }
    if (faults.length > 0) unread += 1;
  }
  if (options.runner !== undefined) {
    const file = resolve(io.cwd, options.runner);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(runners, null, 2)}\n`);
  }
  if (failed > 0) io.stderr(`load-check: ${String(failed)} packages have a relative path that leaves their folder. Import the file from its package, or move it into the folder.
`);
  if (unread > 0) io.stderr(`No read: ${String(unread)} packages have a test file that Vitest does not load, that holds no test, or that no selection starts. A mutant that only this file detects survives, so a score of the package is not a reading.
`);
  return failed > 0 || unread > 0 ? 1 : 0;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

/**
 * This function gives the major version of the `typescript` that the folder `dir` resolves, or undefined when the
 * folder resolves none. In a usual install, Stryker resolves the same version, because it starts in that folder.
 */
function typescriptMajor(dir: string): number | undefined {
  let file: string;
  try {
    file = createRequire(join(dir, "package.json")).resolve("typescript/package.json");
  } catch {
    return undefined;
  }
  const version: unknown = (readJson(file) as { version?: unknown }).version;
  const major = typeof version === "string" ? Number.parseInt(version, 10) : Number.NaN;
  return Number.isInteger(major) ? major : undefined;
}

/**
 * This function examines the parts of the packages against their source files.
 *
 * @throws Error with each file that is in no part, in more than one part, or in a part and not in `mutate`
 */
/** This function gives the number of lines of a text. A last line break does not start a line. */
const lineCount = (text: string): number => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/** This function tells if a file of the package of a selection, from its folder, exists. */
const existsIn =
  (laneDir: string, s: Selection) =>
  (file: string): boolean =>
    existsSync(resolve(laneDir, s.dir, file));

function checkParts(lane: Lane, laneDir: string, pkgs: readonly string[]): void {
  const errors = pkgs.flatMap((pkg) => {
    const p = lane.packages[pkg];
    if (p?.parts === undefined) return [];
    const dir = resolve(laneDir, p.dir);
    if (!existsSync(dir)) return [`${pkg}: the folder ${p.dir} does not exist`];
    return partErrors(lane, pkg, sourcesOf(dir, dir), (file) => lineCount(readFileSync(resolve(dir, file), "utf8")));
  });
  if (errors.length > 0) throw new Error(`the parts do not cover each file exactly one time:\n  ${errors.join("\n  ")}`);
}

/** This function examines the parts of the package of each selection that is a part. */
const checkPartsOf = (lane: Lane, laneDir: string, names: readonly string[]): void =>
  checkParts(lane, laneDir, [...new Set(names.map((n) => select(lane, n)).filter((s) => s.name !== s.pkg).map((s) => s.pkg))]);

function disables(lane: Lane, laneDir: string, write: boolean, io: CliIo): number {
  const files = new Set<string>();
  for (const [name, p] of Object.entries(lane.packages)) {
    const dir = resolve(laneDir, p.dir);
    if (!existsSync(dir)) throw new Error(`${name}: the folder ${p.dir} does not exist`);
    for (const f of sourcesOf(laneDir, dir)) files.add(f);
  }
  const found = findDisables([...files].map((file) => ({ file, text: readFileSync(resolve(laneDir, file), "utf8") })));
  const listFile = resolve(laneDir, lane.disables ?? "mutation-disables.json");
  const listed = existsSync(listFile) ? (readJson(listFile) as Disable[]) : [];
  const check = compareDisables(found, listed);
  for (const d of check.noReason) io.stderr(`a disable without a reason after a colon: ${d.file}: ${d.comment}\n`);
  if (write) {
    if (check.noReason.length > 0) return 1;
    writeFileSync(listFile, `${JSON.stringify(found, null, 2)}\n`);
    io.stdout(`disables: wrote ${String(found.length)} comments to ${relative(io.cwd, listFile).replaceAll("\\", "/")}\n`);
    return 0;
  }
  const perFile = new Map<string, number>();
  for (const d of found) perFile.set(d.file, (perFile.get(d.file) ?? 0) + 1);
  io.stdout(`disables: ${String(found.length)} in ${String(perFile.size)} files\n`);
  for (const [file, n] of perFile) io.stdout(`  ${file}: ${String(n)}\n`);
  for (const k of check.added) io.stderr(`not in the list: ${k}\n`);
  for (const k of check.removed) io.stderr(`in the list, not in the sources: ${k}\n`);
  if (check.added.length > 0 || check.removed.length > 0) {
    io.stderr("disables: the sources and the list are not the same. Add each new disable with its reason, or start with --write and examine the diff.\n");
  }
  return check.ok ? 0 : 1;
}

/** The options of `scores`. */
interface ScoresOptions {
  readonly report: string | undefined;
  readonly reports: string | undefined;
  readonly summary: string | undefined;
  readonly last: string | undefined;
  readonly writeLast: string | undefined;
  readonly testFiles: boolean;
  /** This field tells if the command gives no score of a package from its parts, for the job of one part. */
  readonly alone?: boolean;
}

/**
 * This function gives the score of each selection (`scores`). With `last`, it compares the test count with the last
 * good count (LANE.TESTS of Vex). With `testFiles`, it compares the test files that the run starts with the report (LANE.FILES).
 */
function scores(lane: Lane, laneDir: string, names: readonly string[], o: ScoresOptions, io: CliIo): number {
  if (names.length === 0) throw new Error(`"scores" takes one or more selections`);
  if (o.report !== undefined && names.length > 1) throw new Error(`--report takes one selection`);
  if (o.report !== undefined && o.reports !== undefined) throw new Error(`"scores" takes --report or --reports, not both`);
  checkPartsOf(lane, laneDir, names);
  const lastFile = o.last === undefined ? undefined : resolve(io.cwd, o.last);
  const last = lastFile === undefined || !existsSync(lastFile) ? {} : readCounts(lastFile);
  if (lastFile !== undefined && !existsSync(lastFile)) io.stdout(`scores: the file ${o.last ?? ""} does not exist, so no count is compared
`);
  const notes = new Map<string, string[]>(names.map((n) => [n, []]));
  const note = (name: string, line: string): void => void notes.set(name, [...(notes.get(name) ?? []), line]);
  const reports = new Map<string, MutationReport>();
  const falls: PlannedFall[] = [];
  // The gate of a package with "gateOver": "package" reads the sum of its parts, so a part has no gate of its own.
  const byPackage = (s: Selection): boolean => s.name !== s.pkg && lane.packages[s.pkg]?.gateOver === "package";
  const results: Score[] = names.map((name) => {
    const all = select(lane, name);
    const s = byPackage(all) ? { ...all, gate: undefined } : all;
    if (s !== all) note(name, `  the gate of ${s.pkg} reads all its parts together`);
    const file =
      o.reports !== undefined
        ? resolve(io.cwd, o.reports, `mutation-${name}`, "mutation.json")
        : o.report === undefined
          ? resolve(laneDir, s.dir, REPORT_DIR, "mutation.json")
          : resolve(io.cwd, o.report);
    if (!existsSync(file)) {
      // A time limit stopped Stryker: the reporter rigor-partial wrote the mutants that ran, with the costs.
      const partial = join(dirname(file), PARTIAL_FILE);
      if (existsSync(partial)) return partialScore(parsePartial(readFileSync(partial, "utf8")), s);
      const reason = `the report ${relative(io.cwd, file)} does not exist`;
      return { name, gate: s.gate, detected: 0, hitLimit: 0, clockTimeouts: 0, valid: 0, survived: [], percent: 0, percentWithClock: 0, tests: undefined, pass: false, reason, outcome: "no read" };
    }
    const report = parseReport(readJson(file));
    reports.set(name, report);
    let score = scoreReport(report, s);
    const before = last[name];
    if (lastFile !== undefined && before !== undefined) {
      if (score.tests === undefined) score = failScore(score, `the report has no "testFiles", so the count of the tests is not known`);
      else {
        const fall = testFall(score.tests, before, lane.maxTestFall ?? MAX_TEST_FALL);
        const planned = lane.plannedFalls?.[name];
        if (fall !== undefined && planned === undefined) score = failScore(score, fall);
        else if (fall !== undefined) {
          const text = `${fall.replace(/, so the score is no read$/, "")}. The reason: ${planned ?? ""}`;
          note(name, `  a planned fall: ${text}`);
          falls.push({ name, text });
        }
      }
    }
    if (o.testFiles) score = checkTestFiles(lane, laneDir, s, report, score, (line) => note(name, line));
    return score;
  });
  const faults = o.testFiles && o.alone !== true ? testFileReasons(lane, laneDir, names, reports, note) : new Map<string, string>();
  const packages = o.alone === true ? [] : names.map((n) => select(lane, n)).filter(byPackage).map((s) => s.pkg);
  const totals = [...new Set(packages)].map((pkg) => {
    const p = lane.packages[pkg];
    const parts = results.filter((r) => select(lane, r.name).pkg === pkg && r.name !== pkg);
    // A no read is never a pass: a part that the command does not name makes the package a no read.
    const missing = Object.keys(p?.parts ?? {})
      .map((part) => `${pkg}.${part}`)
      .filter((n) => !names.includes(n));
    return packageScore(pkg, p?.gate, parts, missing);
  });
  // A fault of the test files of a package fails its sum, or each of its selections when it has no sum.
  const withFault = (s: Score, pkg: string): Score => {
    const reason = faults.get(pkg);
    return reason === undefined ? s : failScore(s, reason);
  };
  const summed = new Set(totals.map((t) => t.name));
  const shown = [
    ...results.map((r) => (summed.has(select(lane, r.name).pkg) ? r : withFault(r, select(lane, r.name).pkg))),
    ...totals.map((t) => withFault(t, t.name)),
  ];
  for (const s of shown) {
    io.stdout(`${formatScore(s)}
`);
    for (const line of notes.get(s.name) ?? []) io.stdout(`${line}
`);
    if (!s.pass) for (const m of s.survived) io.stdout(`  survived: ${m}
`);
  }
  if (o.summary !== undefined) appendFileSync(resolve(io.cwd, o.summary), `### Mutation scores

${summaryMarkdown(shown)}
`);
  if (o.writeLast !== undefined) {
    const out = resolve(io.cwd, o.writeLast);
    const counts = { ...(existsSync(out) ? readCounts(out) : {}) };
    for (const s of results) if (s.pass && s.tests !== undefined) counts[s.name] = s.tests;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => (a < b ? -1 : 1))), null, 2)}
`);
  }
  if (io.env?.["GITHUB_ACTIONS"] === "true") for (const line of annotations(shown, falls)) io.stdout(`${line}
`);
  const failed = shown.filter((s) => !s.pass).map((s) => s.name);
  if (failed.length > 0) io.stderr(`The gate failed for ${failed.join(", ")}.
`);
  return failed.length > 0 ? 1 : 0;
}

/**
 * This function examines the test files of each package whose selections the command names in full, over all their
 * reports (LANE.FILES). A part starts only its related test files, so one part does not show a test file that no part
 * reads. The function gives the reason of the fault of each package, and notes each file.
 */
function testFileReasons(lane: Lane, laneDir: string, names: readonly string[], reports: ReadonlyMap<string, MutationReport>, note: (name: string, line: string) => void): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const [pkg, p] of Object.entries(lane.packages)) {
    const own = p.parts === undefined ? [pkg] : Object.keys(p.parts).map((part) => `${pkg}.${part}`);
    const read = own.flatMap((n) => reports.get(n) ?? []);
    // A selection that is not named, or that has no full report, is a no read already.
    if (!own.every((n) => names.includes(n)) || read.length < own.length) continue;
    // The notes go under the sum of the package, or else under its last selection.
    const at = p.parts === undefined || p.gateOver === "package" ? pkg : (own.at(-1) ?? pkg);
    // A report with no "testFiles" fails its own selection. The note tells that the check over the parts did not run.
    const blind = own.filter((n) => reports.get(n)?.testFiles === undefined);
    if (blind.length > 0) {
      note(at, `  the test files of ${pkg} over all its selections are not known: the reports of ${blind.join(", ")} have no "testFiles"`);
      continue;
    }
    const dir = resolve(laneDir, p.dir);
    const onDisk = sourcesOf(dir, dir, true).filter((f) => TEST.test(f) && !f.endsWith(".d.ts"));
    const { unread, stale } = testFileFaults(read, onDisk, p.notRead, dir);
    for (const f of unread) note(at, `  read by no selection: ${p.dir}/${f}`);
    for (const f of stale) note(at, `  "notRead" is not true: ${p.dir}/${f}`);
    const parts: string[] = [];
    if (unread.length > 0) parts.push(`no selection reads ${String(unread.length)} test files, and "notRead" does not give their reason`);
    if (stale.length > 0) parts.push(`${String(stale.length)} entries of "notRead" name a file that is not on the disk or that a report reads`);
    if (parts.length > 0) reasons.set(pkg, `the test files of ${pkg}: ${parts.join(". Also, ")}`);
  }
  return reasons;
}

/** A fall of the test count that the lane plans, with its text. The score passes, and its annotation tells the fall. */
interface PlannedFall {
  readonly name: string;
  readonly text: string;
}

/** This function escapes the text of a workflow command of GitHub Actions. A property escapes also `:` and `,`. */
const escapeCommand = (text: string, property = false): string => {
  const data = text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return property ? data.replaceAll(":", "%3A").replaceAll(",", "%2C") : data;
};

/**
 * This function gives a warning annotation for each score that does not pass and each planned fall. The annotation is on
 * the check line, so a no read is not a green check with the reason only in the log. This is true also for a run that
 * only reports. The title of a no read gives the count of the no reads and of the selections.
 */
function annotations(results: readonly Score[], falls: readonly PlannedFall[]): string[] {
  const noReads = results.filter((s) => !s.pass && s.outcome !== "block");
  const line = (title: string, message: string): string => `::warning title=${escapeCommand(title, true)}::${escapeCommand(message)}`;
  return [
    ...noReads.map((s) => line(`Mutation gate: no read, ${String(noReads.length)} of ${String(results.length)} selections`, `${s.name}: ${s.reason ?? ""}`)),
    ...results.filter((s) => !s.pass && s.outcome === "block").map((s) => line("Mutation gate: under the gate", `${s.name}: ${s.reason ?? ""}`)),
    ...falls.map((f) => line("Mutation gate: a planned fall of the tests", `${f.name}: ${f.text}`)),
  ];
}

/** The options of `plan-check`. */
interface PlanCheckOptions {
  readonly report: string | undefined;
  readonly reports: string | undefined;
}

/**
 * This function reads the plan of each selection (`plan-check`). It gives the estimate of the clock of each selection,
 * and it fails a selection over its target, a file over its limit of static runs, and a selection with no plan.
 */
function planCheck(lane: Lane, laneDir: string, names: readonly string[], o: PlanCheckOptions, io: CliIo): number {
  if (names.length === 0) throw new Error(`"plan-check" takes one or more selections`);
  if (o.report !== undefined && names.length > 1) throw new Error(`--report takes one selection`);
  if (o.report !== undefined && o.reports !== undefined) throw new Error(`"plan-check" takes --report or --reports, not both`);
  let failed = 0;
  for (const name of names) {
    const s = select(lane, name);
    const file =
      o.reports !== undefined
        ? resolve(io.cwd, o.reports, `mutation-${name}`, PLAN_FILE)
        : o.report === undefined
          ? resolve(laneDir, s.dir, REPORT_DIR, PLAN_FILE)
          : resolve(io.cwd, o.report);
    if (!existsSync(file)) {
      failed += 1;
      io.stdout(`${name}: FAIL: there is no plan at ${relative(io.cwd, file).replaceAll("\\", "/")}. Start Stryker with the config of "config --plan".\n`);
      continue;
    }
    const limits = lane.packages[s.pkg]?.staticLimits;
    const read = readPlan(name, parsePlan(readJson(file)), { planPerClock: lane.planPerClock, targetMinutes: lane.targetMinutes, ...(limits === undefined ? {} : { staticLimits: limits }) });
    io.stdout(`${read.line}\n${read.faults.map((f) => `  FAIL: ${f}\n`).join("")}`);
    if (read.faults.length > 0) failed += 1;
  }
  io.stdout(failed === 0 ? `plan-check: each plan of ${String(names.length)} selections is in its limits\n` : `plan-check: ${String(failed)} of ${String(names.length)} selections fail\n`);
  return failed === 0 ? 0 : 1;
}

/** This function reads a file of test counts: an object from each selection to its count. */
function readCounts(file: string): Record<string, number> {
  const json = readJson(file);
  const ok = typeof json === "object" && json !== null && !Array.isArray(json) && Object.values(json).every((n) => Number.isInteger(n) && (n as number) >= 0);
  if (!ok) throw new Error(`the file ${file} is not an object of test counts`);
  return json as Record<string, number>;
}

/** This function tells if the Vitest runner of a selection starts all the tests: the lane sets `vitest.related` to false. */
function runsAllTests(s: Selection): boolean {
  const vitest = s.stryker?.["vitest"];
  return typeof vitest === "object" && vitest !== null && (vitest as Record<string, unknown>)["related"] === false;
}

/**
 * This function fails a score when the report does not read a test file that the run starts. The related mode of the
 * Vitest runner starts each test file that loads a file of the selection (LANE.FILES). So a part does not start the
 * test files of the other parts. With `vitest.related` false, the run starts each test file on the disk.
 */
function checkTestFiles(lane: Lane, laneDir: string, s: Selection, report: MutationReport, score: Score, note: (line: string) => void): Score {
  const p = lane.packages[s.pkg];
  if (p === undefined) return score;
  const dir = resolve(laneDir, p.dir);
  if (report.testFiles === undefined) return failScore(score, `the report has no "testFiles", so the test files that it read are not known`);
  const files = sourcesOf(dir, dir, true).filter((f) => !f.endsWith(".d.ts"));
  const onDisk = files.filter((f) => TEST.test(f));
  const started = runsAllTests(s)
    ? onDisk
    : relatedTestFiles(
        files.map((file) => ({ file, text: readFileSync(resolve(dir, file), "utf8") })),
        (file) => globsSelect(s.mutate, file),
      );
  const unread = unreadTestFiles(report, started, p.notRead, dir);
  for (const f of unread) note(`  not read: ${p.dir}/${f}`);
  if (unread.length === 0) return score;
  return failScore(score, `the report does not read ${String(unread.length)} test files that the run starts. Each one is no read, unless "notRead" of the package gives its reason`);
}

/** This function starts the CLI with its arguments and gives the exit code. */
export function runCli(argv: readonly string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      lane: { type: "string", default: "mutation.json" },
      out: { type: "string" },
      concurrency: { type: "string" },
      report: { type: "string" },
      reports: { type: "string" },
      summary: { type: "string" },
      write: { type: "boolean", default: false },
      runs: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      plan: { type: "boolean", default: false },
      changed: { type: "string" },
      last: { type: "string" },
      "write-last": { type: "string" },
      "test-files": { type: "boolean", default: false },
      alone: { type: "boolean", default: false },
      collect: { type: "boolean", default: false },
      runner: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  const [command, ...names] = positionals;
  if (values.help || command === undefined) {
    io.stdout(HELP);
    return command === undefined && !values.help ? 1 : 0;
  }
  const laneFile = resolve(io.cwd, values.lane);
  const laneDir = dirname(laneFile);
  const lane = parseLane(readJson(laneFile));
  const changed =
    values.changed === undefined
      ? undefined
      : readFileSync(resolve(io.cwd, values.changed), "utf8")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "");
  const one = (): string => {
    if (names.length !== 1 || names[0] === undefined) throw new Error(`"${command}" takes one selection`);
    return names[0];
  };
  switch (command) {
    case "list": {
      if (values.runs) checkParts(lane, laneDir, Object.keys(lane.packages));
      if (changed !== undefined && !values.runs) throw new Error(`--changed of "list" takes --runs`);
      const runs = values.runs ? runSelections(lane) : selectionNames(lane);
      const shown = changed === undefined ? runs : runs.filter((n) => changedFiles(select(lane, n), changed, existsIn(laneDir, select(lane, n))).length > 0);
      io.stdout(shown.length === 0 ? "" : `${shown.join("\n")}\n`);
      return 0;
    }
    case "dir":
      io.stdout(`${relative(io.cwd, resolve(laneDir, select(lane, one()).dir)).replaceAll("\\", "/") || "."}\n`);
      return 0;
    case "config": {
      const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency);
      if (concurrency !== undefined && !(Number.isInteger(concurrency) && concurrency > 0)) throw new Error(`--concurrency is not a positive integer`);
      if (values["dry-run"] && values.plan) throw new Error(`"config" takes --dry-run or --plan, not both`);
      checkPartsOf(lane, laneDir, [one()]);
      const all = select(lane, one());
      const files = changed === undefined ? undefined : changedFiles(all, changed, existsIn(laneDir, all));
      if (files?.length === 0) throw new Error(`the selection ${all.name} has no changed file`);
      const selection = files === undefined ? all : { ...all, mutate: files };
      const tsconfigRewrite = rewritesTsconfig(typescriptMajor(resolve(laneDir, all.dir)));
      const options = { ...(concurrency === undefined ? {} : { concurrency }), dryRun: values["dry-run"], plan: values.plan, tsconfigRewrite };
      const text = `${JSON.stringify(strykerConfig(selection, options), null, 2)}\n`;
      if (values.out === undefined) io.stdout(text);
      else {
        mkdirSync(dirname(resolve(io.cwd, values.out)), { recursive: true });
        writeFileSync(resolve(io.cwd, values.out), text);
      }
      return 0;
    }
    case "scores":
      return scores(lane, laneDir, names, { report: values.report, reports: values.reports, summary: values.summary, last: values.last, writeLast: values["write-last"], testFiles: values["test-files"], alone: values.alone }, io);
    case "plan-check":
      return planCheck(lane, laneDir, names, { report: values.report, reports: values.reports }, io);
    case "disables":
      return disables(lane, laneDir, values.write, io);
    case "load-check":
      return loadCheck(lane, laneDir, names, io, { collect: values.collect, runner: values.runner });
    default:
      io.stderr(`unknown command "${command}"\n\n${HELP}`);
      return 1;
  }
}
