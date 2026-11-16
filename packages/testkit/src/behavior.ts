/**
 * A behavior check: two functions on the same seeded inputs. The check gives evidence on the draws only. It is not a
 * proof that the two functions are equal.
 *
 * - `behaviorCheck` applies two functions in one process, and compares their outputs on each draw.
 * - `behaviorDigest` gives the hash of the output of one function on each draw. Each process of a pair writes one digest.
 * - `compareDigests` compares two digests, and gives the counts of `behaviorCheck`.
 *
 * The inputs come from an input family of `@mark1russell7/rigor-generators`, or from a list. The default equality
 * compares the stable form of each output, from `behaviorForm`.
 */
import type { InputFamily, Point } from "@mark1russell7/rigor-generators";
import { importPeer } from "./peer.ts";

// rigor-generators is an optional peer dependency. Without it, the import of this entry throws an error with the install.
const { canonicalJson, familyMap, latinHypercube, random, randomDesign, seedOf, sha256Hex } = await importPeer(
  () => import("@mark1russell7/rigor-generators"),
  "@mark1russell7/rigor-generators",
  "@mark1russell7/rigor-testkit/behavior",
);

/** The design of the draws of a family: a Latin hypercube, or independent uniform points. */
export type BehaviorDesign = "latin" | "random";

/** The draws of an input family. Each draw is one point of the family. */
export interface BehaviorFamilyDraws {
  /** The input family. Each draw is a point with one value for each dimension, by name. */
  readonly family: InputFamily;
  /** The seed of the draws: a number, or a name. The same seed gives the same draws. */
  readonly seed: number | string;
  /** The count of draws. It is an integer from 1. */
  readonly count: number;
  /** The design of the unit points. The default is `latin`, so each dimension has one draw in each of `count` strata. */
  readonly design?: BehaviorDesign;
}

/** The draws of a list. Each item of the list is one draw. */
export interface BehaviorListDraws<I> {
  /** The inputs, one for each draw. The list is not empty. */
  readonly inputs: readonly I[];
}

/** The options of `behaviorCheck` that are not the options of the draws. */
export interface BehaviorCheckOptions<I> {
  /**
   * This function tells if two outputs are equal. The default compares the text of `behaviorForm` of each output.
   * Use it for a tolerance, or for an output that has no stable form.
   */
  readonly equal?: (a: unknown, b: unknown) => boolean;
  /**
   * This function gives a copy of an input. Each function gets its own copy, so a change to an input does not go to
   * the other function. The default is `structuredClone`. Give `(input) => input` for no copy.
   */
  readonly copy?: (input: I) => I;
}

/** The options of `behaviorDigest` that are not the options of the draws. */
export interface BehaviorDigestOptions<I> {
  /** This function gives a copy of an input for the function. The default is `structuredClone`. */
  readonly copy?: (input: I) => I;
}

/** The outcome of one function on one draw: a value, or a thrown error. */
export type BehaviorOutcome = { readonly threw: false; readonly value: unknown } | { readonly threw: true; readonly error: unknown };

/** The counts of a behavior check. The sum of `equal`, `different`, `bothThrew` and the two lists of throws is `count`. */
export interface BehaviorCounts {
  /** The count of draws. */
  readonly count: number;
  /** The count of draws where the two functions gave equal values. */
  readonly equal: number;
  /** The count of draws where the two functions gave values that are not equal. */
  readonly different: number;
  /** The count of draws where the two functions threw. These draws are not differences. */
  readonly bothThrew: number;
  /** The index of each draw where only `a` threw, in increasing order. */
  readonly onlyAThrew: readonly number[];
  /** The index of each draw where only `b` threw, in increasing order. */
  readonly onlyBThrew: readonly number[];
}

/** The first draw where the two functions do not agree: the values are not equal, or only one function threw. */
export interface BehaviorDifference<I> {
  /** The index of the draw. */
  readonly index: number;
  /** The input of the draw, before a function got its copy. */
  readonly input: I;
  /** The outcome of `a`. */
  readonly a: BehaviorOutcome;
  /** The outcome of `b`. */
  readonly b: BehaviorOutcome;
}

/** The result of `behaviorCheck`. */
export interface BehaviorCheckResult<I> extends BehaviorCounts {
  /** The first draw where the two functions do not agree. It is absent when they agree on each draw. */
  readonly firstDifference?: BehaviorDifference<I>;
}

/** The digest of one draw: the SHA-256 hash of the stable form of the output, or the class of the thrown value. */
export type DrawDigest = { readonly output: string } | { readonly threw: string };

