/**
 * The shape of a sample: the count of its modes, and the smooth law with the highest likelihood. Use them to read the
 * law that a generator really emits, from its values and not from its label.
 */
import { mean, quantile, sd, sorted } from "./describe.ts";

/** The smooth laws that `smoothLawScores` compares. Each law has 2 fitted numbers. */
export type SmoothLaw = "uniform" | "normal" | "exponential" | "log-normal" | "pareto";

/** The value of one law at its fit. */
export interface SmoothLawScore {
  readonly law: SmoothLaw;
  /** The mean log density of the values at the fit of the law. A larger value is a better fit. */
  readonly meanLogDensity: number;
}

/** The options of `modeCount`. */
export interface ModeOptions {
  /**
   * The smallest share of the mass that makes a mode. The default is `0.1`. Half of the mass of the largest mode also
   * makes a mode, so many equal modes each count.
   */
  readonly minShare?: number;
  /** The valley between two peaks of the kernel is under this share of the lower peak. The default is `0.5`. */
  readonly valleyRatio?: number;
}

/** The points of the grid of the density estimate. */
const GRID = 96;
/** The width of the kernel, in the factor of Silverman's rule. The value 0.9 of that rule hides close modes. */
const KERNEL_FACTOR = 0.45;
/** The share of the values in a span of neighbours, as a factor of `n ** -0.2`. */
const SPAN_FACTOR = 0.1;
/** The quantile of the spans. A low quantile stays in the clusters when most spans cross a gap. */
const SPAN_QUANTILE = 0.25;
/**
 * The tight width replaces the width from the quartiles under this ratio. In seeded smooth samples the ratio stays over
 * 0.2, except for a heavy tail, and in tight clusters it stays under 0.02.
 */
const TIGHT_RATIO = 0.1;
/** The kernels stop at this count of widths. */
const KERNEL_REACH = 3;
const HALF_LOG_2PI_E = 0.5 * Math.log(2 * Math.PI * Math.E);
/** Two values closer than this share of the range are one value, so the noise of a float makes no new value. */
const SAME_VALUE = 1e-9;
/** The most distinct values of a direct read of their counts. The grid resolves no more than this count of clusters. */
const FEW_VALUES = GRID / 4;
/** The mean count of each value in a direct read. Under it the values are a small sample, and the kernel reads them. */
const MIN_REPEATS = 4;
/** The fewest values that show the shape of a law. A sample with fewer values gives one mode for each value. */
const MIN_BELL_VALUES = 4;
/** The ratio of the highest third of the counts to the lowest third, under which the counts are flat. */
const FLAT_RATIO = 3;
/** The ratio of the means of the three parts of the list of counts, under which the counts have no shape. */
const SHAPE_RATIO = 1.75;
/** A value with under this share of the sample is a tail. A rare value does not change the shape of the counts. */
const RARE_VALUE = 0.01;
/** The fewest values of a hump of a rounded law. When most humps are narrower, the values are a discrete law. */
const MIN_HUMP_VALUES = 3;
/** A count differs from another count at this z value. The two counts then differ by more than the noise of a sample. */
const COUNT_Z = 3;

/** One hump of a series: its highest point, the sum of its points and the count of its points. */
interface Hump {
  readonly top: number;
  readonly mass: number;
  readonly points: number;
}

/**
 * This function gives the distances of the values from one end of the sample, in order. It takes the end that gives the
 * smaller list, so `x` and `-x` give one list and one count.
 */
function fromOneEnd(values: readonly number[]): number[] {
  const order = sorted(values);
  const low = order[0]!;
  const high = order[order.length - 1]!;
  const rising = order.map((x) => x - low);
  const falling = order.map((x) => high - x).reverse();
  const first = rising.findIndex((x, i) => x !== falling[i]);
  return first >= 0 && falling[first]! < rising[first]! ? falling : rising;
}

/**
 * This function gives the width of the kernel. The width from the quartiles follows the distance between clusters, so
 * it hides many tight clusters. A low quantile of the spans of neighbouring values follows the width of a cluster.
 * The function uses the tight width only when it is far under the other width, so a smooth sample keeps its width.
 * The tight width stays over the grid step. No width goes under the median gap of the distinct values of a tight
 * sample. A step of rounding is no gap between clusters, so a rounded smooth sample keeps one mode at each size.
 */
function kernelWidth(values: readonly number[], low: number, high: number): number {
  const count = values.length;
  const order = sorted(values);
  const scale = Math.min(quantile(values, 0.75) - quantile(values, 0.25), high - low) / 1.34;
  const wide = KERNEL_FACTOR * Math.max(scale, (high - low) / GRID) * count ** -0.2;
  const neighbours = Math.min(count - 1, Math.ceil(SPAN_FACTOR * count ** 0.8));
  const tight = quantile(order.slice(neighbours).map((x, i) => x - order[i]!), SPAN_QUANTILE);
  if (tight >= TIGHT_RATIO * wide) return wide;
  const distinct = order.filter((x, i) => i === 0 || x !== order[i - 1]);
  const resolution = quantile(distinct.slice(1).map((x, i) => x - distinct[i]!), 0.5);
  return Math.max(resolution, Math.min(wide, Math.max(tight, (high - low) / GRID)));
}

