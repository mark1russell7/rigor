import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import {
  type SeparableModel,
  SEPARABLE_MAX_COMBINATIONS,
  bootstrapSeparable,
  fitError,
  fitSeparable,
  heldOutSeparable,
  quantileSorted,
  rankSeparable,
  sorted,
} from "./index.ts";

/* ---------- Models of the tests ---------- */

// The hinge: base + slope·x + bend·max(0, x − knee). The knee starts at each value of x inside the range, and at each middle.
function hinge(candidates: readonly number[]): SeparableModel<number> {
  return {
    terms: ["base", "slope", "bend"],
    shapes: [{ id: "knee", candidates }],
    design: ([knee], xs) => xs.map((x) => [1, x, Math.max(0, x - knee!)]),
  };
}

function inside(xs: readonly number[]): number[] {
  const distinct = [...new Set(xs)].sort((a, b) => a - b);
  const middles = distinct.slice(1).map((v, i) => (v + distinct[i]!) / 2);
  return [...distinct, ...middles].filter((v) => v > distinct[0]! && v < distinct.at(-1)!);
}

// The power: base + scale·x^exponent.
function power(candidates: readonly number[], bounds: { min?: number; max?: number } = {}): SeparableModel<number> {
  return {
    terms: ["base", "scale"],
    shapes: [{ id: "exponent", candidates, ...bounds }],
    design: ([e], xs) => xs.map((x) => [1, x ** e!]),
  };
}

// The universal scalability law: unit·x / (1 + a(x − 1) + b·x(x − 1)). A denominator of 0 or less has no value.
const SCALABILITY: SeparableModel<number> = {
  terms: ["unit"],
  shapes: [
    { id: "contention", candidates: [0, 0.01, 0.03, 0.1, 0.2, 0.4, 0.7], min: 0 },
    { id: "coherency", candidates: [0, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2], min: 0 },
  ],
  design: ([a, b], xs) => {
    const rows = xs.map((x) => [x / (1 + a! * (x - 1) + b! * x * (x - 1))]);
    return xs.every((x) => 1 + a! * (x - 1) + b! * x * (x - 1) > 0) ? rows : null;
  },
};

const CONSTANT: SeparableModel<number> = { terms: ["base"], shapes: [], design: (_, xs) => xs.map(() => [1]) };
const LINE: SeparableModel<number> = { terms: ["base", "slope"], shapes: [], design: (_, xs) => xs.map((x) => [1, x]) };
const NEVER: SeparableModel<number> = { terms: ["base"], shapes: [{ id: "s", candidates: [1, 2] }], design: () => null };

/* ---------- Data ---------- */

const XS = Array.from({ length: 21 }, (_, i) => i * 0.75); // 0 to 15
const KNEE = 7.3;
const truth = (x: number): number => 2 + 0.5 * x + 1.5 * Math.max(0, x - KNEE);
const EXACT = XS.map(truth);

function noisy(seed: string, sd: number): number[] {
  const r = random(seed);
  return XS.map((x) => truth(x) + r.normal(0, sd));
}

/* ---------- fitSeparable ---------- */

