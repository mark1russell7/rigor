/**
 * The dispersion test of counts: do the counts of some cells agree with one rate? An example is the events of each year.
 *
 * - The statistic is the Pearson sum `Σ (count - expected)² / expected`. The expected count of a cell is the total in
 *   proportion to the exposure of the cell.
 * - Given the total, the counts of one rate have a multinomial law with the shares of the exposures. The test draws counts
 *   from that law with seeded draws, and does not use the chi-square law of a large sample. Thus it holds for small counts.
 * - The p value is `(hits + 1) / (draws + 1)`, where `hits` is the count of the draws with a statistic at or above the
 *   statistic of the counts. It is more than 0, and it is an exact level of the test for each number of draws.
 * - The test has one side: it finds more spread than one rate gives. Counts that are too even give a p value near 1.
 * - The work is `draws` times the total: one uniform draw for each event of each draw. The scan of the cells is small next to it.
 *   Each uniform draw takes approximately 20 ns, so a total of 66 with 100000 draws takes approximately 0.1 s.
 *   An input of more than `maxWork` uniform draws throws a `RangeError` before the work starts.
 * - The method `exact` gives the p with no draws and no seed, for equal exposures. It sums the chances over the partitions of the total
 *   into the cells. A total of 66 in 12 cells has fewer than 2^20 partitions. The method `auto` uses it when it can.
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
  /** The most uniform draws: `draws` times the total, a whole number of 1 or more. The default is `DISPERSION_MAX_WORK`. */
  readonly maxWork?: number | undefined;
  /**
   * The method of the p value. The default is `draws`. Since 0.2.26.
   * - `draws`: the seeded draws of the multinomial law.
   * - `exact`: the sum of the chances over the partitions of the total. It needs equal exposures and `maxPartitions` partitions or fewer. Otherwise it throws a `RangeError`.
   * - `auto`: `exact` when it can, and `draws` otherwise.
   */
  readonly method?: "draws" | "exact" | "auto" | undefined;
  /** The most partitions of the total for the method `exact` or `auto`, a whole number of 1 or more. The default is `DISPERSION_MAX_PARTITIONS`. Since 0.2.26. */
  readonly maxPartitions?: number | undefined;
}

/** The default most uniform draws of `dispersionTest`: 2^26, approximately 1.2 s. A caller with a larger input gives fewer draws or a higher `maxWork`. */
export const DISPERSION_MAX_WORK: number = 2 ** 26;

/** The result of `dispersionTest`. */
export interface DispersionTest {
  /** The Pearson statistic of the counts. */
  readonly statistic: number;
  /** The p value of one rate, from more than 0 to 1. */
  readonly p: number;
  /** The count of the draws with a statistic at or above the statistic of the counts. */
  readonly hits: number;
  /** The number of draws. It is 0 when the test needs no draw: a total of 0, one cell, or an exact p. */
  readonly draws: number;
  /** The seed of the draws, as a 32-bit number. */
  readonly seed: number;
  /** The sum of the counts. */
  readonly total: number;
  /** This field is true when the p value is exact: no draws were used. Since 0.2.26. */
  readonly exact: boolean;
}

/** The relative tolerance of a tie of two statistics. Equal counts in another order give a sum with other rounding. */
const TIE = 1e-9;

/** The default most partitions of `dispersionTest` with the method `exact` or `auto`: 2^22. A total of 66 in 12 cells has fewer than 2^20. */
export const DISPERSION_MAX_PARTITIONS: number = 2 ** 22;

/** This function gives the count of the partitions of `total` into `cells` parts or fewer. A count over `cap` gives `cap + 1`. */
function partitionCount(total: number, cells: number, cap: number): number {
  // The partitions into `cells` parts or fewer are the partitions with each part `cells` or less (the conjugate partitions).
  const ways = new Array<number>(total + 1).fill(0);
  ways[0] = 1;
  for (let part = 1; part <= Math.min(cells, total); part++) {
    for (let sum = part; sum <= total; sum++) ways[sum] = Math.min(cap + 1, (ways[sum] as number) + (ways[sum - part] as number));
  }
  return ways[total] as number;
}

