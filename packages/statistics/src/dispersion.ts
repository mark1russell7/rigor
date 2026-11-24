/**
 * The dispersion test of counts: do the counts of some cells agree with one rate? An example is the events of each year.
 *
 * - The statistic is the Pearson sum `Σ (count - expected)² / expected`. The expected count of a cell is the total in
 *   proportion to the exposure of the cell.
 * - Given the total, the counts of one rate have a multinomial law with the shares of the exposures. The test draws counts
 *   from that law with seeded draws, and does not use the chi-square law of a large sample. Thus it holds for small counts.
 * - The p value is `(hits + 1) / (draws + 1)`, where `hits` is the count of the draws with a statistic at or above the
 *   statistic of the counts. It is more than 0, and it is an exact level of the test for each number of draws.
 */

import { random } from "@mark1russell7/rigor-generators";

/** The options of `dispersionTest`. */
export interface DispersionOptions {
  /** The exposure of each cell, each a finite number of more than 0, for example the days of each year. The default is 1 for each cell. */
  readonly exposures?: readonly number[] | undefined;
  /** The number of draws of the multinomial law, a whole number from 1. The default is 10000. */
  readonly draws?: number | undefined;
  /** The seed of the draws. The default is 1. */
  readonly seed?: number | string | undefined;
}

/** The result of `dispersionTest`. */
export interface DispersionTest {
  /** The Pearson statistic of the counts. */
  readonly statistic: number;
  /** The p value of one rate, from more than 0 to 1. */
  readonly p: number;
  /** The count of the draws with a statistic at or above the statistic of the counts. */
  readonly hits: number;
  /** The number of draws. It is 0 when the test needs no draw: a total of 0 or one cell. */
  readonly draws: number;
  /** The seed of the draws, as a 32-bit number. */
  readonly seed: number;
  /** The sum of the counts. */
  readonly total: number;
}

/** The relative tolerance of a tie of two statistics. Equal counts in another order give a sum with other rounding. */
const TIE = 1e-9;

/**
 * This function tests if the counts of the cells agree with one rate, given their total.
 *
 * @param counts - The count of each cell, each a whole number of 0 or more. There is one cell or more.
 * @param options - The exposures of the cells, the number of draws and the seed
 * @returns The statistic, the p value and the draws. Give `hits` and `draws` to `clopperPearson` for an interval of the p value.
 */
export function dispersionTest(counts: readonly number[], options: DispersionOptions = {}): DispersionTest {
  if (counts.length === 0) throw new RangeError("dispersionTest: there are no counts.");
  for (const count of counts) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`dispersionTest: each count is a whole number of 0 or more, not ${count}.`);
  }
  const exposures = options.exposures ?? counts.map(() => 1);
  if (exposures.length !== counts.length) throw new RangeError(`dispersionTest: there are ${exposures.length} exposures for ${counts.length} counts.`);
  for (const exposure of exposures) {
    if (!(Number.isFinite(exposure) && exposure > 0)) throw new RangeError(`dispersionTest: each exposure is a finite number of more than 0, not ${exposure}.`);
  }
  const draws = options.draws ?? 10_000;
  if (!Number.isSafeInteger(draws) || draws < 1) throw new RangeError(`dispersionTest: draws is a whole number from 1, not ${draws}.`);
  const r = random(options.seed ?? 1);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const weight = exposures.reduce((sum, exposure) => sum + exposure, 0);
  const shares = exposures.map((exposure) => exposure / weight);
  const expected = shares.map((share) => share * total);
  const pearson = (cells: readonly number[]): number => cells.reduce((sum, count, index) => sum + (count - (expected[index] as number)) ** 2 / (expected[index] as number), 0);
  if (total === 0 || counts.length === 1) return { statistic: 0, p: 1, hits: 0, draws: 0, seed: r.seed, total };
  const statistic = pearson(counts);
  const bar = statistic - TIE * Math.max(1, statistic);
  // The upper end of each share, for one uniform draw for each event.
  const ends: number[] = [];
  let sum = 0;
  for (const share of shares) ends.push((sum += share));
  const cells = new Array<number>(counts.length);
  let hits = 0;
  for (let draw = 0; draw < draws; draw++) {
    cells.fill(0);
    for (let event = 0; event < total; event++) {
      const u = r.next();
      let index = 0;
      while (index < ends.length - 1 && u >= (ends[index] as number)) index++;
      cells[index] = (cells[index] as number) + 1;
    }
    if (pearson(cells) >= bar) hits++;
  }
  return { statistic, p: (hits + 1) / (draws + 1), hits, draws, seed: r.seed, total };
}
