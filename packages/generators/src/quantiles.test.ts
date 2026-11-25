import { describe, expect, it } from "vitest";
import { sampler, type DistributionSpec } from "./distributions.ts";
import { normalQuantile } from "./normal.ts";
import { betaCdf, betaShares, distributionOf, logBeta, logGamma } from "./quantiles.ts";
import { random } from "./random.ts";

const relative = (got: number, want: number): number => Math.abs(got - want) / Math.abs(want);
const grid = Array.from({ length: 999 }, (_, i) => (i + 1) / 1000);

const CONTINUOUS: readonly DistributionSpec[] = [
  { family: "lognormal", mu: 1, sigma: 0.5 },
  { family: "lognormal", mu: -2, sigma: 2 },
  { family: "pareto", scale: 2, shape: 3 },
  { family: "pareto", scale: 0.5, shape: 0.7 },
  { family: "beta", a: 2, b: 5 },
  { family: "beta", a: 0.5, b: 0.5 },
  { family: "beta", a: 0.3, b: 4 },
  { family: "mixture", parts: [{ weight: 3, part: { family: "lognormal", mu: 0, sigma: 1 } }, { weight: 1, part: { family: "pareto", scale: 5, shape: 2 } }] },
];

describe("the log of the gamma function", () => {
  it("equals the log of a factorial at each whole number, to a relative error of 1e-14", () => {
    let factorial = 1;
    for (let n = 1; n <= 30; n++) {
      if (n > 1) factorial *= n - 1;
      const got = logGamma(n);
      const want = Math.log(factorial);
      expect(want === 0 ? Math.abs(got) : relative(got, want), String(n)).toBeLessThan(1e-14);
    }
  });

  it("equals the closed forms at one half, and the reflection formula below one half", () => {
    expect(relative(logGamma(0.5), 0.5 * Math.log(Math.PI))).toBeLessThan(1e-14);
    expect(relative(logGamma(1.5), Math.log(Math.sqrt(Math.PI) / 2))).toBeLessThan(1e-13);
    // Gamma(1/4) Gamma(3/4) = pi times the square root of 2.
    expect(relative(logGamma(0.25) + logGamma(0.75), Math.log(Math.PI * Math.SQRT2))).toBeLessThan(1e-14);
    expect(relative(logGamma(100), 359.13420536957539878)).toBeLessThan(1e-14);
  });
});

describe("the beta cumulative distribution", () => {
  it("equals the closed forms", () => {
    for (const x of [0.01, 0.2, 0.5, 0.77, 0.99]) {
      expect(betaCdf(x, 1, 1)).toBeCloseTo(x, 14);
      expect(betaCdf(x, 2, 2)).toBeCloseTo(3 * x * x - 2 * x ** 3, 14);
      expect(betaCdf(x, 3, 1)).toBeCloseTo(x ** 3, 14);
      expect(betaCdf(x, 1, 4)).toBeCloseTo(1 - (1 - x) ** 4, 14);
    }
    expect(betaCdf(0, 2, 3)).toBe(0);
    expect(betaCdf(1, 2, 3)).toBe(1);
  });
});

describe("the log of the beta function", () => {
  it("equals the closed forms and the sum of logGamma at small arguments, and is symmetric", () => {
    expect(relative(logBeta(2, 3), Math.log(1 / 12))).toBeLessThan(1e-14);
    expect(relative(logBeta(0.5, 0.5), Math.log(Math.PI))).toBeLessThan(1e-14);
    expect(relative(logBeta(10, 20), logGamma(10) + logGamma(20) - logGamma(30))).toBeLessThan(1e-13);
    expect(relative(logBeta(12.5, 300), logGamma(12.5) + logGamma(300) - logGamma(312.5))).toBeLessThan(1e-13);
    expect(logBeta(3, 40)).toBe(logBeta(40, 3));
  });

  // B(a, b + 1) = B(a, b) b / (a + b), and B(1, b) = 1 / b. The sum of logGamma loses all digits of these steps near 1e12.
  it.each([10, 1e3, 1e6, 1e9, 1e12, 1e13])("keeps the digits of the steps at b of %s", (b) => {
    expect(relative(logBeta(1, b), -Math.log(b))).toBeLessThan(1e-15);
    for (const a of [0.5, 20, 1e4]) {
      const step = logBeta(a, b + 1) - logBeta(a, b);
      expect(Math.abs(step - Math.log1p(-a / (a + b)))).toBeLessThan(1e-15 * Math.max(1, Math.abs(logBeta(a, b))));
    }
  });
});

