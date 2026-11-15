/**
 * Arbitraries for property tests on `fast-check`. The entry imports `fast-check`, an optional peer dependency.
 *
 * `fc.double({ min, max })` draws uniformly over the floats of the range, not over its values. The floats are dense
 * near 0, so with a seed of 7, only 6.6 % of the values of `fc.double({ min: -1, max: 1 })` have a size above 0.2.
 * A property over a range then tests almost only the values near 0. `uniformDouble` draws uniformly by value.
 */
import fc from "fast-check";

/** The largest whole number of a draw. A value is `min + (max - min) * k / SPAN` for a whole number `k`. */
const SPAN = Number.MAX_SAFE_INTEGER;

/** The options of `uniformDouble`. */
export interface UniformDoubleOptions {
  /** The smallest value. It is a finite number. */
  readonly min: number;
  /** The largest value. It is a finite number of `min` or more. */
  readonly max: number;
}

/**
 * This function gives an arbitrary of numbers from `min` to `max`, uniform by value. Use it in place of `fc.double({ min, max })`.
 * - It maps a whole number from 0 to 2^53 - 1 into the range, so the steps between values are `(max - min) / (2^53 - 1)`.
 * - `fast-check` draws more whole numbers near the ends. Thus approximately 1 draw in 8 is near `min`, and 1 draw in 16 is near `max`.
 * - These draws test the edges of the range. The other draws are uniform.
 * - A counterexample shrinks toward `min`. Each value is in the range, also `min` and `max`.
 * - The function refuses a bound that is not finite, and a `max` below `min`.
 */
export function uniformDouble(options: UniformDoubleOptions): fc.Arbitrary<number> {
  const { min, max } = options;
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new RangeError(`uniformDouble: min and max are finite numbers, not ${min} and ${max}.`);
  if (max < min) throw new RangeError(`uniformDouble: max is min or more, not ${max} below ${min}.`);
  const width = max - min;
  // A range wider than the largest double, for example -MAX_VALUE to MAX_VALUE, takes each bound by its own weight.
  const at = Number.isFinite(width) ? (t: number) => min + width * t : (t: number) => min * (1 - t) + max * t;
  return fc.maxSafeNat().map((k) => Math.min(max, Math.max(min, at(k / SPAN))));
}
