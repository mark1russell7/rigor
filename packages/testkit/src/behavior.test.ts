import { describe, expect, it } from "vitest";
import { seedOf, type InputFamily, type Point } from "@mark1russell7/rigor-generators";
import { BEHAVIOR_DIGEST_FORMAT, behaviorCheck, behaviorDigest, behaviorDraws, behaviorForm, compareDigests, type BehaviorDigest } from "./behavior.ts";

const plane: InputFamily = {
  name: "plane",
  dimensions: [
    { name: "x", min: -10, max: 10 },
    { name: "y", min: -10, max: 10 },
  ],
};

const x = (p: Point): number => p["x"] as number;
const y = (p: Point): number => p["y"] as number;

describe("behaviorForm", () => {
  it("writes JSON values in the canonical form of RFC 8785", () => {
    expect(behaviorForm({ b: [1, "a", true, null], a: 0.5 })).toBe('{"a":0.5,"b":[1,"a",true,null]}');
  });

  it("tags the numbers that RFC 8785 does not have", () => {
    expect(behaviorForm([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 0])).toBe(
      '[{"$number":"NaN"},{"$number":"Infinity"},{"$number":"-Infinity"},{"$number":"-0"},0]',
    );
    expect(behaviorForm(Number.NaN)).toBe(behaviorForm(0 / 0));
    expect(behaviorForm(-0)).not.toBe(behaviorForm(0));
  });

  it("keeps undefined, also as the value of a key and as a hole of an array", () => {
    expect(behaviorForm(undefined)).toBe('{"$undefined":true}');
    expect(behaviorForm({ a: undefined })).not.toBe(behaviorForm({}));
    expect(behaviorForm([1, , 3])).toBe(behaviorForm([1, undefined, 3]));
  });

  it("tags a bigint, a date, a regular expression, an error and a string with a lone surrogate", () => {
    expect(behaviorForm(12n)).toBe('{"$bigint":"12"}');
    expect(behaviorForm(new Date(5))).toBe('{"$date":5}');
    expect(behaviorForm(new Date(Number.NaN))).toBe('{"$date":{"$number":"NaN"}}');
    expect(behaviorForm(/a/g)).toBe('{"$regexp":"/a/g"}');
    expect(behaviorForm(new RangeError("bad"))).toBe('{"$error":{"message":"bad","name":"RangeError"}}');
    expect(behaviorForm("a\ud800")).toBe('{"$utf16":[97,55296]}');
  });

  it("gives a map and a set the same form in each order of insertion", () => {
    const one = new Map<unknown, unknown>([
      ["b", 2],
      [1, new Set([3, 1])],
    ]);
    const two = new Map<unknown, unknown>([
      [1, new Set([1, 3])],
      ["b", 2],
    ]);
    expect(behaviorForm(one)).toBe(behaviorForm(two));
    expect(behaviorForm(one)).toBe('{"$map":[["b",2],[1,{"$set":[1,3]}]]}');
    expect(behaviorForm(new Map([["a", 1]]))).not.toBe(behaviorForm({ a: 1 }));
    expect(behaviorForm(new Set([1]))).not.toBe(behaviorForm([1]));
  });

  it("gives one more $ to a key that starts with $, so a plain object never has the form of a tag", () => {
    expect(behaviorForm({ $number: "NaN" })).toBe('{"$$number":"NaN"}');
    expect(behaviorForm({ $number: "NaN" })).not.toBe(behaviorForm(Number.NaN));
  });

  it("uses toJSON, and keeps only the own enumerable keys of other objects", () => {
    class Money {
      readonly cents: number;
      constructor(cents: number) {
        this.cents = cents;
      }
      toJSON(): string {
        return `${this.cents / 100} USD`;
      }
    }
    class Pair {
      readonly left: number;
      readonly right: number;
      constructor(left: number, right: number) {
        this.left = left;
        this.right = right;
      }
    }
    expect(behaviorForm(new Money(150))).toBe('"1.5 USD"');
    expect(behaviorForm(new Pair(1, 2))).toBe(behaviorForm({ left: 1, right: 2 }));
    expect(behaviorForm(new Float64Array([1, Number.NaN]))).toBe('{"0":1,"1":{"$number":"NaN"}}');
  });

  it("refuses a function, a symbol, a promise and a cycle", () => {
    const loop: { self?: unknown } = {};
    loop.self = loop;
    expect(() => behaviorForm(() => 1)).toThrow(new TypeError("behaviorForm: a function has no stable form."));
    expect(() => behaviorForm(Symbol("s"))).toThrow(TypeError);
    expect(() => behaviorForm(Promise.resolve(1))).toThrow(/a promise has no stable form/);
    expect(() => behaviorForm(loop)).toThrow(new TypeError("behaviorForm: the value has a cycle."));
    const shared = { a: 1 };
    expect(behaviorForm([shared, shared])).toBe('[{"a":1},{"a":1}]');
  });
});

