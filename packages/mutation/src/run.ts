/**
 * The CLI `rigor-mutation`. The work is in `runCli`, so a test can start the CLI in a fixture folder.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPORT_DIR, strykerConfig } from "./config.ts";
import { compareDisables, findDisables, type Disable } from "./disables.ts";
import { parseLane, partErrors, runSelections, select, selectionNames, type Lane } from "./lane.ts";
import { formatScore, parseReport, scoreReport, summaryMarkdown, type Score } from "./score.ts";

/** The input and the output of the CLI. */
export interface CliIo {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** The help text of the CLI. */
export const HELP: string = `rigor-mutation: the mutation tests of a repository, with Stryker and a gate for each package.

  rigor-mutation list [--runs]                 the packages and the parts of the lane. With --runs, the
                                               selections of a full run: the parts of a package with parts.
  rigor-mutation dir <selection>               the folder of the package of a selection
  rigor-mutation config <selection> [--out <file>] [--concurrency <n>]
                                               the Stryker config of a selection, as JSON
  rigor-mutation scores <selection>... [--report <file>] [--summary <file>]
                                               the score of each selection, with its gate
  rigor-mutation disables [--write]            compare the disable comments with their list

  --lane <file>   the lane file. The default is mutation.json.

A selection is a package ("collections") or a part of a package ("collections.impl").
Each file of a package with parts must be in exactly one part. list --runs, and config and scores
of a part, fail when it is not.
The score of a selection reads <dir>/${REPORT_DIR}/mutation.json, or the file of --report.
`;

const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;
const TEST = /\.(?:test|spec)\.[^.]+$/;
const SKIP = new Set(["node_modules", "build", "dist", "reports", "coverage"]);

/** This function gives each source file of a folder, from `root`, with `/`. It skips the tests, the outputs and the dot folders. */
function sourcesOf(root: string, dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .toSorted((x, y) => x.name.localeCompare(y.name))
    .flatMap((e) => {
      const path = resolve(dir, e.name);
      if (e.isDirectory()) return e.name.startsWith(".") || SKIP.has(e.name) ? [] : sourcesOf(root, path);
      return e.isFile() && SOURCE.test(e.name) && !TEST.test(e.name) ? [relative(root, path).replaceAll("\\", "/")] : [];
    });
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
  const one = (): string => {
    if (names.length !== 1 || names[0] === undefined) throw new Error(`"${command}" takes one selection`);
    return names[0];
  };
  switch (command) {
    case "list":
      if (values.runs) checkParts(lane, laneDir, Object.keys(lane.packages));
      io.stdout(`${(values.runs ? runSelections(lane) : selectionNames(lane)).join("\n")}\n`);
      return 0;
    case "dir":
      io.stdout(`${relative(io.cwd, resolve(laneDir, select(lane, one()).dir)).replaceAll("\\", "/") || "."}\n`);
      return 0;
    case "config": {
      const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency);
      if (concurrency !== undefined && !(Number.isInteger(concurrency) && concurrency > 0)) throw new Error(`--concurrency is not a positive integer`);
      checkPartsOf(lane, laneDir, [one()]);
      const text = `${JSON.stringify(strykerConfig(select(lane, one()), concurrency === undefined ? {} : { concurrency }), null, 2)}\n`;
      if (values.out === undefined) io.stdout(text);
      else {
        mkdirSync(dirname(resolve(io.cwd, values.out)), { recursive: true });
        writeFileSync(resolve(io.cwd, values.out), text);
      }
      return 0;
    }
    case "scores": {
      if (names.length === 0) throw new Error(`"scores" takes one or more selections`);
      if (values.report !== undefined && names.length > 1) throw new Error(`--report takes one selection`);
      checkPartsOf(lane, laneDir, names);
      const scores: Score[] = names.map((name) => {
        const s = select(lane, name);
        const file = values.report === undefined ? resolve(laneDir, s.dir, REPORT_DIR, "mutation.json") : resolve(io.cwd, values.report);
        if (!existsSync(file)) {
          const reason = `the report ${relative(io.cwd, file)} does not exist`;
          return { name, gate: s.gate, detected: 0, hitLimit: 0, clockTimeouts: 0, valid: 0, survived: [], percent: 0, percentWithClock: 0, pass: false, reason };
        }
        return scoreReport(parseReport(readJson(file)), s);
      });
      for (const s of scores) {
        io.stdout(`${formatScore(s)}\n`);
        if (!s.pass) for (const m of s.survived) io.stdout(`  survived: ${m}\n`);
      }
      if (values.summary !== undefined) appendFileSync(resolve(io.cwd, values.summary), `### Mutation scores\n\n${summaryMarkdown(scores)}\n`);
      const failed = scores.filter((s) => !s.pass).map((s) => s.name);
      if (failed.length > 0) io.stderr(`The gate failed for ${failed.join(", ")}.\n`);
      return failed.length > 0 ? 1 : 0;
    }
    case "disables":
      return disables(lane, laneDir, values.write, io);
    default:
      io.stderr(`unknown command "${command}"\n\n${HELP}`);
      return 1;
  }
}