/** The format of a behavior digest. A digest of a different format does not go into a comparison. */
export const BEHAVIOR_DIGEST_FORMAT = "rigor-behavior-digest/1";

/**
 * The digest of one function on its draws. It is JSON data, so a process can write it and a second process can read it.
 * `family`, `seed` and `design` are absent for the draws of a list.
 */
export interface BehaviorDigest {
  /** The format of the digest. */
  readonly format: typeof BEHAVIOR_DIGEST_FORMAT;
  /** The name of the input family. */
  readonly family?: string;
  /** The 32-bit seed of the draws, from `seedOf`. */
  readonly seed?: number;
  /** The design of the draws. */
  readonly design?: BehaviorDesign;
  /** The count of draws. */
  readonly count: number;
  /** The SHA-256 hash of the stable form of the list of draws. Two digests of different draws have different hashes. */
  readonly draws: string;
  /** The digest of each draw, in the order of the draws. */
  readonly outputs: readonly DrawDigest[];
}

/** The first draw where two digests do not agree. */
export interface DigestDifference {
  /** The index of the draw. */
  readonly index: number;
  /** The digest of the draw in the first digest. */
  readonly a: DrawDigest;
  /** The digest of the draw in the second digest. */
  readonly b: DrawDigest;
}

/** The result of `compareDigests`. It has the counts of `behaviorCheck`, without the inputs and the outputs. */
export interface DigestComparison extends BehaviorCounts {
  /** The first draw where the two digests do not agree. It is absent when they agree on each draw. */
  readonly firstDifference?: DigestDifference;
}

type Draws<I> = BehaviorFamilyDraws | BehaviorListDraws<I>;

/** The record of the draws that a digest keeps. */
interface DrawSource<I> {
  readonly inputs: readonly I[];
  readonly family?: string;
  readonly seed?: number;
  readonly design?: BehaviorDesign;
}

function isWellFormed(text: string): boolean {
  return (text as string & { isWellFormed(): boolean }).isWellFormed();
}

/** This function gives the tagged form of a value. The tagged form is JSON data, and RFC 8785 can write it. */
function tagged(value: unknown, open: Set<object>): unknown {
  switch (typeof value) {
    case "undefined":
      return { $undefined: true };
    case "boolean":
      return value;
    case "number":
      if (Number.isNaN(value)) return { $number: "NaN" };
      if (value === Number.POSITIVE_INFINITY) return { $number: "Infinity" };
      if (value === Number.NEGATIVE_INFINITY) return { $number: "-Infinity" };
      if (Object.is(value, -0)) return { $number: "-0" };
      return value;
    case "string":
      return isWellFormed(value) ? value : { $utf16: Array.from({ length: value.length }, (_, i) => value.charCodeAt(i)) };
    case "bigint":
      return { $bigint: value.toString() };
    case "object":
      break;
    default:
      throw new TypeError(`behaviorForm: a ${typeof value} has no stable form.`);
  }
  if (value === null) return null;
  const object = value as object;
  if (typeof (object as { then?: unknown }).then === "function") {
    throw new TypeError("behaviorForm: a promise has no stable form. The check runs synchronous functions only.");
  }
  if (open.has(object)) throw new TypeError("behaviorForm: the value has a cycle.");
  open.add(object);
  try {
    if (Array.isArray(object)) {
      const items: unknown[] = [];
      // A loop over the indexes, so a hole of a sparse array is undefined.
      for (let i = 0; i < object.length; i++) items.push(tagged((object as unknown[])[i], open));
      return items;
    }
    if (object instanceof Map) return { $map: sortedByForm([...object].map(([key, item]) => [tagged(key, open), tagged(item, open)])) };
    if (object instanceof Set) return { $set: sortedByForm([...object].map((item) => tagged(item, open))) };
    if (object instanceof Date) return { $date: tagged(object.getTime(), open) };
    if (object instanceof RegExp) return { $regexp: String(object) };
    if (object instanceof Error) return { $error: { name: tagged(object.name, open), message: tagged(object.message, open) } };
    const toJSON = (object as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      const next: unknown = toJSON.call(object, "");
      if (next !== object) return tagged(next, open);
    }
    const out: Record<string, unknown> = {};
    // A key that starts with "$" gets one more "$", so a plain object cannot have the form of a tag.
    for (const key of Object.keys(object)) out[key.startsWith("$") ? `$${key}` : key] = tagged((object as Record<string, unknown>)[key], open);
    return out;
  } finally {
    open.delete(object);
  }
}

