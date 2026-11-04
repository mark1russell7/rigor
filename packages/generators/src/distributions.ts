// Open families of distributions for generated inputs. A family has parameters, and a parameter can be a range.
// A corpus names a point of a family, so a new size distribution does not need a new closed value.
import type { Random } from "./random.ts";

/** A parameter of a family: one value, or a range from `min` to `max` that `sampler` draws from once. */
export type Param = number | readonly [min: number, max: number];

/** A family of distributions and its parameters. */
export type DistributionSpec =
  | { readonly family: "lognormal"; readonly mu: Param; readonly sigma: Param }
  | { readonly family: "pareto"; readonly scale: Param; readonly shape: Param }
  | { readonly family: "zipf"; readonly n: number; readonly exponent: Param }
  | { readonly family: "beta"; readonly a: Param; readonly b: Param }
  | { readonly family: "mixture"; readonly parts: readonly { readonly weight: number; readonly part: DistributionSpec }[] }
  | { readonly family: "recorded"; readonly values: readonly number[] };

/** This function examines a parameter. Both ends of a range must pass `valid`. */
function checked(family: string, name: string, param: Param, valid: (value: number) => boolean, rule: string): void {
  const ends = typeof param === "number" ? [param] : param;
  for (const value of ends) {
    if (!Number.isFinite(value) || !valid(value)) throw new RangeError(`${family}: ${name} is ${value}, and it must be ${rule}.`);
  }
  if (typeof param !== "number" && param[0] > param[1]) throw new RangeError(`${family}: the range of ${name} starts above its end.`);
}

/** This function gives the value of a parameter: the number, or one draw from the range. */
function valueOf(param: Param, r: Random): number {
  return typeof param === "number" ? param : r.range(param[0], param[1]);
}

/** This function gives a gamma sample with the scale 1 (Marsaglia and Tsang, 2000). A shape below 1 uses the boost `U^(1/shape)`. */
function gamma(r: Random, shape: number): number {
  if (shape < 1) return gamma(r, shape + 1) * Math.pow(1 - r.next(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = r.normal();
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    if (Math.log(1 - r.next()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/** This function gives the sampler of the ranks from 1 to `n`, with a probability in proportion to `rank^-exponent`. */
function zipfSampler(n: number, exponent: number, r: Random): () => number {
  const totals: number[] = [];
  let total = 0;
  for (let rank = 1; rank <= n; rank++) {
    total += Math.pow(rank, -exponent);
    totals.push(total);
  }
  return () => {
    const at = r.next() * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (totals[mid]! > at) hi = mid;
      else lo = mid + 1;
    }
    return lo + 1;
  };
}

/**
 * This function gives a sampler of a family. It fixes each parameter once, so a range gives one point of the family.
 * Each call of the sampler gives one number. The same seed and the same spec give the same numbers on one platform.
 */
export function sampler(spec: DistributionSpec, r: Random): () => number {
  switch (spec.family) {
    case "lognormal": {
      checked("lognormal", "sigma", spec.sigma, (v) => v >= 0, "0 or more");
      checked("lognormal", "mu", spec.mu, () => true, "finite");
      const mu = valueOf(spec.mu, r);
      const sigma = valueOf(spec.sigma, r);
      return () => Math.exp(r.normal(mu, sigma));
    }
    case "pareto": {
      checked("pareto", "scale", spec.scale, (v) => v > 0, "above 0");
      checked("pareto", "shape", spec.shape, (v) => v > 0, "above 0");
      const scale = valueOf(spec.scale, r);
      const shape = valueOf(spec.shape, r);
      return () => scale / Math.pow(1 - r.next(), 1 / shape);
    }
    case "zipf": {
      if (!Number.isSafeInteger(spec.n) || spec.n < 1) throw new RangeError(`zipf: n is ${spec.n}, and it must be a whole number of 1 or more.`);
      checked("zipf", "exponent", spec.exponent, (v) => v >= 0, "0 or more");
      return zipfSampler(spec.n, valueOf(spec.exponent, r), r);
    }
    case "beta": {
      checked("beta", "a", spec.a, (v) => v > 0, "above 0");
      checked("beta", "b", spec.b, (v) => v > 0, "above 0");
      const a = valueOf(spec.a, r);
      const b = valueOf(spec.b, r);
      return () => {
        const x = gamma(r, a);
        return x / (x + gamma(r, b));
      };
    }
    case "mixture": {
      if (spec.parts.length === 0) throw new RangeError("mixture: the list of the parts is empty.");
      for (const { weight } of spec.parts) checked("mixture", "weight", weight, (v) => v > 0, "above 0");
      const parts = spec.parts.map(({ part }) => sampler(part, r));
      const weights = spec.parts.map(({ weight }) => weight);
      return () => parts[r.weighted(weights)]!();
    }
    case "recorded": {
      if (spec.values.length === 0) throw new RangeError("recorded: the list of the values is empty.");
      for (const value of spec.values) checked("recorded", "value", value, () => true, "finite");
      return () => r.pick(spec.values);
    }
  }
}

/**
 * This function tells if the numbers of a family use `Math.exp`, `Math.log` or `Math.pow`.
 * The result of those functions can change between JavaScript engines. Thus such a family has the same numbers only on one platform.
 */
export function dependsOnLibm(spec: DistributionSpec): boolean {
  if (spec.family === "recorded") return false;
  if (spec.family === "mixture") return spec.parts.some(({ part }) => dependsOnLibm(part));
  return true;
}
