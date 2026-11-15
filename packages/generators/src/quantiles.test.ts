import { describe, expect, it } from "vitest";
import { sampler, type DistributionSpec } from "./distributions.ts";
import { betaCdf, distributionOf } from "./quantiles.ts";
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