/** This function sorts tagged items by their canonical text, so the order of a map or a set has no effect. */
function sortedByForm(items: unknown[]): unknown[] {
  return items
    .map((item) => ({ item, text: canonicalJson(item) }))
    .sort((x, y) => (x.text < y.text ? -1 : x.text > y.text ? 1 : 0))
    .map(({ item }) => item);
}

/**
 * This function gives the stable form of a value: the canonical JSON (RFC 8785) of its tagged form. Two values with
 * the same form are equal for the behavior check. RFC 8785 has no form for some values, so the tagged form uses an
 * object with one key that starts with `$`:
 *
 * - `NaN`, `Infinity`, `-Infinity` and `-0` become `{"$number":"NaN"}` and the related texts. Thus `-0` and `0` are not equal.
 * - `undefined` becomes `{"$undefined":true}`, also as the value of a key. Thus `{ a: undefined }` and `{}` are not equal.
 * - A `bigint` becomes `{"$bigint":"12"}`. A string with a lone surrogate becomes `{"$utf16":[...]}`, its code units.
 * - A `Map` becomes `{"$map":[[key, value], ...]}`, and a `Set` becomes `{"$set":[...]}`. The entries go in the order of their form.
 * - A `Date` becomes `{"$date":time}`. A `RegExp` becomes `{"$regexp":"/a/g"}`. An `Error` becomes `{"$error":{"name", "message"}}`.
 * - A key of an object that starts with `$` gets one more `$`. Thus a plain object cannot have the form of a tag.
 * - An object with a method `toJSON` gives the form of the result of that method.
 * - Other objects keep their own enumerable string keys, as in JSON. The form does not keep the class of an object.
 *
 * The function refuses a function, a symbol, a promise and a cycle with a `TypeError`. A key with a lone surrogate
 * causes a `RangeError`.
 */
export function behaviorForm(value: unknown): string {
  return canonicalJson(tagged(value, new Set()));
}

