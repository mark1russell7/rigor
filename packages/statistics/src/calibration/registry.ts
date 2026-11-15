/**
 * The registry of the calibration studies. A new interval function adds its study to this list, not a new workflow.
 * The choice `study` of the workflow `calibration.yml` has the same names.
 */
import type { Study } from "./study.ts";
import { uStatisticIntervalStudy } from "./u-statistic-interval.ts";

/** The calibration studies, by name. */
export const STUDIES: Readonly<Record<string, Study>> = Object.fromEntries([uStatisticIntervalStudy].map((study) => [study.name, study]));

/** This function gives the study with the name, and throws a `RangeError` with the names of the studies for another name. */
export function study(name: string): Study {
  const found = STUDIES[name];
  if (found === undefined) throw new RangeError(`study: no study has the name ${JSON.stringify(name)}. The studies are ${Object.keys(STUDIES).join(", ")}.`);
  return found;
}
