/**
 * Covering arrays: few rows that still hold each combination of `t` values of `t` different dimensions.
 * With the strength 2, each pair of values of 2 dimensions is in one row or more (a pairwise array).
 */
import type { Random } from "./random.ts";

/** The default count of candidate rows for each row that `coveringArray` keeps. */
export const COVERING_CANDIDATES = 50;

/** The largest count of combinations of values that one array covers. A larger array is an error, not a long run. */
export const COVERING_LIMIT = 10_000_000;

/** The options of `coveringArray` and `coveringRows`. */
export interface CoveringOptions {
  /** The strength `t`: each `t` values of `t` different dimensions are in one row or more. The default is 2. */
  readonly strength?: number;
  /** The count of candidate rows for each row that the array keeps. The default is `COVERING_CANDIDATES`. */
  readonly candidates?: number;
}

/** The coverage of a set of rows over some dimensions. */
export interface Coverage {
  /** The count of the combinations of `t` values of `t` different dimensions. */
  readonly tuples: number;
  /** The count of the combinations that one row or more holds. */
  readonly covered: number;
  /** `covered` divided by `tuples`. Dimensions with no combination give 1. */
  readonly share: number;
  /** The combinations that no row holds, as `<dimension>=<value>&<dimension>=<value>`, in the order of the dimensions. */
  readonly missing: readonly string[];
}

