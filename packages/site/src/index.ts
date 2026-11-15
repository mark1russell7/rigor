// The entry of the workspace: the pure part of the page. The browser bundle starts from src/page.ts (src/build.ts).
export { type Method, METHODS, chiSquarePerDf, generatorOf, histogram, run, seedFrom } from "./page.ts";
export {
  type Bench,
  type Explored,
  type Preset,
  type Simulated,
  AXIS,
  CASES,
  MARGIN,
  NOISE_CAP,
  POOL_RUNS,
  PRESETS,
  START,
  axisPlace,
  changeText,
  explore,
  mergePower,
  plainWhy,
  power,
  ratioText,
  simulate,
  verdictOptions,
} from "./explorer.ts";
