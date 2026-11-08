import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Random, random } from "@mark1russell7/rigor-generators";
import { type PairComparison, type PairOutcome, bradleyTerry, pairProbabilities, spearman } from "./index.ts";

/* ---------- Helpers ---------- */

function repeat(a: number, b: number, outcome: PairOutcome, times: number): PairComparison[] {
  return Array.from({ length: times }, () => ({ a, b, outcome }));
}

// Seeded comparisons from known strengths and a known tie parameter, with the Davidson model.
function drawComparisons(r: Random, strengths: readonly number[], count: number, nu: number): PairComparison[] {
  const out: PairComparison[] = [];
  for (let i = 0; i < count; i++) {
    const [a, b] = r.sample(
      strengths.map((_, k) => k),
      2,
    ) as [number, number];
    const p = pairProbabilities(strengths[a]!, strengths[b]!, nu);
    const u = r.next();
    out.push({ a, b, outcome: u < p.a ? "a" : u < p.a + p.b ? "b" : "tie" });
  }
  return out;
}

const comparisonList = (items: number) =>
  fc.array(
    fc
      .record({
        a: fc.integer({ min: 0, max: items - 1 }),
        b: fc.integer({ min: 0, max: items - 1 }),
        outcome: fc.constantFrom<PairOutcome>("a", "b", "tie"),
        weight: fc.constantFrom(0.5, 1, 2),
      })
      .filter((c) => c.a !== c.b),
    { maxLength: 40 },
  );

/* ---------- Exact cases ---------- */

describe("bradleyTerry: exact cases", () => {
  it("fits one win of two items by hand", () => {
    // With a prior N(0, 1), the strengths are t and -t, and the gradient is tanh(t) - 1 + 2t = 0.
    const fit = bradleyTerry(2, [{ a: 0, b: 1, outcome: "a" }]);
    const t = fit.strengths[0]!;
    expect(fit.strengths[1]).toBeCloseTo(-t, 12);
    expect(Math.tanh(t) + 2 * t).toBeCloseTo(1, 10);
    expect(fit.converged).toBe(true);
    expect(fit.tie).toBe(0);
    const pa = 1 / (1 + Math.exp(-2 * t));
    expect(fit.logLikelihood).toBeCloseTo(Math.log(pa), 10);
    // The Hessian is [[h + 1, -h], [-h, h + 1]] with h = pa * pb. Its inverse has (h + 1) / (2h + 1) on the diagonal.
    const h = pa * (1 - pa);
    expect(fit.se[0]).toBeCloseTo(Math.sqrt((h + 1) / (2 * h + 1)), 10);
    expect(fit.se[1]).toBeCloseTo(fit.se[0]!, 12);
  });

  it("gives the prior to an item with no comparison", () => {
    const comparisons = [...repeat(0, 1, "a", 3), ...repeat(1, 2, "tie", 2), ...repeat(2, 0, "b", 1)];
    const fit = bradleyTerry(4, comparisons, { priorMean: 0.3, priorSd: 2 });
    expect(fit.strengths[3]).toBe(0.3);
    expect(fit.se[3]).toBeCloseTo(2, 12);
    const empty = bradleyTerry(3, [], { priorMean: -1, priorSd: 0.5 });
    expect(empty.strengths).toEqual([-1, -1, -1]);
    expect(empty.se.map((s) => Number(s.toFixed(12)))).toEqual([0.5, 0.5, 0.5]);
    expect(empty.logLikelihood).toBe(0);
    expect(empty.converged).toBe(true);
  });

  it("keeps an unbeaten item finite, and puts it first", () => {
    const comparisons = [...repeat(0, 1, "a", 30), ...repeat(2, 0, "b", 30), ...repeat(1, 2, "a", 5), ...repeat(2, 1, "a", 5)];
    const fit = bradleyTerry(3, comparisons);
    expect(fit.converged).toBe(true);
    for (const s of [...fit.strengths, ...fit.se]) expect(Number.isFinite(s)).toBe(true);
    expect(fit.strengths[0]).toBeGreaterThan(fit.strengths[1]!);
    expect(fit.strengths[0]).toBeGreaterThan(fit.strengths[2]!);
    expect(fit.strengths[0]).toBeLessThan(10);
    // A wider prior lets the unbeaten item go farther, but it stays finite.
    const wide = bradleyTerry(3, comparisons, { priorSd: 10 });
    expect(wide.strengths[0]).toBeGreaterThan(fit.strengths[0]!);
    expect(Number.isFinite(wide.strengths[0])).toBe(true);
  });

  it("counts a weight of 2 as two equal comparisons, and a weight of 0 as no comparison", () => {
    const one = bradleyTerry(3, [{ a: 0, b: 1, outcome: "a", weight: 2 }, { a: 1, b: 2, outcome: "tie" }, { a: 2, b: 0, outcome: "b", weight: 0 }]);
    const two = bradleyTerry(3, [...repeat(0, 1, "a", 2), { a: 1, b: 2, outcome: "tie" }]);
    for (let i = 0; i < 3; i++) {
      expect(one.strengths[i]).toBeCloseTo(two.strengths[i]!, 10);
      expect(one.se[i]).toBeCloseTo(two.se[i]!, 10);
    }
    expect(one.tie).toBeCloseTo(two.tie, 10);
    expect(one.logLikelihood).toBeCloseTo(two.logLikelihood, 10);
  });

  it("does not change its inputs, and gives the same result two times", () => {
    const comparisons = Object.freeze([...repeat(0, 1, "a", 3), ...repeat(1, 2, "tie", 2)].map((c) => Object.freeze(c)));
    const a = bradleyTerry(3, comparisons);
    const b = bradleyTerry(3, comparisons);
    expect(a).toEqual(b);
    expect(comparisons[0]).toEqual({ a: 0, b: 1, outcome: "a" });
  });

  it("refuses a bad index, outcome, weight and option", () => {
    expect(() => bradleyTerry(0, [])).toThrow(RangeError);
    expect(() => bradleyTerry(2, [{ a: 0, b: 2, outcome: "a" }])).toThrow(RangeError);
    expect(() => bradleyTerry(2, [{ a: 1, b: 1, outcome: "a" }])).toThrow(RangeError);
    expect(() => bradleyTerry(2, [{ a: 0.5, b: 1, outcome: "a" }])).toThrow(RangeError);
    expect(() => bradleyTerry(2, [{ a: 0, b: 1, outcome: "draw" as PairOutcome }])).toThrow(RangeError);
    expect(() => bradleyTerry(2, [{ a: 0, b: 1, outcome: "a", weight: -1 }])).toThrow(RangeError);
    expect(() => bradleyTerry(2, [], { priorSd: 0 })).toThrow(RangeError);
    expect(() => bradleyTerry(2, [], { maxIterations: 0 })).toThrow(RangeError);
    expect(() => bradleyTerry(2, [], { ties: "other" as "half" })).toThrow(RangeError);
  });
});