/** This function gives the Gaussian kernel density of the values on a grid. */
function densityGrid(values: readonly number[], low: number, high: number): Float64Array {
  const width = kernelWidth(values, low, high);
  const start = low - KERNEL_REACH * width;
  const step = (high - low + 2 * KERNEL_REACH * width) / (GRID - 1);
  const density = new Float64Array(GRID);
  for (const x of values) {
    const first = Math.max(0, Math.floor((x - KERNEL_REACH * width - start) / step));
    const last = Math.min(GRID - 1, Math.ceil((x + KERNEL_REACH * width - start) / step));
    for (let i = first; i <= last; i++) {
      const u = (start + i * step - x) / width;
      density[i]! += Math.exp(-0.5 * u * u);
    }
  }
  return density;
}

/**
 * This function gives the humps of a series. It first gives each rise and fall one hump. Then it joins the two neighbours
 * with the closest valley, and again, until each valley has a closeness under the limit. The result has no direction,
 * because the order of the joins comes from the depth of the valleys and not from their position.
 */
function humpsOf(series: ArrayLike<number>, closeness: (lower: number, valley: number) => number, limit: number): Hump[] {
  const humps: Hump[] = [];
  const valleys: number[] = [];
  let index = 0;
  while (index < series.length) {
    let top = index;
    while (top + 1 < series.length && series[top + 1]! >= series[top]!) top++;
    let end = top;
    while (end + 1 < series.length && series[end + 1]! < series[end]!) end++;
    let mass = 0;
    for (let i = index; i <= end; i++) mass += series[i]!;
    humps.push({ top: series[top]!, mass, points: end + 1 - index });
    if (end + 1 < series.length) valleys.push(series[end]!);
    index = end + 1;
  }
  while (valleys.length > 0) {
    const scores = valleys.map((valley, i) => closeness(Math.min(humps[i]!.top, humps[i + 1]!.top), valley));
    const closest = scores.indexOf(Math.max(...scores));
    if (scores[closest]! < limit) break;
    const [left, right] = [humps[closest]!, humps[closest + 1]!];
    humps.splice(closest, 2, { top: Math.max(left.top, right.top), mass: left.mass + right.mass, points: left.points + right.points });
    valleys.splice(closest, 1);
  }
  return humps;
}

/** This function gives the count of each distinct value, in the order of the values. */
function valueCounts(values: readonly number[], low: number, high: number): number[] {
  const tie = SAME_VALUE * (high - low);
  const counts: number[] = [];
  let last = -Infinity;
  for (const x of sorted(values)) {
    if (x - last > tie) {
      counts.push(0);
      last = x;
    }
    counts[counts.length - 1]!++;
  }
  return counts;
}

/**
 * This function tells that the counts are flat. The highest third of the counts stays under `FLAT_RATIO` times the
 * lowest third, so a list of heavy and light values is not flat. The means of the first, the middle and the last third
 * of the list stay under `SHAPE_RATIO` of each other. The noise of a sample cancels in those means, and a bell does not.
 */
function flatCounts(counts: readonly number[]): boolean {
  const order = [...counts].sort((a, b) => a - b);
  const third = Math.ceil(order.length / 3);
  if (mean(order.slice(-third)) >= FLAT_RATIO * mean(order.slice(0, third))) return false;
  const parts = [counts.slice(0, third), counts.slice(third, -third), counts.slice(-third)].filter((part) => part.length > 0).map((part) => mean(part));
  return Math.max(...parts) < SHAPE_RATIO * Math.min(...parts);
}

/** This function gives the closeness of a count to a valley: the negative of its height over the noise of a sample. */
const countCloseness = (lower: number, valley: number): number => -(lower - valley) / Math.sqrt(lower + valley);

/**
 * This function counts the modes of a sample with few distinct values, from the counts of those values. The result does
 * not change with the size of the sample. Flat counts are a discrete law with one mode for each value, so the noise of
 * a sample does not take a value out. Counts with one rise and one fall are a rounded smooth law with one mode.
 */
function fewValueModes(allCounts: readonly number[], total: number, minShare: number): number {
  const counts = allCounts.filter((count) => count / total >= RARE_VALUE);
  const each = counts.map((count) => count / total);
  const overLimit = (masses: readonly number[], limit: number): number => masses.filter((share) => share >= limit).length;
  if (counts.length < MIN_BELL_VALUES) return overLimit(each, Math.min(minShare, Math.max(...each) / 2));
  if (flatCounts(counts)) return overLimit(each, Math.min(minShare, quantile(each, 0.5) / FLAT_RATIO));
  const humps = humpsOf(counts, countCloseness, -COUNT_Z);
  const narrow = humps.filter((hump) => hump.points < MIN_HUMP_VALUES).length;
  const masses = 2 * narrow > humps.length ? each : humps.map((hump) => hump.mass / total);
  return overLimit(masses, Math.min(minShare, Math.max(...masses) / 2));
}