/**
 * This function gives the exact p of the Pearson statistic for equal shares. It is the sum of the chances of the counts with a statistic of `bar` or more.
 * - With equal shares, the statistic and the chance of the counts do not change when the counts change places. So the sum goes over the partitions of the total into `cells` parts or fewer.
 * - The chance of one partition is `total! / Π λ! · cells! / Π m! / cells^total`. Here `m` is the count of the cells with each value. The chance is in logs, so a large total does not overflow.
 * - The sum of the chances of all the partitions is 1. The function divides by that sum, so the rounding of the chances does not move the p.
 */
function exactP(total: number, cells: number, bar: number): number {
  const logFactorial = [0];
  for (let i = 1; i <= Math.max(total, cells); i++) logFactorial.push((logFactorial[i - 1] as number) + Math.log(i));
  const expected = total / cells;
  const base = (logFactorial[total] as number) + (logFactorial[cells] as number) - total * Math.log(cells);
  let hit = 0;
  let all = 0;
  // The parts go down. `cell` is the place of the next part, `left` the events that are not in a part, and `most` the largest next part.
  // `run` is the count of the parts before with the value `last`. `square` is the sum of (part - expected)² over the parts. `logOf` is Σ log λ! + Σ log m!.
  const place = (cell: number, left: number, most: number, last: number, run: number, square: number, logOf: number): void => {
    if (left === 0) {
      const zeros = cells - cell;
      const chance = Math.exp(base - logOf - (logFactorial[zeros] as number));
      all += chance;
      if ((square + zeros * expected * expected) / expected >= bar) hit += chance;
      return;
    }
    if (cell === cells) return;
    for (let part = Math.min(most, left); part >= 1; part--) {
      // A part with the value of the part before makes the run longer: m! grows by the factor m.
      const nextRun = part === last ? run + 1 : 1;
      place(cell + 1, left - part, part, part, nextRun, square + (part - expected) ** 2, logOf + (logFactorial[part] as number) + Math.log(nextRun));
    }
  };
  place(0, total, total, 0, 0, 0, 0);
  return Math.min(1, hit / all);
}

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
  const maxWork = options.maxWork ?? DISPERSION_MAX_WORK;
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new RangeError(`dispersionTest: maxWork is a whole number of 1 or more, not ${maxWork}.`);
  const method = options.method ?? "draws";
  if (method !== "draws" && method !== "exact" && method !== "auto") throw new RangeError(`dispersionTest: the method is draws, exact or auto, not ${String(method)}.`);
  const maxPartitions = options.maxPartitions ?? DISPERSION_MAX_PARTITIONS;
  if (!Number.isSafeInteger(maxPartitions) || maxPartitions < 1) throw new RangeError(`dispersionTest: maxPartitions is a whole number of 1 or more, not ${maxPartitions}.`);
  const r = random(options.seed ?? 1);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const weight = exposures.reduce((sum, exposure) => sum + exposure, 0);
  const shares = exposures.map((exposure) => exposure / weight);
  const expected = shares.map((share) => share * total);
  const pearson = (cells: readonly number[]): number => cells.reduce((sum, count, index) => sum + (count - (expected[index] as number)) ** 2 / (expected[index] as number), 0);
  if (total === 0 || counts.length === 1) return { statistic: 0, p: 1, hits: 0, draws: 0, seed: r.seed, total, exact: true };
  if (method !== "draws") {
    const equal = exposures.every((exposure) => exposure === exposures[0]);
    const partitions = equal ? partitionCount(total, counts.length, maxPartitions) : 0;
    if (equal && partitions <= maxPartitions) {
      const statistic = pearson(counts);
      return { statistic, p: exactP(total, counts.length, statistic - TIE * Math.max(1, statistic)), hits: 0, draws: 0, seed: r.seed, total, exact: true };
    }
    if (method === "exact") {
      throw new RangeError(equal ? `dispersionTest: ${total} events in ${counts.length} cells have more than maxPartitions ${maxPartitions} partitions. Give a higher maxPartitions, or the method auto or draws.` : "dispersionTest: the method exact needs equal exposures. Give the method auto or draws.");
    }
  }
  const work = draws * total;
  if (work > maxWork) {
    throw new RangeError(`dispersionTest: ${draws} draws of ${total} events need ${work} uniform draws, more than maxWork ${maxWork}. Give fewer draws or a higher maxWork.`);
  }
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
  return { statistic, p: (hits + 1) / (draws + 1), hits, draws, seed: r.seed, total, exact: false };
}
