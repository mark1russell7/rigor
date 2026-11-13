import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Random, random } from "@mark1russell7/rigor-generators";
import { type PairComparison, type PairOutcome, bradleyTerry, bradleyTerrySparse, pairProbabilities } from "./index.ts";

/* ---------- Helpers ---------- */

function repeat(a: number, b: number, outcome: PairOutcome, times: number): PairComparison[] {
  return Array.from({ length: times }, () => ({ a, b, outcome }));
}

// Seeded comparisons of random pairs from known strengths and a known tie parameter, with the Davidson model.
function drawComparisons(r: Random, strengths: readonly number[], count: number, nu: number): PairComparison[] {
  const out: PairComparison[] = [];
  for (let i = 0; i < count; i++) {
    const a = r.below(strengths.length);
    let b = r.below(strengths.length - 1);
    if (b >= a) b++;
    const p = pairProbabilities(strengths[a]!, strengths[b]!, nu);
    const u = r.next();
    out.push({ a, b, outcome: u < p.a ? "a" : u < p.a + p.b ? "b" : "tie" });
  }
  return out;
}

const comparisonList = (items: number, maxLength = 40) =>
  fc.array(
    fc
      .record({
        a: fc.integer({ min: 0, max: items - 1 }),
        b: fc.integer({ min: 0, max: items - 1 }),
        outcome: fc.constantFrom<PairOutcome>("a", "b", "tie"),
        weight: fc.constantFrom(0.5, 1, 2),
      })
      .filter((c) => c.a !== c.b),
    { maxLength },
  );

const ties = fc.constantFrom<"davidson" | "half">("davidson", "half");

/** The Euclidean distance of the log-strengths and the log of the tie parameter of two fits. */
function distance(x: { strengths: readonly number[]; tie: number }, y: { strengths: readonly number[]; tie: number }): number {
  let sum = 0;
  for (let i = 0; i < x.strengths.length; i++) sum += (x.strengths[i]! - y.strengths[i]!) ** 2;
  if (x.tie > 0 && y.tie > 0) sum += (Math.log(x.tie) - Math.log(y.tie)) ** 2;
  return Math.sqrt(sum);
}

/* ---------- The agreement with the dense fit ---------- */

