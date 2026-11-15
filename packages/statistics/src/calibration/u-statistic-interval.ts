/**
 * The calibration study of the method `"tight"` of `uStatisticInterval`. It has 3 made-up kernels over pairs and 17
 * cells of a population `n` and a sample `m`. The bar of the study gives `U_STATISTIC_TIGHT_MIN_SAMPLE`.
 * The file `docs/CALIBRATION.md` records the methods that a read ruled out, with the empirical Bernstein bound.
 */
import { random } from "@mark1russell7/rigor-generators";
import { type CoverageBar, coverageMinSample } from "../coverage.ts";
import { uStatisticInterval } from "../u-statistic.ts";
import type { Study, StudyCell, StudyOptions, StudyRecord } from "./study.ts";

/** A kernel over the pairs of a population: the value of the pair of units `i` and `j`. */
export type Kernel = (i: number, j: number) => number;
type Point = readonly [number, number];
type Segment = readonly [Point, Point];

/** This function gives the sign of the turn from a to b to c. */
function turn(a: Point, b: Point, c: Point): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

/** This function is true when the two segments cross at a point inside both. */
function cross(p: Segment, q: Segment): boolean {
  return turn(p[0], p[1], q[0]) * turn(p[0], p[1], q[1]) < 0 && turn(q[0], q[1], p[0]) * turn(q[0], q[1], p[1]) < 0;
}

/** This function gives a made-up population of `n` random segments. The kernel is 1 when two segments cross. */
function segments(n: number, seed: string, length: (u: number) => number): Kernel {
  const r = random(seed);
  const s = Array.from({ length: n }, (): Segment => {
    const a: Point = [r.next(), r.next()];
    const angle = 2 * Math.PI * r.next();
    const l = length(r.next());
    return [a, [a[0] + l * Math.cos(angle), a[1] + l * Math.sin(angle)]];
  });
  return (i, j) => (cross(s[i] as Segment, s[j] as Segment) ? 1 : 0);
}

/** This function gives a made-up skewed integer kernel: the smaller weight of two units near each other on a line, from 0 to 9. */
function skewed(n: number, seed: string): Kernel {
  const r = random(seed);
  const w = Array.from({ length: n }, () => 1 + Math.floor(9 * r.next() ** 3));
  const x = Array.from({ length: n }, () => r.next());
  return (i, j) => (Math.abs((x[i] as number) - (x[j] as number)) < 0.25 ? Math.min(w[i] as number, w[j] as number) : 0);
}

/** A family of made-up populations: the range of its kernel, and the maker of a population of `n` units. */
export interface Population {
  readonly range: readonly [number, number];
  readonly make: (n: number, seed: string) => Kernel;
}

/** The names of the kernels of the study. */
export type KernelName = "sparse" | "crossings" | "skewed";

/** The 3 made-up kernels of the study. */
export const KERNELS: Readonly<Record<KernelName, Population>> = {
  // Short segments: 2% to 3% of the pairs cross.
  sparse: { range: [0, 1], make: (n, seed) => segments(n, seed, (u) => 0.1 + 0.4 * u * u) },
  // Long segments: 8% to 10% of the pairs cross.
  crossings: { range: [0, 1], make: (n, seed) => segments(n, seed, (u) => 0.3 + 0.5 * u) },
  skewed: { range: [0, 9], make: skewed },
};

/** The 17 cells `[n, m]` of the study. The cells at `m / n` of 1/2 and 0.9 examine the finite population correction. */
export const U_STATISTIC_CELLS: readonly (readonly [n: number, m: number])[] = [
  [40, 8],
  [40, 10],
  [40, 12],
  [40, 20],
  [40, 36],
  [60, 8],
  [60, 10],
  [60, 12],
  [60, 20],
  [60, 40],
  [120, 8],
  [120, 10],
  [120, 12],
  [120, 20],
  [120, 40],
  [120, 60],
  [120, 108],
];

/**
 * The bar of the study. The reviewer fixed it before the run of 1000 samples in each cell. Do not change it after a
 * run.
 */
export const U_STATISTIC_BAR: CoverageBar = { level: 0.95, alpha: 0.05, pooledLow: 0.94 };

/** This function gives the matrix of the kernel over all pairs of the population, and the total over all pairs. */
export function pairTable(kernel: Kernel, n: number): { readonly h: number[][]; readonly total: number } {
  const h = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : kernel(i, j))));
  let total = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) total += (h[i] as number[])[j] as number;
  return { h, total };
}

/** This function gives the total of each sampled unit: the sum of the kernel over the other sampled units. */
export function pairTotals(h: readonly (readonly number[])[], sample: readonly number[]): number[] {
  return sample.map((i) => sample.reduce((s, j) => s + ((h[i] as readonly number[])[j] as number), 0));
}

/** One cell of the record of the study. */
export interface UStatisticCell extends StudyCell {
  readonly kernel: KernelName;
  readonly n: number;
  readonly m: number;
  /** The samples of the method `"tight"` that used the method `"conservative"`, because the jackknife variance is 0. */
  readonly fallbacks: number;
  /** The seed of the made-up population of the cell. */
  readonly populationSeed: string;
}

/**
 * This function counts the hits of the method `"tight"` on the total of the population in one cell. A hit with the
 * fallback counts, because the method ships with the fallback.
 */
function runCell(kernel: KernelName, n: number, m: number, draws: number, base: string): UStatisticCell {
  const population = KERNELS[kernel];
  const populationSeed = `${base}/${kernel}/${n}`;
  const seed = `${base}/${kernel}/${n}/${m}`;
  const { h, total } = pairTable(population.make(n, populationSeed), n);
  const r = random(seed);
  const ids = Array.from({ length: n }, (_, i) => i);
  let hits = 0;
  let fallbacks = 0;
  for (let k = 0; k < draws; k++) {
    const totals = pairTotals(h, r.sample(ids, m));
    const i = uStatisticInterval(totals, { order: 2, population: n, method: "tight", range: population.range });
    if (i.method === "conservative") fallbacks++;
    if (i.low <= total && total <= i.high) hits++;
  }
  return { name: `${kernel} ${n}/${m}`, kernel, n, m, sample: m, draws, hits, fallbacks, seed, populationSeed };
}

/** The study of the method `"tight"` of `uStatisticInterval`. */
export const uStatisticIntervalStudy: Study = {
  name: "u-statistic-interval",
  description: 'The coverage of the method "tight" of uStatisticInterval, for 3 made-up kernels over pairs in 17 cells.',
  draws: 1000,
  bar: U_STATISTIC_BAR,
  run(options: StudyOptions): StudyRecord<UStatisticCell> {
    const draws = options.draws ?? this.draws;
    if (!Number.isSafeInteger(draws) || draws < 1) throw new RangeError(`${this.name}: draws is a whole number of 1 or more, not ${draws}.`);
    const base = `${this.name}/${options.seed}`;
    const cells: UStatisticCell[] = [];
    for (const kernel of Object.keys(KERNELS) as KernelName[]) {
      for (const [n, m] of U_STATISTIC_CELLS) {
        const name = `${kernel} ${n}/${m}`;
        if (options.cells !== undefined && !options.cells.includes(name) && !options.cells.includes(`${n}/${m}`)) continue;
        cells.push(runCell(kernel, n, m, draws, base));
      }
    }
    if (cells.length === 0) throw new RangeError(`${this.name}: no cell has a name of ${JSON.stringify(options.cells)}.`);
    return { study: this.name, seed: options.seed, draws, bar: this.bar, cells, result: coverageMinSample(cells, this.bar) };
  },
};