/* ---------- Ties ---------- */

describe("bradleyTerry: ties", () => {
  // Two equal items: 10 wins each and 80 ties. The Davidson fit gives P(tie) = nu / (2 + nu) = 0.8, so nu = 8.
  const tieHeavy = [...repeat(0, 1, "a", 10), ...repeat(0, 1, "b", 10), ...repeat(1, 0, "tie", 80)];

  it("fits the Davidson tie parameter of a log with many ties", () => {
    const fit = bradleyTerry(2, tieHeavy, { tiePriorSd: 1e6 });
    expect(fit.converged).toBe(true);
    expect(fit.strengths[0]).toBeCloseTo(0, 10);
    expect(fit.strengths[1]).toBeCloseTo(0, 10);
    expect(fit.tie).toBeCloseTo(8, 6);
    const p = pairProbabilities(fit.strengths[0]!, fit.strengths[1]!, fit.tie);
    expect(p.tie).toBeCloseTo(0.8, 8);
    expect(fit.logLikelihood).toBeCloseTo(20 * Math.log(0.1) + 80 * Math.log(0.8), 8);
    // The default weak prior on ln(nu) moves the parameter only a little.
    expect(Math.abs(bradleyTerry(2, tieHeavy).tie - 8)).toBeLessThan(0.05);
  });

  it("counts a tie as half a win and half a loss with the model half", () => {
    const fit = bradleyTerry(2, tieHeavy, { ties: "half" });
    expect(fit.tie).toBe(0);
    expect(fit.strengths[0]).toBeCloseTo(0, 10);
    expect(fit.logLikelihood).toBeCloseTo(100 * Math.log(0.5), 8);
    // One win and two ties of item 0 count as two wins and one loss.
    const half = bradleyTerry(2, [{ a: 0, b: 1, outcome: "a" }, ...repeat(0, 1, "tie", 2)], { ties: "half" });
    const counted = bradleyTerry(2, [...repeat(0, 1, "a", 2), { a: 0, b: 1, outcome: "b" }]);
    expect(half.strengths[0]).toBeCloseTo(counted.strengths[0]!, 10);
    expect(half.se[0]).toBeCloseTo(counted.se[0]!, 10);
  });

  it("keeps the tie parameter finite when each comparison is a tie", () => {
    const fit = bradleyTerry(3, [...repeat(0, 1, "tie", 20), ...repeat(1, 2, "tie", 20)]);
    expect(fit.converged).toBe(true);
    expect(Number.isFinite(fit.tie)).toBe(true);
    expect(fit.tie).toBeGreaterThan(100);
  });

  it("gives a tie parameter of 0 when no comparison is a tie", () => {
    expect(bradleyTerry(2, repeat(0, 1, "a", 3)).tie).toBe(0);
  });
});

