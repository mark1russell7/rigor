/**
 * The form of a calibration study. A study draws seeded samples in cells. It counts the hits of an interval method
 * on the true value. Then it applies a bar that is fixed before the start. The package does not export the studies.
 * The workflow `calibration.yml` starts them with `scripts/calibration.ts`.
 */
import type { CoverageBar, CoverageCell, CoverageMinSample } from "../coverage.ts";

/** The options of one run of a study. */
export interface StudyOptions {
  /** The seed of the run. Each cell gets its own seed from it. */
  readonly seed: string;
  /** The count of samples in each cell. The default is the `draws` of the study. */
  readonly draws?: number;
  /** The names of the cells to read. A name is a full cell name or a part of the grid, for example `"40/8"`. The default is each cell. */
  readonly cells?: readonly string[];
}

/** One cell of the record of a run: the counts of the rule and the seeds of the cell. */
export interface StudyCell extends CoverageCell {
  /** The seed of the samples of the cell. */
  readonly seed: string;
}

/** The record of one run of a study: the raw counts of each cell and the result of the bar. */
export interface StudyRecord<C extends StudyCell = StudyCell> {
  readonly study: string;
  /** The seed of the run. */
  readonly seed: string;
  /** The count of samples in each cell. */
  readonly draws: number;
  /** The bar of the study. It is fixed before the run. */
  readonly bar: CoverageBar;
  readonly cells: readonly C[];
  /** The result of `coverageMinSample` for the cells and the bar. */
  readonly result: CoverageMinSample;
}

/** A calibration study with a name. */
export interface Study {
  readonly name: string;
  /** What the study measures, in one sentence. */
  readonly description: string;
  /** The count of samples in each cell of a full run. */
  readonly draws: number;
  /** The bar of the study. It is fixed before the run. */
  readonly bar: CoverageBar;
  /** This function starts the study, and gives the raw counts and the result of the bar. */
  readonly run: (options: StudyOptions) => StudyRecord;
}
