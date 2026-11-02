/**
 * Ordinary least squares with a Householder QR decomposition. The QR decomposition does not square the condition
 * number of the design, as the normal equations do. A design without full rank gives NaN coefficients and does not
 * throw. Thus a bootstrap run with a singular draw is not finite, and it does not count.
 */

export interface LeastSquaresOptions {
  /** When true, the fit adds an intercept as coefficient 0. The default is true. */
  readonly intercept?: boolean;
}

export interface LeastSquaresFit {
  /** The coefficients. With an intercept, coefficient 0 is the intercept and coefficient `j + 1` is predictor `j`. */
  readonly coefficients: number[];
  /** The residual standard deviation: the square root of the residual sum of squares divided by `n - k`. */
  readonly residualSd: number;
  /**
   * The coefficient of determination: 1 minus the residual sum of squares divided by the total sum of squares. With
   * an intercept, the total sum uses the distances from the mean of `y`. Without an intercept, it uses the values.
   */
  readonly r2: number;
  /** The number of rows. */
  readonly n: number;
  /** The number of coefficients, with the intercept. */
  readonly k: number;
}

/**
 * The relative tolerance of the rank test. A column is dependent when the part of it that is orthogonal to the
 * columns before it is shorter than this share of its length.
 */
const RANK_TOLERANCE = 1e-10;

/**
 * The ordinary least-squares fit of `y` on the rows of `x`, with `k` coefficients. Each row has the same number of
 * predictors. The fit solves the problem with a Householder QR decomposition. When the design does not have full
 * rank, or when `n <= k`, the coefficients, `residualSd` and `r2` are NaN. When the total sum of squares is 0,
 * `r2` is NaN.
 *
 * This function throws a RangeError for an empty `x` and for rows of different lengths. It also throws
 * for `x` and `y` of different lengths, for a value that is not finite, and for a fit with no coefficient.
 */
export function leastSquares(x: readonly (readonly number[])[], y: readonly number[], options: LeastSquaresOptions = {}): LeastSquaresFit {
  const intercept = options.intercept ?? true;
  const k = checkedShape("leastSquares", x, y, intercept);
  return fitRows(x, y, intercept, k);
}

/**
 * This function examines the shape and the values of a least-squares problem, and gives the number of
 * coefficients. It throws a RangeError for each fault.
 */
export function checkedShape(name: string, x: readonly (readonly number[])[], y: readonly number[], intercept: boolean): number {
  if (x.length === 0) throw new RangeError(`${name}: x is empty.`);
  if (x.length !== y.length) throw new RangeError(`${name}: x has ${x.length} rows and y has ${y.length} values. The two lengths must be equal.`);
  const p = (x[0] as readonly number[]).length;
  for (let i = 0; i < x.length; i++) {
    const row = x[i] as readonly number[];
    if (row.length !== p) throw new RangeError(`${name}: row ${i} of x has ${row.length} values, and row 0 has ${p}. Each row must have the same length.`);
    for (const v of row) if (!Number.isFinite(v)) throw new RangeError(`${name}: row ${i} of x has a value that is not finite.`);
    if (!Number.isFinite(y[i] as number)) throw new RangeError(`${name}: value ${i} of y is not finite.`);
  }
  const k = p + (intercept ? 1 : 0);
  if (k === 0) throw new RangeError(`${name}: the fit has no coefficient. Give a predictor or an intercept.`);
  return k;
}

/**
 * The fit of rows with a known shape. The caller examined the shape with `checkedShape`. The design is a matrix of
 * `n` rows and `k` columns, kept by column.
 */
export function fitRows(x: readonly (readonly number[])[], y: readonly number[], intercept: boolean, k: number): LeastSquaresFit {
  const n = x.length;
  const failed = (): LeastSquaresFit => ({ coefficients: new Array<number>(k).fill(Number.NaN), residualSd: Number.NaN, r2: Number.NaN, n, k });
  if (n <= k) return failed();
  const offset = intercept ? 1 : 0;
  const a = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    const row = x[i] as readonly number[];
    if (intercept) a[i] = 1;
    for (let j = offset; j < k; j++) a[j * n + i] = row[j - offset] as number;
  }
  const qty = Float64Array.from(y);
  const diagonal = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    const c = j * n;
    // A reflection keeps the length of a column. Thus the length of column j is the length of its first form.
    let head = 0;
    for (let i = 0; i < j; i++) head += (a[c + i] as number) ** 2;
    let tail2 = 0;
    for (let i = j; i < n; i++) tail2 += (a[c + i] as number) ** 2;
    // The tail is the part of column j that is orthogonal to the columns before it.
    const tail = Math.sqrt(tail2);
    if (!(tail > RANK_TOLERANCE * Math.sqrt(head + tail2))) return failed();
    const alpha = (a[c + j] as number) > 0 ? -tail : tail;
    // The Householder vector v is the tail of column j minus alpha times the first unit vector. It is kept in place.
    a[c + j] = (a[c + j] as number) - alpha;
    let vv = 0;
    for (let i = j; i < n; i++) vv += (a[c + i] as number) ** 2;
    const reflect = (target: Float64Array, start: number): void => {
      let dot = 0;
      for (let i = j; i < n; i++) dot += (a[c + i] as number) * (target[start + i] as number);
      const f = (2 * dot) / vv;
      for (let i = j; i < n; i++) target[start + i] = (target[start + i] as number) - f * (a[c + i] as number);
    };
    for (let m = j + 1; m < k; m++) reflect(a, m * n);
    reflect(qty, 0);
    diagonal[j] = alpha;
  }
  // The back substitution of R b = Q'y. Above the diagonal, R is in the columns of a.
  const b = new Array<number>(k).fill(0);
  for (let j = k - 1; j >= 0; j--) {
    let s = qty[j] as number;
    for (let m = j + 1; m < k; m++) s -= (a[m * n + j] as number) * (b[m] as number);
    b[j] = s / (diagonal[j] as number);
  }
  let center = 0;
  if (intercept) {
    for (const v of y) center += v;
    center /= n;
  }
  let rss = 0;
  let tss = 0;
  for (let i = 0; i < n; i++) {
    const row = x[i] as readonly number[];
    let fitted = intercept ? (b[0] as number) : 0;
    for (let j = offset; j < k; j++) fitted += (b[j] as number) * (row[j - offset] as number);
    rss += ((y[i] as number) - fitted) ** 2;
    tss += ((y[i] as number) - center) ** 2;
  }
  return { coefficients: b, residualSd: Math.sqrt(rss / (n - k)), r2: tss > 0 ? 1 - rss / tss : Number.NaN, n, k };
}
