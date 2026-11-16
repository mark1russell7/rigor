/**
 * The Pearson correlation: do two measures rise and fall together on a straight line? `spearman` and
 * `correlationPermutation` use the same formula, so the three functions give the same value to the bit.
 */

/** The parts of a correlation that stay the same when the second list changes its order. */
export interface CorrelationParts {
  /** The first list, scaled and minus its mean. */
  readonly x: readonly number[];
  /** The second list, scaled and minus its mean. */
  readonly y: readonly number[];
  /** The square root of the product of the two sums of squares. It is 0 when a list has no spread. */
  readonly spread: number;
}

/**
 * This function gives the values times a power of 2, so that the largest absolute value is near 1. A product with a
 * power of 2 has no rounding, so the correlation does not change, but its sums do not overflow or underflow.
 */
function scaled(values: readonly number[]): number[] {
  let largest = 0;
  for (const v of values) largest = Math.max(largest, Math.abs(v));
  if (largest === 0) return [...values];
  // A clamp keeps the factor finite for a subnormal largest value.
  const exponent = Math.min(1000, Math.max(-1000, Math.floor(Math.log2(largest))));
  const factor = 2 ** -exponent;
  return values.map((v) => v * factor);
}

/** This function gives each value minus the mean of the values. */
function centered(values: readonly number[]): number[] {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.map((v) => v - mean);
}

/** This function gives the sum of the products of the two lists, item by item. */
function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] as number) * (b[i] as number);
  return sum;
}

/** This function checks that the lists have the same length and only finite numbers. */
export function finitePairs(name: string, a: readonly number[], b: readonly number[]): void {
  if (a.length !== b.length) throw new RangeError(`${name}: the lists have ${a.length} and ${b.length} values.`);
  for (const [i, v] of a.entries()) if (!Number.isFinite(v)) throw new RangeError(`${name}: the value ${i} of the first list is ${v}, not a finite number.`);
  for (const [i, v] of b.entries()) if (!Number.isFinite(v)) throw new RangeError(`${name}: the value ${i} of the second list is ${v}, not a finite number.`);
}

/** This function gives the parts of the correlation of two lists of the same length. It does not examine the values. */
export function correlationParts(a: readonly number[], b: readonly number[]): CorrelationParts {
  const x = centered(scaled(a));
  const y = centered(scaled(b));
  return { x, y, spread: Math.sqrt(dot(x, x) * dot(y, y)) };
}

/**
 * This function gives the correlation of `x` and a list `y` in any order, from the parts of the two lists. A clamp
 * keeps a rounding error from a value above 1 or below -1.
 */
export function correlationOf(x: readonly number[], y: readonly number[], spread: number): number {
  return spread === 0 ? 0 : Math.max(-1, Math.min(1, dot(x, y) / spread));
}

/**
 * The Pearson correlation of two lists: the covariance over the product of the standard deviations. The value is
 * from -1 to 1. When one list has no spread, the value is 0. Each value is a finite number.
 */
export function pearson(a: readonly number[], b: readonly number[]): number {
  finitePairs("pearson", a, b);
  const { x, y, spread } = correlationParts(a, b);
  return correlationOf(x, y, spread);
}
