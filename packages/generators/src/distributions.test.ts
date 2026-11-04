import { describe, expect, it } from "vitest";
import { dependsOnLibm, sampler, type DistributionSpec } from "./distributions.ts";
import { random } from "./random.ts";

const N = 40_000;
const draws = (spec: DistributionSpec, seed: number | string = "fixed", n = N): number[] => {
  const next = sampler(spec, random(seed));
  return Array.from({ length: n }, () => next());
};
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const share = (xs: readonly number[], test: (x: number) => boolean): number => xs.filter(test).length / xs.length;

describe("the families", () => {
  it("gives the lognormal median and mean", () => {
    const xs = draws({ family: "lognormal", mu: 1, sigma: 0.5 });
    expect(median(xs)).toBeCloseTo(Math.exp(1), 1);
    expect(mean(xs) / Math.exp(1 + 0.125)).toBeCloseTo(1, 1);
    expect(Math.min(...xs)).toBeGreaterThan(0);
  });

  it("gives the Pareto scale as the lowest value, and its median", () => {
    const xs = draws({ family: "pareto", scale: 2, shape: 3 });
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(2);
    expect(median(xs)).toBeCloseTo(2 * 2 ** (1 / 3), 1);
  });

  it("gives the Zipf ranks with their ratio", () => {
    const xs = draws({ family: "zipf", n: 50, exponent: 1 });
    expect(xs.every((x) => Number.isInteger(x) && x >= 1 && x <= 50)).toBe(true);
    expect(share(xs, (x) => x === 1) / share(xs, (x) => x === 2)).toBeCloseTo(2, 0);
    expect(new Set(xs).size).toBe(50);
  });

  it("gives the uniform ranks with the exponent 0, and one rank with n 1", () => {
    expect(share(draws({ family: "zipf", n: 4, exponent: 0 }), (x) => x === 4)).toBeCloseTo(0.25, 1);
    expect(new Set(draws({ family: "zipf", n: 1, exponent: 2 }, "one", 50))).toEqual(new Set([1]));
  });

  it("gives the beta mean, above and below the shape 1", () => {
    for (const [a, b] of [[2, 5], [0.5, 0.5], [0.7, 3]] as const) {
      const xs = draws({ family: "beta", a, b }, `beta-${a}-${b}`);
      expect(mean(xs)).toBeCloseTo(a / (a + b), 1);
      expect(xs.every((x) => x >= 0 && x <= 1)).toBe(true);
    }
  });

  it("gives each part of a mixture by its weight", () => {
    const xs = draws({
      family: "mixture",
      parts: [
        { weight: 3, part: { family: "recorded", values: [1] } },
        { weight: 1, part: { family: "recorded", values: [2] } },
      ],
    });
    expect(share(xs, (x) => x === 1)).toBeCloseTo(0.75, 1);
  });

  it("gives only the recorded values, with their repeats", () => {
    const xs = draws({ family: "recorded", values: [10, 10, 10, 20] });
    expect(new Set(xs)).toEqual(new Set([10, 20]));
    expect(share(xs, (x) => x === 10)).toBeCloseTo(0.75, 1);
  });
});

describe("the parameters", () => {
  it("draws a range once, so one sampler is one point of the family", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 8; seed++) {
      const xs = draws({ family: "lognormal", mu: [1, 2], sigma: 0 }, seed, 5);
      expect(new Set(xs).size).toBe(1);
      expect(xs[0]!).toBeGreaterThanOrEqual(Math.exp(1));
      expect(xs[0]!).toBeLessThan(Math.exp(2));
      seen.add(xs[0]!);
    }
    expect(seen.size).toBe(8);
  });

  it("gives the same numbers for the same seed, and other numbers for another seed", () => {
    const spec: DistributionSpec = { family: "beta", a: [1, 3], b: 2 };
    expect(draws(spec, "a", 100)).toEqual(draws(spec, "a", 100));
    expect(draws(spec, "a", 100)).not.toEqual(draws(spec, "b", 100));
  });

  it.each<[string, DistributionSpec]>([
    ["sigma", { family: "lognormal", mu: 0, sigma: -1 }],
    ["mu", { family: "lognormal", mu: Number.NaN, sigma: 1 }],
    ["scale", { family: "pareto", scale: 0, shape: 1 }],
    ["shape", { family: "pareto", scale: 1, shape: [-1, 1] }],
    ["n", { family: "zipf", n: 0, exponent: 1 }],
    ["n", { family: "zipf", n: 1.5, exponent: 1 }],
    ["exponent", { family: "zipf", n: 3, exponent: -1 }],
    ["a", { family: "beta", a: 0, b: 1 }],
    ["b", { family: "beta", a: 1, b: Number.POSITIVE_INFINITY }],
    ["range", { family: "lognormal", mu: [2, 1], sigma: 1 }],
    ["parts", { family: "mixture", parts: [] }],
    ["weight", { family: "mixture", parts: [{ weight: 0, part: { family: "recorded", values: [1] } }] }],
    ["values", { family: "recorded", values: [] }],
    ["value", { family: "recorded", values: [Number.NaN] }],
  ])("refuses a bad %s", (_name, spec) => {
    expect(() => sampler(spec, random(1))).toThrow(RangeError);
  });
});

describe("dependsOnLibm", () => {
  it("tells which families use the functions of the platform", () => {
    const recorded: DistributionSpec = { family: "recorded", values: [1] };
    const zipf: DistributionSpec = { family: "zipf", n: 3, exponent: 1 };
    expect(dependsOnLibm(recorded)).toBe(false);
    expect(dependsOnLibm(zipf)).toBe(true);
    expect(dependsOnLibm({ family: "mixture", parts: [{ weight: 1, part: recorded }] })).toBe(false);
    expect(dependsOnLibm({ family: "mixture", parts: [{ weight: 1, part: recorded }, { weight: 1, part: zipf }] })).toBe(true);
  });
});
