/**
 * Metamorphic relations on `fast-check`. A relation changes an input in a known way and tells how the output changes.
 * A test examines the relation on random inputs. It needs no oracle of the correct output.
 * The entry imports `fast-check`, an optional peer dependency, and no module of Node.js.
 */

import fc from "fast-check";

/** One case of a relation: the source input, the parameter of the change and the follow-up input of the change. */
export interface RelationCase<I, P> {
  readonly input: I;
  readonly param: P;
  readonly followUp: I;
}

/** The verdict of a relation on one case. The value `true` tells that the relation holds. `false` or a text tells a break. */
export type RelationVerdict = boolean | string;

/**
 * A metamorphic relation of a function from `I` to `O`. The parameter `P` selects one change, for example the size of a shift.
 * The members are methods, so a list of relations with different parameters has the type `Relation<I, O, unknown>[]`.
 */
export interface Relation<I, O, P> {
  /** The name of the relation in a failure. */
  readonly name: string;
  /** This arbitrary gives the parameter of a change. A function gives an arbitrary for each input, for example the indexes of an array. */
  readonly param: fc.Arbitrary<P> | ((input: I) => fc.Arbitrary<P>);
  /** This method gives the follow-up input. It must not change `input`. */
  change(input: I, param: P): I;
  /** This method compares the output of the source input with the output of the follow-up input. */
  holds(source: O, followUp: O, test: RelationCase<I, P>): RelationVerdict;
}

/**
 * A relation where the follow-up output is a function of the source output: `f(change(x, p))` equals `map(f(x), p)`.
 * Two of these relations make a third relation with `composeRelations`.
 */
export interface EquivariantRelation<I, O, P> extends Relation<I, O, P> {
  /** This method gives the expected follow-up output from the source output. */
  map(output: O, param: P): O;
  /** This method compares two outputs. */
  equal(a: O, b: O): boolean;
}

/** The options of `equivariant`. */
export interface EquivariantOptions<I, O, P> {
  /** This arbitrary gives the parameter of a change. A function gives an arbitrary for each input. */
  param: fc.Arbitrary<P> | ((input: I) => fc.Arbitrary<P>);
  /** This function gives the follow-up input. It must not change `input`. */
  change: (input: I, param: P) => I;
  /** This function gives the expected follow-up output from the source output. */
  map: (output: O, param: P) => O;
  /** This function compares two outputs. The default is `withinTolerance()`, an exact comparison of the structure. */
  equal?: (a: O, b: O) => boolean;
}

/** The options of `invariant`. The follow-up output is equal to the source output. */
export type InvariantOptions<I, O, P> = Omit<EquivariantOptions<I, O, P>, "map">;

/** The options of `permutationInvariant`. */
export interface PermutationOptions<O> {
  /** The name of the relation. The default is `"permutation"`. */
  name?: string;
  /** This function compares two outputs. The default is `withinTolerance()`. */
  equal?: (a: O, b: O) => boolean;
}

/** The tolerances of `withinTolerance`. Two numbers are equal when one of the two limits holds. */
export interface Tolerance {
  /** The largest absolute difference. The default is 0. */
  absolute?: number;
  /** The largest difference as a fraction of the larger size of the two numbers. The default is 0. */
  relative?: number;
}

/** The options of `checkRelations` and `checkRelationsAsync`. */
export interface CheckRelationsOptions<I = unknown> {
  /** The number of runs of each relation. The default is the default of `fast-check`. A value in `parameters` replaces it. */
  numRuns?: number;
  /** More parameters of `fc.check` for each relation, for example `seed`. */
  parameters?: fc.Parameters<[RelationCase<I, unknown>]>;
}

/** The options of `composeRelations`. */
export interface ComposeOptions<O> {
  /** This function compares two outputs. The default accepts two outputs when the comparison of one of the two relations accepts them. */
  equal?: (a: O, b: O) => boolean;
}

/** This function gives the arbitrary of the parameter of a relation for one input. */
function paramOf<I, P>(relation: Pick<Relation<I, unknown, P>, "param">, input: I): fc.Arbitrary<P> {
  return typeof relation.param === "function" ? relation.param(input) : relation.param;
}

