import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { type Forecast, binomialTest, poissonBinomial, poissonBinomialTest, totalCalibration } from "./index.ts";

/** The law of the count of successes, from a sum over each of the 2^n outcomes of the trials. */
function lawOfEachOutcome(ps: readonly number[]): number[] {
  const law = Array<number>(ps.length + 1).fill(0);
  for (let outcome = 0; outcome < 2 ** ps.length; outcome++) {
    let [chance, count] = [1, 0];
    ps.forEach((p, i) => {
      if (outcome & (1 << i)) {
        chance *= p;
        count++;
      } else chance *= 1 - p;
    });
    law[count] = (law[count] ?? 0) + chance;
  }
  return law;
}

const sum = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0);
const chance = uniformDouble({ min: 0, max: 1 });
const chances = (maxLength: number) => fc.array(chance, { maxLength });
const forecasts = (maxLength: number) => fc.array(fc.record({ p: chance, hit: fc.boolean() }), { minLength: 1, maxLength });
/** A list and the same list in another order. */
const reordered = <T>(items: fc.Arbitrary<T[]>) =>
  items.chain((list) => fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length })));

describe("poissonBinomial", () => {
  it("is equal to the sum over each outcome of up to 10 trials", () => {
    fc.assert(
      fc.property(chances(10), (ps) => {
        const law = poissonBinomial(ps);
        const each = lawOfEachOutcome(ps);
        expect(law).toHaveLength(ps.length + 1);
        law.forEach((c, k) => expect(c).toBeCloseTo(each[k] ?? Number.NaN, 12));
      }),
    );
  });

  it("has the sum 1, the mean sum p and the variance sum p (1 - p)", () => {
    fc.assert(
      fc.property(chances(80), (ps) => {
        const law = poissonBinomial(ps);
        const mean = sum(law.map((c, k) => k * c));
        for (const c of law) expect(c >= 0 && c <= 1).toBe(true);
        expect(sum(law)).toBeCloseTo(1, 12);
        expect(mean).toBeCloseTo(sum(ps), 9);
        expect(sum(law.map((c, k) => (k - mean) ** 2 * c))).toBeCloseTo(sum(ps.map((p) => p * (1 - p))), 9);
      }),
    );
  });

  it("does not change when the trials change their order", () => {
    fc.assert(
      fc.property(reordered(chances(40)), ([ps, other]) => {
        const [a, b] = [poissonBinomial(ps), poissonBinomial(other)];
        a.forEach((c, k) => expect(c).toBeCloseTo(b[k] ?? Number.NaN, 13));
      }),
    );
  });

  it("turns around when each p becomes 1 - p", () => {
    fc.assert(
      fc.property(chances(40), (ps) => {
        const [law, mirror] = [poissonBinomial(ps), poissonBinomial(ps.map((p) => 1 - p)).reverse()];
        law.forEach((c, k) => expect(c).toBeCloseTo(mirror[k] ?? Number.NaN, 13));
      }),
    );
  });

  it("moves up by one count for a trial with p 1, and keeps each count for a trial with p 0", () => {
    fc.assert(
      fc.property(chances(30), (ps) => {
        const law = poissonBinomial(ps);
        expect(poissonBinomial([...ps, 1])).toEqual([0, ...law]);
        expect(poissonBinomial([...ps, 0])).toEqual([...law, 0]);
      }),
    );
  });

  it("gives [1] for no trials", () => {
    expect(poissonBinomial([])).toEqual([1]);
  });

  it("gives 0 for a chance under 2^-1022, and keeps the sum 1 for 20 000 trials", () => {
    const ps = Array.from({ length: 20_000 }, (_, i) => (i % 2 === 0 ? 0.3 : 0.7));
    const law = poissonBinomial(ps);
    expect(law[0]).toBe(0);
    expect(law[20_000]).toBe(0);
    expect(sum(law)).toBeCloseTo(1, 10);
    for (const c of law) expect(c === 0 || c >= 2 ** -1022).toBe(true);
  });

  it("refuses a chance outside 0 to 1", () => {
    for (const bad of [-0.1, 1.5, Number.NaN]) expect(() => poissonBinomial([0.5, bad])).toThrow(RangeError);
  });
});

