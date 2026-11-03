/**
 * The ridge solve of a least-squares problem from its normal equations. The caller gives the matrix `X'X` and the
 * vector `X'y`. Thus it can make them from sparse rows. It can also remove the sums of one fold of a cross-validation.
 * The solve uses a Cholesky factorization of `X'X + lambda * P`. The matrix `P` is the identity, with 0 on the
 * diagonal for each free coefficient, for example an intercept.
 */

export interface RidgeOptions {
  /** The indexes of the coefficients with no penalty, for example 0 for an intercept. The default is none. */
  readonly free?: readonly number[];
}

/**
 * The relative tolerance of the Cholesky pivots. A pivot is the squared length of the part of a column that is
 * orthogonal to the columns before it. The rounding error of a pivot is approximately 1e-16 times its diagonal value.
 * Thus a pivot of a dependent column is not exactly 0, and the tolerance is larger than that error.
 */
const PIVOT_TOLERANCE = 1e-12;

/**
 * This function gives the coefficients `beta` that solve `(gram + lambda * P) beta = moment`.
 * - `gram` is the symmetric matrix `X'X` of size `k`, in row order. The function reads only its lower triangle.
 * - `moment` is the vector `X'y` of length `k`.
 * - With `lambda` 0, the result is the ordinary least-squares fit.
 *
 * The function does not change `gram` or `moment`. When the matrix is not positive definite, each coefficient is
 * NaN, as in `leastSquares`. The function throws a RangeError when `gram` does not have `k * k` values, and when
 * `k` is 0. It also throws for a value that is not finite, for a `lambda` below 0, and for a bad free index.
 */
export function ridgeSolve(gram: ArrayLike<number>, moment: ArrayLike<number>, lambda: number, options: RidgeOptions = {}): number[] {
  const k = moment.length;
  if (k === 0) throw new RangeError("ridgeSolve: the moment is empty.");
  if (gram.length !== k * k) throw new RangeError(`ridgeSolve: the gram has ${gram.length} values, and a moment of length ${k} needs ${k * k}.`);
  if (!(lambda >= 0 && Number.isFinite(lambda))) throw new RangeError(`ridgeSolve: lambda is a finite number of 0 or more, not ${lambda}.`);
  const penalty = new Float64Array(k).fill(lambda);
  for (const i of options.free ?? []) {
    if (!Number.isSafeInteger(i) || i < 0 || i >= k) throw new RangeError(`ridgeSolve: a free index is a whole number from 0 to ${k - 1}, not ${i}.`);
    penalty[i] = 0;
  }
  const a = new Float64Array(k * k);
  for (let i = 0; i < k * k; i++) {
    const v = gram[i] as number;
    if (!Number.isFinite(v)) throw new RangeError(`ridgeSolve: the gram value ${i} is not finite.`);
    a[i] = v;
  }
  const x = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const v = moment[i] as number;
    if (!Number.isFinite(v)) throw new RangeError(`ridgeSolve: the moment value ${i} is not finite.`);
    x[i] = v;
    a[i * k + i] = (a[i * k + i] as number) + (penalty[i] as number);
  }
  if (!factor(a, k)) return new Array<number>(k).fill(Number.NaN);
  for (let i = 0; i < k; i++) {
    let s = x[i] as number;
    for (let j = 0; j < i; j++) s -= (a[i * k + j] as number) * (x[j] as number);
    x[i] = s / (a[i * k + i] as number);
  }
  for (let i = k - 1; i >= 0; i--) {
    let s = x[i] as number;
    for (let j = i + 1; j < k; j++) s -= (a[j * k + i] as number) * (x[j] as number);
    x[i] = s / (a[i * k + i] as number);
  }
  return Array.from(x);
}

/**
 * This function writes the Cholesky factor `L` of `a` into its lower triangle, with `a = L L'`. It returns false when
 * a pivot is not more than the tolerance times the diagonal value of its column.
 */
function factor(a: Float64Array, k: number): boolean {
  for (let j = 0; j < k; j++) {
    const diagonal = a[j * k + j] as number;
    let d = diagonal;
    for (let m = 0; m < j; m++) d -= (a[j * k + m] as number) ** 2;
    if (!(d > PIVOT_TOLERANCE * Math.abs(diagonal)) || !(d > 0)) return false;
    const l = Math.sqrt(d);
    a[j * k + j] = l;
    for (let i = j + 1; i < k; i++) {
      let s = a[i * k + j] as number;
      for (let m = 0; m < j; m++) s -= (a[i * k + m] as number) * (a[j * k + m] as number);
      a[i * k + j] = s / l;
    }
  }
  return true;
}
