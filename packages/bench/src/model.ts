/**
 * The CPU model test. A limit from reads of many runners can hide a model that reads apart. A check of the pool
 * passes when most reads come from the other models. This test reads each model against the rest, for each case.
 *
 * A read of `differs` is about these reads. A read of `no read` does not say that a model is the same, because few reads
 * have little power. Its row gives the smallest p that this count can reach, and the level. So a row at a size that cannot
 * reach the level says so with no flip. Its row also gives the smallest shift that this test can see at that count and
 * family. A model with too few reads gives `too-few`, and it stays out of the Holm family.
 *
 * Reads of one model are not independent of their runner image and their date. The p holds only if the reads of a case
 * can change places under the null. So a read of `differs` tells where to look, and it does not name a cause.
 */
import { type TwoSamplePermutationOptions, holm, median, twoSamplePermutation } from "@mark1russell7/rigor-statistics";

/** The name of a record with no CPU model. */
export const UNKNOWN_MODEL = "unknown";

/** One value of one case, from one read on one CPU model. */
export interface ModelRead {
  readonly case: string;
  readonly model: string;
  /** The value of the read: a ratio or a time. All the reads of a case have one unit. */
  readonly value: number;
}

/** The options of `modelTest`. */
export interface ModelTestOptions {
  /** The smallest count of reads of a model that the test reads. The default is 5. */
  readonly minReads?: number;
  /** The level of the Holm family over all the rows that the test reads. The default is 0.05. */
  readonly alpha?: number;
  /** The smallest shift of a median that counts. Without it, only the test decides. It has no default. */
  readonly resolution?: number;
  /**
   * The largest number of splits of each test. The default gives 100 counts at the level of the strictest step of Holm, and
   * 10 000 or more. A test reads each split when their count is this number or less, so its p is exact.
   */
  readonly runs?: number;
  /** The seed of the splits. The default is 1. */
  readonly seed?: number | string;
  /**
   * The rows of the question, when a question has fewer rows than the data. Each other row reads `not asked`, and it stays
   * out of the family. State the question before the reads: a family that is chosen after a read has no valid p.
   */
  readonly asked?: (row: { readonly case: string; readonly model: string }) => boolean;
  /**
   * With false, the test does not search for the smallest shift of a row of `no read`, and the words of the row say so.
   * This search is most of the cost of the test. The default is true.
   */
  readonly searchVisible?: boolean;
}

/** The result of one model on one case. */
export type ModelStatus = "differs" | "no read" | "too-few" | "not asked";

/** One model on one case, against all the other reads of that case. */
export interface ModelRow {
  readonly case: string;
  readonly model: string;
  readonly reads: number;
  readonly median: number;
  readonly low: number;
  readonly high: number;
  /** The count of the reads of the other models. */
  readonly restReads: number;
  /** The median of the reads of the other models, or undefined when no other model has a read. */
  readonly restMedian: number | undefined;
  /** The median of this model minus the median of the rest, or undefined when no other model has a read. */
  readonly shift: number | undefined;
  /** The p after the Holm correction, or undefined for a row outside the family. */
  readonly p: number | undefined;
  readonly status: ModelStatus;
  /** The size of the smallest shift that this test can see at this count and family, in the direction of the shift of this row. It applies to a row of `no read`. It is undefined on each other row, and also when no shift can reach the family. */
  readonly visible: number | undefined;
  /** The p of this row with its reads far from the rest, in the direction of its shift, for a row of `no read`. No shift gives a smaller p. */
  readonly floor: number | undefined;
  /**
   * The first level of Holm in this family, alpha over the size of the family, for a row of `no read`. A row with a floor over this level reads `differs` only if other rows read `differs` before it.
   * Each of those rows raises the level.
   */
  readonly level: number | undefined;
}

/** The result of `modelTest`. */
export interface ModelTest {
  /** Each model on each case, sorted by case and by model. */
  readonly rows: readonly ModelRow[];
  /** The count of the rows in the Holm family. */
  readonly family: number;
  /** Each row that reads `differs`. */
  readonly differs: readonly ModelRow[];
}

/** This function groups a list of reads by a key, and sorts the groups by their key. */
function groupsOf(reads: readonly ModelRead[], key: (read: ModelRead) => string): [string, ModelRead[]][] {
  const groups = new Map<string, ModelRead[]>();
  for (const read of reads) groups.set(key(read), [...(groups.get(key(read)) ?? []), read]);
  return [...groups].sort(([a], [b]) => (a < b ? -1 : 1));
}

/** The count of the halvings of the search for a visible shift. */
const VISIBLE_STEPS = 8;

