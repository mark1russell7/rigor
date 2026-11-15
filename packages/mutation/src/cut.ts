/**
 * The cut of a group of files by cost. A group of the lane gives a count of parts of near the same planned net time. A
 * cost map of each file comes from the plan of a run, and it gives the cost of each segment of the file. A segment ends
 * on a closing line, so a mutant of the body of a method stays in one part. The cut thus follows the cost of the lines,
 * and not the size of the files.
 */
import type { LinePlan } from "./plan.ts";

/** The closing line of a method of a class, or of a function at the top of a file. */
const CLOSING_LINE = /^ {0,2}\}$/u;

/** The first line of a declaration at the top of a file or in a class body, with its name. */
const DECLARATION = /^ {0,2}(?:export +)?(?:(?:async|static|private|protected|public|readonly|get|set|declare|abstract) +)*(?:(?:function\*?|class|const|let|interface|type|enum) +)?([#$A-Za-z_][\w$]*) *[(<=:{]/u;

/** The words that start a statement and not a declaration. */
const STATEMENTS: ReadonlySet<string> = new Set(["if", "for", "while", "switch", "return", "throw", "do", "try", "catch", "else"]);

/** A segment of a text: a run of lines that ends on a closing line, with the name of its first declaration. */
export interface Segment {
  readonly key: string;
  /** The first line of the segment, counted from 1. */
  readonly start: number;
  /** The last line of the segment, counted from 1. */
  readonly end: number;
}

/** This function gives the lines of a text. */
const linesOf = (text: string): string[] => text.split(/\r?\n/u);

/**
 * This function cuts a text into segments. Each segment ends on a closing line, and the last segment ends on the last
 * line. The key of a segment is the name of its first declaration, with `#2` for the second segment of that name. A
 * segment with no name has the key `@n`. A key thus stays the same when a change moves the lines.
 */
export function segmentsOf(text: string): Segment[] {
  const lines = linesOf(text);
  const segments: Segment[] = [];
  const seen = new Map<string, number>();
  let start = 1;
  let name: string | undefined;
  const close = (end: number): void => {
    const base = name ?? `@${String(segments.length + 1)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    segments.push({ key: n === 1 ? base : `${base}#${String(n)}`, start, end });
    start = end + 1;
    name = undefined;
  };
  lines.forEach((line, index) => {
    const declared = DECLARATION.exec(line)?.[1];
    if (name === undefined && declared !== undefined && !STATEMENTS.has(declared)) name = declared;
    if (CLOSING_LINE.test(line)) close(index + 1);
  });
  if (start <= lines.length) close(lines.length);
  return segments;
}

/** The cost map of a file: the planned net time of each segment in milliseconds, from the plan of a run. */
export interface CostMap {
  /** The run that gave the plan. */
  readonly run: string;
  readonly segments: Readonly<Record<string, number>>;
}

/** The cost maps of a lane: a map for each file, by the name of its package and its path from the package folder. */
export type CostMaps = Readonly<Record<string, Readonly<Record<string, CostMap>>>>;

/** This function gives the cost map of a text from the plan of its lines: the planned net time of each segment. */
export function costMapOf(text: string, run: string, lines: readonly LinePlan[]): CostMap {
  const segments = segmentsOf(text);
  const cost: Record<string, number> = Object.fromEntries(segments.map((segment) => [segment.key, 0]));
  for (const [line, , , netMs] of lines) {
    const segment = segments.find((s) => s.start <= line && line <= s.end);
    if (segment !== undefined) cost[segment.key] = (cost[segment.key] ?? 0) + netMs;
  }
  return { run, segments: cost };
}

/**
 * This function gives the weight of each line of a text from a cost map. A segment spreads its cost over its lines. A
 * segment that the map does not name has the mean cost of a line of the named segments. Thus a new function has a cost.
 */
export function lineWeights(text: string, map: CostMap): number[] {
  const segments = segmentsOf(text);
  const named = segments.filter((s) => map.segments[s.key] !== undefined);
  const namedLines = named.reduce((sum, s) => sum + s.end - s.start + 1, 0);
  const namedCost = named.reduce((sum, s) => sum + (map.segments[s.key] ?? 0), 0);
  const mean = namedLines === 0 ? 1 : namedCost / namedLines;
  return segments.flatMap((s) => {
    const size = s.end - s.start + 1;
    const cost = map.segments[s.key];
    return Array.from({ length: size }, () => (cost === undefined ? mean : cost / size));
  });
}

/** A file of a group: its path from the folder of its package, its lines, and the weight of each line. */
export interface WeightedFile {
  readonly path: string;
  readonly lines: readonly string[];
  readonly weights: readonly number[];
}

/**
 * This function gives the weight of each line of each file from the cost maps of its package. A file with no map has
 * the mean weight of a line of the files with a map, so a new file has a cost. With no map, each line has the weight 1.
 */
export function weightedFiles(texts: readonly { readonly path: string; readonly text: string }[], maps: Readonly<Record<string, CostMap>> = {}): WeightedFile[] {
  const known = texts.flatMap(({ path, text }) => {
    const map = maps[path];
    return map === undefined ? [] : [lineWeights(text, map)];
  });
  const lineCount = known.reduce((n, w) => n + w.length, 0);
  const mean = lineCount === 0 ? 1 : known.flat().reduce((n, w) => n + w, 0) / lineCount;
  return texts.map(({ path, text }) => {
    const lines = linesOf(text);
    const map = maps[path];
    return { path, lines, weights: map === undefined ? lines.map(() => mean) : lineWeights(text, map) };
  });
}

/** The weight of a cut into parts: the weight of its largest part, and the sum of the squares of the weights of its parts. */
interface CutWeight {
  readonly max: number;
  readonly squares: number;
  /** The index of the candidate before the last part of the cut, or -1 for a cut of one part. */
  readonly before: number;
}

/**
 * This function gives the lightest cut of the lines at the candidates into `count` parts. It gives the index of the
 * candidate at the end of each part but the last. With a limit, a part over the limit is not possible, and the lightest
 * cut has the smallest squares. With no limit, the lightest cut has the smallest largest part, then the smallest squares.
 */
function lightestCut(candidates: readonly number[], sumTo: (at: number) => number, total: number, count: number, limit?: number): { readonly picks: number[]; readonly max: number } {
  const lighter = (x: CutWeight, y: CutWeight | undefined): boolean =>
    y === undefined || (limit === undefined ? x.max < y.max || (x.max === y.max && x.squares < y.squares) : x.squares < y.squares);
  const extend = (prior: CutWeight | undefined, from: number, to: number, before: number): CutWeight | undefined => {
    const weight = sumTo(to) - sumTo(from);
    if (prior === undefined || (limit !== undefined && weight > limit)) return undefined;
    return { max: Math.max(prior.max, weight), squares: prior.squares + weight ** 2, before };
  };
  const start: CutWeight = { max: 0, squares: 0, before: -1 };
  // The value cuts[p][k] is the lightest cut of the lines up to the candidate k into p + 1 parts.
  const cuts: (CutWeight | undefined)[][] = [candidates.map((end) => extend(start, -1, end, -1))];
  for (let part = 1; part < count - 1; part += 1) {
    const last = cuts[part - 1] ?? [];
    cuts.push(
      candidates.map((end, k) => {
        let best: CutWeight | undefined;
        for (let i = part - 1; i < k; i += 1) {
          const cut = extend(last[i], candidates[i] ?? -1, end, i);
          if (cut !== undefined && lighter(cut, best)) best = cut;
        }
        return best;
      }),
    );
  }
  let best: CutWeight | undefined;
  (cuts[count - 2] ?? []).forEach((prior, k) => {
    const cut = extend(prior, candidates[k] ?? -1, total, k);
    if (cut !== undefined && lighter(cut, best)) best = cut;
  });
  const picks: number[] = [];
  let at = best?.before ?? -1;
  for (let part = count - 2; part >= 0; part -= 1) {
    picks.unshift(at);
    at = cuts[part]?.[at]?.before ?? -1;
  }
  return { picks, max: best?.max ?? Number.POSITIVE_INFINITY };
}

/**
 * This function gives the last line of each part but the last, counted from 1. A line is an end line when `isEnd` of
 * its index from 0 is true. Of all cuts at end lines into `count` parts, it takes the cuts with the smallest largest
 * part. Of these, it takes the cut with the smallest sum of squares.
 *
 * @throws Error when the lines have fewer end lines than the count of parts needs
 */
function endsOf(size: number, isEnd: (at: number) => boolean, count: number, weights: readonly number[]): number[] {
  if (count < 2) return [];
  const sums: number[] = [];
  let total = 0;
  for (let at = 0; at < size; at += 1) {
    total += weights[at] ?? 0;
    sums.push(total);
  }
  // A position of the sums is a line from 0. The position -1 is before the first line, and `size` is after the last line.
  const sumTo = (at: number): number => (at < 0 ? 0 : at >= size ? total : (sums[at] ?? 0));
  // The candidates are the end lines before the last line. A cut after the last line gives an empty part.
  const candidates = Array.from({ length: Math.max(0, size - 1) }, (_unused, at) => at).filter(isEnd);
  if (candidates.length < count - 1) throw new Error(`the files have ${String(candidates.length + 1)} places for the end of a part, and the cut needs ${String(count)}`);
  const { max } = lightestCut(candidates, sumTo, size, count);
  const { picks } = lightestCut(candidates, sumTo, size, count, max);
  return picks.map((pick) => (candidates[pick] ?? 0) + 1);
}

/**
 * This function cuts the files of a group into `count` parts of near the same weight. It gives the entries of `mutate`
 * of each part. The files follow one another in their order. A part ends on the closing line of a method, or on the last
 * line of a file. A part holds whole files, and a range of lines of a file at each end. Each input gives one result.
 *
 * @throws Error when the files have fewer end lines than the count of parts needs
 */
export function cutByCost(files: readonly WeightedFile[], count: number): string[][] {
  const lines = files.flatMap((file) => file.lines);
  const starts: number[] = [];
  let at = 0;
  for (const file of files) {
    starts.push(at);
    at += file.lines.length;
  }
  // The last line of each file but the last file is an end. The last part ends on the last line of all files.
  const fileEnds = new Set(starts.slice(1).map((start) => start - 1));
  const isEnd = (line: number): boolean => fileEnds.has(line) || CLOSING_LINE.test(lines[line] ?? "");
  const ends = endsOf(lines.length, isEnd, count, files.flatMap((file) => file.weights));
  return Array.from({ length: count }, (_unused, part) => {
    const from = (ends[part - 1] ?? 0) + 1;
    const to = ends[part] ?? lines.length;
    return files.flatMap((file, index) => {
      const start = starts[index] ?? 0;
      const first = Math.max(from, start + 1) - start;
      const last = Math.min(to, start + file.lines.length) - start;
      if (first > last) return [];
      return [first === 1 && last === file.lines.length ? file.path : `${file.path}:${String(first)}-${String(last)}`];
    });
  });
}

/** This function gives the planned net time of the entries of a part in milliseconds: the sum of the weights of their lines. */
export function plannedMs(entries: readonly string[], files: readonly WeightedFile[]): number {
  const byPath = new Map(files.map((file) => [file.path, file.weights]));
  return entries.reduce((sum, entry) => {
    const [, path = entry, first, last] = /^(.+):(\d+)-(\d+)$/u.exec(entry) ?? [];
    const weights = byPath.get(path) ?? [];
    const from = first === undefined ? 1 : Number(first);
    const to = last === undefined ? weights.length : Number(last);
    return sum + weights.slice(from - 1, to).reduce((n, w) => n + w, 0);
  }, 0);
}

/**
 * This function reads the JSON of a file of cost maps.
 *
 * @throws Error when the JSON is not an object of packages, each an object of files, each with a run and segments
 */
export function parseCostMaps(json: unknown): CostMaps {
  const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  const isMap = (m: unknown): boolean =>
    isRecord(m) && typeof m["run"] === "string" && isRecord(m["segments"]) && Object.values(m["segments"]).every((n) => typeof n === "number" && n >= 0);
  if (!isRecord(json) || !Object.values(json).every((files) => isRecord(files) && Object.values(files).every(isMap))) {
    throw new Error(`the cost maps are not an object of packages, each an object of files, each with "run" and "segments"`);
  }
  return json as CostMaps;
}
