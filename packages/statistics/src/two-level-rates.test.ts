import { random } from "@mark1russell7/rigor-generators";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fitGammaRates, fitTwoLevelGammaRates, gammaPoissonLogLikelihood, pooledRate, splitHoldout, thinningHoldout, thinUnits, type GroupedRateUnit, type RateUnit } from "./index.ts";

// The group "a" has two units with events. The group "b" has two units with no event.
const UNITS: GroupedRateUnit[] = [
  { group: "a", count: 9, exposure: 3 },
  { group: "b", count: 0, exposure: 2 },
  { group: "a", count: 3, exposure: 3 },
  { group: "b", count: 0, exposure: 4 },
];

describe("fitTwoLevelGammaRates", () => {
  it("fits each group with events alone, and gives each unit its pooled rate toward the law of its group", () => {
    const { laws, rates } = fitTwoLevelGammaRates(UNITS);
    const own = fitGammaRates([UNITS[0] as RateUnit, UNITS[2] as RateUnit]);
    expect(laws["a"]).toEqual({ ...own, units: 2, count: 12, from: "group" });
    expect(rates[0]).toBe(pooledRate(UNITS[0] as RateUnit, own));
    // Each pooled rate is between the raw rate of its unit and the mean of its group. With equal exposures, the pooled events of the group are its events.
    expect(rates[0]).toBeGreaterThan(2);
    expect(rates[0]).toBeLessThan(3);
    expect(rates[2]).toBeGreaterThan(1);
    expect(rates[2]).toBeLessThan(2);
    expect(((rates[0] ?? 0) + (rates[2] ?? 0)) * 3).toBeCloseTo(12, 9);
  });

  it("gives a group with no event the shape Infinity and its pooled mean toward the law of the groups", () => {
    const { groups, laws, rates } = fitTwoLevelGammaRates(UNITS);
    // The groups as units: "a" has 12 events in 6 years, and "b" has 0 events in 6 years.
    expect(groups).toEqual(fitGammaRates([{ count: 12, exposure: 6 }, { count: 0, exposure: 6 }]));
    const law = laws["b"];
    expect(law).toMatchObject({ shape: Number.POSITIVE_INFINITY, units: 2, count: 0, from: "groups" });
    expect(law?.mean).toBe(pooledRate({ count: 0, exposure: 6 }, groups));
    expect(law?.mean).toBeGreaterThan(0);
    expect(law?.mean).toBeLessThan(1);
    expect(rates[1]).toBe(law?.mean);
    expect(rates[3]).toBe(law?.mean);
    expect(Object.keys(laws)).toEqual(["a", "b"]);
  });

  it("gives each unit the rate 0 when no group has an event, and refuses a bad list", () => {
    expect(fitTwoLevelGammaRates([{ group: "a", count: 0, exposure: 1 }, { group: "b", count: 0, exposure: 2 }]).rates).toEqual([0, 0]);
    expect(() => fitTwoLevelGammaRates([])).toThrow(RangeError);
    expect(() => fitTwoLevelGammaRates([{ group: "a", count: 1.5, exposure: 1 }])).toThrow(RangeError);
    expect(() => fitTwoLevelGammaRates([{ group: "a", count: 1, exposure: 0 }])).toThrow(RangeError);
    expect(() => fitTwoLevelGammaRates([{ group: 1 as unknown as string, count: 1, exposure: 1 }])).toThrow(RangeError);
  });

  it("gives the same rate to each unit after a change of the order of the units", () => {
    const forward = fitTwoLevelGammaRates(UNITS);
    const backward = fitTwoLevelGammaRates([...UNITS].reverse());
    expect([...backward.rates].reverse().map((rate) => Number(rate.toPrecision(10)))).toEqual(forward.rates.map((rate) => Number(rate.toPrecision(10))));
  });
});

