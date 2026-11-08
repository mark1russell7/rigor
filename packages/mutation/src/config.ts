import type { Selection } from "./lane.ts";

/** The options of `strykerConfig`. */
export interface ConfigOptions {
  /** This option gives the number of test processes. The default is 2. */
  readonly concurrency?: number;
  /** This option gives the folder of the reports, from the folder of the package. The default is `reports/mutation`. */
  readonly reportDir?: string;
  /**
   * When this option is true, Stryker starts only the tests without mutants, and it does not stop at the first failed
   * test. Use it to see if the tests pass under Stryker before a long run.
   */
  readonly dryRun?: boolean;
  /**
   * When this option is false, Stryker does not rewrite the tsconfig of the package in its sandbox. The default is true.
   * The rewrite uses `parseConfigFileTextToJson`, and TypeScript 7 does not have it. Refer to `rewritesTsconfig`.
   */
  readonly tsconfigRewrite?: boolean;
}

/** The Stryker config of one selection, as JSON. Stryker starts in the folder of the package. The field `stryker` of the lane adds keys. */
export interface StrykerConfig {
  readonly [key: string]: unknown;
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
  readonly tsconfigFile?: string;
  readonly dryRunOnly?: true;
  readonly disableBail?: true;
}

/**
 * The file URL of the module of the reporter `rigor-partial`: the source in the workspace, the build in the package of
 * npm. The reporter writes each tested mutant at once, so a stop of Stryker keeps a partial score.
 */
export const PARTIAL_PLUGIN: string = new URL(import.meta.url.endsWith(".ts") ? "./reporter.ts" : "./reporter.js", import.meta.url).href;

/** The default folder of the reports, from the folder of the package. */
export const REPORT_DIR = "reports/mutation";

/**
 * The default time in milliseconds that the clock adds to the time of the tests for each mutant. The default of
 * Stryker is 5000. On a loaded CI runner that time stopped mutants that the tests detected later.
 */
export const TIMEOUT_MS = 120_000;

/**
 * The value of `tsconfigFile` when the rewrite of the tsconfig is off. No project has this file, so Stryker finds no
 * tsconfig to rewrite.
 */
export const NO_TSCONFIG = "tsconfig.no-stryker-rewrite.json";

/**
 * This function tells if Stryker can rewrite a tsconfig with a TypeScript of the major version `major`. Stryker 10.1
 * parses the tsconfig with `parseConfigFileTextToJson`, and TypeScript 7 removed it. When no TypeScript is found, the
 * answer is true, and the config keeps the default of Stryker.
 */
export function rewritesTsconfig(major: number | undefined): boolean {
  return major === undefined || major < 7;
}

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
    plugins: ["@stryker-mutator/vitest-runner", PARTIAL_PLUGIN],
    ...(selection.vitestConfig === undefined ? {} : { vitest: { configFile: selection.vitestConfig } }),
    mutate: selection.mutate,
    coverageAnalysis: "perTest",
    reporters: ["clear-text", "progress", "html", "json", "rigor-partial"],
    htmlReporter: { fileName: `${reportDir}/index.html` },
    jsonReporter: { fileName: `${reportDir}/mutation.json` },
    thresholds: { high: Math.max(low, 90), low, break: null },
    concurrency: options.concurrency ?? 2,
    timeoutMS: selection.timeoutMS ?? TIMEOUT_MS,
    dryRunTimeoutMinutes: selection.dryRunTimeoutMinutes ?? DRY_RUN_TIMEOUT_MINUTES,
    ...(options.tsconfigRewrite === false ? { tsconfigFile: NO_TSCONFIG } : {}),
    // The keys of the lane field "stryker" replace the keys above, but "--concurrency" replaces its "concurrency".
    ...selection.stryker,
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.dryRun === true ? { dryRunOnly: true, disableBail: true } : {}),
  };
}
