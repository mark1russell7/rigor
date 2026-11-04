// Tables of sizes that were recorded from public sources. A corpus can then draw real sizes with the family `recorded`.
// Each table keeps its source, its license and its date, so a reader can check each table.
import type { DistributionSpec } from "./distributions.ts";

/** A table of recorded values and the facts of its source. */
export interface RecordedTable {
  /** The name of the table. */
  readonly name: string;
  /** What one value measures. */
  readonly measure: string;
  /** The link to the source, with the commit of the read. */
  readonly source: string;
  /** The license of the source. */
  readonly license: string;
  /** The notice of the license of the source, or an empty string when it has no notice. */
  readonly notice: string;
  /** The date of the read. */
  readonly date: string;
  /** The count of the recorded values. */
  readonly count: number;
  /** The median of the recorded values. */
  readonly median: number;
  /**
   * The 100 midpoint quantiles, from the lowest to the highest.
   * The value at index `i` has the rank `floor(count * (i + 0.5) / 100)` of the sorted values. Each value thus stands for 1 percent of the recorded values.
   */
  readonly quantiles: readonly number[];
}

/** The areas of the boxes of 293 real diagrams: the actors of the Ptolemy II models, in the flattened form of the ELK model set. */
export const DIAGRAM_BOX_AREA: RecordedTable = Object.freeze({
  name: "diagram-box-area",
  measure: "the area of one box of a diagram, in square layout units",
  source: "https://github.com/eclipse-elk/elk-models/tree/ac5af2ba511c0037e4f347e8bd91f013950951c7/realworld/ptolemy/flattened",
  license: "The Ptolemy II license of the University of California, stated in realworld/ptolemy/README.txt of the source",
  notice: "Copyright (c) 1997-2013 The Regents of the University of California.\nAll rights reserved.\nPermission is hereby granted, without written agreement and without\nlicense or royalty fees, to use, copy, modify, and distribute this\nsoftware and its documentation for any purpose, provided that the above\ncopyright notice and the following two paragraphs appear in all copies\nof this software.\n\nIN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY\nFOR DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES\nARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN IF\nTHE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE POSSIBILITY OF\nSUCH DAMAGE.\n\nTHE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,\nINCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE SOFTWARE\nPROVIDED HEREUNDER IS ON AN \"AS IS\" BASIS, AND THE UNIVERSITY OF\nCALIFORNIA HAS NO OBLIGATION TO PROVIDE MAINTENANCE, SUPPORT, UPDATES,\nENHANCEMENTS, OR MODIFICATIONS.",
  date: "2026-11-04",
  count: 9859,
  median: 2024,
  quantiles: Object.freeze([
    350, 410, 410, 410, 450, 450, 475, 650, 725, 725,
    800, 825, 861, 861, 900, 912, 912, 912, 961, 961,
    961, 1025, 1150, 1250, 1271, 1271, 1475, 1681, 1681, 1681,
    1681, 1681, 1681, 1681, 1681, 1681, 1681, 1681, 1681, 1681,
    1681, 1681, 1794, 1794, 1794, 1875, 1891, 1914, 1927, 1975,
    2024, 2100, 2350, 2400, 2400, 2400, 2400, 2400, 2400, 2400,
    2400, 2400, 2400, 2400, 2400, 2400, 2400, 2441, 2501, 2501,
    2501, 2501, 2501, 2501, 2501, 2501, 2501, 2501, 2501, 2501,
    2501, 2501, 2501, 2600, 3036, 3036, 3036, 3036, 3036, 3036,
    3036, 3036, 3036, 3036, 3036, 3358, 3600, 4900, 5975, 10625,
  ]),
});

/** The sizes of the files of one large public git tree. A treemap of a repository has weights of this kind. */
export const GIT_BLOB_BYTES: RecordedTable = Object.freeze({
  name: "git-blob-bytes",
  measure: "the size of one file of a git tree, in bytes. Empty files are left out",
  source: "https://github.com/microsoft/vscode/tree/aace354316214ca620b7c809a3da1ed59bf942dd",
  license: "MIT",
  notice: "",
  date: "2026-11-04",
  count: 20751,
  median: 4454,
  quantiles: Object.freeze([
    8, 63, 132, 216, 265, 326, 413, 447, 474, 505,
    542, 578, 625, 665, 708, 772, 831, 903, 981, 1051,
    1128, 1190, 1272, 1354, 1435, 1514, 1593, 1668, 1757, 1851,
    1936, 2030, 2122, 2220, 2335, 2442, 2561, 2680, 2805, 2925,
    3052, 3186, 3335, 3459, 3617, 3765, 3902, 4055, 4209, 4380,
    4524, 4718, 4876, 5092, 5282, 5487, 5720, 5933, 6143, 6388,
    6657, 6939, 7211, 7513, 7853, 8190, 8496, 8817, 9183, 9574,
    9943, 10367, 10758, 11294, 11797, 12355, 12903, 13619, 14240, 14994,
    15751, 16593, 17546, 18678, 19722, 21129, 22639, 24080, 25906, 27915,
    30174, 32771, 36281, 40324, 46261, 54344, 63697, 84365, 122821, 233638,
  ]),
});

/** The recorded tables, by name. */
export const RECORDED_TABLES: Readonly<Record<string, RecordedTable>> = Object.freeze({
  [DIAGRAM_BOX_AREA.name]: DIAGRAM_BOX_AREA,
  [GIT_BLOB_BYTES.name]: GIT_BLOB_BYTES,
});

/** This function gives the spec of the family `recorded` that draws from a table. */
export function recordedSpec(table: RecordedTable): DistributionSpec {
  return { family: "recorded", values: table.quantiles };
}
