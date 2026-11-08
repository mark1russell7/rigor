/**
 * The rule that finds the smallest sample at which an interval method keeps its level. The input is the hits of the
 * method on the true value in seeded cells. The bar is fixed before the run.
 */
import { binomialTest } from "./discrete.ts";
import { type Proportion, Z95, holm, wilson } from "./tests.ts";

/** One cell of a coverage study: the hits of a method on the true value in `draws` seeded samples of size `sample`. */
export interface CoverageCell {
  /** The name of the cell, for example `"skewed 120/108"`. The result names the rejected cells with it. */
  readonly name: string;
  /** The sample size `m` of the cell, a whole number of 1 or more. */
  readonly sample: number;
  /** The count of samples whose interval holds the true value, a whole number from 0 to `draws`. */
  readonly hits: number;
  /** The count of samples of the cell, a whole number of 1 or more. */
  readonly draws: number;
}

/** The bar of `coverageMinSample`. Fix it before the run, and do not change it after the run. */
export interface CoverageBar {
  /** The coverage that the method claims, for example 0.95. Each cell has a one-sided exact binomial test of it. */
  readonly level: number;
  /** The level of the Holm family of the cell tests, for example 0.05. */
  readonly alpha: number;
  /** The smallest Wilson lower end of the pooled coverage, for example 0.94. */
  readonly pooledLow: number;
  /** The z of the Wilson interval. The default is `Z95`. */
  readonly z?: number;
}

/** The reason of one step: `"qualifies"`, or the test or tests that failed. */
export type CoverageReason = "qualifies" | "cell-rejected" | "pooled-low" | "cell-rejected-and-pooled-low";

/** The result of the bar at one sample size `m`, over each cell with a sample of `m` or more. */
export interface CoverageStep {
  /** The sample size `m` of the step. */
  readonly sample: number;
  /** The count of cells with a sample of `m` or more. */
  readonly cells: number;
  /** The names of the cells that reject the coverage `level`, after the Holm correction. */
  readonly rejected: readonly string[];
  /** The smallest Holm-adjusted p of the cells of the step. */
  readonly smallestAdjusted: number;
  /** The sum of the hits of the cells of the step. */
  readonly hits: number;
  /** The sum of the draws of the cells of the step. */
  readonly draws: number;
  /** The Wilson interval of the pooled coverage `hits / draws`. */
  readonly pooled: Proportion;
  /** The sample size `m` passes the two tests of the bar. */
  readonly qualifies: boolean;
  readonly reason: CoverageReason;
}

/** The result of `coverageMinSample`. */
export interface CoverageMinSample {
  /** The smallest sample size `m` of the cells that passes the bar. It is infinite when no `m` passes. */
  readonly minSample: number;
  /** One step for each sample size of the cells, from the smallest to the largest. */
  readonly steps: readonly CoverageStep[];
}

function whole(name: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`coverageMinSample: ${name} is a whole number of ${min} or more, not ${value}.`);
}

/**
 * This function applies a fixed bar of coverage to the cells of a study. It gives the smallest sample size `m` at
 * which an interval method keeps its level. The method qualifies at `m` when the cells with a sample of `m` or more
 * pass two tests:
 *
 * 1. No cell rejects the coverage `level`. Each cell has the exact one-sided binomial test `P(X <= hits)`, with
 *    X ~ Binomial(draws, level). The family of these tests gets the Holm correction at `alpha`.
 * 2. The Wilson lower end of the pooled coverage, the sum of the hits over the sum of the draws, is `pooledLow`
 *    or more.
 *
 * The result is the smallest `m` of the cells that qualifies. It is infinite when no `m` qualifies. Each step tells
 * the result of the two tests at its `m`. A step does not depend on the steps of other sizes, so a larger `m` can
 * fail when a smaller `m` passes. The steps show this case.
 *
 * @param cells - The hits and the draws of each cell. Each cell has its own sample size.
 * @param bar - The level, the alpha of the Holm family and the pooled lower end.
 * @returns The smallest qualifying sample size, and the result of the bar at each sample size.
 */
export function coverageMinSample(cells: readonly CoverageCell[], bar: CoverageBar): CoverageMinSample {
  const { level, alpha, pooledLow } = bar;
  const z = bar.z ?? Z95;
  if (!(level > 0 && level < 1)) throw new RangeError(`coverageMinSample: level is more than 0 and less than 1, not ${level}.`);
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`coverageMinSample: alpha is more than 0 and less than 1, not ${alpha}.`);
  if (!(pooledLow >= 0 && pooledLow <= 1)) throw new RangeError(`coverageMinSample: pooledLow is from 0 to 1, not ${pooledLow}.`);
  if (!(z > 0 && Number.isFinite(z))) throw new RangeError(`coverageMinSample: z is a finite number more than 0, not ${z}.`);
  for (const cell of cells) {
    whole("sample", cell.sample, 1);
    whole("draws", cell.draws, 1);
    whole("hits", cell.hits, 0);
    if (cell.hits > cell.draws) throw new RangeError(`coverageMinSample: the hits ${cell.hits} of the cell ${cell.name} are more than its draws ${cell.draws}.`);
  }
  const p = cells.map((cell) => binomialTest(cell.hits, cell.draws, level, "less"));
  const sizes = [...new Set(cells.map((cell) => cell.sample))].sort((a, b) => a - b);
  const steps = sizes.map((m): CoverageStep => {
    const at = cells.map((cell, i) => ({ cell, p: p[i] as number })).filter(({ cell }) => cell.sample >= m);
    const corrected = holm(
      at.map(({ p: value }) => value),
      alpha,
    );
    const rejected = at.filter((_, i) => corrected[i]?.reject === true).map(({ cell }) => cell.name);
    const smallestAdjusted = Math.min(...corrected.map((c) => c.adjusted));
    let hits = 0;
    let draws = 0;
    for (const { cell } of at) {
      hits += cell.hits;
      draws += cell.draws;
    }
    const pooled = wilson(hits, draws, z);
    const cellOk = rejected.length === 0;
    const pooledOk = pooled.low >= pooledLow;
    const reason: CoverageReason = cellOk ? (pooledOk ? "qualifies" : "pooled-low") : pooledOk ? "cell-rejected" : "cell-rejected-and-pooled-low";
    return { sample: m, cells: at.length, rejected, smallestAdjusted, hits, draws, pooled, qualifies: cellOk && pooledOk, reason };
  });
  const first = steps.find((step) => step.qualifies);
  return { minSample: first === undefined ? Number.POSITIVE_INFINITY : first.sample, steps };
}