/* ---------- Invariance ---------- */

describe("bradleyTerry: invariance", () => {
  it("permutes the result when the labels of the items are permuted", () => {
    fc.assert(
      fc.property(comparisonList(5), fc.constantFrom<"davidson" | "half">("davidson", "half"), (comparisons, ties) => {
        const map = [3, 0, 4, 1, 2];
        const fit = bradleyTerry(5, comparisons, { ties });
        const moved = bradleyTerry(5, comparisons.map((c) => ({ ...c, a: map[c.a]!, b: map[c.b]! })), { ties });
        expect(fit.converged).toBe(true);
        for (let i = 0; i < 5; i++) {
          expect(moved.strengths[map[i]!]).toBeCloseTo(fit.strengths[i]!, 8);
          expect(moved.se[map[i]!]).toBeCloseTo(fit.se[i]!, 8);
        }
        expect(moved.tie).toBeCloseTo(fit.tie, 6);
        expect(moved.logLikelihood).toBeCloseTo(fit.logLikelihood, 8);
      }),
      { numRuns: 60 },
    );
  });

  it("gives the same fit when each comparison swaps its two sides", () => {
    fc.assert(
      fc.property(comparisonList(4), (comparisons) => {
        const swap: Record<PairOutcome, PairOutcome> = { a: "b", b: "a", tie: "tie" };
        const fit = bradleyTerry(4, comparisons);
        const swapped = bradleyTerry(4, comparisons.map((c) => ({ ...c, a: c.b, b: c.a, outcome: swap[c.outcome] })));
        for (let i = 0; i < 4; i++) expect(swapped.strengths[i]).toBeCloseTo(fit.strengths[i]!, 8);
      }),
      { numRuns: 60 },
    );
  });

  it("moves each strength by the change of the prior mean, and keeps the errors and the tie parameter", () => {
    fc.assert(
      fc.property(comparisonList(4), fc.double({ min: -5, max: 5, noNaN: true }), (comparisons, shift) => {
        const fit = bradleyTerry(4, comparisons);
        const moved = bradleyTerry(4, comparisons, { priorMean: shift });
        for (let i = 0; i < 4; i++) {
          expect(moved.strengths[i]).toBeCloseTo(fit.strengths[i]! + shift, 8);
          expect(moved.se[i]).toBeCloseTo(fit.se[i]!, 8);
        }
        expect(moved.tie).toBeCloseTo(fit.tie, 6);
      }),
      { numRuns: 60 },
    );
  });
});

/* ---------- Recovery ---------- */

function recovery(seed: string): { truth: number[]; fit: ReturnType<typeof bradleyTerry> } {
  const r = random(seed);
  const truth = Array.from({ length: 20 }, () => r.normal());
  const comparisons = drawComparisons(r.fork("picks"), truth, 1500, 0.5);
  return { truth, fit: bradleyTerry(truth.length, comparisons) };
}

describe("bradleyTerry: recovery of known strengths", () => {
  it.each(["bt-recovery-1", "bt-recovery-2", "bt-recovery-3"])("finds the order, the differences and the tie parameter at seed %s", (seed) => {
    const { truth, fit } = recovery(seed);
    expect(fit.converged).toBe(true);
    expect(fit.iterations).toBeLessThan(30);
    expect(spearman(truth, fit.strengths)).toBeGreaterThan(0.9);
    // The comparisons fix only the differences. The prior sets the center, so the test compares the centered strengths.
    const center = truth.reduce((s, t) => s + t, 0) / truth.length;
    let inside = 0;
    for (let i = 0; i < truth.length; i++) if (Math.abs(fit.strengths[i]! - (truth[i]! - center)) <= 2 * fit.se[i]!) inside++;
    expect(inside / truth.length).toBeGreaterThanOrEqual(0.85);
    expect(fit.tie).toBeGreaterThan(0.35);
    expect(fit.tie).toBeLessThan(0.7);
  });

  it("covers the true strengths in about 95 percent of the items over 20 seeds", () => {
    // The true strengths come from the prior N(0, 1), so 2 standard errors cover approximately 95 percent of them.
    let inside = 0;
    let total = 0;
    for (let s = 0; s < 20; s++) {
      const { truth, fit } = recovery(`bt-coverage-${s}`);
      for (let i = 0; i < truth.length; i++) if (Math.abs(fit.strengths[i]! - truth[i]!) <= 2 * fit.se[i]!) inside++;
      total += truth.length;
    }
    expect(inside / total).toBeGreaterThan(0.88);
    expect(inside / total).toBeLessThan(0.99);
  });
});