/**
 * This function makes a relation where the follow-up output is `map(f(x), p)`.
 * A failure shows the expected output and the follow-up output.
 */
export function equivariant<I, O, P>(name: string, options: EquivariantOptions<I, O, P>): EquivariantRelation<I, O, P> {
  const equal = options.equal ?? withinTolerance();
  return {
    name,
    param: options.param,
    change: options.change,
    map: options.map,
    equal,
    holds: (source, followUp, test) => {
      const expected = options.map(source, test.param);
      return equal(followUp, expected) || `the follow-up output ${fc.stringify(followUp)} is not the expected ${fc.stringify(expected)}`;
    },
  };
}

/** This function makes a relation where the follow-up output is equal to the source output. */
export function invariant<I, O, P>(name: string, options: InvariantOptions<I, O, P>): EquivariantRelation<I, O, P> {
  return equivariant(name, { ...options, map: (output) => output });
}

/**
 * This function makes the relation of the second change after the first change.
 * The parameter of the second change comes from the follow-up input of the first change.
 * Thus the second change gets the follow-up inputs of the first change as source inputs.
 */
export function composeRelations<I, O, P, Q>(
  first: EquivariantRelation<I, O, P>,
  second: EquivariantRelation<I, O, Q>,
  options: ComposeOptions<O> = {},
): EquivariantRelation<I, O, readonly [P, Q]> {
  return equivariant(`${first.name} then ${second.name}`, {
    param: (input) => paramOf(first, input).chain((p) => paramOf(second, first.change(input, p)).map((q): readonly [P, Q] => [p, q])),
    change: (input, [p, q]) => second.change(first.change(input, p), q),
    map: (output, [p, q]) => second.map(first.map(output, p), q),
    equal: options.equal ?? ((a, b) => first.equal(a, b) || second.equal(a, b)),
  });
}

/**
 * This function makes the relation of a function of a multiset: a new order of the elements keeps the output.
 * The parameter is the list of the source indexes in the new order.
 */
export function permutationInvariant<T, O>(options: PermutationOptions<O> = {}): EquivariantRelation<readonly T[], O, readonly number[]> {
  return invariant<readonly T[], O, readonly number[]>(options.name ?? "permutation", {
    param: (input) => {
      const indexes = input.map((_, index) => index);
      return fc.shuffledSubarray(indexes, { minLength: indexes.length, maxLength: indexes.length });
    },
    change: (input, order) => order.map((index) => input[index] as T),
    ...(options.equal === undefined ? {} : { equal: options.equal }),
  });
}

/** This function tells whether a value is a plain object: its prototype is `Object.prototype` or `null`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * This function makes a comparison of two values with a tolerance on each number.
 * - Two numbers are equal when they are equal, when both are `NaN`, or when the difference is in a limit.
 * - Two arrays are equal when they have the same length and each pair of elements is equal.
 * - Two plain objects are equal when they have the same keys and each pair of values is equal.
 * - Two other values are equal when `Object.is` tells it. For a `Map` or a `Date`, give your own comparison.
 */
export function withinTolerance(tolerance: Tolerance = {}): (a: unknown, b: unknown) => boolean {
  const absolute = tolerance.absolute ?? 0;
  const relative = tolerance.relative ?? 0;
  if (!(absolute >= 0) || !(relative >= 0)) throw new RangeError("A tolerance is a number of 0 or more.");
  const equal = (a: unknown, b: unknown): boolean => {
    if (typeof a === "number" && typeof b === "number") {
      if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      const difference = Math.abs(a - b);
      return difference <= absolute || difference <= relative * Math.max(Math.abs(a), Math.abs(b));
    }
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equal(value, b[index]));
    if (isPlainObject(a) && isPlainObject(b)) {
      const keys = Object.keys(a);
      return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
    }
    return Object.is(a, b);
  };
  return equal;
}

/**
 * This function gives the arbitrary of the cases of a relation: an input, a parameter for it and the follow-up input.
 * Use it to write a property of your own on a relation.
 */
