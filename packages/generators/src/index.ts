export { dependsOnLibm, sampler, type DistributionSpec, type Param } from "./distributions.ts";
export { normalCdf, normalQuantile } from "./normal.ts";
export { betaCdf, distributionOf, type Distribution } from "./quantiles.ts";
export {
  familyMap,
  familyPoints,
  latinHypercube,
  randomDesign,
  saltelliDesign,
  stratifiedDesign,
  type Dimension,
  type InputFamily,
  type Point,
  type SaltelliDesign,
} from "./designs.ts";
export { canonicalHash, canonicalJson, sha256Hex, type CanonicalOptions, type Sha256Options } from "./hash.ts";
export { DIAGRAM_BOX_AREA, GIT_BLOB_BYTES, RECORDED_TABLES, recordedSpec, type RecordedTable } from "./recorded.ts";
export { deriveSeed, fnv1a32, mulberry32, plackettLuceOrder, random, randomOf, seedOf, seedsFrom, stablePick, type Random, type Source } from "./random.ts";