/** The count of the splits at the level of a test, for the default of its runs. The noise of a p at the level is then 10 %. */
const COUNTS_AT_LEVEL = 100;

/** The smallest default of the runs of a test. */
const MIN_RUNS = 10_000;

/** The result of `visibleShift`. */
export interface VisibleShift {
  /** The size of the smallest shift that reaches the level, or undefined when no shift reaches it. */
  readonly shift: number | undefined;
  /** The p with the values far from the rest, in this direction. No shift in this direction gives a smaller p. */
  readonly floor: number;
}

/** This function gives a shift that puts the moved values on one side of the rest: twice the span of the pool. */
function farShift(values: readonly number[], rest: readonly number[]): number {
  const all = [...values, ...rest];
  const span = Math.max(...all) - Math.min(...all);
  return span > 0 ? 2 * span : 1;
}

/** This function gives the p of the values with their median moved to `shift` from the median of the rest. */
function pAtShift(values: readonly number[], rest: readonly number[], shift: number, options: TwoSamplePermutationOptions): number {
  const move = median(rest) + shift - median(values);
  return twoSamplePermutation(values.map((value) => value + move), rest, options).p;
}

/**
 * This function finds the smallest shift of the median of `values` from the median of `rest` that gives a p of `level` or less.
 * It keeps the spread of the values, and it reads one direction: 1 for a shift up, and -1 for a shift down. The two
 * directions can differ, because the spread of the values and of the rest need not be symmetric.
 *
 * The level of a family is its alpha over its size, the strictest step of Holm. So the result errs on the side of a shift
 * that is too large. The cost is 9 permutation tests when the level is in reach, and 1 when it is not.
 */
export function visibleShift(values: readonly number[], rest: readonly number[], level: number, direction: 1 | -1, options: TwoSamplePermutationOptions = {}): VisibleShift {
  const far = farShift(values, rest);
  const floor = pAtShift(values, rest, direction * far, options);
  if (floor > level) return { shift: undefined, floor };
  let low = 0;
  let high = far;
  for (let step = 0; step < VISIBLE_STEPS; step++) {
    const middle = (low + high) / 2;
    if (pAtShift(values, rest, direction * middle, options) <= level) high = middle;
    else low = middle;
  }
  return { shift: high, floor };
}

/** This function reads each CPU model against the rest, for each case. */
export function modelTest(reads: readonly ModelRead[], options: ModelTestOptions = {}): ModelTest {
  const minReads = options.minReads ?? 5;
  if (!Number.isSafeInteger(minReads) || minReads < 2) throw new RangeError(`modelTest: minReads is a whole number of 2 or more, not ${minReads}.`);
  for (const read of reads) {
    if (!Number.isFinite(read.value)) throw new RangeError(`modelTest: the read of the case "${read.case}" on "${read.model}" is ${read.value}, not a finite value.`);
  }
  const seed = String(options.seed ?? 1);
  const alpha = options.alpha ?? 0.05;
  const draft = groupsOf(reads, (r) => r.case).flatMap(([caseName, ofCase]) =>
    groupsOf(ofCase, (r) => r.model).map(([model, ofModel]) => {
      const values = ofModel.map((r) => r.value);
      const rest = ofCase.filter((r) => r.model !== model).map((r) => r.value);
      const restMedian = rest.length === 0 ? undefined : median(rest);
      const middle = median(values);
      const row = { case: caseName, model, reads: values.length, median: middle, low: Math.min(...values), high: Math.max(...values), restReads: rest.length, restMedian, shift: restMedian === undefined ? undefined : middle - restMedian };
      const asked = options.asked?.({ case: caseName, model }) ?? true;
      return { row, asked, inFamily: asked && values.length >= minReads && rest.length > 0, values, rest };
    }),
  );
  const family = draft.filter((d) => d.inFamily).length;
  const level = alpha / Math.max(family, 1);
  const runs = options.runs ?? Math.max(MIN_RUNS, Math.ceil(COUNTS_AT_LEVEL / level));
  // Each pair of a case and a model has its own seed, so a new case does not change the p of another case.
  const read = draft.map((d) => {
    const test = { seed: `${seed} ${d.row.case} ${d.row.model}`, runs };
    return { ...d, test, raw: d.inFamily ? twoSamplePermutation(d.values, d.rest, test).p : undefined };
  });
  const tested = read.flatMap((d) => (d.raw === undefined ? [] : [d.raw]));
  const corrected = holm(tested, alpha);
  let next = 0;
  const rows = read.map(({ row, asked, raw, values, rest, test }): ModelRow => {
    if (raw === undefined) return { ...row, p: undefined, status: asked ? "too-few" : "not asked", visible: undefined, floor: undefined, level: undefined };
    const held = corrected[next++];
    if (held === undefined) throw new Error("modelTest: the Holm family lost a row.");
    const large = options.resolution === undefined || Math.abs(row.shift ?? 0) >= options.resolution;
    if (held.reject && large) return { ...row, p: held.adjusted, status: "differs", visible: undefined, floor: undefined, level: undefined };
    const direction = (row.shift ?? 0) < 0 ? -1 : 1;
    if (options.searchVisible === false) {
      return { ...row, p: held.adjusted, status: "no read", visible: undefined, floor: pAtShift(values, rest, direction * farShift(values, rest), test), level };
    }
    const seen = visibleShift(values, rest, level, direction, test);
    const visible = seen.shift === undefined ? undefined : Math.max(seen.shift, options.resolution ?? 0);
    return { ...row, p: held.adjusted, status: "no read", visible, floor: seen.floor, level };
  });
  return { rows, family, differs: rows.filter((r) => r.status === "differs") };
}

