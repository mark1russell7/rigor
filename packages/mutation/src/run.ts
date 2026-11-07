/**
 * The CLI `rigor-mutation`. The work is in `runCli`, so a test can start the CLI in a fixture folder.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPORT_DIR, strykerConfig } from "./config.ts";
import { compareDisables, findDisables, type Disable } from "./disables.ts";
import { leavingPaths } from "./load.ts";
import { changedFiles, MAX_TEST_FALL, parseLane, partErrors, runSelections, select, selectionNames, type Lane } from "./lane.ts";
import { failScore, formatScore, parseReport, scoreReport, summaryMarkdown, testFall, unreadTestFiles, type MutationReport, type Score } from "./score.ts";

/** The input and the output of the CLI. */
export interface CliIo {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** The help text of the CLI. */
export const HELP: string = `rigor-mutation: the mutation tests of a repository, with Stryker and a gate for each package.

  rigor-mutation list [--runs] [--changed <file>]
                                               the packages and the parts of the lane. With --runs, the
                                               selections of a full run: the parts of a package with parts.
                                               With --changed, only the runs with a changed file.
  rigor-mutation dir <selection>               the folder of the package of a selection
  rigor-mutation config <selection> [--out <file>] [--concurrency <n>] [--dry-run] [--changed <file>]
                                               the Stryker config of a selection, as JSON. With --dry-run,
                                               Stryker starts only the tests. With --changed, it mutates only
                                               the changed files of the selection.
  rigor-mutation scores <selection>... [--report <file>] [--summary <file>] [--last <file>]
                       [--write-last <file>] [--test-files]
                                               the score of each selection, with its gate and its count
                                               of tests. With --last, a fall of the count of more than
                                               maxTestFall % (default 20) against the file fails. With
                                               --write-last, the counts of the passed selections go in
                                               the file. With --test-files, a test file on the disk that
                                               the report does not read fails.
  rigor-mutation disables [--write]            compare the disable comments with their list
  rigor-mutation load-check [<selection>...]   refuse each relative path of a package that leaves its folder.
                                               Stryker starts the tests in a copy of the folder, so such a
                                               path finds no file. No selection checks each package.

  --lane <file>      the lane file. The default is mutation.json.
  --changed <file>   a file with one changed path on each line, from the folder of the lane file,
                     for example the output of git diff --name-only.

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

/** This function checks the relative paths of the package of each selection (`load-check`). */
function loadCheck(lane: Lane, laneDir: string, names: readonly string[], io: CliIo): number {
  const pkgs = [...new Set((names.length === 0 ? Object.keys(lane.packages) : names.map((n) => select(lane, n).pkg)))];
  let failed = 0;
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
  }
  if (failed > 0) io.stderr(`load-check: ${String(failed)} packages have a relative path that leaves their folder. Import the file from its package, or move it into the folder.
`);
  return failed > 0 ? 1 : 0;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

/**
 * This function examines the parts of the packages against their source files.
 *
 * @throws Error with each file that is in no part, in more than one part, or in a part and not in `mutate`
 */
function checkParts(lane: Lane, laneDir: string, pkgs: readonly string[]): void {
  const errors = pkgs.flatMap((pkg) => {
    const p = lane.packages[pkg];
    if (p?.parts === undefined) return [];
    const dir = resolve(laneDir, p.dir);
    if (!existsSync(dir)) return [`${pkg}: the folder ${p.dir} does not exist`];
    return partErrors(lane, pkg, sourcesOf(dir, dir));
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
  readonly summary: string | undefined;
  readonly last: string | undefined;
  readonly writeLast: string | undefined;
  readonly testFiles: boolean;
}

/**
 * This function gives the score of each selection (`scores`). With `last`, it compares the test count with the last
 * good count (LANE.TESTS of Vex). With `testFiles`, it compares the test files on the disk with the report (LANE.FILES).
 */
function scores(lane: Lane, laneDir: string, names: readonly string[], o: ScoresOptions, io: CliIo): number {
  if (names.length === 0) throw new Error(`"scores" takes one or more selections`);
  if (o.report !== undefined && names.length > 1) throw new Error(`--report takes one selection`);
  checkPartsOf(lane, laneDir, names);
  const lastFile = o.last === undefined ? undefined : resolve(io.cwd, o.last);
  const last = lastFile === undefined || !existsSync(lastFile) ? {} : readCounts(lastFile);
  if (lastFile !== undefined && !existsSync(lastFile)) io.stdout(`scores: the file ${o.last ?? ""} does not exist, so no count is compared
`);
  const notes = new Map<string, string[]>(names.map((n) => [n, []]));
  const note = (name: string, line: string): void => void notes.get(name)?.push(line);
  const results: Score[] = names.map((name) => {
    const s = select(lane, name);
    const file = o.report === undefined ? resolve(laneDir, s.dir, REPORT_DIR, "mutation.json") : resolve(io.cwd, o.report);
    if (!existsSync(file)) {
      const reason = `the report ${relative(io.cwd, file)} does not exist`;
      return { name, gate: s.gate, detected: 0, hitLimit: 0, clockTimeouts: 0, valid: 0, survived: [], percent: 0, percentWithClock: 0, tests: undefined, pass: false, reason };
    }
    const report = parseReport(readJson(file));
    let score = scoreReport(report, s);
    const before = last[name];
    if (lastFile !== undefined && before !== undefined) {
      if (score.tests === undefined) score = failScore(score, `the report has no "testFiles", so the count of the tests is not known`);
      else {
        const fall = testFall(score.tests, before, lane.maxTestFall ?? MAX_TEST_FALL);
        const planned = lane.plannedFalls?.[name];
        if (fall !== undefined && planned === undefined) score = failScore(score, fall);
        else if (fall !== undefined) note(name, `  a planned fall: ${fall.replace(/, so the score is no read$/, "")}. The reason: ${planned ?? ""}`);
      }
    }
    if (o.testFiles) score = checkTestFiles(lane, laneDir, s.pkg, report, score, (line) => note(name, line));
    return score;
  });
  for (const s of results) {
    io.stdout(`${formatScore(s)}
`);
    for (const line of notes.get(s.name) ?? []) io.stdout(`${line}
`);
    if (!s.pass) for (const m of s.survived) io.stdout(`  survived: ${m}
`);
  }
  if (o.summary !== undefined) appendFileSync(resolve(io.cwd, o.summary), `### Mutation scores

${summaryMarkdown(results)}
`);
  if (o.writeLast !== undefined) {
    const out = resolve(io.cwd, o.writeLast);
    const counts = { ...(existsSync(out) ? readCounts(out) : {}) };
    for (const s of results) if (s.pass && s.tests !== undefined) counts[s.name] = s.tests;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => (a < b ? -1 : 1))), null, 2)}
`);
  }
  const failed = results.filter((s) => !s.pass).map((s) => s.name);
  if (failed.length > 0) io.stderr(`The gate failed for ${failed.join(", ")}.
`);
  return failed.length > 0 ? 1 : 0;
}

