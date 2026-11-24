import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fitGammaRates, gammaPoissonLogLikelihood, pooledRate, type RateUnit } from "./index.ts";

/** Units with a large spread of rates: in 10 years each, half of the units have no event and half have 20. */
const SPREAD: RateUnit[] = Array.from({ length: 20 }, (_, i) => ({ count: i % 2 === 0 ? 0 : 20, exposure: 10 }));

describe("gammaPoissonLogLikelihood", () => {
  it("gives the negative binomial law, and the Poisson law at the shape Infinity", () => {
    // Shape 1, mean 1, exposure 1: the probability of 2 events is C(2, 2) * 0.5 * 0.5^2 = 0.125.
    expect(gammaPoissonLogLikelihood([{ count: 2, exposure: 1 }], 1, 1)).toBeCloseTo(Math.log(0.125), 12);
    // The Poisson law: 3 events at the mean 2 * 1.5 = 3 have the probability e^-3 3^3 / 3!.
    const poisson = Math.log((Math.exp(-3) * 27) / 6);
    expect(gammaPoissonLogLikelihood([{ count: 3, exposure: 1.5 }], Number.POSITIVE_INFINITY, 2)).toBeCloseTo(poisson, 12);
    expect(gammaPoissonLogLikelihood([{ count: 3, exposure: 1.5 }], 1e9, 2)).toBeCloseTo(poisson, 6);
    // A count of 100 uses the log-gamma form. It agrees with a sum of logarithms.
    const large = gammaPoissonLogLikelihood([{ count: 100, exposure: 10 }], 2.5, 9);
    let direct = 0;
    for (let k = 0; k < 100; k++) direct += Math.log(2.5 + k) - Math.log(k + 1);
    expect(large).toBeCloseTo(direct - 2.5 * Math.log1p(90 / 2.5) + 100 * (Math.log(90) - Math.log(92.5)), 8);
  });

  it("gives 0 for no events at the mean 0, and -Infinity for an event at the mean 0", () => {
    expect(gammaPoissonLogLikelihood([{ count: 0, exposure: 4 }], 2, 0)).toBe(0);
    expect(gammaPoissonLogLikelihood([{ count: 1, exposure: 4 }], 2, 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("refuses a bad unit, shape or mean", () => {
    expect(() => gammaPoissonLogLikelihood([], 1, 1)).toThrow(RangeError);
    expect(() => gammaPoissonLogLikelihood([{ count: 1.5, exposure: 1 }], 1, 1)).toThrow(RangeError);
    expect(() => gammaPoissonLogLikelihood([{ count: -1, exposure: 1 }], 1, 1)).toThrow(RangeError);
    expect(() => gammaPoissonLogLikelihood([{ count: 1, exposure: 0 }], 1, 1)).toThrow(RangeError);
    expect(() => gammaPoissonLogLikelihood([{ count: 1, exposure: Number.POSITIVE_INFINITY }], 1, 1)).toThrow(RangeError);
    expect(() => gammaPoissonLogLikelihood([{ count: 1, exposure: 1 }], 0, 1)).toThrow(RangeError);
    expect(() => gammaPoissonLogLikelihood([{ count: 1, exposure: 1 }], Number.NaN, 1)).toThrow(RangeError);
    expect(() => gammaPoissonLogLikelihood([{ count: 1, exposure: 1 }], 1, -1)).toThrow(RangeError);
  });
});

describe("fitGammaRates", () => {
  it("gives a finite shape for a spread of rates, with the total count over the total exposure as the mean at equal exposures", () => {
    const law = fitGammaRates(SPREAD);
    expect(law.shape).toBeGreaterThan(0.01);
    expect(law.shape).toBeLessThan(1);
    expect(law.mean).toBeCloseTo(1, 9);
    // The fit is a peak of the likelihood: a near shape, a near mean or one rate for all units gives less.
    const total = gammaPoissonLogLikelihood(SPREAD, law.shape, law.mean);
    for (const factor of [0.8, 1.25]) {
      expect(gammaPoissonLogLikelihood(SPREAD, law.shape * factor, law.mean)).toBeLessThan(total);
      expect(gammaPoissonLogLikelihood(SPREAD, law.shape, law.mean * factor)).toBeLessThan(total);
    }
    expect(gammaPoissonLogLikelihood(SPREAD, Number.POSITIVE_INFINITY, 1)).toBeLessThan(total);
  });

  it("gives the shape Infinity for units with one rate, and the mean 0 for units with no event", () => {
    expect(fitGammaRates(Array.from({ length: 8 }, () => ({ count: 5, exposure: 10 })))).toEqual({ shape: Number.POSITIVE_INFINITY, mean: 0.5 });
    expect(fitGammaRates([{ count: 3, exposure: 2 }, { count: 6, exposure: 4 }])).toEqual({ shape: Number.POSITIVE_INFINITY, mean: 1.5 });
    expect(fitGammaRates([{ count: 0, exposure: 2 }, { count: 0, exposure: 9 }])).toEqual({ shape: Number.POSITIVE_INFINITY, mean: 0 });
    // One unit shows no spread: its rate is count / exposure.
    expect(fitGammaRates([{ count: 7, exposure: 2 }])).toEqual({ shape: Number.POSITIVE_INFINITY, mean: 3.5 });
  });

  it("gives a shape at the limit low when the peak is below it, and a smaller shape with a wider range", () => {
    // One unit with 40 events and 2999 units with none, in 10 years each: the peak of the shape is below 0.001.
    const units: RateUnit[] = [{ count: 40, exposure: 10 }, ...Array.from({ length: 2999 }, () => ({ count: 0, exposure: 10 }))];
    const law = fitGammaRates(units);
    expect(Math.abs(Math.log(law.shape / 0.001))).toBeLessThan(1e-6);
    const wide = fitGammaRates(units, { low: 1e-6 });
    expect(wide.shape).toBeLessThan(0.0005);
    expect(wide.shape).toBeGreaterThan(1e-6);
    expect(gammaPoissonLogLikelihood(units, wide.shape, wide.mean)).toBeGreaterThan(gammaPoissonLogLikelihood(units, law.shape, law.mean));
  });

  it("is a peak of the likelihood for any units, and the order of the units does not change it", () => {
    const unit = fc.record({ count: fc.integer({ min: 0, max: 200 }), exposure: fc.double({ min: 0.5, max: 50, noNaN: true }) });
    fc.assert(
      fc.property(fc.array(unit, { minLength: 2, maxLength: 12 }), (units) => {
        const law = fitGammaRates(units);
        const total = gammaPoissonLogLikelihood(units, law.shape, law.mean);
        const tolerance = 1e-7 * Math.max(1, Math.abs(total));
        if (law.mean > 0) for (const factor of [0.9, 1.1]) expect(gammaPoissonLogLikelihood(units, law.shape, law.mean * factor)).toBeLessThanOrEqual(total + tolerance);
        if (Number.isFinite(law.shape)) for (const factor of [0.5, 2]) expect(gammaPoissonLogLikelihood(units, law.shape * factor, law.mean)).toBeLessThanOrEqual(total + tolerance);
        // A result of Infinity is not worse than a finite shape at the mean of the result.
        else if (law.mean > 0) for (const shape of [0.1, 1, 10, 100]) expect(gammaPoissonLogLikelihood(units, shape, law.mean)).toBeLessThanOrEqual(total + tolerance);
        const reversed = fitGammaRates([...units].reverse());
        expect(reversed.shape === law.shape || Math.abs(Math.log(reversed.shape / law.shape)) < 1e-6).toBe(true);
        expect(Math.abs(reversed.mean - law.mean)).toBeLessThanOrEqual(1e-7 * law.mean);
      }),
      { seed: 20261124, numRuns: 150 },
    );
  });

  it("refuses an empty list, a bad unit and a bad range of the search", () => {
    expect(() => fitGammaRates([])).toThrow(RangeError);
    expect(() => fitGammaRates([{ count: 1, exposure: -1 }])).toThrow(RangeError);
    expect(() => fitGammaRates(SPREAD, { low: 0 })).toThrow(RangeError);
    expect(() => fitGammaRates(SPREAD, { low: 10, high: 1 })).toThrow(RangeError);
    expect(() => fitGammaRates(SPREAD, { high: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe("pooledRate", () => {
  it("moves the rate of a unit toward the mean, more for a small exposure", () => {
    const law = { shape: 2, mean: 0.5 };
    // No event in 1 year: (0 + 2) / (1 + 4) = 0.4, near the mean. No event in 100 years: 2 / 104, near 0.
    expect(pooledRate({ count: 0, exposure: 1 }, law)).toBeCloseTo(0.4, 12);
    expect(pooledRate({ count: 0, exposure: 100 }, law)).toBeCloseTo(2 / 104, 12);
    // 30 events in 10 years: (30 + 2) / (10 + 4), between 3 and the mean.
    expect(pooledRate({ count: 30, exposure: 10 }, law)).toBeCloseTo(32 / 14, 12);
    expect(pooledRate({ count: 30, exposure: 10 }, { shape: Number.POSITIVE_INFINITY, mean: 0.5 })).toBe(0.5);
    expect(pooledRate({ count: 0, exposure: 10 }, { shape: 3, mean: 0 })).toBe(0);
  });

  it("gives a value between the rate of the unit and the mean of the law", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        fc.double({ min: 0.001, max: 1000, noNaN: true }),
        fc.double({ min: 0.001, max: 100, noNaN: true }),
        (count, exposure, shape, mean) => {
          const rate = pooledRate({ count, exposure }, { shape, mean });
          const [low, high] = [Math.min(count / exposure, mean), Math.max(count / exposure, mean)];
          expect(rate).toBeGreaterThanOrEqual(low * (1 - 1e-12));
          expect(rate).toBeLessThanOrEqual(high * (1 + 1e-12));
        },
      ),
      { seed: 20261124 },
    );
  });

  it("refuses a bad unit or law", () => {
    expect(() => pooledRate({ count: -1, exposure: 1 }, { shape: 1, mean: 1 })).toThrow(RangeError);
    expect(() => pooledRate({ count: 1, exposure: 1 }, { shape: 0, mean: 1 })).toThrow(RangeError);
    expect(() => pooledRate({ count: 1, exposure: 1 }, { shape: 1, mean: Number.NaN })).toThrow(RangeError);
  });
});
