/** The agreement of two raters that give one category to each item. */
export interface Kappa {
  /** The number of items. */
  readonly n: number;
  /** The part of the items where the two raters give the same category. */
  readonly observed: number;
  /** The part of agreement that two independent raters with the same frequencies of categories give. */
  readonly chance: number;
  /** Cohen's kappa: `(observed − chance) / (1 − chance)`. It is `undefined` when `chance` is 1. */
  readonly kappa: number | undefined;
}

/**
 * Cohen's kappa of two raters (Cohen, 1960). Item `i` has the category `a[i]` from one rater and `b[i]` from the
 * other. Two categories are the same when they are `===`. A kappa of 1 is full agreement, and 0 is the agreement of chance.
 */
export function cohenKappa<T>(a: readonly T[], b: readonly T[]): Kappa {
  if (a.length !== b.length) throw new RangeError(`cohenKappa: the raters have ${a.length} and ${b.length} items.`);
  const n = a.length;
  if (n === 0) throw new RangeError("cohenKappa: there are no items.");
  const countA = new Map<T, number>();
  const countB = new Map<T, number>();
  let same = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] as T;
    const y = b[i] as T;
    if (x === y) same++;
    countA.set(x, (countA.get(x) ?? 0) + 1);
    countB.set(y, (countB.get(y) ?? 0) + 1);
  }
  let chance = 0;
  for (const [category, count] of countA) chance += (count / n) * ((countB.get(category) ?? 0) / n);
  const observed = same / n;
  return { n, observed, chance, kappa: chance === 1 ? undefined : (observed - chance) / (1 - chance) };
}
