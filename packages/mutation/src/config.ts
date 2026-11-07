import type { Selection } from "./lane.ts";

/** The options of `strykerConfig`. */
export interface ConfigOptions {
  /** This option gives the number of test processes. The default is 2. */
  readonly concurrency?: number;
  /** This option gives the folder of the reports, from the folder of the package. The default is `reports/mutation`. */
  readonly reportDir?: string;
}

/** The Stryker config of one selection, as JSON. Stryker starts in the folder of the package. */
export interface StrykerConfig {
  readonly testRunner: "vitest";
  readonly plugins: readonly string[];
  readonly vitest?: { readonly configFile: string };
  readonly mutate: readonly string[];
  readonly coverageAnalysis: "perTest";
  readonly reporters: readonly string[];
  readonly htmlReporter: { readonly fileName: string };
  readonly jsonReporter: { readonly fileName: string };
  readonly thresholds: { readonly high: number; readonly low: number; readonly break: null };
  readonly concurrency: number;
  readonly timeoutMS: number;
  readonly dryRunTimeoutMinutes: number;
}

/** The default folder of the reports, from the folder of the package. */
export const REPORT_DIR = "reports/mutation";

/**
 * The default time in milliseconds that the clock adds to the time of the tests for each mutant. The default of
 * Stryker is 5000. On a loaded CI runner that time stopped mutants that the tests detected later.
 */
export const TIMEOUT_MS = 120_000;

/** The default time in minutes for the run of the tests without mutants. The default of Stryker is 5. */
export const DRY_RUN_TIMEOUT_MINUTES = 15;

/**
 * This function gives the Stryker config of a selection. The break of Stryker is off, because the gate of each
 * package is in `scoreReport`. Stryker 10.1.0 or later is necessary with Vitest 5: version 10.0 started no test on each
 * mutant (stryker-js issue 6210).
 */
export function strykerConfig(selection: Selection, options: ConfigOptions = {}): StrykerConfig {
  const reportDir = options.reportDir ?? REPORT_DIR;
  const low = selection.gate ?? 60;
  return {
    testRunner: "vitest",
    plugins: ["@stryker-mutator/vitest-runner"],
    ...(selection.vitestConfig === undefined ? {} : { vitest: { configFile: selection.vitestConfig } }),
    mutate: selection.mutate,
    coverageAnalysis: "perTest",
    reporters: ["clear-text", "progress", "html", "json"],
    htmlReporter: { fileName: `${reportDir}/index.html` },
    jsonReporter: { fileName: `${reportDir}/mutation.json` },
    thresholds: { high: Math.max(low, 90), low, break: null },
    concurrency: options.concurrency ?? 2,
    timeoutMS: selection.timeoutMS ?? TIMEOUT_MS,
    dryRunTimeoutMinutes: selection.dryRunTimeoutMinutes ?? DRY_RUN_TIMEOUT_MINUTES,
  };
}