function integerFromOne(fn: string, name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${fn}: ${name} is ${value}, and it must be an integer from 1.`);
}

/** This function examines the options of the draws, and gives the inputs with the record of their source. */
function drawSource<I>(fn: string, options: Draws<I>): DrawSource<I> {
  const hasFamily = (options as { family?: unknown }).family !== undefined;
  const hasInputs = (options as { inputs?: unknown }).inputs !== undefined;
  if (hasFamily && hasInputs) throw new RangeError(`${fn}: give a family or a list of inputs, not the two.`);
  if (!hasFamily && !hasInputs) throw new RangeError(`${fn}: give a family or a list of inputs.`);
  if (hasInputs) {
    const { inputs } = options as BehaviorListDraws<I>;
    if (!Array.isArray(inputs)) throw new RangeError(`${fn}: inputs is not a list.`);
    if (inputs.length === 0) throw new RangeError(`${fn}: the list of inputs is empty.`);
    return { inputs: [...inputs] };
  }
  const { family, seed, count, design = "latin" } = options as BehaviorFamilyDraws;
  if (!(typeof seed === "string" || (typeof seed === "number" && Number.isFinite(seed)))) {
    throw new RangeError(`${fn}: seed is a finite number or a string, not ${String(seed)}.`);
  }
  integerFromOne(fn, "count", count);
  if (design !== "latin" && design !== "random") throw new RangeError(`${fn}: design is "latin" or "random", not ${String(design)}.`);
  const root = random(seed);
  // familyMap examines the family first, so a bad family gives its own message, not a message of the design.
  const map = familyMap(family, root.fork("family"));
  const unit = (design === "latin" ? latinHypercube : randomDesign)(count, family.dimensions.length, root.fork("design"));
  return { inputs: unit.map(map) as unknown as I[], family: family.name, seed: seedOf(seed), design };
}

/**
 * This function gives the inputs of a behavior check, in the order of the draws. A family gives its points, and a list
 * gives a copy of the list. Use it to find the input of a draw from its index, for example after `compareDigests`.
 *
 * For a family, the seed gives one random stream `random(seed)`. The fork `family` gives the parameters of the
 * dimensions, and the fork `design` gives the unit points.
 */
export function behaviorDraws(options: BehaviorFamilyDraws): Point[];
export function behaviorDraws<I>(options: BehaviorListDraws<I>): I[];
export function behaviorDraws<I>(options: Draws<I>): I[] {
  return [...drawSource("behaviorDraws", options).inputs];
}

function copier<I>(fn: string, copy: ((input: I) => I) | undefined): (input: I, index: number) => I {
  if (copy !== undefined) return (input) => copy(input);
  return (input, index) => {
    try {
      return structuredClone(input);
    } catch (error) {
      throw new TypeError(`${fn}: structuredClone cannot copy the input of draw ${index}. Give the option copy.`, { cause: error });
    }
  };
}

function outcome<I>(fn: (input: I) => unknown, input: I): BehaviorOutcome {
  let value: unknown;
  try {
    value = fn(input);
  } catch (error) {
    return { threw: true, error };
  }
  if (value !== null && typeof value === "object" && typeof (value as { then?: unknown }).then === "function") {
    // The check does not wait for a promise, so its rejection must not become an unhandled rejection.
    Promise.resolve(value).catch(() => undefined);
  }
  return { threw: false, value };
}

/** This function gives the stable form of an output, and names the function and the draw when it has no form. */
function formOf(fn: string, side: string, index: number, value: unknown): string {
  try {
    return behaviorForm(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(`${fn}: the output of ${side} on draw ${index} has no stable form (${reason}).`, { cause: error });
  }
}

/**
 * This function gives the class of a thrown value: the name of its constructor for an object, `null`, or else the
 * `typeof` of the value. For example, a thrown `new RangeError()` gives `RangeError`, and a thrown string gives `string`.
 */
function thrownClass(error: unknown): string {
  if (error === null) return "null";
  if (typeof error === "object" || typeof error === "function") {
    const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === "string" && name !== "" ? name : "Object";
  }
  return typeof error;
}

/** This function counts the agreements of two lists of outcomes. `same` compares two values. */
function tally<T, D>(
  sides: readonly (readonly [T, T])[],
  threw: (side: T) => boolean,
  same: (a: T, b: T, index: number) => boolean,
  difference: (index: number, a: T, b: T) => D,
): BehaviorCounts & { readonly firstDifference?: D } {
  let equal = 0;
  let different = 0;
  let bothThrew = 0;
  const onlyAThrew: number[] = [];
  const onlyBThrew: number[] = [];
  let first: D | undefined;
  for (let index = 0; index < sides.length; index++) {
    const [a, b] = sides[index] as readonly [T, T];
    const aThrew = threw(a);
    const bThrew = threw(b);
    if (aThrew && bThrew) {
      bothThrew += 1;
      continue;
    }
    let agree = false;
    if (aThrew) onlyAThrew.push(index);
    else if (bThrew) onlyBThrew.push(index);
    else if (same(a, b, index)) {
      equal += 1;
      agree = true;
    } else different += 1;
    if (!agree && first === undefined) first = difference(index, a, b);
  }
  const counts = { count: sides.length, equal, different, bothThrew, onlyAThrew, onlyBThrew };
  return first === undefined ? counts : { ...counts, firstDifference: first };
}

/**
 * This function applies `a` and `b` to each draw of the same inputs, and compares their outputs. Each function gets its
 * own copy of each input. For one seed and two deterministic functions, the result is always the same.
 *
 * - A draw where the two functions give equal values counts in `equal`. The default equality compares `behaviorForm` of each value.
 * - A draw where the two functions throw counts in `bothThrew`. The check does not compare the two errors.
 * - A draw where only one function throws goes in `onlyAThrew` or `onlyBThrew`, and it is a difference.
 * - `firstDifference` gives the index, the input and the two outcomes of the first difference.
 *
 * The function refuses bad options with a `RangeError`. With the default equality, an output with no stable form,
 * for example a promise, causes a `TypeError`.
 */
export function behaviorCheck(
  a: (input: Point) => unknown,
  b: (input: Point) => unknown,
  options: BehaviorFamilyDraws & BehaviorCheckOptions<Point>,
): BehaviorCheckResult<Point>;
export function behaviorCheck<I>(a: (input: I) => unknown, b: (input: I) => unknown, options: BehaviorListDraws<I> & BehaviorCheckOptions<I>): BehaviorCheckResult<I>;
export function behaviorCheck<I>(a: (input: I) => unknown, b: (input: I) => unknown, options: Draws<I> & BehaviorCheckOptions<I>): BehaviorCheckResult<I> {
  const fn = "behaviorCheck";
  const { inputs } = drawSource(fn, options);
  const copy = copier(fn, options.copy);
  const equal: (x: unknown, y: unknown, index: number) => boolean =
    options.equal ?? ((x, y, index) => formOf(fn, "a", index, x) === formOf(fn, "b", index, y));
  const sides = inputs.map((input, index) => [outcome(a, copy(input, index)), outcome(b, copy(input, index))] as const);
  return tally(
    sides,
    (side) => side.threw,
    (x, y, index) => equal((x as { value: unknown }).value, (y as { value: unknown }).value, index),
    (index, x, y): BehaviorDifference<I> => ({ index, input: inputs[index] as I, a: x, b: y }),
  );
}

/**
 * This function applies `fn` to each draw, and gives the digest of each outcome. A value gives the SHA-256 hash of its
 * `behaviorForm`. A thrown value gives its class, for example `RangeError`. The digest also keeps the seed, the family,
 * the design, the count and the hash of the draws.
 *
 * Each of two repositories writes the digest of its function in its own process. `compareDigests` then compares the
 * two digests. The inputs need a stable form, because the digest keeps their hash.
 */
export function behaviorDigest(fn: (input: Point) => unknown, options: BehaviorFamilyDraws & BehaviorDigestOptions<Point>): BehaviorDigest;
export function behaviorDigest<I>(fn: (input: I) => unknown, options: BehaviorListDraws<I> & BehaviorDigestOptions<I>): BehaviorDigest;
export function behaviorDigest<I>(fn: (input: I) => unknown, options: Draws<I> & BehaviorDigestOptions<I>): BehaviorDigest {
  const name = "behaviorDigest";
  const source = drawSource(name, options);
  let draws: string;
  try {
    draws = sha256Hex(behaviorForm(source.inputs));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(`${name}: the inputs have no stable form (${reason}).`, { cause: error });
  }
  const copy = copier(name, options.copy);
  const outputs = source.inputs.map((input, index): DrawDigest => {
    const result = outcome(fn, copy(input, index));
    return result.threw ? { threw: thrownClass(result.error) } : { output: sha256Hex(formOf(name, "the function", index, result.value)) };
  });
  return {
    format: BEHAVIOR_DIGEST_FORMAT,
    ...(source.family === undefined ? {} : { family: source.family }),
    ...(source.seed === undefined ? {} : { seed: source.seed }),
    ...(source.design === undefined ? {} : { design: source.design }),
    count: outputs.length,
    draws,
    outputs,
  };
}

function isDrawDigest(entry: unknown): entry is DrawDigest {
  if (entry === null || typeof entry !== "object") return false;
  const keys = Object.keys(entry);
  if (keys.length !== 1) return false;
  const value = (entry as Record<string, unknown>)[keys[0] as string];
  return (keys[0] === "output" || keys[0] === "threw") && typeof value === "string";
}

function examineDigest(which: string, digest: unknown): BehaviorDigest {
  const fn = "compareDigests";
  if (digest === null || typeof digest !== "object") throw new RangeError(`${fn}: ${which} is not a behavior digest.`);
  const d = digest as Partial<Record<keyof BehaviorDigest, unknown>>;
  if (d.format !== BEHAVIOR_DIGEST_FORMAT) throw new RangeError(`${fn}: the format of ${which} is ${String(d.format)}, not ${BEHAVIOR_DIGEST_FORMAT}.`);
  if (typeof d.draws !== "string") throw new RangeError(`${fn}: ${which} has no hash of its draws.`);
  if (!Array.isArray(d.outputs) || d.outputs.length !== d.count) throw new RangeError(`${fn}: ${which} does not have one output for each of its ${String(d.count)} draws.`);
  const bad = d.outputs.findIndex((entry) => !isDrawDigest(entry));
  if (bad !== -1) throw new RangeError(`${fn}: output ${bad} of ${which} does not have exactly one field, output or threw, with a string.`);
  return digest as BehaviorDigest;
}

/**
 * This function compares two digests of the same draws, and gives the counts of `behaviorCheck`. Two hashes of
 * outputs are equal when the two outputs have the same `behaviorForm`. Two thrown values count in `bothThrew`, also
 * when their classes are different.
 *
 * The function refuses two digests of different draws with a `RangeError`: a different family, seed, design, count or
 * hash of the draws. It also refuses a value that is not a digest of this format.
 */
export function compareDigests(x: BehaviorDigest, y: BehaviorDigest): DigestComparison {
  const a = examineDigest("the first digest", x);
  const b = examineDigest("the second digest", y);
  for (const field of ["family", "seed", "design", "count", "draws"] as const) {
    if (a[field] !== b[field]) {
      throw new RangeError(`compareDigests: the digests have different draws (${field} ${String(a[field])} and ${String(b[field])}).`);
    }
  }
  const sides = a.outputs.map((entry, index) => [entry, b.outputs[index] as DrawDigest] as const);
  return tally(
    sides,
    (entry) => "threw" in entry,
    (p, q) => (p as { output: string }).output === (q as { output: string }).output,
    (index, p, q): DigestDifference => ({ index, a: p, b: q }),
  );
}