describe("thinUnits", () => {
  it("puts each event in one half, keeps the other fields, and gives the same halves for the same draws", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 50 }), { minLength: 1, maxLength: 20 }), fc.integer(), (counts, seed) => {
        const units = counts.map((count, index) => ({ group: String(index % 3), count, exposure: index + 1 }));
        const draws = random(seed);
        const [fit, score] = thinUnits(units, () => draws.chance(0.5));
        units.forEach((unit, index) => {
          expect((fit[index]?.count ?? 0) + (score[index]?.count ?? 0)).toBe(unit.count);
          expect(fit[index]).toMatchObject({ group: unit.group, exposure: unit.exposure });
        });
        const again = random(seed);
        expect(thinUnits(units, () => again.chance(0.5))).toEqual([fit, score]);
      }),
    );
    expect(thinUnits([{ count: 4, exposure: 1 }], () => true)).toEqual([[{ count: 4, exposure: 1 }], [{ count: 0, exposure: 1 }]]);
    expect(() => thinUnits([{ count: -1, exposure: 1 }], () => true)).toThrow(RangeError);
  });
});

describe("thinningHoldout", () => {
  const raw = (fit: readonly RateUnit[]): number[] => fit.map((unit) => unit.count / unit.exposure);

  it("gives -Infinity to a rate of 0 with events in the score half, and a finite score to the units with events in the fit half", () => {
    const units = [
      { count: 20, exposure: 2 },
      { count: 1, exposure: 2 },
    ];
    // The draws give the fit half each event of the first unit, and give the score half the event of the second unit.
    const order = [...Array.from({ length: 20 }, () => true), false];
    let index = 0;
    const result = thinningHoldout(units, { raw }, { draw: () => order[index++ % order.length] as boolean, rounds: 1 });
    expect(result.methods["raw"]?.logLikelihood).toBe(Number.NEGATIVE_INFINITY);
    expect(result.methods["raw"]?.lost).toBe(1);
    expect(result.seenUnits).toBe(1);
    // The seen score has only the first unit: 0 events at the expected count 20.
    expect(result.methods["raw"]?.seen).toBeCloseTo(-20, 12);
    expect(result.methods["raw"]?.squared).toBeCloseTo(400 + 1, 12);
  });

  it("scores the two-level rates above the raw rates and one rate for all units, on counts of a two-level gamma-Poisson law", () => {
    // 8 groups of 30 units. Each group has a log-normal mean rate, and each unit has a log-normal rate about the mean of its group.
    const draws = random("two-level-holdout");
    // A Poisson count by the product of uniform draws (Knuth). The expected counts here are small.
    const poisson = (expected: number): number => {
      const limit = Math.exp(-expected);
      let count = 0;
      for (let product = draws.next(); product > limit; product *= draws.next()) count += 1;
      return count;
    };
    const units: GroupedRateUnit[] = [];
    for (let g = 0; g < 8; g++) {
      const mean = Math.exp(draws.normal(-0.5, 0.8));
      for (let u = 0; u < 30; u++) {
        const exposure = draws.int(1, 10);
        const rate = mean * Math.exp(draws.normal(0, 0.5));
        units.push({ group: `g${g}`, count: poisson(rate * exposure), exposure });
      }
    }
    const stream = random(20261124);
    const result = thinningHoldout(
      units,
      {
        raw,
        pooled: (fit) => fitTwoLevelGammaRates(fit).rates,
        one: (fit) => {
          const total = fit.reduce((sum, unit) => ({ count: sum.count + unit.count, exposure: sum.exposure + unit.exposure }), { count: 0, exposure: 0 });
          return fit.map(() => total.count / total.exposure);
        },
      },
      { draw: () => stream.chance(0.5) },
    );
    expect(result.rounds).toBe(5);
    const { raw: rawScore, pooled, one } = result.methods;
    expect(pooled?.lost).toBe(0);
    expect(pooled?.logLikelihood).toBeGreaterThan(one?.logLikelihood ?? 0);
    expect(pooled?.seen).toBeGreaterThan(rawScore?.seen ?? 0);
    expect(pooled?.squared).toBeLessThan(Math.min(rawScore?.squared ?? 0, one?.squared ?? 0));
  });

  it("refuses an empty list, a bad number of splits, and a method with a bad rate or a list of a different length", () => {
    const units = [{ count: 2, exposure: 1 }];
    const draw = (): boolean => true;
    expect(() => thinningHoldout([], { raw }, { draw })).toThrow(RangeError);
    expect(() => thinningHoldout(units, { raw }, { draw, rounds: 0 })).toThrow(/rounds/u);
    expect(() => thinningHoldout(units, { bad: () => [-1] }, { draw })).toThrow(RangeError);
    expect(() => thinningHoldout(units, { bad: () => [Number.NaN] }, { draw })).toThrow(RangeError);
    expect(() => thinningHoldout(units, { bad: () => [1, 2] }, { draw })).toThrow(RangeError);
  });
});