const isWhole = (value: unknown, least: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= least;

/** This function gives each set of `t` indices from 0 to `k - 1`, each set in increasing order, the sets in lexical order. */
function combinations(k: number, t: number): number[][] {
  const out: number[][] = [];
  const pick: number[] = [];
  const walk = (from: number): void => {
    if (pick.length === t) {
      out.push([...pick]);
      return;
    }
    for (let i = from; i <= k - (t - pick.length); i++) {
      pick.push(i);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

/** This function checks the options and gives the strength for `k` dimensions: the given strength, or `k` when there are fewer dimensions. */
function strengthOf(k: number, options: CoveringOptions): number {
  const strength = options.strength ?? 2;
  if (!isWhole(strength, 1)) throw new RangeError(`covering: the strength is a whole number of 1 or more, not ${String(strength)}.`);
  return Math.min(strength, k);
}

/**
 * This function gives a covering array of strength `t` over dimensions with `levels[i]` levels each. Each row has the index
 * of one level of each dimension. With fewer dimensions than `t`, the array covers each combination of all the dimensions.
 * Thus no dimensions give one empty row, as the product of no sets has one item.
 *
 * The algorithm is a greedy AETG. Each row starts at a level with the most open combinations. The array makes `candidates`
 * rows, and it keeps the row that covers the most new combinations. Each candidate takes the dimensions in a random order.
 * Each dimension takes the level that covers the most new combinations with the dimensions before it.
 * The random draws come from `r`, thus the same levels, options and seed give the same rows.
 *
 * This function throws a `RangeError` for a dimension with no level, for bad options, and for more than `COVERING_LIMIT` combinations.
 */
export function coveringArray(levels: readonly number[], r: Random, options: CoveringOptions = {}): number[][] {
  for (const [i, size] of levels.entries()) {
    if (!isWhole(size, 1)) throw new RangeError(`coveringArray: dimension ${i} has ${String(size)} levels, not a whole number of 1 or more.`);
  }
  const t = strengthOf(levels.length, options);
  const candidates = options.candidates ?? COVERING_CANDIDATES;
  if (!isWhole(candidates, 1)) throw new RangeError(`coveringArray: candidates is a whole number of 1 or more, not ${String(candidates)}.`);
  const k = levels.length;
  if (k === 0) return [[]];

  const combos = combinations(k, t);
  const comboOf = new Map(combos.map((combo, index) => [combo.join(","), index]));
  const sizes = combos.map((combo) => combo.reduce((product, d) => product * levels[d]!, 1));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > COVERING_LIMIT) throw new RangeError(`coveringArray: ${total} combinations of values, more than ${COVERING_LIMIT}.`);
  // open[c][index] is 1 while the combination `index` of the values of the dimensions `combos[c]` has no row.
  const open = sizes.map((size) => new Uint8Array(size).fill(1));
  // openBy[d][v] is the count of the open combinations that hold level `v` of dimension `d`.
  const openBy = levels.map((size, d) => new Array<number>(size).fill(combos.reduce((sum, combo, c) => sum + (combo.includes(d) ? sizes[c]! / levels[d]! : 0), 0)));
  let left = total;
  const indexOf = (combo: readonly number[], row: readonly number[]): number => combo.reduce((index, d) => index * levels[d]! + row[d]!, 0);
  // The level of dimension `f` that closes the most open combinations with the levels of the row on the dimensions `done`.
  // The gain of a level counts each set of `t - 1` dimensions of `done` with `f`. The function draws among the ties with `choose`.
  const bestLevel = (f: number, row: number[], done: readonly number[], choose: (ties: number[]) => number): [level: number, gain: number] => {
    const sets = combinations(done.length, t - 1).map((rest) => {
      const combo = [...rest.map((i) => done[i]!), f].sort((a, b) => a - b);
      return { flags: open[comboOf.get(combo.join(","))!]!, combo };
    });
    let top = -1;
    let tops: number[] = [];
    for (let v = 0; v < levels[f]!; v++) {
      row[f] = v;
      let n = 0;
      for (const { flags, combo } of sets) n += flags[indexOf(combo, row)]!;
      if (n > top) {
        top = n;
        tops = [];
      }
      if (n === top) tops.push(v);
    }
    return [choose(tops), top];
  };

  const rows: number[][] = [];
  while (left > 0) {
    let most = -1;
    let starts: [number, number][] = [];
    for (let d = 0; d < k; d++) {
      for (let v = 0; v < levels[d]!; v++) {
        if (openBy[d]![v]! > most) {
          most = openBy[d]![v]!;
          starts = [];
        }
        if (openBy[d]![v] === most) starts.push([d, v]);
      }
    }
    let best: number[] = [];
    let bestGain = -1;
    for (let c = 0; c < candidates; c++) {
      const [first, level] = r.pick(starts);
      const row = new Array<number>(k).fill(-1);
      row[first] = level;
      const done = [first];
      let gain = t === 1 ? open[comboOf.get(String(first))!]![level]! : 0;
      for (const f of r.shuffle([...Array(k).keys()].filter((d) => d !== first))) {
        const [chosen, top] = bestLevel(f, row, done, (ties) => r.pick(ties));
        row[f] = chosen;
        gain += top;
        done.push(f);
      }
      if (gain > bestGain) {
        best = row;
        bestGain = gain;
      }
    }
    if (bestGain === 0) {
      // With a strength of 3 or more, the greedy rows can miss each open combination. The row then starts from the first open
      // combination, and each other dimension takes its lowest level with the most gain. This row closes one combination or more.
      const c = open.findIndex((flags) => flags.includes(1));
      let index = open[c]!.indexOf(1);
      best = new Array<number>(k).fill(-1);
      for (const d of [...combos[c]!].reverse()) {
        best[d] = index % levels[d]!;
        index = Math.floor(index / levels[d]!);
      }
      const done = [...combos[c]!];
      for (let f = 0; f < k; f++) {
        if (done.includes(f)) continue;
        best[f] = bestLevel(f, best, done, (ties) => ties[0]!)[0];
        done.push(f);
      }
    }
    for (const [c, combo] of combos.entries()) {
      const at = indexOf(combo, best);
      if (open[c]![at] === 1) {
        open[c]![at] = 0;
        left--;
        for (const d of combo) openBy[d]![best[d]!]!--;
      }
    }
    rows.push(best);
  }
  return rows;
}

/**
 * This function gives a covering array over named dimensions: each row has one value of each dimension. The values of a
 * dimension are its levels, in their order. The options and the draws are those of `coveringArray`. The value of each name
 * in a row has the type of the levels of its dimension. Thus dimensions of different types can be in one call.
 */
export function coveringRows<D extends Readonly<Record<string, readonly unknown[]>>>(dimensions: D, r: Random, options: CoveringOptions = {}): { [K in keyof D]: D[K][number] }[] {
  const names = Object.keys(dimensions);
  const levels: Readonly<Record<string, readonly unknown[]>> = dimensions;
  return coveringArray(
    names.map((name) => levels[name]!.length),
    r,
    options,
  ).map((row) => Object.fromEntries(names.map((name, i) => [name, levels[name]![row[i]!]])) as { [K in keyof D]: D[K][number] });
}

/**
 * This function gives the coverage of some rows over named dimensions, with the strength `t` (the default is 2). A row holds a
 * combination when it has each of its values. The function compares the values as text with `String`, and it ignores the
 * fields of a row that are not dimensions. With fewer dimensions than `t`, the combinations are those of all the dimensions.
 * Thus no dimensions give one empty combination, with the key `""`.
 */
export function tupleCoverage(rows: readonly Readonly<Record<string, unknown>>[], dimensions: Readonly<Record<string, readonly unknown[]>>, strength = 2): Coverage {
  const names = Object.keys(dimensions);
  const t = strengthOf(names.length, { strength });
  const combos = combinations(names.length, t);
  const keyOf = (combo: readonly number[], values: readonly unknown[]): string => combo.map((d, i) => `${names[d]}=${String(values[i])}`).join("&");
  let tuples = 0;
  for (const combo of combos) tuples += combo.reduce((product, d) => product * dimensions[names[d]!]!.length, 1);
  if (tuples > COVERING_LIMIT) throw new RangeError(`tupleCoverage: ${tuples} combinations of values, more than ${COVERING_LIMIT}.`);
  const seen = new Set<string>();
  for (const row of rows) {
    for (const combo of combos) seen.add(keyOf(combo, combo.map((d) => row[names[d]!])));
  }
  const missing: string[] = [];
  for (const combo of combos) {
    const values = combo.map((d) => dimensions[names[d]!]!);
    const walk = (i: number, chosen: unknown[]): void => {
      if (i === combo.length) {
        const key = keyOf(combo, chosen);
        if (!seen.has(key)) missing.push(key);
        return;
      }
      for (const value of values[i]!) walk(i + 1, [...chosen, value]);
    };
    walk(0, []);
  }
  const covered = tuples - missing.length;
  return { tuples, covered, share: tuples === 0 ? 1 : covered / tuples, missing };
}
