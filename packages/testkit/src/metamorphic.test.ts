import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Relation,
  checkRelations,
  checkRelationsAsync,
  composeRelations,
  equivariant,
  invariant,
  permutationInvariant,
  relationCases,
  relationProperty,
  withinTolerance,
} from "./metamorphic.ts";

const SEED = { seed: 7 };
const sorted = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const lists: fc.Arbitrary<readonly number[]> = fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 20 });
const filled: fc.Arbitrary<readonly number[]> = fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1, maxLength: 20 });
const close = withinTolerance({ absolute: 1e-9, relative: 1e-9 });

/** The output of `mean` after a shift of each element by `c`. */
const shift = equivariant<readonly number[], number, number>("shift", {
  param: fc.integer({ min: -100, max: 100 }),
  change: (xs, c) => xs.map((x) => x + c),
  map: (m, c) => m + c,
  equal: close,
});

/** The output of `mean` after a scale of each element by `k`. */
const scale = equivariant<readonly number[], number, number>("scale", {
  param: fc.integer({ min: -5, max: 5 }),
  change: (xs, k) => xs.map((x) => x * k),
  map: (m, k) => m * k,
  equal: close,
});

/** The error message of a check, or an empty text when the check passes. */
const messageOf = (check: () => void): string => {
  try {
    check();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe("checkRelations", () => {
  it("passes when each relation holds", () => {
    expect(() => checkRelations(sorted, [permutationInvariant<number, number[]>()], lists, { parameters: SEED })).not.toThrow();
    expect(() => checkRelations(mean, [permutationInvariant<number, number>({ equal: close }), shift, scale], filled, { parameters: SEED })).not.toThrow();
  });

  it("names the relation that does not hold, with the break and the counterexample", () => {
    // This sort keeps the first element in its place, so a new order of the input changes the output.
    const broken = (xs: readonly number[]): number[] => (xs.length === 0 ? [] : [xs[0]!, ...sorted(xs.slice(1))]);
    const message = messageOf(() => checkRelations(broken, [permutationInvariant<number, number[]>()], lists, { parameters: SEED }));
    expect(message.startsWith("1 of 1 relations do not hold: permutation.")).toBe(true);
    expect(message).toContain("The relation permutation does not hold: the follow-up output");
    expect(message).toContain("Counterexample");
  });

  it("names each relation that does not hold, and not the relations that hold", () => {
    // This mean divides by n + 1. A new order and a scale keep the relations, but a shift does not give the mean + c.
    const wrongMean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length + 1);
    const message = messageOf(() => checkRelations(wrongMean, [permutationInvariant<number, number>({ equal: close }), shift, scale], filled, { parameters: SEED }));
    expect(message.split("\n")[0]).toBe("1 of 3 relations do not hold: shift.");
    const offset = (xs: readonly number[]): number => mean(xs) + 1;
    expect(messageOf(() => checkRelations(offset, [shift, scale], filled, { parameters: SEED })).split("\n")[0]).toBe("1 of 2 relations do not hold: scale.");
  });

  it("uses numRuns, and a value in parameters replaces it", () => {
    let calls = 0;
    const count = (xs: readonly number[]): number[] => {
      calls += 1;
      return sorted(xs);
    };
    checkRelations(count, [permutationInvariant<number, number[]>()], lists, { numRuns: 25 });
    expect(calls).toBe(50);
    calls = 0;
    checkRelations(count, [permutationInvariant<number, number[]>()], lists, { numRuns: 25, parameters: { numRuns: 10 } });
    expect(calls).toBe(20);
  });

  it("gives the same failure for the same seed", () => {
    const broken = (xs: readonly number[]): number[] => (xs.length === 0 ? [] : [xs[0]!, ...sorted(xs.slice(1))]);
    // The report has the stack of the error, so the test compares the counterexample and the number of shrinks.
    const once = (): string[] =>
      messageOf(() => checkRelations(broken, [permutationInvariant<number, number[]>()], lists, { parameters: SEED }))
        .split(/\r?\n/)
        .filter((line) => line.startsWith("Counterexample") || line.startsWith("Shrunk"));
    expect(once()).toHaveLength(2);
    expect(once()).toEqual(once());
  });
});

describe("the relations", () => {
  it("draws the parameter of a relation from the input", () => {
    // An insert of v at index i: the sort of the follow-up input is the sort of the input with v in its place.
    const insert = equivariant<readonly number[], number[], readonly [number, number]>("insert", {
      param: (xs) => fc.tuple(fc.integer({ min: 0, max: xs.length }), fc.integer({ min: -1000, max: 1000 })),
      change: (xs, [i, v]) => [...xs.slice(0, i), v, ...xs.slice(i)],
      map: (out, [, v]) => sorted([...out, v]),
    });
    expect(() => checkRelations(sorted, [insert], lists, { parameters: SEED })).not.toThrow();
    const cases = fc.sample(relationCases(insert, lists), { numRuns: 50, ...SEED });
    for (const test of cases) {
      expect(test.param[0]).toBeLessThanOrEqual(test.input.length);
      expect(test.followUp).toHaveLength(test.input.length + 1);
    }
  });

  it("gives a permutation of the input as the follow-up input", () => {
    const relation = permutationInvariant<number, number>();
    for (const test of fc.sample(relationCases(relation, lists), { numRuns: 50, ...SEED })) {
      expect(sorted(test.param)).toEqual(test.input.map((_, i) => i));
      expect(sorted(test.followUp)).toEqual(sorted(test.input));
    }
  });

  it("composes two relations: the second change gets the follow-up input of the first", () => {
    const both = composeRelations(shift, scale);
    expect(both.name).toBe("shift then scale");
    for (const test of fc.sample(relationCases(both, filled), { numRuns: 50, ...SEED })) {
      const [c, k] = test.param;
      expect(test.followUp).toEqual(test.input.map((x) => (x + c) * k));
      expect(both.map(mean(test.input), test.param)).toBeCloseTo((mean(test.input) + c) * k, 9);
    }
    expect(() => checkRelations(mean, [both], filled, { parameters: SEED })).not.toThrow();
    const wrongMean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length + 1);
    expect(messageOf(() => checkRelations(wrongMean, [both], filled, { parameters: SEED })).split("\n")[0]).toBe("1 of 1 relations do not hold: shift then scale.");
  });

  it("keeps the output for an invariant relation, with an exact comparison of the structure by default", () => {
    const reverse = invariant<readonly number[], { min: number; max: number }, null>("reverse", {
      param: fc.constant(null),
      change: (xs) => [...xs].reverse(),
    });
    const range = (xs: readonly number[]): { min: number; max: number } => ({ min: Math.min(...xs), max: Math.max(...xs) });
    expect(() => checkRelations(range, [reverse], filled, { parameters: SEED })).not.toThrow();
    const first = (xs: readonly number[]): { min: number; max: number } => ({ min: xs[0]!, max: Math.max(...xs) });
    expect(messageOf(() => checkRelations(first, [reverse], filled, { parameters: SEED }))).toContain("reverse");
  });

  it("shows the text of a verdict in the error of the property", () => {
    const sameLength: Relation<readonly number[], number[], null> = {
      name: "same length",
      param: fc.constant(null),
      change: (xs) => [...xs, 0],
      holds: (source, followUp) => followUp.length === source.length || `${followUp.length} is not ${source.length}`,
    };
    const details = fc.check(relationProperty(sorted, sameLength, filled), SEED);
    expect(details.failed).toBe(true);
    const error = details.errorInstance as Error;
    expect(error.message).toMatch(/^The relation same length does not hold: \d+ is not \d+\.$/);
    const silent: Relation<readonly number[], number[], null> = { ...sameLength, name: "silent", holds: () => false };
    const failed = fc.check(relationProperty(sorted, silent, filled), SEED);
    expect((failed.errorInstance as Error).message).toBe("The relation silent does not hold.");
  });
});