describe("poissonBinomialTest", () => {
  it("is equal to binomialTest when each chance is equal", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), chance, (n, p) => {
        const ps = Array<number>(n).fill(p);
        for (const k of [0, Math.floor(n / 3), Math.floor(n / 2), n]) {
          for (const side of ["less", "greater"] as const) {
            const exact = binomialTest(k, n, p, side);
            expect(Math.abs(poissonBinomialTest(k, ps, side) - exact)).toBeLessThanOrEqual(1e-12 + 1e-9 * exact);
          }
        }
      }),
    );
  });

  it("keeps the digits of a small tail", () => {
    const ps = Array<number>(1000).fill(0.5);
    const exact = binomialTest(900, 1000, 0.5, "greater");
    expect(exact).toBeLessThan(1e-140);
    expect(poissonBinomialTest(900, ps, "greater") / exact).toBeCloseTo(1, 9);
  });

  it("gives 1 for a tail that holds each count", () => {
    expect(poissonBinomialTest(3, [0.2, 0.9, 0.4], "less")).toBe(1);
    expect(poissonBinomialTest(0, [0.2, 0.9, 0.4], "greater")).toBe(1);
  });

  it("refuses a count outside 0 to n, and a side that is not less or greater", () => {
    expect(() => poissonBinomialTest(3, [0.5, 0.5], "less")).toThrow(RangeError);
    expect(() => poissonBinomialTest(-1, [0.5], "less")).toThrow(RangeError);
    expect(() => poissonBinomialTest(0.5, [0.5], "less")).toThrow(RangeError);
    expect(() => poissonBinomialTest(1, [0.5], "both" as "less")).toThrow(RangeError);
    expect(() => poissonBinomialTest(1, [2], "less")).toThrow(RangeError);
  });
});

describe("totalCalibration", () => {
  it("gives the totals of two coin flips with one hit", () => {
    const t = totalCalibration([
      { p: 0.5, hit: true },
      { p: 0.5, hit: false },
    ]);
    expect(t).toMatchObject({ n: 2, expected: 1, hits: 1, z: 0, within2: true, pLess: 0.75, pGreater: 0.75, pTwoSided: 1 });
    expect(t.sd).toBeCloseTo(Math.SQRT1_2, 15);
  });

  it("finds too many hits: ten hits of ten predictions of 0.1", () => {
    const t = totalCalibration(Array.from({ length: 10 }, () => ({ p: 0.1, hit: true })));
    expect(t.expected).toBeCloseTo(1, 14);
    expect(t.hits).toBe(10);
    expect(t.z).toBeCloseTo(9 / Math.sqrt(0.9), 12);
    expect(t.within2).toBe(false);
    expect(t.pLess).toBe(1);
    expect(t.pGreater / 1e-10).toBeCloseTo(1, 10);
    expect(t.pTwoSided / 2e-10).toBeCloseTo(1, 10);
  });

  it("gives z NaN when sd is 0, and within2 only for hits equal to expected", () => {
    const sure = totalCalibration([
      { p: 1, hit: true },
      { p: 0, hit: false },
    ]);
    expect(sure).toMatchObject({ expected: 1, hits: 1, sd: 0, within2: true, pLess: 1, pGreater: 1, pTwoSided: 1 });
    expect(sure.z).toBeNaN();
    const wrong = totalCalibration([{ p: 1, hit: false }]);
    expect(wrong).toMatchObject({ expected: 1, hits: 0, sd: 0, within2: false, pLess: 0, pGreater: 1, pTwoSided: 0 });
    expect(wrong.z).toBeNaN();
  });

  it("agrees with its parts: the sums, z, within2 and the exact tails", () => {
    fc.assert(
      fc.property(forecasts(60), (list: Forecast[]) => {
        const t = totalCalibration(list);
        const ps = list.map((f) => f.p);
        const law = poissonBinomial(ps);
        expect(t.n).toBe(list.length);
        expect(t.hits).toBe(list.filter((f) => f.hit).length);
        expect(t.expected).toBeCloseTo(sum(ps), 12);
        expect(t.sd).toBeCloseTo(Math.sqrt(sum(ps.map((p) => p * (1 - p)))), 12);
        expect(t.pLess).toBe(poissonBinomialTest(t.hits, ps, "less"));
        expect(t.pGreater).toBe(poissonBinomialTest(t.hits, ps, "greater"));
        expect(t.pLess + t.pGreater - (law[t.hits] ?? Number.NaN)).toBeCloseTo(1, 12);
        expect(t.pTwoSided).toBe(Math.min(1, 2 * Math.min(t.pLess, t.pGreater)));
        if (t.sd === 0) expect(t.z).toBeNaN();
        else {
          expect(Math.sign(t.z)).toBe(Math.sign(t.hits - t.expected));
          if (Math.abs(Math.abs(t.z) - 2) > 1e-9) expect(t.within2).toBe(Math.abs(t.z) <= 2);
        }
      }),
    );
  });

  it("does not change when the predictions change their order", () => {
    fc.assert(
      fc.property(reordered(forecasts(40)), ([list, other]) => {
        const [a, b] = [totalCalibration(list), totalCalibration(other)];
        expect(b.hits).toBe(a.hits);
        expect(b.expected).toBeCloseTo(a.expected, 12);
        expect(b.pLess).toBeCloseTo(a.pLess, 12);
        expect(b.pGreater).toBeCloseTo(a.pGreater, 12);
      }),
    );
  });

  it("refuses an empty list and a chance outside 0 to 1", () => {
    expect(() => totalCalibration([])).toThrow(RangeError);
    expect(() => totalCalibration([{ p: 1.2, hit: true }])).toThrow(RangeError);
  });
});
