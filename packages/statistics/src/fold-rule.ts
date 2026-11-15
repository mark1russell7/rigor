import type { ResponseRecord } from "./response.ts";

/**
 * The fold rule tells if a fitted model counts. The model counts when it beats the mean on each held-out fold,
 * and its mean skill is at the bar or above it. The skill of a fold is 1 minus the error of the model over the error of the mean.
 */

/** The default least count of folds. With 5 folds, a model with no skill beats the mean on each fold with a chance of 1/32. */
export const FOLD_RULE_MIN_FOLDS = 5;

/** The default least mean skill of a model that counts. */
export const FOLD_RULE_BAR = 0.05;

/** The options of `foldRule`. */
export interface FoldRuleOptions {
  /** The least count of folds. The default is `FOLD_RULE_MIN_FOLDS`. With fewer folds, the rule has no read. */
  readonly minFolds?: number;
  /** The least mean skill. The default is `FOLD_RULE_BAR`. */
  readonly bar?: number;
}

/** The verdict of the fold rule. `no read` is not a pass: the rule cannot read the model. */
export type FoldVerdictKind = "pass" | "fail" | "no read";

/** The result of `foldRule`. */
export interface FoldVerdict {
  readonly verdict: FoldVerdictKind;
  /** The count of folds. */
  readonly folds: number;
  /** The count of folds where the model beats the mean: a skill above 0. */
  readonly beaten: number;
  /** The mean skill of the folds. It is `null` with no fold. */
  readonly mean: number | null;
  /**
   * The chance that a model with no skill beats the mean on each fold: 1/2 to the power of the folds.
   * The sum of this value over many models gives the expected count of false passes.
   * The value is an approximation, because the folds share training points.
   */
  readonly chance: number;
  /** The reason of each rule that does not hold. A pass has no reasons. */
  readonly reasons: readonly string[];
}

/**
 * This function gives the held-out skill of each fold of a measure: `1 - mae / baselineMae`. A skill above 0 tells that
 * the model beats the mean of the training points on the fold. A fold with a baseline error of 0 gives 0, because no model beats it.
 * A fold with no error of the measure gives no skill.
 */
export function foldSkills(record: Pick<ResponseRecord, "folds">, measure: string): number[] {
  const out: number[] = [];
  for (const fold of record.folds) {
    if (!Object.hasOwn(fold.errors, measure)) continue;
    const error = fold.errors[measure]!;
    out.push(error.baselineMae > 0 ? 1 - error.mae / error.baselineMae : 0);
  }
  return out;
}

/**
 * This function applies the fold rule to the held-out skill of each fold. The verdict is:
 *
 * - `no read` with fewer than `minFolds` folds. A measure with no fold thus has no read, not an error.
 * - `pass` when the skill of each fold is above 0, and the mean skill is `bar` or more.
 * - `fail` in each other case.
 *
 * This function throws a `RangeError` for a skill that is not finite and for a `bar` that is not finite.
 * It also throws when `minFolds` is not a whole number of 1 or more.
 */
export function foldRule(skills: readonly number[], options: FoldRuleOptions = {}): FoldVerdict {
  const minFolds = options.minFolds ?? FOLD_RULE_MIN_FOLDS;
  const bar = options.bar ?? FOLD_RULE_BAR;
  if (!Number.isSafeInteger(minFolds) || minFolds < 1) throw new RangeError(`foldRule: minFolds is a whole number of 1 or more, not ${String(minFolds)}.`);
  if (typeof bar !== "number" || !Number.isFinite(bar)) throw new RangeError(`foldRule: bar is a finite number, not ${String(bar)}.`);
  const bad = skills.findIndex((skill) => typeof skill !== "number" || !Number.isFinite(skill));
  if (bad >= 0) throw new RangeError(`foldRule: the skill of fold ${bad} is a finite number, not ${String(skills[bad])}.`);
  const folds = skills.length;
  const chance = 0.5 ** folds;
  const beaten = skills.filter((skill) => skill > 0).length;
  if (folds < minFolds) {
    return { verdict: "no read", folds, beaten, mean: folds === 0 ? null : mean(skills), chance, reasons: [`The model has ${folds} folds, fewer than ${minFolds}.`] };
  }
  const reasons: string[] = [];
  const average = mean(skills);
  if (beaten < folds) reasons.push(`The model beats the mean on ${beaten} of ${folds} folds, not on each fold.`);
  if (!(average >= bar)) reasons.push(`The mean skill ${average} is under the bar ${bar}.`);
  return { verdict: reasons.length === 0 ? "pass" : "fail", folds, beaten, mean: average, chance, reasons };
}

/** This function gives the mean of a list that is not empty. */
function mean(values: readonly number[]): number {
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}