/** This function reads a file of test counts: an object from each selection to its count. */
function readCounts(file: string): Record<string, number> {
  const json = readJson(file);
  const ok = typeof json === "object" && json !== null && !Array.isArray(json) && Object.values(json).every((n) => Number.isInteger(n) && (n as number) >= 0);
  if (!ok) throw new Error(`the file ${file} is not an object of test counts`);
  return json as Record<string, number>;
}

/** This function fails a score when a test file of its package is on the disk and the report does not read it. */
function checkTestFiles(lane: Lane, laneDir: string, pkg: string, report: MutationReport, score: Score, note: (line: string) => void): Score {
  const p = lane.packages[pkg];
  if (p === undefined) return score;
  const dir = resolve(laneDir, p.dir);
  if (report.testFiles === undefined) return failScore(score, `the report has no "testFiles", so the test files that it read are not known`);
  const onDisk = sourcesOf(dir, dir, true).filter((f) => TEST.test(f) && !f.endsWith(".d.ts"));
  const unread = unreadTestFiles(report, onDisk, p.notRead, dir);
  for (const f of unread) note(`  not read: ${p.dir}/${f}`);
  if (unread.length === 0) return score;
  return failScore(score, `the report does not read ${String(unread.length)} test files on the disk. Each one is no read, unless "notRead" of the package gives its reason`);
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
      summary: { type: "string" },
      write: { type: "boolean", default: false },
      runs: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      changed: { type: "string" },
      last: { type: "string" },
      "write-last": { type: "string" },
      "test-files": { type: "boolean", default: false },
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
      const shown = changed === undefined ? runs : runs.filter((n) => changedFiles(select(lane, n), changed).length > 0);
      io.stdout(shown.length === 0 ? "" : `${shown.join("\n")}\n`);
      return 0;
    }
    case "dir":
      io.stdout(`${relative(io.cwd, resolve(laneDir, select(lane, one()).dir)).replaceAll("\\", "/") || "."}\n`);
      return 0;
    case "config": {
      const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency);
      if (concurrency !== undefined && !(Number.isInteger(concurrency) && concurrency > 0)) throw new Error(`--concurrency is not a positive integer`);
      checkPartsOf(lane, laneDir, [one()]);
      const all = select(lane, one());
      const files = changed === undefined ? undefined : changedFiles(all, changed);
      if (files?.length === 0) throw new Error(`the selection ${all.name} has no changed file`);
      const selection = files === undefined ? all : { ...all, mutate: files };
      const options = { ...(concurrency === undefined ? {} : { concurrency }), dryRun: values["dry-run"] };
      const text = `${JSON.stringify(strykerConfig(selection, options), null, 2)}\n`;
      if (values.out === undefined) io.stdout(text);
      else {
        mkdirSync(dirname(resolve(io.cwd, values.out)), { recursive: true });
        writeFileSync(resolve(io.cwd, values.out), text);
      }
      return 0;
    }
    case "scores":
      return scores(lane, laneDir, names, { report: values.report, summary: values.summary, last: values.last, writeLast: values["write-last"], testFiles: values["test-files"] }, io);
    case "disables":
      return disables(lane, laneDir, values.write, io);
    case "load-check":
      return loadCheck(lane, laneDir, names, io);
    default:
      io.stderr(`unknown command "${command}"\n\n${HELP}`);
      return 1;
  }
}
