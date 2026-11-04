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
  /** The valley between two modes is under this share of the lower peak. The default is `0.5`. */
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

/** One peak of the density, with the grid points of its mass. */
interface Peak {
  readonly index: number;
  readonly height: number;
  readonly start: number;
  end: number;
}

/**
 * This function gives the width of the kernel. The width from the quartiles follows the distance between clusters, so
 * it hides many tight clusters. A low quantile of the spans of neighbouring values follows the width of a cluster.
 * The function uses the tight width only when it is far under the other width, so a smooth sample keeps its width.
 * The tight width stays over the grid step and over the median gap of the distinct values. A step of rounding is no gap
 * between clusters, so a rounded smooth sample keeps one mode.
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
  return Math.min(wide, Math.max(tight, resolution, (high - low) / GRID));
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

/** This function gives each rise and fall of the density as a peak. */
function peaksOf(density: Float64Array): Peak[] {
  const peaks: Peak[] = [];
  let index = 0;
  while (index < density.length) {
    let top = index;
    while (top + 1 < density.length && density[top + 1]! >= density[top]!) top++;
    let end = top;
    while (end + 1 < density.length && density[end + 1]! < density[end]!) end++;
    peaks.push({ index: top, height: density[top]!, start: index, end });
    index = end + 1;
  }
  return peaks;
}

/**
 * This function counts the modes of a sample with a kernel estimate on a grid. Two peaks stay apart when the valley
 * between them is under `valleyRatio` of the lower peak. A mode counts when it holds `minShare` of the mass. The peaks
 * join from left to right, so a reversed axis can change the count of a close mixture. The result is at least 1.
 * The grid has 96 points, so the function joins more than approximately 24 evenly spaced clusters. A tight cluster
 * also needs more than approximately `n ** 0.8 / 8` values for a sample of `n` values. A cluster with an SD over 5
 * percent of the gap to the next cluster can join it. Even groups of equal values are also a rounded uniform law, so
 * many such groups give 1. A rounding step of 0.5 SD or more gives more than one mode for a smooth law.
 * The function throws a RangeError for an empty list or for a value that is not finite.
 */
export function modeCount(values: readonly number[], options: ModeOptions = {}): number {
  const { minShare = 0.1, valleyRatio = 0.5 } = options;
  for (const v of values) if (!Number.isFinite(v)) throw new RangeError("modeCount: each value must be finite.");
  const low = quantile(values, 0);
  const high = quantile(values, 1);
  if (high === low) return 1;
  const density = densityGrid(values, low, high);
  const peaks = peaksOf(density);
  const kept = [peaks[0]!];
  for (const peak of peaks.slice(1)) {
    const last = kept[kept.length - 1]!;
    let valley = Infinity;
    for (let i = last.index; i <= peak.index; i++) valley = Math.min(valley, density[i]!);
    if (valley < valleyRatio * Math.min(last.height, peak.height)) kept.push(peak);
    else if (peak.height > last.height) kept[kept.length - 1] = { ...peak, start: last.start };
    else last.end = peak.end;
  }
  const total = density.reduce((sum, d) => sum + d, 0);
  const mass = (peak: Peak): number => {
    let sum = 0;
    for (let i = peak.start; i <= peak.end; i++) sum += density[i]!;
    return sum / total;
  };
  const masses = kept.map(mass);
  const limit = Math.min(minShare, Math.max(...masses) / 2);
  return masses.filter((share) => share >= limit).length;
}

/**
 * This function gives the mean log density of the values under each smooth law, at the closed-form fit of that law.
 * Each law has 2 fitted numbers, so the function adds no penalty. The uniform, the shifted exponential and the Pareto
 * law take the smallest value as their lower limit, and this fitted end helps them at small sizes. All values are exact
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