describe("checkRelationsAsync", () => {
  it("awaits the outputs of an async function", async () => {
    const later = async (xs: readonly number[]): Promise<number[]> => {
      await Promise.resolve();
      return sorted(xs);
    };
    await expect(checkRelationsAsync(later, [permutationInvariant<number, number[]>()], lists, { numRuns: 30, parameters: SEED })).resolves.toBeUndefined();
    const broken = async (xs: readonly number[]): Promise<number[]> => (xs.length === 0 ? [] : [xs[0]!, ...sorted(xs.slice(1))]);
    await expect(checkRelationsAsync(broken, [permutationInvariant<number, number[]>()], lists, { numRuns: 30, parameters: SEED })).rejects.toThrow(
      /^1 of 1 relations do not hold: permutation\./,
    );
  });
});

describe("withinTolerance", () => {
  it("compares numbers with an absolute or a relative limit", () => {
    const exact = withinTolerance();
    expect(exact(0.1 + 0.2, 0.3)).toBe(false);
    expect(exact(Number.NaN, Number.NaN)).toBe(true);
    expect(exact(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(true);
    expect(withinTolerance({ absolute: 1e-12 })(0.1 + 0.2, 0.3)).toBe(true);
    expect(withinTolerance({ absolute: 0.5 })(1, 1.6)).toBe(false);
    expect(withinTolerance({ relative: 0.01 })(1000, 1009)).toBe(true);
    expect(withinTolerance({ relative: 0.01 })(1, 1.02)).toBe(false);
    expect(withinTolerance({ relative: 0.5 })(Number.POSITIVE_INFINITY, 1e308)).toBe(false);
    expect(withinTolerance({ absolute: 1 })(Number.NaN, 0)).toBe(false);
  });

  it("compares arrays and plain objects element by element", () => {
    const near = withinTolerance({ absolute: 1e-9 });
    expect(near([1, { a: 2, b: [3] }], [1 + 1e-12, { b: [3], a: 2 }])).toBe(true);
    expect(near([1, 2], [1, 2, 3])).toBe(false);
    expect(near({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(near({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    expect(near("a", "a")).toBe(true);
    expect(near([1], { 0: 1, length: 1 })).toBe(false);
  });

  it("compares other objects by identity", () => {
    const map = new Map([[1, 2]]);
    expect(withinTolerance()(map, map)).toBe(true);
    expect(withinTolerance()(map, new Map([[1, 2]]))).toBe(false);
  });

  it("refuses a negative tolerance or NaN", () => {
    expect(() => withinTolerance({ absolute: -1 })).toThrow(RangeError);
    expect(() => withinTolerance({ relative: Number.NaN })).toThrow(RangeError);
  });
});
