// Input families and the designs that draw their points (R5). A design gives points of the unit cube. `familyMap`
// takes each point to a point of the family: a value from the range of each dimension.
import type { DistributionSpec } from "./distributions.ts";
import { distributionOf } from "./quantiles.ts";
import type { Random } from "./random.ts";

/** One dimension of an input family. */
export interface Dimension {
  /** The name of the dimension. It is a key of each point. */
  readonly name: string;
  /** The smallest value. */
  readonly min: number;
  /** The largest value. A uniform or log dimension that is not `integer` gets values below `max`. */
  readonly max: number;
  /** The distribution of the values, cut to the range. Without it, the values are uniform in the range. */
  readonly distribution?: DistributionSpec;
  /** With `log`, the logarithm of the value is uniform. `min` must be above 0. A dimension with a distribution has no scale. */
  readonly scale?: "linear" | "log";
  /** With `true`, each value is an integer. `min` and `max` must be integers. */
  readonly integer?: boolean;
}

/** An input family: its name and its dimensions. */
export interface InputFamily {
  readonly name: string;
  readonly dimensions: readonly Dimension[];
}

/** One point of a family: one value for each dimension, by name. */
export type Point = Readonly<Record<string, number>>;

/** The Saltelli design: the matrices `a` and `b`, and for each dimension `i` the matrix `ab[i]`. */
export interface SaltelliDesign {
  readonly a: number[][];
  readonly b: number[][];
  /** `ab[i]` is `a` with the column `i` of `b`. */
  readonly ab: number[][][];
}

const BELOW_ONE = 1 - Number.EPSILON / 2;

/** This function gives the next double toward minus infinity. */
function nextDown(x: number): number {
  if (x === 0) return -Number.MIN_VALUE;
  const f = new Float64Array([x]);
  const bits = new BigInt64Array(f.buffer);
  bits[0] = x > 0 ? bits[0]! - 1n : bits[0]! + 1n;
  return f[0]!;
}

/** This function gives the next double toward plus infinity. */
function nextUp(x: number): number {
  return -nextDown(-x);
}

/** This function keeps a value below 1. A sum of a stratum and a draw can round up to 1. */
function belowOne(x: number): number {
  return x < 1 ? x : BELOW_ONE;
}