/**
 * This function gives the mass of each mode from a kernel estimate on a grid. Two peaks stay apart when the valley
 * between them is under `valleyRatio` of the lower peak.
 */
function kernelMasses(values: readonly number[], low: number, high: number, valleyRatio: number): number[] {
  const density = densityGrid(values, low, high);
  const total = density.reduce((sum, d) => sum + d, 0);
  return humpsOf(density, (lower, valley) => valley / lower, valleyRatio).map((hump) => hump.mass / total);
}

/**
 * This function counts the modes of a sample. A mode counts when it holds `minShare` of the mass. The default counts the
 * modes that hold 10 percent, and a caller who needs all modes passes a smaller value. The result is at least 1. The
 * result is the same for `x` and `-x`.
 *
 * A sample with 24 or fewer distinct values, and 4 or more copies of each value on average, gets a direct read.
 * That read uses the counts of the values, and it does not change with the size of the sample.
 * It gives one mode for each value of a flat discrete law. So even groups give the count of the groups, and so does a
 * rounded uniform law with 24 or fewer steps. It gives one mode for each hump of a rounded smooth law.
 * The direct read of a sample with 3 or fewer values gives one mode for each value that holds the share.
 *
 * A kernel estimate on a grid reads each other sample. The grid has 96 points, so the kernel joins more than
 * approximately 24 evenly spaced clusters. A tight cluster also needs more than approximately `n ** 0.8 / 8` values for
 * a sample of `n` values. A cluster with an SD over 5 percent of the gap to the next cluster can join it.
 *
 * The function throws a RangeError for an empty list or for a value that is not finite.
 */
export function modeCount(values: readonly number[], options: ModeOptions = {}): number {
  const { minShare = 0.1, valleyRatio = 0.5 } = options;
  for (const v of values) if (!Number.isFinite(v)) throw new RangeError("modeCount: each value must be finite.");
  const distances = fromOneEnd(values);
  const high = distances[distances.length - 1]!;
  if (high === 0) return 1;
  const counts = valueCounts(distances, 0, high);
  if (counts.length <= FEW_VALUES && values.length >= MIN_REPEATS * counts.length) return fewValueModes(counts, values.length, minShare);
  const masses = kernelMasses(distances, 0, high, valleyRatio);
  const limit = Math.min(minShare, Math.max(...masses) / 2);
  return masses.filter((share) => share >= limit).length;
}

/**
 * This function gives the mean log density of the values under each smooth law, at the closed-form fit of that law.
 * Each law has 2 fitted numbers, so the function adds no penalty. The uniform, the shifted exponential and the Pareto
 * law take the smallest value as their lower limit. This fitted end helps them at small sizes. All values are exact
 * maximum likelihoods.
 * The function throws a RangeError for an empty list, for a value that is not positive and finite, or for equal values.
 */
export function smoothLawScores(values: readonly number[]): readonly SmoothLawScore[] {
  if (values.length === 0) throw new RangeError("smoothLawScores: the list is empty.");
  for (const v of values) if (!(v > 0 && Number.isFinite(v))) throw new RangeError("smoothLawScores: each value must be positive and finite.");
  const logs = values.map((v) => Math.log(v));
  const low = quantile(values, 0);
  const high = quantile(values, 1);
  if (low === high) throw new RangeError("smoothLawScores: the values are equal, so no law has a density.");
  const meanLog = mean(logs);
  const toExact = 0.5 * Math.log(values.length / (values.length - 1));
  const alpha = 1 / (meanLog - Math.log(low));
  return [
    { law: "uniform", meanLogDensity: -Math.log(high - low) },
    { law: "normal", meanLogDensity: -Math.log(sd(values)) - HALF_LOG_2PI_E + toExact },
    { law: "exponential", meanLogDensity: -Math.log(mean(values) - low) - 1 },
    { law: "log-normal", meanLogDensity: -Math.log(sd(logs)) - HALF_LOG_2PI_E - meanLog + toExact },
    { law: "pareto", meanLogDensity: Math.log(alpha) + alpha * Math.log(low) - (alpha + 1) * meanLog },
  ];
}

/**
 * This function gives the smooth law with the highest likelihood. Under 300 values the result is not reliable: the
 * normal and the log-normal law lose to the laws with a fitted end. The README gives the measured shares of correct
 * results. The function throws as `smoothLawScores` does.
 */
export function bestSmoothLaw(values: readonly number[]): SmoothLaw {
  return smoothLawScores(values).reduce((best, score) => (score.meanLogDensity > best.meanLogDensity ? score : best)).law;
}
