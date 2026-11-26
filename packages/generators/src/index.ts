export { COVERING_CANDIDATES, COVERING_LIMIT, MATRIX_FULL_LIMIT, coveringArray, coveringRows, matrixRows, productRows, tupleCoverage, type Coverage, type CoveringOptions, type MatrixOptions } from "./covering.ts";
export { dependsOnLibm, sampler, type DistributionSpec, type Param } from "./distributions.ts";
export { normalCdf, normalQuantile } from "./normal.ts";
export { betaCdf, betaShares, type BetaShares, distributionOf, type Distribution, logBeta, logGamma } from "./quantiles.ts";
export {
  familyMap,
  familyPoints,
  latinHypercube,
  oneAtATimePoints,
  randomDesign,
  saltelliDesign,
  stratifiedDesign,
  type Dimension,
  type InputFamily,
  type Point,
  type SaltelliDesign,
} from "./designs.ts";
export { canonicalHash, canonicalJson, sha256Hex, type CanonicalOptions, type Sha256Options } from "./hash.ts";
export { SHRINK_CHECKS, SHRINK_TOLERANCE, shrinkPoint, shrinkPointAsync, shrinkTarget, type ShrinkOptions, type ShrinkStep, type Shrunk } from "./shrink.ts";
export { DIAGRAM_BOX_AREA, GIT_BLOB_BYTES, RECORDED_TABLES, recordedSpec, type RecordedTable } from "./recorded.ts";
export { deriveSeed, fnv1a32, mulberry32, plackettLuceOrder, random, randomOf, seedOf, seedsFrom, stablePick, type Random, type Source } from "./random.ts";