describe("fitSeparable", () => {
  it("finds the knee of a hinge and its coefficients on exact data", () => {
    const fit = fitSeparable(hinge(inside(XS)), XS, EXACT)!;
    expect(Math.abs(fit.shapes[0]! - KNEE)).toBeLessThan(1e-6);
    expect(fit.coefficients[0]).toBeCloseTo(2, 6);
    expect(fit.coefficients[1]).toBeCloseTo(0.5, 6);
    expect(fit.coefficients[2]).toBeCloseTo(1.5, 6);
    expect(fit.rss).toBeLessThan(1e-12);
    fit.fitted.forEach((v, i) => expect(v).toBeCloseTo(EXACT[i]!, 6));
    // The grid has one evaluation for each candidate, and the refine adds more.
    expect(fit.evaluations).toBeGreaterThan(inside(XS).length);
  });

  it("finds the exponent of a power on exact data", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    const y = xs.map((x) => 3 + 0.8 * x ** 1.37);
    const fit = fitSeparable(power([-1, -0.5, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]), xs, y)!;
    expect(Math.abs(fit.shapes[0]! - 1.37)).toBeLessThan(1e-6);
    expect(fit.coefficients[0]).toBeCloseTo(3, 5);
    expect(fit.coefficients[1]).toBeCloseTo(0.8, 6);
  });

  it("finds the two shapes of the scalability law on exact data", () => {
    const xs = Array.from({ length: 48 }, (_, i) => i + 1);
    const y = xs.map((x) => (100 * x) / (1 + 0.05 * (x - 1) + 0.002 * x * (x - 1)));
    const fit = fitSeparable(SCALABILITY, xs, y)!;
    // The tolerance of the two shapes is 1e-9. On this data, the cycles of the refine give approximately 1e-13.
    expect(Math.abs(fit.shapes[0]! - 0.05)).toBeLessThan(1e-9);
    expect(Math.abs(fit.shapes[1]! - 0.002)).toBeLessThan(1e-9);
    expect(fit.coefficients[0]).toBeCloseTo(100, 6);
  });

  it("extends the bracket past the last candidate, and clips it to the bounds", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    const y = xs.map((x) => 1 + 0.5 * x ** 3.4);
    const free = fitSeparable(power([1, 2, 3]), xs, y)!;
    expect(Math.abs(free.shapes[0]! - 3.4)).toBeLessThan(1e-6);
    const bound = fitSeparable(power([1, 2, 3], { max: 3.2 }), xs, y)!;
    expect(bound.shapes[0]!).toBeLessThanOrEqual(3.2);
    expect(bound.shapes[0]!).toBeGreaterThan(3.2 - 1e-6);
  });

  it("fits a model with no shape in one evaluation", () => {
    const fit = fitSeparable(LINE, [0, 1, 2, 3], [1, 3, 5, 7])!;
    expect(fit.shapes).toEqual([]);
    expect(fit.coefficients[0]).toBeCloseTo(1, 12);
    expect(fit.coefficients[1]).toBeCloseTo(2, 12);
    expect(fit.evaluations).toBe(1);
  });

  it("gives null when the design is always null, or when no combination has a finite fit", () => {
    expect(fitSeparable(NEVER, [1, 2, 3], [1, 2, 3])).toBeNull();
    const infinite: SeparableModel<number> = { terms: ["a"], shapes: [], design: (_, xs) => xs.map(() => [Infinity]) };
    expect(fitSeparable(infinite, [1, 2, 3], [1, 2, 3])).toBeNull();
    // Two points do not fix three coefficients.
    expect(fitSeparable(hinge([1]), [0, 2], [1, 2])).toBeNull();
  });

  it("skips the combinations with no value", () => {
    // The pole at x = capacity: a capacity at or below a point has no value.
    const queue: SeparableModel<number> = {
      terms: ["base", "scale"],
      shapes: [{ id: "capacity", candidates: [5, 8, 12, 20, 40] }],
      design: ([c], xs) => (xs.every((x) => x < c!) ? xs.map((x) => [1, c! / (c! - x)]) : null),
    };
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const y = xs.map((x) => 1 + 0.5 * (15 / (15 - x)));
    const fit = fitSeparable(queue, xs, y)!;
    expect(Math.abs(fit.shapes[0]! - 15)).toBeLessThan(1e-6);
  });

  it("uses the weights of the points", () => {
    const y = [1, 2, 3, 10];
    expect(fitSeparable(CONSTANT, y, y)!.coefficients[0]).toBeCloseTo(4, 12);
    const weighted = fitSeparable(CONSTANT, y, y, { weights: [1, 1, 1, 3] })!;
    expect(weighted.coefficients[0]).toBeCloseTo(6, 12);
    expect(weighted.rss).toBeCloseTo(25 + 16 + 9 + 3 * 16, 10);
    expect(weighted.fitted).toEqual([6, 6, 6, 6].map((v) => expect.closeTo(v, 12)));
    // The weights 1 / y^2 fit the relative residuals: the value is sum(1 / y) / sum(1 / y^2).
    const relative = fitSeparable(CONSTANT, y, y, { weights: y.map((v) => 1 / v ** 2) })!;
    const expected = y.reduce((s, v) => s + 1 / v, 0) / y.reduce((s, v) => s + 1 / v ** 2, 0);
    expect(relative.coefficients[0]).toBeCloseTo(expected, 12);
    // Equal weights change only the sum of the squares.
    const plain = fitSeparable(hinge(inside(XS)), XS, noisy("weights", 0.1))!;
    const doubled = fitSeparable(hinge(inside(XS)), XS, noisy("weights", 0.1), { weights: XS.map(() => 2) })!;
    expect(doubled.shapes[0]).toBeCloseTo(plain.shapes[0]!, 6);
    expect(doubled.rss).toBeCloseTo(2 * plain.rss, 10);
  });

  it("throws a RangeError for each fault of the input", () => {
    const m = hinge([5]);
    expect(() => fitSeparable(m, [], [])).toThrow(RangeError);
    expect(() => fitSeparable(m, [1, 2], [1])).toThrow(/fitSeparable: xs has 2 points and y has 1 values/);
    expect(() => fitSeparable(m, [1, 2], [1, Number.NaN])).toThrow(/value 1 of y is not finite/);
    expect(() => fitSeparable(hinge([]), [1], [1])).toThrow(/has no candidate/);
    expect(() => fitSeparable(hinge([Number.POSITIVE_INFINITY]), [1], [1])).toThrow(/not finite/);
    expect(() => fitSeparable(power([1, 5], { max: 3 }), [1], [1])).toThrow(/the candidate 5, outside/);
    expect(() => fitSeparable(power([1], { min: 2, max: 1 }), [1], [1])).toThrow(/The min is not more than the max/);
    expect(() => fitSeparable({ ...CONSTANT, terms: [] }, [1], [1])).toThrow(/no term/);
    expect(() => fitSeparable(CONSTANT, [1, 2], [1, 2], { weights: [1] })).toThrow(/weights has 1 values for 2 points/);
    expect(() => fitSeparable(CONSTANT, [1, 2], [1, 2], { weights: [1, 0] })).toThrow(/weight 1 is a finite number more than 0/);
    expect(() => fitSeparable(CONSTANT, [1, 2], [1, 2], { weights: [-1, 1] })).toThrow(RangeError);
    expect(() => fitSeparable(CONSTANT, [1, 2], [1, 2], { weights: [1, Number.NaN] })).toThrow(RangeError);
    const many = Array.from({ length: 101 }, (_, i) => i);
    const wide: SeparableModel<number> = {
      terms: ["a"],
      shapes: [
        { id: "p", candidates: many },
        { id: "q", candidates: many },
      ],
      design: () => {
        throw new Error("The design is not called.");
      },
    };
    expect(101 * 101).toBeGreaterThan(SEPARABLE_MAX_COMBINATIONS);
    expect(() => fitSeparable(wide, [1], [1])).toThrow(/10201 combinations/);
  });

  it("throws a RangeError for a design with the wrong shape", () => {
    const short: SeparableModel<number> = { terms: ["a"], shapes: [], design: (_, xs) => xs.slice(1).map(() => [1]) };
    expect(() => fitSeparable(short, [1, 2, 3], [1, 2, 3])).toThrow(/the design gives 2 rows for 3 points/);
    const narrow: SeparableModel<number> = { terms: ["a", "b"], shapes: [], design: (_, xs) => xs.map(() => [1]) };
    expect(() => fitSeparable(narrow, [1, 2, 3], [1, 2, 3])).toThrow(/row 0 of the design has 1 values, and the model has 2 terms/);
  });
});

