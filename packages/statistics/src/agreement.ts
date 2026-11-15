import { type Proportion, Z95, wilson } from "./tests.ts";

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

/** The confusion table of a classifier: the count of each pair of a true class and a predicted class. */
export interface Confusion<T> {
  /** The classes: the option `labels` first, then each other class in the order of its first item. */
  readonly labels: readonly T[];
  /** `counts[i][j]` is the number of items with the true class `labels[i]` and the predicted class `labels[j]`. */
  readonly counts: readonly (readonly number[])[];
  /** The number of items. */
  readonly n: number;
  /** The number of items where the predicted class is the true class. */
  readonly correct: number;
}

/**
 * The confusion table of a classifier. Item `i` has the true class `truth[i]` and the predicted class `predicted[i]`.
 * Two classes are the same when they are `===`. The option `labels` sets the first classes and their order, also
 * when no item has them. Thus each class of a catalog gets a row.
 */
export function confusion<T>(truth: readonly T[], predicted: readonly T[], labels: readonly T[] = []): Confusion<T> {
  if (truth.length !== predicted.length) {
    throw new RangeError(`confusion: the true list has ${truth.length} items and the predicted list has ${predicted.length}.`);
  }
  const index = new Map<T, number>();
  for (const label of labels) {
    if (index.has(label)) throw new RangeError(`confusion: the label ${String(label)} is in the labels two times.`);
    index.set(label, index.size);
  }
  for (const list of [truth, predicted]) for (const label of list) if (!index.has(label)) index.set(label, index.size);
  const size = index.size;
  const counts = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  let correct = 0;
  for (let i = 0; i < truth.length; i++) {
    const row = index.get(truth[i] as T) as number;
    const column = index.get(predicted[i] as T) as number;
    (counts[row] as number[])[column] = ((counts[row] as number[])[column] as number) + 1;
    if (row === column) correct++;
  }
  return { labels: [...index.keys()], counts, n: truth.length, correct };
}

/** The scores of one class of a confusion table. */
export interface ClassScore<T> {
  /** The class. */
  readonly label: T;
  /** The number of items with this true class. */
  readonly support: number;
  /** The number of items with this predicted class. */
  readonly predicted: number;
  /** The number of items with this true class and this predicted class. */
  readonly hits: number;
  /** The recall `hits / support`. It is `undefined` when `support` is 0. */
  readonly recall: number | undefined;
  /** The Wilson interval of the recall. It is 0 to 1 when `support` is 0. */
  readonly recallInterval: Proportion;
  /** The precision `hits / predicted`. It is `undefined` when `predicted` is 0. */
  readonly precision: number | undefined;
  /** The harmonic mean of the precision and the recall. It is `undefined` when one of them is `undefined`. */
  readonly f1: number | undefined;
}

/**
 * The scores of each class of a confusion table, in the order of its labels. The recall of a class is its hit rate,
 * and `recallInterval` is its Wilson interval at `z`. A gate on the lower end of each class holds the worst class.
 */
export function classScores<T>(table: Confusion<T>, z: number = Z95): ClassScore<T>[] {
  return table.labels.map((label, i) => {
    const row = table.counts[i] as readonly number[];
    const hits = row[i] as number;
    const support = row.reduce((total, count) => total + count, 0);
    const predicted = table.counts.reduce((total, other) => total + (other[i] as number), 0);
    const recall = support === 0 ? undefined : hits / support;
    const precision = predicted === 0 ? undefined : hits / predicted;
    const f1 =
      recall === undefined || precision === undefined ? undefined : hits === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { label, support, predicted, hits, recall, recallInterval: wilson(hits, support, z), precision, f1 };
  });
}