export function relationCases<I, O, P>(relation: Relation<I, O, P>, inputs: fc.Arbitrary<I>): fc.Arbitrary<RelationCase<I, P>> {
  const pairs: fc.Arbitrary<readonly [I, P]> =
    typeof relation.param === "function"
      ? inputs.chain((input) => paramOf(relation, input).map((param): readonly [I, P] => [input, param]))
      : fc.tuple(inputs, relation.param);
  return pairs.map(([input, param]) => ({ input, param, followUp: relation.change(input, param) }));
}

/** This function gives the text of the error of a break. */
function breakText(name: string, verdict: RelationVerdict): string {
  return typeof verdict === "string" ? `The relation ${name} does not hold: ${verdict}.` : `The relation ${name} does not hold.`;
}

/**
 * This function gives the property of a relation for `f`. It throws an error with the name of the relation when the relation does not hold.
 * The function `f` must not change its input.
 */
export function relationProperty<I, O, P>(
  f: (input: I) => O,
  relation: Relation<I, O, P>,
  inputs: fc.Arbitrary<I>,
): fc.IPropertyWithHooks<[RelationCase<I, P>]> {
  return fc.property(relationCases(relation, inputs), (test) => {
    const verdict = relation.holds(f(test.input), f(test.followUp), test);
    if (verdict !== true) throw new Error(breakText(relation.name, verdict));
  });
}

/** This function gives the property of a relation for an async function `f`. */
export function relationPropertyAsync<I, O, P>(
  f: (input: I) => Promise<O> | O,
  relation: Relation<I, O, P>,
  inputs: fc.Arbitrary<I>,
): fc.IAsyncPropertyWithHooks<[RelationCase<I, P>]> {
  return fc.asyncProperty(relationCases(relation, inputs), async (test) => {
    const verdict = relation.holds(await f(test.input), await f(test.followUp), test);
    if (verdict !== true) throw new Error(breakText(relation.name, verdict));
  });
}

/** One relation that does not hold, with the report of `fast-check`. */
interface Break {
  readonly name: string;
  readonly report: string;
}

/** This function gives the parameters of `fc.check` for one relation. The report includes the error of the break by default. */
function parametersOf<I>(options: CheckRelationsOptions<I>): fc.Parameters<[RelationCase<I, unknown>]> {
  return { includeErrorInReport: true, ...(options.numRuns === undefined ? {} : { numRuns: options.numRuns }), ...options.parameters };
}

/** This function throws one error that names each relation that does not hold. */
function throwBreaks(breaks: readonly Break[], count: number): void {
  if (breaks.length === 0) return;
  const names = breaks.map((b) => b.name).join(", ");
  const reports = breaks.map((b) => `${b.name}:\n${b.report}`).join("\n\n");
  throw new Error(`${breaks.length} of ${count} relations do not hold: ${names}.\n\n${reports}`);
}

/**
 * This function examines each relation for `f` on random inputs, and throws one error when one or more relations do not hold.
 * The error names each relation that does not hold. The set of these relations helps to find the fault.
 */
export function checkRelations<I, O>(
  f: (input: I) => O,
  relations: readonly Relation<I, O, unknown>[],
  inputs: fc.Arbitrary<I>,
  options: CheckRelationsOptions<I> = {},
): void {
  const breaks: Break[] = [];
  for (const relation of relations) {
    const details = fc.check(relationProperty(f, relation, inputs), parametersOf(options));
    if (details.failed) breaks.push({ name: relation.name, report: fc.defaultReportMessage(details) ?? "" });
  }
  throwBreaks(breaks, relations.length);
}

/** This function is `checkRelations` for an async function `f`. */
export async function checkRelationsAsync<I, O>(
  f: (input: I) => Promise<O> | O,
  relations: readonly Relation<I, O, unknown>[],
  inputs: fc.Arbitrary<I>,
  options: CheckRelationsOptions<I> = {},
): Promise<void> {
  const breaks: Break[] = [];
  for (const relation of relations) {
    const details = await fc.check(relationPropertyAsync(f, relation, inputs), parametersOf(options));
    if (details.failed) breaks.push({ name: relation.name, report: (await fc.asyncDefaultReportMessage(details)) ?? "" });
  }
  throwBreaks(breaks, relations.length);
}