/* ---------- bootstrapSeparable ---------- */

describe("bootstrapSeparable", () => {
  const model = hinge(inside(XS));
  const y = noisy("knee", 0.1);

  it("gives a 95% interval of the knee that holds the true knee", () => {
    const b = bootstrapSeparable(model, XS, y, { runs: 200, seed: 7 })!;
    expect(b.runs).toBe(200);
    expect(b.replicates.length).toBeGreaterThan(190);
    const knee = b.intervals[3]!;
    expect(knee.estimate).toBe(b.estimate.shapes[0]);
    expect(knee.low).toBeLessThan(KNEE);
    expect(knee.high).toBeGreaterThan(KNEE);
    // The slope after the knee is 2.
    expect(b.intervals[1]!.low + b.intervals[2]!.low).toBeLessThan(2);
    expect(b.intervals[1]!.high + b.intervals[2]!.high).toBeGreaterThan(2);
  });

  it("gives intervals that are the percentiles of the columns of the replicates", () => {
    const b = bootstrapSeparable(model, XS, y, { runs: 100, seed: 3, level: 0.9 })!;
    expect(b.intervals).toHaveLength(4);
    b.intervals.forEach((interval, j) => {
      const column = sorted(b.replicates.map((row) => row[j]!));
      expect(interval.low).toBe(quantileSorted(column, (1 - 0.9) / 2));
      expect(interval.high).toBe(quantileSorted(column, 1 - (1 - 0.9) / 2));
      expect(interval.finite).toBe(b.replicates.length);
      expect(interval.level).toBe(0.9);
      expect(interval.seed).toBe(b.seed);
    });
  });

  it("gives the same replicates for the same seed", () => {
    const a = bootstrapSeparable(model, XS, y, { runs: 50, seed: "same" })!;
    const b = bootstrapSeparable(model, XS, y, { runs: 50, seed: "same" })!;
    const c = bootstrapSeparable(model, XS, y, { runs: 50, seed: "other" })!;
    expect(b.replicates).toEqual(a.replicates);
    expect(b.intervals).toEqual(a.intervals);
    expect(c.replicates).not.toEqual(a.replicates);
  });

  it("draws whole groups with the option groups", () => {
    const xs = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4];
    const ys = [1.1, 0.9, 1.0, 2.1, 1.8, 2.0, 3.2, 2.9, 3.1, 3.9, 4.2, 4.0];
    const seen: number[][] = [];
    const counted: SeparableModel<number> = {
      ...LINE,
      design: (shapes, x) => {
        seen.push([...x]);
        return LINE.design(shapes, x);
      },
    };
    const whole = (call: readonly number[]): boolean => [1, 2, 3, 4].every((v) => call.filter((x) => x === v).length % 3 === 0);
    bootstrapSeparable(counted, xs, ys, { runs: 40, seed: 2, groups: xs });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(whole)).toBe(true);
    seen.length = 0;
    bootstrapSeparable(counted, xs, ys, { runs: 40, seed: 2 });
    expect(seen.every(whole)).toBe(false);
  });

  it("gives null when all the points have no fit, and throws for a fault of the options", () => {
    expect(bootstrapSeparable(NEVER, [1, 2, 3], [1, 2, 3], { runs: 5 })).toBeNull();
    expect(() => bootstrapSeparable(model, XS, y, { runs: 0 })).toThrow(/bootstrapSeparable: runs is a whole number/);
    expect(() => bootstrapSeparable(model, XS, y, { level: 1.5 })).toThrow(RangeError);
    expect(() => bootstrapSeparable(model, XS, y, { groups: ["a"] })).toThrow(/groups has 1 keys for 21 points/);
  });
});