describe("the shares of the beta law", () => {
  it("gives the two shares, betaCdf as the share below, and the shares of the swapped law", () => {
    for (const [a, b] of [[2, 3], [0.5, 7], [40, 0.3]] as const) {
      for (const x of [0.01, 0.3, 0.5, 0.9, 0.999]) {
        const shares = betaShares(x, 1 - x, a, b);
        expect(shares.below).toBe(betaCdf(x, a, b));
        expect(shares.below + shares.above).toBeCloseTo(1, 15);
        expect(relative(betaShares(1 - x, x, b, a).above, shares.below)).toBeLessThan(1e-13);
      }
    }
    expect(betaShares(0, 1, 2, 3)).toEqual({ below: 0, above: 1 });
    expect(betaShares(1, 0, 2, 3)).toEqual({ below: 1, above: 0 });
  });

  it("keeps the digits of the distance of a point near 1", () => {
    // The law with b of 1 has the share x^a below x. Thus the share above is -expm1(a log1p(-y)).
    for (const y of [1e-9, 1e-15, 1e-20]) {
      expect(relative(betaShares(1 - y, y, 3, 1).above, -Math.expm1(3 * Math.log1p(-y)))).toBeLessThan(1e-12);
      expect(relative(betaShares(y, 1 - y, 1, 2.5).below, -Math.expm1(2.5 * Math.log1p(-y)))).toBeLessThan(1e-12);
    }
    // betaCdf gets only x, so it cannot keep these digits.
    expect(1 - betaCdf(1 - 1e-20, 3, 1)).toBe(0);
  });

  it("refuses a point out of the law and a pair whose sum is not 1", () => {
    expect(() => betaShares(-0.1, 1.1, 2, 3)).toThrow(RangeError);
    expect(() => betaShares(0.3, 0.6, 2, 3)).toThrow(RangeError);
    expect(() => betaShares(Number.NaN, 0.5, 2, 3)).toThrow(RangeError);
  });

  /** The Cornish-Fisher series of the quantile of the Student t law, to the power -4 of the degrees of freedom. */
  const tSeries = (p: number, df: number): number => {
    const z = normalQuantile(p);
    const terms = [
      (z ** 3 + z) / 4,
      (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96,
      (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384,
      (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / 92160,
    ];
    return terms.reduce((sum, term, at) => sum + term / df ** (at + 1), z);
  };

  // The beta law of t^2 / (df + t^2), with a of 0.5 and b of df / 2, gives the shares of the Student t law.
  // The share between -t and t keeps its digits at each df. The share above, from the swapped fraction, loses digits in proportion to df.
  it.each([1e6, 1e7, 1e8, 1e9])("gives the shares of the Student t law at df %s, against the Cornish-Fisher series", (df) => {
    for (const p of [0.5 + 1e-9, 0.5 + 1e-7, 0.6, 0.7]) {
      const square = tSeries(p, df) ** 2;
      expect(relative(betaShares(square / (df + square), df / (df + square), 0.5, df / 2).below, 2 * p - 1)).toBeLessThan(1e-13);
    }
    for (const p of [0.9, 0.975, 0.999, 1 - 1e-6, 1 - 1e-9]) {
      const square = tSeries(p, df) ** 2;
      expect(relative(betaShares(square / (df + square), df / (df + square), 0.5, df / 2).above, 2 * (1 - p))).toBeLessThan(1e-16 * df);
    }
  });
});

describe("the quantile of each continuous family", () => {
  for (const spec of CONTINUOUS) {
    it(`goes back to u through the cdf, and back to x through the quantile: ${JSON.stringify(spec)}`, () => {
      const d = distributionOf(spec, random("round-trip"));
      let worst = 0;
      for (const u of grid) {
        const x = d.quantile(u);
        expect(Math.abs(d.cdf(x) - u)).toBeLessThan(1e-12);
        worst = Math.max(worst, relative(d.quantile(d.cdf(x)), x));
      }
      expect(worst).toBeLessThanOrEqual(1e-9);
    });
  }
});

describe("the point of the family", () => {
  it("draws the parameters as sampler does, so the Pareto and Zipf quantiles of r.next() are the sampler draws", () => {
    for (const spec of [
      { family: "pareto", scale: [1, 3], shape: [1, 4] },
      { family: "zipf", n: 40, exponent: [0.5, 1.5] },
    ] as const satisfies readonly DistributionSpec[]) {
      const r = random("same-point");
      const d = distributionOf(spec, r);
      const next = sampler(spec, random("same-point"));
      for (let i = 0; i < 2000; i++) expect(d.quantile(r.next())).toBe(next());
    }
  });

  it("matches the sampler draws in distribution (the Kolmogorov distance)", () => {
    for (const spec of CONTINUOUS) {
      const n = 20_000;
      const next = sampler(spec, random("ks"));
      const d = distributionOf(spec, random("ks"));
      const xs = Array.from({ length: n }, () => next()).sort((a, b) => a - b);
      let distance = 0;
      xs.forEach((x, i) => {
        const f = d.cdf(x);
        distance = Math.max(distance, Math.abs(f - i / n), Math.abs(f - (i + 1) / n));
      });
      // The 0.001 critical value of the distance for 20 000 draws is 1.95 / sqrt(20 000) = 0.0138.
      expect(distance, JSON.stringify(spec)).toBeLessThan(0.0138);
    }
  });
});

describe("the discrete families", () => {
  it("gives the smallest value whose cdf is u or more", () => {
    const zipf = distributionOf({ family: "zipf", n: 4, exponent: 0 }, random(1));
    expect([0, 0.25, 0.2500001, 0.5, 0.99, 1].map((u) => zipf.quantile(u))).toEqual([1, 1, 2, 2, 4, 4]);
    expect(zipf.cdf(2.5)).toBe(0.5);
    expect(zipf.discrete).toBe(true);
    const recorded = distributionOf({ family: "recorded", values: [5, 1, 3, 3] }, random(1));
    expect([0, 0.25, 0.26, 0.75, 0.76, 1].map((u) => recorded.quantile(u))).toEqual([1, 1, 3, 3, 5, 5]);
    expect([0, 1, 3, 4, 5].map((x) => recorded.cdf(x))).toEqual([0, 0.25, 0.75, 0.75, 1]);
  });

  it("refuses u outside 0 to 1", () => {
    const d = distributionOf({ family: "beta", a: 2, b: 2 }, random(1));
    expect(() => d.quantile(-0.1)).toThrow(RangeError);
    expect(() => d.quantile(Number.NaN)).toThrow(RangeError);
  });
});
