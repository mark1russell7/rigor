/**
 * The two-level gamma-Poisson fit of the rates of units in groups, and a holdout of rates by the thinning of the counts.
 *
 * - The two-level fit gives each group its own gamma law of the rates of its units (`fitGammaRates`). A unit gets its pooled rate toward the law of its group.
 *   A group with no event has no law of its own. It gets the shape `Infinity` and its pooled mean toward the law of the groups.
 * - The thinning holdout splits each count into two halves. Each event goes to the fit half or to the score half with a chance that the caller gives.
 *   Each half of a Poisson count is then an independent Poisson count with a part of the rate. A method fits its rates on the fit half, and the score half scores them.
 */

import { fitGammaRates, gammaPoissonLogLikelihood, pooledRate, type GammaRates, type GammaRatesOptions, type RateUnit } from "./gamma-rates.ts";

/** One unit of a two-level fit: a count in an exposure, and the code of its group. */
export interface GroupedRateUnit extends RateUnit {
  /** The code of the group of the unit, for example the code of a state for a county. */
  readonly group: string;
}

/** The gamma law of the rates of the units of one group, with the count of its units and of their events. */
export interface GroupLaw extends GammaRates {
  /** The count of the units of the group. */
  readonly units: number;
  /** The sum of the counts of the units of the group. */
  readonly count: number;
  /** `group` for a law of the fit of the group. `groups` for a group with no event: its mean is its pooled rate toward the law of the groups. */
  readonly from: "group" | "groups";
}

/** The result of `fitTwoLevelGammaRates`. */
export interface TwoLevelRates {
  /** The law of the groups as units: the count of each group in the sum of the exposures of its units. */
  readonly groups: GammaRates;
  /** The law of each group, by the code of the group in its order. */
  readonly laws: Readonly<Record<string, GroupLaw>>;
  /** The pooled rate of each unit, in the order of the units. */
  readonly rates: readonly number[];
}

/**
 * This function gives the two-level gamma-Poisson fit of the rates of units in groups.
 *
 * - The fit of each group with one event or more is the gamma law of the counts of its units (`fitGammaRates`).
 * - The law of the groups is the fit of the groups as units. A group is the sum of the counts of its units in the sum of their exposures.
 * - A group with no event gets the shape `Infinity` and the mean of its pooled rate toward the law of the groups (`pooledRate`). Thus its units get a rate of more than 0 when another group has an event.
 * - The rate of each unit is its pooled rate toward the law of its group. With no event in any group, each rate is 0.
 * - The order of the units changes only the order of the rates and the rounding.
 *
 * @param units - The units, each with a count, an exposure and the code of its group
 * @param options - The range of the search of each shape, as in `fitGammaRates`
 * @throws RangeError when the list is empty, or a unit has a bad count, exposure or group
 */
export function fitTwoLevelGammaRates(units: readonly GroupedRateUnit[], options: GammaRatesOptions = {}): TwoLevelRates {
  if (units.length === 0) throw new RangeError("fitTwoLevelGammaRates: the list of units is empty.");
  const members = new Map<string, GroupedRateUnit[]>();
  for (const unit of units) {
    if (typeof unit.group !== "string") throw new RangeError(`fitTwoLevelGammaRates: a group is ${String(unit.group)}. It is a string.`);
    if (!Number.isInteger(unit.count) || unit.count < 0) throw new RangeError(`fitTwoLevelGammaRates: a count is ${unit.count}. It is a whole number of 0 or more.`);
    if (!Number.isFinite(unit.exposure) || unit.exposure <= 0) throw new RangeError(`fitTwoLevelGammaRates: an exposure is ${unit.exposure}. It is a finite number of more than 0.`);
    const list = members.get(unit.group) ?? [];
    list.push(unit);
    members.set(unit.group, list);
  }
  const codes = [...members.keys()].sort();
  const totals = codes.map((code) =>
    (members.get(code) ?? []).reduce((sum, unit) => ({ count: sum.count + unit.count, exposure: sum.exposure + unit.exposure }), { count: 0, exposure: 0 }),
  );
  const groups = fitGammaRates(totals, options);
  const laws: Record<string, GroupLaw> = {};
  codes.forEach((code, position) => {
    const list = members.get(code) ?? [];
    const total = totals[position] as RateUnit;
    const law = total.count > 0 ? fitGammaRates(list, options) : { shape: Number.POSITIVE_INFINITY, mean: pooledRate(total, groups) };
    laws[code] = { shape: law.shape, mean: law.mean, units: list.length, count: total.count, from: total.count > 0 ? "group" : "groups" };
  });
  const rates = units.map((unit) => pooledRate(unit, laws[unit.group] as GroupLaw));
  return { groups, laws, rates };
}

/**
 * This function splits the count of each unit into two halves: each event goes to the fit half when `draw` gives `true`.
 * Each half keeps the other fields of its unit, also the exposure. The draws go in the order of the units, and then in the order of the events.
 *
 * @param units - The units
 * @param draw - This function gives `true` for an event of the fit half, for example `() => random(seed).chance(0.5)` with one stream
 */