/* ---------- heldOutSeparable and fitError ---------- */

describe("heldOutSeparable", () => {
  it("predicts each point from the fit of the other points", () => {
    const y = [1, 2, 3];
    const absolute = heldOutSeparable(CONSTANT, y, y);
    expect(absolute.predictions).toEqual([2.5, 2, 1.5].map((v) => expect.closeTo(v, 12)));
    expect(absolute.residuals).toEqual([-1.5, 0, 1.5].map((v) => expect.closeTo(v, 12)));
    const relative = heldOutSeparable(CONSTANT, y, y, { residual: "relative" });
    expect(relative.residuals.map((v) => Number(v.toFixed(12)))).toEqual([-0.6, 0, 1]);
    // With weights, each prediction is the weighted mean of the other points.
    const weighted = heldOutSeparable(CONSTANT, y, y, { weights: [1, 1, 2] });
    expect(weighted.predictions[0]).toBeCloseTo((2 + 2 * 3) / 3, 12);
  });

  it("holds out all the points of a group together", () => {
    const xs = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4];
    const ys = [1.1, 0.9, 1.0, 2.1, 1.8, 2.0, 3.2, 2.9, 3.1, 3.9, 4.2, 4.0];
    const sizes: number[] = [];
    const counted: SeparableModel<number> = {
      ...LINE,
      design: (shapes, x) => {
        sizes.push(x.length);
        return LINE.design(shapes, x);
      },
    };
    const grouped = heldOutSeparable(counted, xs, ys, { groups: xs });
    // One fit of 9 points and one prediction of 3 points for each group.
    expect(sizes).toEqual([9, 3, 9, 3, 9, 3, 9, 3]);
    for (let g = 0; g < 4; g++) {
      const p = grouped.predictions.slice(3 * g, 3 * g + 3);
      expect(p[1]).toBe(p[0]);
      expect(p[2]).toBe(p[0]);
    }
    grouped.residuals.forEach((e, i) => expect(e).toBeCloseTo(ys[i]! - grouped.predictions[i]!, 12));
    // Without groups, the other points of the same x stay in the fit, so the predictions differ.
    const single = heldOutSeparable(LINE, xs, ys);
    expect(single.predictions[1]).not.toBe(single.predictions[0]);
  });

  it("gives NaN for a point whose fit or prediction has no value", () => {
    const all = heldOutSeparable(NEVER, [1, 2, 3], [1, 2, 3]);
    expect(all.predictions.every(Number.isNaN)).toBe(true);
    expect(all.residuals.every(Number.isNaN)).toBe(true);
    // A relative residual with a prediction of 0 is not finite, so it is NaN.
    const zero = heldOutSeparable(CONSTANT, [1, 2, 3], [0, 0, 1], { residual: "relative" });
    expect(Number.isNaN(zero.residuals[2]!)).toBe(true);
    expect(zero.predictions[2]).toBe(0);
  });

  it("throws a RangeError for a fault of the options", () => {
    expect(() => heldOutSeparable(CONSTANT, [1, 2], [1, 2], { groups: ["a"] })).toThrow(/heldOutSeparable: groups has 1 keys/);
    expect(() => heldOutSeparable(CONSTANT, [1, 2], [1, 2], { residual: "square" as "absolute" })).toThrow(/residual is "absolute" or "relative"/);
  });
});

