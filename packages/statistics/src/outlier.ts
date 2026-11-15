/**
 * The outliers of a sample by the robust z-score of Iglewicz and Hoaglin (1993). The cut is a published value, not a
 * factor by feel. The median and the median absolute deviation (MAD) do not move when one value is far out.
 */
import { median } from "./describe.ts";

/** The cut of Iglewicz and Hoaglin: a value with an absolute robust z-score above 3.5 is an outlier. */
export const MODIFIED_Z_CUT = 3.5;

/** The factor of the score from the MAD: the 0.75 quantile of the standard normal law, 0.6745. */
const MAD_FACTOR = 0.6745;

/** The factor of the score from the mean absolute deviation when the MAD is 0: `sqrt(pi / 2)`, 1.253314. */
const MEAN_AD_FACTOR = 1.253314;

/** The side of an outlier: above the median, below the median, or both. */
export type OutlierSide = "high" | "low" | "both";

/** The options of `modifiedZ`. */
export interface ModifiedZOptions {
  /** The cut of the absolute score. The default is `MODIFIED_Z_CUT`, 3.5. */
  readonly cut?: number;
  /** The side of an outlier. The default is `both`. */
  readonly side?: OutlierSide;
}

/** The robust z-scores of a sample, and its outliers. */
export interface ModifiedZ {
  readonly median: number;
  /** The median absolute deviation from the median. */
  readonly mad: number;
  /** The score of each value, in the order of the values. */
  readonly scores: readonly number[];
  /** The indices of the outliers, in increasing order. */
  readonly outliers: readonly number[];
}

/**
 * This function gives the robust z-score of each value: `0.6745 * (value - median) / MAD`.
 * - A value with a score above the cut on its side is an outlier.
 * - When the MAD is 0, the score uses the mean absolute deviation: `(value - median) / (1.253314 * meanAD)`.
 * - When each value is equal, each score is 0, and no value is an outlier.
 * - The function refuses an empty list, a value that is not finite and a cut that is not a finite number above 0.
 */
export function modifiedZ(values: readonly number[], options: ModifiedZOptions = {}): ModifiedZ {
  const cut = options.cut ?? MODIFIED_Z_CUT;
  const side = options.side ?? "both";
  if (!(Number.isFinite(cut) && cut > 0)) throw new RangeError(`modifiedZ: the cut is a finite number above 0, not ${cut}.`);
  if (values.length === 0) throw new RangeError("modifiedZ: the list is empty.");
  for (const v of values) if (!Number.isFinite(v)) throw new RangeError(`modifiedZ: each value is a finite number, not ${v}.`);
  const middle = median(values);
  const deviations = values.map((v) => Math.abs(v - middle));
  const mad = median(deviations);
  const meanAd = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
  const scale = mad > 0 ? mad / MAD_FACTOR : MEAN_AD_FACTOR * meanAd;
  const scores = values.map((v) => (scale > 0 ? (v - middle) / scale : 0));
  const out = (score: number): boolean => (side === "high" ? score > cut : side === "low" ? -score > cut : Math.abs(score) > cut);
  const outliers = scores.flatMap((score, index) => (out(score) ? [index] : []));
  return { median: middle, mad, scores, outliers };
}