describe("bradleyTerrySparse: the agreement with bradleyTerry", () => {
  it("finds the optimum of the dense fit within its bound, on small logs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 7 }).chain((items) => fc.tuple(fc.constant(items), comparisonList(items))),
        ties,
        fc.constantFrom(0.5, 1, 3),
        ([items, comparisons], tieModel, priorSd) => {
          const options = { ties: tieModel, priorSd, priorMean: 0.25 };
          const dense = bradleyTerry(items, comparisons, options);
          const sparse = bradleyTerrySparse(items, comparisons, options);
          expect(sparse.converged).toBe(true);
          expect(sparse.bound).toBeLessThanOrEqual(1e-8);
          // The bound holds: the distance from the dense optimum is at most the bound, plus the rounding of the dense fit.
          expect(distance(sparse, dense)).toBeLessThanOrEqual(sparse.bound + 1e-9);
          for (let i = 0; i < items; i++) expect(Math.abs(sparse.strengths[i]! - dense.strengths[i]!)).toBeLessThan(1e-7);
          expect(sparse.tie === 0).toBe(dense.tie === 0);
          if (dense.tie > 0) expect(Math.abs(sparse.tie / dense.tie - 1)).toBeLessThan(1e-7);
          expect(sparse.logLikelihood).toBeCloseTo(dense.logLikelihood, 6);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("fits a log with many ties, and a log with only ties, as the dense fit does", () => {
    const tieHeavy = [...repeat(0, 1, "a", 10), ...repeat(0, 1, "b", 10), ...repeat(1, 0, "tie", 80)];
    const sparse = bradleyTerrySparse(2, tieHeavy, { tiePriorSd: 1e6 });
    expect(sparse.converged).toBe(true);
    expect(sparse.tie).toBeCloseTo(8, 6);
    expect(sparse.logLikelihood).toBeCloseTo(20 * Math.log(0.1) + 80 * Math.log(0.8), 8);
    const only = [...repeat(0, 1, "tie", 20), ...repeat(1, 2, "tie", 20)];
    expect(bradleyTerrySparse(3, only).tie).toBeCloseTo(bradleyTerry(3, only).tie, 4);
  });

  it("finds the strengths of a seeded log of 20 items as the dense fit does", () => {
    const r = random("bt-sparse-recovery");
    const truth = Array.from({ length: 20 }, () => r.normal());
    const comparisons = drawComparisons(r.fork("picks"), truth, 1500, 0.5);
    const dense = bradleyTerry(20, comparisons);
    const sparse = bradleyTerrySparse(20, comparisons);
    expect(sparse.converged).toBe(true);
    expect(distance(sparse, dense)).toBeLessThan(1e-8);
    // On a log with many comparisons of each pair, the approximate standard errors are within 2 percent of the dense errors.
    for (let i = 0; i < 20; i++) expect(Math.abs(sparse.se[i]! / dense.se[i]! - 1)).toBeLessThan(0.02);
  });
});

/* ---------- Exact cases ---------- */

describe("bradleyTerrySparse: exact cases", () => {
  it("fits one win of two items by hand, with the approximate standard error", () => {
    // With a prior N(0, 1), the strengths are t and -t, and the gradient is tanh(t) - 1 + 2t = 0.
    const fit = bradleyTerrySparse(2, [{ a: 0, b: 1, outcome: "a" }]);
    const t = fit.strengths[0]!;
    expect(fit.strengths[1]).toBeCloseTo(-t, 12);
    expect(Math.tanh(t) + 2 * t).toBeCloseTo(1, 8);
    expect(fit.tie).toBe(0);
    expect(fit.pairs).toBe(1);
    // The group has 2 items and the diagonal entry h + 1, so the variance is 1 / 2 + (1 / 2) / (h + 1).
    const pa = 1 / (1 + Math.exp(-2 * t));
    const h = pa * (1 - pa);
    expect(fit.se[0]).toBeCloseTo(Math.sqrt(0.5 + 0.5 / (h + 1)), 8);
  });

  it("gives the prior to an item with no comparison, and to each item of an empty log", () => {
    const comparisons = [...repeat(0, 1, "a", 3), ...repeat(1, 2, "tie", 2), ...repeat(2, 0, "b", 1)];
    const fit = bradleyTerrySparse(4, comparisons, { priorMean: 0.3, priorSd: 2 });
    expect(fit.strengths[3]).toBeCloseTo(0.3, 12);
    expect(fit.se[3]).toBeCloseTo(2, 12);
    const empty = bradleyTerrySparse(3, [], { priorMean: -1, priorSd: 0.5 });
    expect(empty.strengths).toEqual([-1, -1, -1]);
    expect(empty.se.map((s) => Number(s.toFixed(12)))).toEqual([0.5, 0.5, 0.5]);
    expect(empty).toMatchObject({ logLikelihood: 0, converged: true, iterations: 0, bound: 0, pairs: 0 });
  });

  it("counts a weight of 2 as two equal comparisons, and keeps one record for each distinct pair", () => {
    const one = bradleyTerrySparse(3, [{ a: 0, b: 1, outcome: "a", weight: 2 }, { a: 1, b: 2, outcome: "tie" }, { a: 2, b: 0, outcome: "b", weight: 0 }]);
    const two = bradleyTerrySparse(3, [...repeat(0, 1, "a", 2), { a: 2, b: 1, outcome: "tie" }]);
    for (let i = 0; i < 3; i++) expect(one.strengths[i]).toBeCloseTo(two.strengths[i]!, 8);
    expect(one.pairs).toBe(2);
    expect(two.pairs).toBe(2);
  });

  it("does not change its inputs, and gives the same result two times", () => {
    const comparisons = Object.freeze([...repeat(0, 1, "a", 3), ...repeat(1, 2, "tie", 2)].map((c) => Object.freeze(c)));
    expect(bradleyTerrySparse(3, comparisons)).toEqual(bradleyTerrySparse(3, comparisons));
    expect(comparisons[0]).toEqual({ a: 0, b: 1, outcome: "a" });
  });

  it("refuses a bad index, outcome, weight and option", () => {
    expect(() => bradleyTerrySparse(0, [])).toThrow(RangeError);
    expect(() => bradleyTerrySparse(2, [{ a: 0, b: 2, outcome: "a" }])).toThrow(RangeError);
    expect(() => bradleyTerrySparse(2, [{ a: 1, b: 1, outcome: "a" }])).toThrow(RangeError);
    expect(() => bradleyTerrySparse(2, [{ a: 0.5, b: 1, outcome: "a" }])).toThrow(RangeError);
    expect(() => bradleyTerrySparse(2, [{ a: 0, b: 1, outcome: "draw" as PairOutcome }])).toThrow(RangeError);
    expect(() => bradleyTerrySparse(2, [{ a: 0, b: 1, outcome: "a", weight: -1 }])).toThrow(RangeError);
    expect(() => bradleyTerrySparse(2, [], { priorSd: 0 })).toThrow(RangeError);
    expect(() => bradleyTerrySparse(2, [], { tolerance: 0 })).toThrow(RangeError);
    expect(() => bradleyTerrySparse(2, [], { maxIterations: 0 })).toThrow(RangeError);
    expect(() => bradleyTerrySparse(2, [], { ties: "other" as "half" })).toThrow(RangeError);
  });

  it("stops at maxIterations with converged false and a bound above the tolerance", () => {
    const fit = bradleyTerrySparse(3, [...repeat(0, 1, "a", 30), ...repeat(1, 2, "tie", 10)], { maxIterations: 2 });
    expect(fit.iterations).toBe(2);
    expect(fit.converged).toBe(false);
    expect(fit.bound).toBeGreaterThan(1e-8);
  });
});

/* ---------- Invariance ---------- */

describe("bradleyTerrySparse: invariance", () => {
  it("permutes the result when the labels of the items are permuted", () => {
    fc.assert(
      fc.property(comparisonList(5), ties, (comparisons, tieModel) => {
        const map = [3, 0, 4, 1, 2];
        const fit = bradleyTerrySparse(5, comparisons, { ties: tieModel });
        const moved = bradleyTerrySparse(5, comparisons.map((c) => ({ ...c, a: map[c.a]!, b: map[c.b]! })), { ties: tieModel });
        for (let i = 0; i < 5; i++) {
          expect(moved.strengths[map[i]!]).toBeCloseTo(fit.strengths[i]!, 7);
          expect(moved.se[map[i]!]).toBeCloseTo(fit.se[i]!, 7);
        }
        expect(moved.tie).toBeCloseTo(fit.tie, 6);
        expect(moved.pairs).toBe(fit.pairs);
      }),
      { numRuns: 80 },
    );
  });

  it("gives the same fit when each comparison swaps its two sides", () => {
    fc.assert(
      fc.property(comparisonList(4), (comparisons) => {
        const swap: Record<PairOutcome, PairOutcome> = { a: "b", b: "a", tie: "tie" };
        const fit = bradleyTerrySparse(4, comparisons);
        const swapped = bradleyTerrySparse(4, comparisons.map((c) => ({ ...c, a: c.b, b: c.a, outcome: swap[c.outcome] })));
        for (let i = 0; i < 4; i++) expect(swapped.strengths[i]).toBeCloseTo(fit.strengths[i]!, 8);
      }),
      { numRuns: 60 },
    );
  });

  it("keeps each standard error above 0 and at most the prior SD", () => {
    fc.assert(
      fc.property(comparisonList(6), fc.constantFrom(0.5, 1, 2), (comparisons, priorSd) => {
        const fit = bradleyTerrySparse(6, comparisons, { priorSd });
        for (const se of fit.se) {
          expect(se).toBeGreaterThan(0);
          expect(se).toBeLessThanOrEqual(priorSd * (1 + 1e-12));
        }
      }),
      { numRuns: 60 },
    );
  });
});

/* ---------- Memory ---------- */

describe("bradleyTerrySparse: memory in proportion to the pairs", () => {
  it("fits 10,000 items with 3 picks each, where the dense Hessian has 800 MB", () => {
    const items = 10_000;
    const r = random("bt-sparse-memory");
    const truth = Array.from({ length: items }, () => r.normal());
    const comparisons = drawComparisons(r.fork("picks"), truth, 15_000, 0.3);
    // The dense fit keeps a Hessian of items * items doubles. This test does not start it.
    expect(items * items * Float64Array.BYTES_PER_ELEMENT).toBe(800_000_000);
    const before = process.memoryUsage();
    const fit = bradleyTerrySparse(items, comparisons);
    const after = process.memoryUsage();
    expect(fit.converged).toBe(true);
    expect(fit.pairs).toBeLessThanOrEqual(comparisons.length);
    expect(fit.strengths).toHaveLength(items);
    // The fit keeps arrays of the items and of the pairs: a few MB. The limit leaves room for the garbage of the loop.
    const grown = after.heapUsed - before.heapUsed + (after.arrayBuffers - before.arrayBuffers);
    expect(grown).toBeLessThan(64 * 1024 * 1024);
    expect(fit.tie).toBeGreaterThan(0.2);
    expect(fit.tie).toBeLessThan(0.4);
  });
});