describe("fitError", () => {
  it("gives the means of the finite residuals, and counts the others as missing", () => {
    const e = fitError([1, -1, Number.NaN, 3, Number.POSITIVE_INFINITY]);
    expect(e.n).toBe(3);
    expect(e.missing).toBe(2);
    expect(e.mae).toBeCloseTo(5 / 3, 14);
    expect(e.rmse).toBeCloseTo(Math.sqrt(11 / 3), 14);
    const none = fitError([Number.NaN]);
    expect(none).toEqual({ mae: Number.NaN, rmse: Number.NaN, n: 0, missing: 1 });
    expect(() => fitError([])).toThrow(RangeError);
  });
});

/* ---------- rankSeparable ---------- */

describe("rankSeparable", () => {
  it("ranks the true model first, and a model with missing residuals after each model with none", () => {
    const model = hinge(inside(XS));
    const partial: SeparableModel<number> = {
      ...model,
      // The prediction of the last point alone has no value.
      design: (shapes, xs) => (xs.length === 1 && xs[0] === 15 ? null : model.design(shapes, xs)),
    };
    const ranked = rankSeparable({ line: LINE, partial, twin: model, hinge: model, never: NEVER }, XS, EXACT);
    expect(ranked.map((r) => r.id)).toEqual(["twin", "hinge", "line", "partial", "never"]);
    expect(ranked[0]!.error.rmse).toBeLessThan(1e-6);
    expect(ranked[0]!.error.missing).toBe(0);
    expect(Math.abs(ranked[0]!.fit!.shapes[0]! - KNEE)).toBeLessThan(1e-6);
    const partialRank = ranked[3]!;
    expect(partialRank.error.missing).toBe(1);
    expect(partialRank.error.rmse).toBeLessThan(ranked[2]!.error.rmse);
    expect(ranked[4]!.fit).toBeNull();
    expect(ranked[4]!.error.n).toBe(0);
  });

  it("ranks by the option by, and throws for a fault of the options", () => {
    const y = noisy("rank", 0.2);
    const byMae = rankSeparable({ line: LINE, hinge: hinge(inside(XS)) }, XS, y, { by: "mae" });
    expect(byMae.map((r) => r.id)).toEqual(["hinge", "line"]);
    expect(byMae[0]!.error.mae).toBeLessThan(byMae[1]!.error.mae);
    expect(rankSeparable({}, XS, y)).toEqual([]);
    expect(() => rankSeparable({ line: LINE }, XS, y, { by: "max" as "mae" })).toThrow(/rankSeparable: by is "mae" or "rmse"/);
    expect(() => rankSeparable({ line: LINE }, XS, y.slice(1))).toThrow(/rankSeparable: xs has 21 points/);
  });
});
