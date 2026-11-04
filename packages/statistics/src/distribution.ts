/**
 * The shape of a sample: the count of its modes, and the smooth law with the highest likelihood. Use them to read the
 * law that a generator really emits, from its values and not from its label.
 */
import { mean, quantile, sd } from "./describe.ts";

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
  /** The smallest share of the mass that makes a mode. The default is `0.1`. */
  readonly minShare?: number;
  /** The valley between two modes is under this share of the lower peak. The default is `0.5`. */
  readonly valleyRatio?: number;
}

/** The points of the grid of the density estimate. */
const GRID = 96;
/** The width of the kernel, in the factor of Silverman's rule. The value 0.9 of that rule hides close modes. */
const KERNEL_FACTOR = 0.45;
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

/** This function gives the Gaussian kernel density of the values on a grid. */
function densityGrid(values: readonly number[], low: number, high: number): Float64Array {
  const scale = Math.min(quantile(values, 0.75) - quantile(values, 0.25), high - low) / 1.34;
  const width = KERNEL_FACTOR * Math.max(scale, (high - low) / GRID) * values.length ** -0.2;
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
 * between them is under `valleyRatio` of the lower peak. A mode counts when it holds `minShare` of the mass.
 * The function throws a RangeError for an empty list or for a value that is NaN.
 */
export function modeCount(values: readonly number[], options: ModeOptions = {}): number {
  const { minShare = 0.1, valleyRatio = 0.5 } = options;
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
  return kept.filter((peak) => mass(peak) >= minShare).length;
}

/**
 * This function gives the mean log density of the values under each smooth law, at the closed-form fit of that law.
 * Each law has 2 fitted numbers, so the values compare with no penalty. The uniform, the shifted exponential and the
 * Pareto law take the smallest value as their lower limit. The normal and the log-normal law use the sample standard
 * deviation, so their value is near the maximum likelihood and not exactly at it.
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
  const alpha = 1 / (meanLog - Math.log(low));
  return [
    { law: "uniform", meanLogDensity: -Math.log(high - low) },
    { law: "normal", meanLogDensity: -Math.log(sd(values)) - HALF_LOG_2PI_E },
    { law: "exponential", meanLogDensity: -Math.log(mean(values) - low) - 1 },
    { law: "log-normal", meanLogDensity: -Math.log(sd(logs)) - HALF_LOG_2PI_E - meanLog },
    { law: "pareto", meanLogDensity: Math.log(alpha) + alpha * Math.log(low) - (alpha + 1) * meanLog },
  ];
}

/** This function gives the smooth law with the highest likelihood. It throws as `smoothLawScores` does. */
export function bestSmoothLaw(values: readonly number[]): SmoothLaw {
  return smoothLawScores(values).reduce((best, score) => (score.meanLogDensity > best.meanLogDensity ? score : best)).law;
}