/** This function gives the words of one row. No word says that a model is the same as the rest. */
export function modelRowText(row: ModelRow, family: number): string {
  const counts = `${row.reads} reads against ${row.restReads}, family ${family}`;
  const name = `${row.case} on ${row.model}`;
  if (row.status === "not asked") return `not asked: ${name} has ${row.reads} reads, and it is outside the family`;
  if (row.status === "too-few") return `too few: ${name} has ${row.reads} reads against ${row.restReads}, and the test does not read it`;
  const shift = (row.shift ?? 0).toFixed(3);
  if (row.status === "differs") return `differs: ${name} has a shift of ${shift} at ${counts}, Holm p ${(row.p ?? 1).toFixed(4)}`;
  const floor = row.floor ?? 1;
  const level = row.level ?? 0;
  const facts = `the smallest p is ${floor.toFixed(5)}, and the first level of Holm is ${level.toFixed(5)}`;
  const head = `no read: ${name} has a shift of ${shift} at ${counts}`;
  if (floor > level) return `${head}. This size cannot reach the level: ${facts}`;
  if (row.visible === undefined) return `${head}. The test did not search for the shift that it can see: ${facts}`;
  return `${head}. This test sees a shift of ${row.visible.toFixed(3)} or more: ${facts}`;
}

/** The limits of a gain that reads on some CPU models only. */
export interface ModelLimits {
  /** The limit that holds the gain, on a model of `models`. */
  readonly gain: number;
  /** The limit on each other model. It stops a loss, and it does not hold the gain. */
  readonly ceiling: number;
  /** The models with a read of the gain. */
  readonly models: readonly string[];
}

/** The limit of a gain on one CPU model. */
export interface LimitOnModel {
  readonly limit: number;
  /** This field is true when a pass at this limit holds the gain. */
  readonly holdsGain: boolean;
  /** The words for a read that does not hold the gain, or undefined when it holds the gain. */
  readonly note: string | undefined;
}

/** The words of a read at the ceiling. A pass at the ceiling is not a gain held. */
export const CEILING_ONLY = "gain not read on this model, ceiling only";

/** This function gives the limit of a gain on one CPU model. A model with no earlier reads gets the ceiling. */
export function limitOnModel(limits: ModelLimits, model: string): LimitOnModel {
  if (limits.ceiling < limits.gain) throw new RangeError(`limitOnModel: the ceiling ${limits.ceiling} is under the gain limit ${limits.gain}.`);
  return limits.models.includes(model) ? { limit: limits.gain, holdsGain: true, note: undefined } : { limit: limits.ceiling, holdsGain: false, note: CEILING_ONLY };
}

/** One pair of reads, with the CPU model of each arm. A record with no model has `undefined`. */
export interface ArmPair {
  readonly a: string | undefined;
  readonly b: string | undefined;
}

/** The CPU models of the two arms of a set of pairs. */
export interface ArmModels {
  readonly a: readonly string[];
  readonly b: readonly string[];
  /** This field is true when all the reads of the two arms have one known model. Otherwise, a ratio can compare two computers. */
  readonly one: boolean;
}

/** This function gives the sorted CPU models of each arm, and tells if all the reads come from one known model. */
export function armModels(pairs: readonly ArmPair[]): ArmModels {
  const distinct = (values: readonly string[]): string[] => [...new Set(values)].sort();
  const a = distinct(pairs.map((p) => p.a ?? UNKNOWN_MODEL));
  const b = distinct(pairs.map((p) => p.b ?? UNKNOWN_MODEL));
  const all = distinct([...a, ...b]);
  return { a, b, one: all.length === 1 && all[0] !== UNKNOWN_MODEL };
}