export function thinUnits<U extends RateUnit>(units: readonly U[], draw: () => boolean): readonly [U[], U[]] {
  const fit: U[] = [];
  const score: U[] = [];
  for (const unit of units) {
    if (!Number.isInteger(unit.count) || unit.count < 0) throw new RangeError(`thinUnits: a count is ${unit.count}. It is a whole number of 0 or more.`);
    let kept = 0;
    for (let k = 0; k < unit.count; k++) if (draw()) kept += 1;
    fit.push({ ...unit, count: kept });
    score.push({ ...unit, count: unit.count - kept });
  }
  return [fit, score];
}

/** The scores of one method in a thinning holdout. Each score is a sum over the units, and the mean over the splits. */
export interface ThinningScore {
  /** The Poisson log-likelihood of the counts of the score half, with the rate of each unit times its exposure. */
  readonly logLikelihood: number;
  /** The sum of the squared errors of the counts of the score half: `(count - rate * exposure)^2`. */
  readonly squared: number;
  /** The Poisson log-likelihood of the units with one event or more in the fit half. A raw rate of these units is above 0, so this score is finite for it. */
  readonly seen: number;
  /** The count of the units with the rate 0 and one event or more in the score half. Each such unit gives a log-likelihood of `-Infinity`. */
  readonly lost: number;
}

/** The result of `thinningHoldout`. */
export interface ThinningHoldout {
  /** The number of splits. */
  readonly rounds: number;
  /** The mean count of the units with one event or more in the fit half. */
  readonly seenUnits: number;
  /** The scores of each method, by its name. */
  readonly methods: Readonly<Record<string, ThinningScore>>;
}

/** The options of `thinningHoldout`. */
export interface ThinningHoldoutOptions {
  /** This function gives `true` for an event of the fit half. A seeded stream makes the holdout repeatable. */
  readonly draw: () => boolean;
  /** The number of splits. Each score is the mean over the splits. The default is 5. */
  readonly rounds?: number | undefined;
}

/**
 * This function gives a holdout of some methods of rates by the thinning of the counts (`thinUnits`).
 *
 * - Each split puts each event in the fit half or in the score half. Each method gives a rate for each unit from the fit half.
 * - The score half scores the rates. The expected count of a unit in the score half is its rate times its exposure. Thus the methods compare on one scale.
 * - It is for a record with only the total count of each unit, when a holdout of the later times is not possible.
 * - With the chance 1/2, a method that fits on the fit half has half of the events. Thus the holdout tests more shrinkage than a fit on all events has.
 *
 * @param units - The units
 * @param methods - The methods by their names. Each method gives a rate of 0 or more for each unit of the fit half, in the order of the units.
 * @param options - The draw of each event and the number of splits
 * @throws RangeError when the list is empty or the number of splits is not a whole number from 1
 * @throws RangeError when a method gives a bad rate, or a list with a different length
 */
export function thinningHoldout<U extends RateUnit>(
  units: readonly U[],
  methods: Readonly<Record<string, (fit: readonly U[]) => readonly number[]>>,
  options: ThinningHoldoutOptions,
): ThinningHoldout {
  const rounds = options.rounds ?? 5;
  if (units.length === 0) throw new RangeError("thinningHoldout: the list of units is empty.");
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError(`thinningHoldout: rounds is ${rounds}. It is a whole number from 1.`);
  const names = Object.keys(methods).sort();
  const sums = Object.fromEntries(names.map((name) => [name, { logLikelihood: 0, squared: 0, seen: 0, lost: 0 }]));
  let seenUnits = 0;
  for (let round = 0; round < rounds; round++) {
    const [fit, score] = thinUnits(units, options.draw);
    seenUnits += fit.filter((unit) => unit.count > 0).length;
    for (const name of names) {
      const rates = (methods[name] as (fit: readonly U[]) => readonly number[])(fit);
      if (rates.length !== units.length) throw new RangeError(`thinningHoldout: the method "${name}" gives ${rates.length} rates for ${units.length} units.`);
      const sum = sums[name] as { logLikelihood: number; squared: number; seen: number; lost: number };
      score.forEach((unit, index) => {
        const rate = rates[index] as number;
        if (!Number.isFinite(rate) || rate < 0) throw new RangeError(`thinningHoldout: the method "${name}" gives the rate ${rate}. It is a finite number of 0 or more.`);
        const value = gammaPoissonLogLikelihood([{ count: unit.count, exposure: unit.exposure }], Number.POSITIVE_INFINITY, rate);
        sum.logLikelihood += value;
        sum.squared += (unit.count - rate * unit.exposure) ** 2;
        if ((fit[index] as U).count > 0) sum.seen += value;
        if (rate === 0 && unit.count > 0) sum.lost += 1;
      });
    }
  }
  const mean = (value: number): number => value / rounds;
  const scores: Record<string, ThinningScore> = {};
  for (const name of names) {
    const sum = sums[name] as { logLikelihood: number; squared: number; seen: number; lost: number };
    scores[name] = { logLikelihood: mean(sum.logLikelihood), squared: mean(sum.squared), seen: mean(sum.seen), lost: mean(sum.lost) };
  }
  return { rounds, seenUnits: mean(seenUnits), methods: scores };
}
