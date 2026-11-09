/**
 * The Stryker reporter `rigor-partial`. It appends the plan and each tested mutant to `partial.jsonl`, next to the JSON
 * report, at the time of each event. When a time limit stops Stryker, `scores` reads this file for a partial score. It
 * also writes the cost plan into `plan.json`, and with `rigorPartial.stopAfterPlan` it stops Stryker after the plan.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { filePlans, PLAN_FILE, plannedRuns, testPlans, type PlannedRun, type PlanOfMutant, type TestOfDryRun } from "./plan.ts";

/** The name of the file of the reporter, in the folder of the JSON report. */
export const PARTIAL_FILE = "partial.jsonl";

/** A line of `partial.jsonl`. The field `at` gives the time in milliseconds since 1970. */
export type PartialLine =
  | { readonly event: "start"; readonly at: number }
  | { readonly event: "plan"; readonly at: number; readonly mutants: number; readonly run: number }
  | {
      readonly event: "mutant";
      readonly at: number;
      readonly file: string;
      readonly status: string;
      readonly statusReason?: string;
      readonly mutatorName: string;
      readonly line: number;
      /** The planned net time of the mutant in milliseconds. A mutant with an early result has none. */
      readonly netMs?: number;
      /** The time limit of the mutant in milliseconds. A mutant that the clock stops costs this time. */
      readonly limitMs?: number;
      readonly static?: boolean;
    }
  | { readonly event: "done"; readonly at: number };

/** The parts of a Stryker mutant result that the reporter reads. */
interface TestedMutant {
  readonly id?: string;
  readonly fileName: string;
  readonly status: string;
  readonly statusReason?: string;
  readonly mutatorName: string;
  readonly location: { readonly start: { readonly line: number } };
}

/** The options of Stryker that the reporter reads. */
export interface ReporterOptions {
  readonly jsonReporter?: { readonly fileName?: string };
  /** With `stopAfterPlan` at true, the reporter stops Stryker after it writes the plan, before the first mutant. */
  readonly rigorPartial?: { readonly stopAfterPlan?: boolean };
}

/** The reporter. Stryker gives it its options, and `now`, `cwd` and `exit` are for the tests. */
export class PartialReporter {
  static readonly inject = ["options"] as const;
  readonly file: string;
  /** The file of the cost plan, in the folder of the JSON report. */
  readonly planFile: string;
  private readonly now: () => number;
  private readonly cwd: string;
  private readonly exit: (code: number) => void;
  private readonly stopAfterPlan: boolean;
  private tests: readonly TestOfDryRun[] = [];
  private runs = new Map<string, PlannedRun>();

  constructor(options: ReporterOptions, now: () => number = Date.now, cwd: string = process.cwd(), exit: (code: number) => void = (code) => process.exit(code)) {
    this.now = now;
    this.cwd = cwd;
    this.exit = exit;
    this.stopAfterPlan = options.rigorPartial?.stopAfterPlan === true;
    const dir = join(cwd, dirname(options.jsonReporter?.fileName ?? "reports/mutation/mutation.json"));
    this.file = join(dir, PARTIAL_FILE);
    this.planFile = join(dir, PLAN_FILE);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, "");
    this.write({ event: "start", at: this.now() });
  }

  onDryRunCompleted(event: { readonly result: { readonly tests: readonly TestOfDryRun[] } }): void {
    this.tests = event.result.tests;
  }

  onMutationTestingPlanReady(event: { readonly mutantPlans: readonly PlanOfMutant[] }): void {
    const plans = event.mutantPlans;
    this.write({ event: "plan", at: this.now(), mutants: plans.length, run: plans.filter((p) => p.plan === "Run").length });
    this.runs = plannedRuns(plans, this.path);
    writeFileSync(this.planFile, `${JSON.stringify({ files: filePlans(plans, this.path), tests: testPlans(plans, this.tests, this.path) }, null, 2)}\n`);
    // The test processes of Stryker stop with this process.
    if (this.stopAfterPlan) this.exit(0);
  }

  onMutantTested(result: TestedMutant): void {
    const reason = result.statusReason === undefined ? {} : { statusReason: result.statusReason };
    const run = result.id === undefined ? undefined : this.runs.get(result.id);
    const planned = run === undefined ? {} : { netMs: run.netMs, limitMs: run.limitMs, static: run.static };
    this.write({ event: "mutant", at: this.now(), file: this.path(result.fileName), status: result.status, ...reason, mutatorName: result.mutatorName, line: result.location.start.line, ...planned });
  }

  onMutationTestReportReady(): void {
    this.write({ event: "done", at: this.now() });
  }

  /** This function gives the path of a file from the folder where Stryker starts, with `/`. */
  private readonly path = (fileName: string): string => relative(this.cwd, fileName).split(sep).join("/");

  // A synchronous append: a stop of the process loses no line of a mutant that was tested.
  private write(line: PartialLine): void {
    appendFileSync(this.file, `${JSON.stringify(line)}\n`);
  }
}

/** The schema of the option of the reporter. Stryker adds it to its own schema, so the option gives no warning. */
export const strykerValidationSchema = {
  $schema: "http://json-schema.org/draft-07/schema",
  type: "object",
  properties: {
    rigorPartial: {
      description: "The options of the reporter rigor-partial.",
      type: "object",
      properties: { stopAfterPlan: { description: "Stop Stryker after the reporter writes the plan.", type: "boolean", default: false } },
      additionalProperties: false,
      default: {},
    },
  },
} as const;

/** The plugins of this module, in the form of `declareClassPlugin` of `@stryker-mutator/api/plugin`. */
export const strykerPlugins: readonly { readonly kind: "Reporter"; readonly name: string; readonly injectableClass: typeof PartialReporter }[] = [
  { kind: "Reporter", name: "rigor-partial", injectableClass: PartialReporter },
];