function count(fn: string, name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${fn}: ${name} is ${value}, and it must be an integer from 1.`);
}

/** This function examines a dimension and gives the map from a uniform number in [0, 1) to a value of the dimension. */
function dimensionMap(family: string, dim: Dimension, r: Random): (u: number) => number {
  const where = `${family}.${dim.name}`;
  if (!Number.isFinite(dim.min) || !Number.isFinite(dim.max) || dim.min > dim.max) {
    throw new RangeError(`${where}: the range ${dim.min} to ${dim.max} is not a finite range.`);
  }
  if (dim.integer === true && (!Number.isSafeInteger(dim.min) || !Number.isSafeInteger(dim.max))) {
    throw new RangeError(`${where}: an integer dimension needs integer ends, not ${dim.min} and ${dim.max}.`);
  }
  // An integer dimension takes the floor of a value from [min, max + 1).
  const end = dim.integer === true ? dim.max + 1 : dim.max;
  const top = dim.integer === true ? nextDown(end) : end;
  const whole = (x: number): number => (dim.integer === true ? Math.min(dim.max, Math.floor(x)) : x);
  const clamp = (x: number): number => Math.min(top, Math.max(dim.min, x));
  if (dim.distribution !== undefined) {
    if (dim.scale !== undefined) throw new RangeError(`${where}: a dimension with a distribution has no scale.`);
    const d = distributionOf(dim.distribution, r);
    const low = d.cdf(nextDown(dim.min));
    const high = d.cdf(top);
    if (!(high > low)) throw new RangeError(`${where}: the distribution has no probability from ${dim.min} to ${dim.max}.`);
    // A discrete quantile at `low` can be a value below `min`. The smallest value above `low` is then the first value in the range.
    const first = d.quantile(nextUp(low));
    return (u) => {
      const x = d.quantile(low + u * (high - low));
      return whole(clamp(x < dim.min ? first : x));
    };
  }
  if (dim.scale === "log") {
    if (!(dim.min > 0)) throw new RangeError(`${where}: a log scale needs a minimum above 0, not ${dim.min}.`);
    // The form `min * exp(u * span)` gives `min` exactly at 0.
    const span = Math.log(end / dim.min);
    return (u) => whole(clamp(dim.min * Math.exp(u * span)));
  }
  return (u) => whole(clamp(dim.min + u * (end - dim.min)));
}

/**
 * This function gives the map from a point of the unit cube to a point of the family. Coordinate `i` gives the value of
 * dimension `i`. The parameters of each distribution come from `r.fork("dimension:" + name)` one time. Thus the
 * same seed gives the same map, and a new dimension does not change the others.
 */
export function familyMap(family: InputFamily, r: Random): (unit: readonly number[]) => Point {
  if (family.dimensions.length === 0) throw new RangeError(`${family.name}: a family needs one dimension or more.`);
  const names = family.dimensions.map((d) => d.name);
  const twice = names.find((n, i) => n === "" || names.indexOf(n) !== i);
  if (twice !== undefined) throw new RangeError(`${family.name}: the dimension name "${twice}" is empty or not unique.`);
  const maps = family.dimensions.map((d) => dimensionMap(family.name, d, r.fork(`dimension:${d.name}`)));
  return (unit) => {
    if (unit.length !== maps.length) throw new RangeError(`${family.name}: a point needs ${maps.length} coordinates, not ${unit.length}.`);
    const point: Record<string, number> = {};
    maps.forEach((map, i) => {
      const u = unit[i]!;
      if (!(u >= 0 && u < 1)) throw new RangeError(`${family.name}: coordinate ${i} is ${u}, and it must be from 0 to below 1.`);
      point[names[i]!] = map(u);
    });
    return point;
  };
}

/** This function gives the points of the family at the points of a unit design. */
export function familyPoints(family: InputFamily, unit: readonly (readonly number[])[], r: Random): Point[] {
  const map = familyMap(family, r);
  return unit.map(map);
}

/** This function gives `n` independent uniform points of the unit cube in `d` dimensions. The draws go row by row. */
export function randomDesign(n: number, d: number, r: Random): number[][] {
  count("randomDesign", "n", n);
  count("randomDesign", "d", d);
  return Array.from({ length: n }, () => Array.from({ length: d }, () => r.next()));
}

/**
 * This function gives a Latin hypercube of `n` points in `d` dimensions. Each column has exactly one point in each of
 * the `n` strata `[k/n, (k+1)/n)`. For each column, the draws are one shuffle of the strata, then one draw in each point.
 */
export function latinHypercube(n: number, d: number, r: Random): number[][] {
  count("latinHypercube", "n", n);
  count("latinHypercube", "d", d);
  const rows = Array.from({ length: n }, () => new Array<number>(d));
  const strata = Array.from({ length: n }, (_, k) => k);
  for (let j = 0; j < d; j++) {
    const order = r.shuffle(strata);
    for (let i = 0; i < n; i++) rows[i]![j] = belowOne((order[i]! + r.next()) / n);
  }
  return rows;
}

/**
 * This function gives a stratified grid: `strata` strata on each axis, so `strata^d` cells, and one uniform point in
 * each cell. The cells go in the order of their index in base `strata`, with the first dimension as the last digit.
 */
export function stratifiedDesign(strata: number, d: number, r: Random, limit = 1_000_000): number[][] {
  count("stratifiedDesign", "strata", strata);
  count("stratifiedDesign", "d", d);
  const n = strata ** d;
  if (n > limit) throw new RangeError(`stratifiedDesign: ${strata}^${d} = ${n} cells is above the limit ${limit}.`);
  return Array.from({ length: n }, (_, cell) => {
    let rest = cell;
    return Array.from({ length: d }, () => {
      const k = rest % strata;
      rest = Math.floor(rest / strata);
      return belowOne((k + r.next()) / strata);
    });
  });
}

/**
 * This function gives the Saltelli design for the Sobol indices of a model with `d` inputs: `a`, `b` and the `d`
 * matrices `ab`. The design has `n * (d + 2)` points for the model. `a` comes from `r.fork("A")`, and `b` comes
 * from `r.fork("B")`. With `base` `"latin"`, each is a Latin hypercube.
 */
export function saltelliDesign(n: number, d: number, r: Random, base: "random" | "latin" = "random"): SaltelliDesign {
  const make = base === "latin" ? latinHypercube : randomDesign;
  const a = make(n, d, r.fork("A"));
  const b = make(n, d, r.fork("B"));
  const ab = Array.from({ length: d }, (_, i) => a.map((row, k) => row.map((x, j) => (j === i ? b[k]![j]! : x))));
  return { a, b, ab };
}