describe("splitHoldout", () => {
  // Each unit: a fit part (for example the early years) and a score part (the later years), each in its own exposure.
  const fit: RateUnit[] = [
    { count: 6, exposure: 3 },
    { count: 0, exposure: 2 },
    { count: 2, exposure: 4 },
  ];
  const score: RateUnit[] = [
    { count: 4, exposure: 2 },
    { count: 1, exposure: 1 },
    { count: 0, exposure: 1 },
  ];
  const raw = (units: readonly RateUnit[]) => units.map((unit) => unit.count / unit.exposure);

  it("scores each count of the score part in its own exposure, with the scores of thinningHoldout", () => {
    const one = (units: readonly RateUnit[]) => units.map(() => 8 / 9);
    const result = splitHoldout(fit, score, { raw, one });
    expect(result.seenUnits).toBe(2);
    expect(Object.keys(result.methods)).toEqual(["one", "raw"]);
    // The raw rate of the first unit is 2 a year: 4 expected events in 2 years, and 4 events.
    const first = gammaPoissonLogLikelihood([{ count: 4, exposure: 2 }], Number.POSITIVE_INFINITY, 2);
    // The second unit has the raw rate 0 and 1 event, so it is lost. The third unit has the raw rate 0.5 and no event in 1 year.
    const third = gammaPoissonLogLikelihood([{ count: 0, exposure: 1 }], Number.POSITIVE_INFINITY, 0.5);
    expect(result.methods["raw"]).toEqual({ logLikelihood: Number.NEGATIVE_INFINITY, squared: 0 + 1 + 0.25, seen: first + third, lost: 1 });
    expect(result.methods["one"]?.lost).toBe(0);
    expect(Number.isFinite(result.methods["one"]?.logLikelihood)).toBe(true);
  });

  it("gives the scores of one round of thinningHoldout on the same split", () => {
    const units: RateUnit[] = [
      { count: 7, exposure: 2 },
      { count: 3, exposure: 5 },
    ];
    const draws = random(11);
    const thinned = thinningHoldout(units, { raw }, { draw: () => draws.chance(0.5), rounds: 1 });
    const again = random(11);
    const [half, rest] = thinUnits(units, () => again.chance(0.5));
    expect(splitHoldout(half, rest, { raw })).toEqual({ seenUnits: thinned.seenUnits, methods: thinned.methods });
  });

  it("refuses an empty list, parts of different lengths, a bad score part and a bad method", () => {
    expect(() => splitHoldout([], [], { raw })).toThrow(RangeError);
    expect(() => splitHoldout(fit, score.slice(1), { raw })).toThrow(/score part has 2 units/u);
    expect(() => splitHoldout(fit, [{ count: 1.5, exposure: 1 }, ...score.slice(1)], { raw })).toThrow(RangeError);
    expect(() => splitHoldout(fit, [{ count: 1, exposure: 0 }, ...score.slice(1)], { raw })).toThrow(/exposure of the score part/u);
    expect(() => splitHoldout(fit, score, { bad: () => [1, -1, 1] })).toThrow(/splitHoldout: the method "bad"/u);
    expect(() => splitHoldout(fit, score, { short: () => [1] })).toThrow(/gives 1 rates for 3 units/u);
  });
});