describe("behaviorDraws", () => {
  it("gives the same points for the same seed, and a name is a seed", () => {
    const one = behaviorDraws({ family: plane, seed: "sum", count: 16 });
    expect(one).toHaveLength(16);
    expect(behaviorDraws({ family: plane, seed: "sum", count: 16 })).toEqual(one);
    expect(behaviorDraws({ family: plane, seed: seedOf("sum"), count: 16 })).toEqual(one);
    expect(behaviorDraws({ family: plane, seed: "other", count: 16 })).not.toEqual(one);
    for (const point of one) {
      expect(x(point)).toBeGreaterThanOrEqual(-10);
      expect(x(point)).toBeLessThan(10);
    }
  });

  it("puts one point in each stratum of each dimension with the default design latin", () => {
    const points = behaviorDraws({ family: plane, seed: 3, count: 10 });
    const strata = (values: number[]): number[] => values.map((v) => Math.floor((v + 10) / 2)).sort((p, q) => p - q);
    expect(strata(points.map(x))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(strata(points.map(y))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(behaviorDraws({ family: plane, seed: 3, count: 10, design: "random" })).not.toEqual(points);
  });

  it("gives a copy of a list", () => {
    const inputs = [[1], [2]];
    const draws = behaviorDraws({ inputs });
    expect(draws).toEqual(inputs);
    expect(draws).not.toBe(inputs);
  });

  it("refuses bad options with a RangeError", () => {
    expect(() => behaviorDraws({} as never)).toThrow(new RangeError("behaviorDraws: give a family or a list of inputs."));
    expect(() => behaviorDraws({ family: plane, seed: 1, count: 2, inputs: [1] } as never)).toThrow(
      new RangeError("behaviorDraws: give a family or a list of inputs, not the two."),
    );
    expect(() => behaviorDraws({ inputs: [] })).toThrow(new RangeError("behaviorDraws: the list of inputs is empty."));
    expect(() => behaviorDraws({ inputs: "ab" as never })).toThrow(new RangeError("behaviorDraws: inputs is not a list."));
    expect(() => behaviorDraws({ family: plane, seed: 1, count: 0 })).toThrow(new RangeError("behaviorDraws: count is 0, and it must be an integer from 1."));
    expect(() => behaviorDraws({ family: plane, seed: 1, count: 1.5 })).toThrow(RangeError);
    expect(() => behaviorDraws({ family: plane, seed: Number.NaN, count: 2 })).toThrow(new RangeError("behaviorDraws: seed is a finite number or a string, not NaN."));
    expect(() => behaviorDraws({ family: plane, seed: 1, count: 2, design: "grid" as never })).toThrow(
      new RangeError('behaviorDraws: design is "latin" or "random", not grid.'),
    );
    expect(() => behaviorDraws({ family: { name: "empty", dimensions: [] }, seed: 1, count: 2 })).toThrow(/empty: a family needs one dimension or more/);
  });
});

describe("behaviorCheck", () => {
  it("counts each draw as equal when two functions give the same outputs", () => {
    const result = behaviorCheck(
      (p) => x(p) + y(p),
      (p) => y(p) + x(p),
      { family: plane, seed: "sum", count: 64 },
    );
    expect(result).toEqual({ count: 64, equal: 64, different: 0, bothThrew: 0, onlyAThrew: [], onlyBThrew: [] });
    expect("firstDifference" in result).toBe(false);
  });

  it("gives the first difference with its index, its input and the two outcomes", () => {
    const draws = behaviorDraws({ family: plane, seed: 9, count: 32 });
    const result = behaviorCheck(
      (p) => Math.abs(x(p)),
      (p) => (x(p) > 0 ? x(p) : x(p) + 0),
      { family: plane, seed: 9, count: 32 },
    );
    const negative = draws.map(x).filter((v) => v < 0).length;
    const first = draws.findIndex((p) => x(p) < 0);
    expect(result.different).toBe(negative);
    expect(result.equal).toBe(32 - negative);
    expect(result.firstDifference).toEqual({
      index: first,
      input: draws[first],
      a: { threw: false, value: -x(draws[first] as Point) },
      b: { threw: false, value: x(draws[first] as Point) },
    });
  });

  it("is the same on each run for one seed", () => {
    const run = () => behaviorCheck((p) => Math.round(x(p)), (p) => Math.floor(x(p) + 0.5), { family: plane, seed: "round", count: 200, design: "random" });
    expect(run()).toEqual(run());
  });

  it("counts the draws where one function throws, and the draws where both throw", () => {
    const inputs = [4, -1, 9, -4, 0];
    const strictRoot = (v: number): number => {
      if (v < 0) throw new RangeError(`no root of ${v}`);
      if (v === 0) throw new Error("zero");
      return Math.sqrt(v);
    };
    const looseRoot = (v: number): number => {
      if (v === 0) throw new TypeError("zero");
      return Math.sqrt(v);
    };
    const result = behaviorCheck(strictRoot, looseRoot, { inputs });
    expect(result).toMatchObject({ count: 5, equal: 2, different: 0, bothThrew: 1, onlyAThrew: [1, 3], onlyBThrew: [] });
    const first = result.firstDifference;
    expect(first?.index).toBe(1);
    expect(first?.input).toBe(-1);
    expect(first?.a.threw).toBe(true);
    expect(first?.b).toEqual({ threw: false, value: Number.NaN });
    expect(behaviorCheck(looseRoot, strictRoot, { inputs })).toMatchObject({ onlyAThrew: [], onlyBThrew: [1, 3] });
  });

  it("gives each function its own copy of each input", () => {
    const inputs = [
      [1, 2, 3],
      [5, 4],
    ];
    const firstThenReverse = (values: number[]): number | undefined => {
      const first = values[0];
      values.reverse();
      return first;
    };
    const first = (values: number[]): number | undefined => values[0];
    expect(behaviorCheck(firstThenReverse, first, { inputs }).equal).toBe(2);
    expect(inputs).toEqual([
      [1, 2, 3],
      [5, 4],
    ]);
    expect(behaviorCheck(firstThenReverse, first, { inputs, copy: (values) => values }).different).toBe(2);
  });

  it("uses the option equal in place of the stable form", () => {
    const options = { family: plane, seed: 5, count: 50 };
    const hypot = (p: Point): number => Math.hypot(x(p), y(p));
    const byHand = (p: Point): number => Math.sqrt(x(p) * x(p) + y(p) * y(p));
    const near = (a: unknown, b: unknown): boolean => Math.abs((a as number) - (b as number)) <= 1e-12 * Math.max(1, Math.abs(a as number));
    expect(behaviorCheck(hypot, byHand, { ...options, equal: near }).equal).toBe(50);
    const fn = (): (() => number) => () => 1;
    expect(behaviorCheck(fn, fn, { inputs: [1], equal: () => true }).equal).toBe(1);
  });

  it("compares NaN, -0 and undefined by their stable form", () => {
    expect(behaviorCheck(() => Number.NaN, () => 0 / 0, { inputs: [1] }).equal).toBe(1);
    expect(behaviorCheck(() => -0, () => 0, { inputs: [1] }).different).toBe(1);
    expect(behaviorCheck(() => ({ a: undefined }), () => ({}), { inputs: [1] }).different).toBe(1);
    expect(behaviorCheck(() => new Map([[1, 2], [3, 4]]), () => new Map([[3, 4], [1, 2]]), { inputs: [1] }).equal).toBe(1);
  });

  it("refuses an output with no stable form, and names the function and the draw", () => {
    expect(() => behaviorCheck(() => 1, async () => 1, { inputs: [0, 1] })).toThrow(
      new TypeError("behaviorCheck: the output of b on draw 0 has no stable form (behaviorForm: a promise has no stable form. The check runs synchronous functions only.)."),
    );
    expect(() => behaviorCheck(async () => Promise.reject(new Error("late")), () => 1, { inputs: [0] })).toThrow(/output of a on draw 0/);
  });

  it("refuses an input that structuredClone cannot copy", () => {
    expect(() => behaviorCheck((f: () => number) => f(), (f: () => number) => f(), { inputs: [() => 1] })).toThrow(
      new TypeError("behaviorCheck: structuredClone cannot copy the input of draw 0. Give the option copy."),
    );
    expect(behaviorCheck((f: () => number) => f(), (f: () => number) => f(), { inputs: [() => 1], copy: (f) => f }).equal).toBe(1);
  });
});

describe("behaviorDigest and compareDigests", () => {
  const options = { family: plane, seed: "abs", count: 40 } as const;
  const abs = (p: Point): number => Math.abs(x(p));
  const wrongAbs = (p: Point): number => (x(p) > 0 ? x(p) : x(p) + 0);

  it("records the seed, the family, the design, the count and the hash of the draws", () => {
    const digest = behaviorDigest(abs, options);
    expect(digest).toMatchObject({ format: BEHAVIOR_DIGEST_FORMAT, family: "plane", seed: seedOf("abs"), design: "latin", count: 40 });
    expect(digest.draws).toMatch(/^[0-9a-f]{64}$/);
    expect(digest.outputs).toHaveLength(40);
    expect(digest.outputs[0]).toEqual({ output: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(behaviorDigest(abs, options)).toEqual(digest);
  });

  it("gives the counts of behaviorCheck, also after a round trip through JSON", () => {
    const check = behaviorCheck(abs, wrongAbs, options);
    const a = JSON.parse(JSON.stringify(behaviorDigest(abs, options))) as BehaviorDigest;
    const b = JSON.parse(JSON.stringify(behaviorDigest(wrongAbs, options))) as BehaviorDigest;
    const comparison = compareDigests(a, b);
    const { firstDifference, ...counts } = check;
    expect(comparison).toMatchObject(counts);
    expect(comparison.firstDifference?.index).toBe(firstDifference?.index);
    expect(compareDigests(a, a)).toEqual({ count: 40, equal: 40, different: 0, bothThrew: 0, onlyAThrew: [], onlyBThrew: [] });
  });

  it("records the class of a thrown value", () => {
    class ParseError extends Error {}
    const throwing = (v: number): number => {
      if (v === 0) throw new RangeError("zero");
      if (v === 1) throw new ParseError("one");
      if (v === 2) throw "two";
      if (v === 3) throw null;
      return v;
    };
    const digest = behaviorDigest(throwing, { inputs: [0, 1, 2, 3, 4] });
    expect(digest.outputs.slice(0, 4)).toEqual([{ threw: "RangeError" }, { threw: "ParseError" }, { threw: "string" }, { threw: "null" }]);
    expect(digest).not.toHaveProperty("seed");
    expect(digest).not.toHaveProperty("family");
    const other = behaviorDigest((v: number) => (v < 2 ? v : -v), { inputs: [0, 1, 2, 3, 4] });
    expect(compareDigests(other, digest)).toEqual({
      count: 5,
      equal: 0,
      different: 1,
      bothThrew: 0,
      onlyAThrew: [],
      onlyBThrew: [0, 1, 2, 3],
      firstDifference: { index: 0, a: other.outputs[0], b: { threw: "RangeError" } },
    });
    expect(compareDigests(digest, digest)).toMatchObject({ equal: 1, bothThrew: 4 });
  });

  it("refuses two digests of different draws", () => {
    const base = behaviorDigest(abs, options);
    expect(() => compareDigests(base, behaviorDigest(abs, { ...options, seed: "other" }))).toThrow(
      new RangeError(`compareDigests: the digests have different draws (seed ${seedOf("abs")} and ${seedOf("other")}).`),
    );
    expect(() => compareDigests(base, behaviorDigest(abs, { ...options, count: 41 }))).toThrow(/\(count 40 and 41\)/);
    expect(() => compareDigests(base, behaviorDigest(abs, { ...options, design: "random" }))).toThrow(/\(design latin and random\)/);
    const wider: InputFamily = { name: "plane", dimensions: [{ name: "x", min: -20, max: 20 }, { name: "y", min: -10, max: 10 }] };
    expect(() => compareDigests(base, behaviorDigest(abs, { ...options, family: wider }))).toThrow(/\(draws [0-9a-f]{64} and [0-9a-f]{64}\)/);
    expect(() => compareDigests(behaviorDigest(Math.abs, { inputs: [1, 2] }), behaviorDigest(Math.abs, { inputs: [1, 3] }))).toThrow(/different draws/);
  });

  it("refuses a value that is not a digest of this format", () => {
    const base = behaviorDigest(abs, options);
    expect(() => compareDigests(null as never, base)).toThrow(new RangeError("compareDigests: the first digest is not a behavior digest."));
    expect(() => compareDigests(base, { ...base, format: "other/1" } as never)).toThrow(/the format of the second digest is other\/1/);
    expect(() => compareDigests(base, { ...base, outputs: base.outputs.slice(1) })).toThrow(/does not have one output for each of its 40 draws/);
    expect(() => compareDigests(base, { ...base, outputs: [{ output: 1 }, ...base.outputs.slice(1)] as never })).toThrow(/output 0 of the second digest/);
  });

  it("refuses inputs with no stable form", () => {
    expect(() => behaviorDigest((f: () => number) => f(), { inputs: [() => 1], copy: (f) => f })).toThrow(
      new TypeError("behaviorDigest: the inputs have no stable form (behaviorForm: a function has no stable form.)."),
    );
  });
});
