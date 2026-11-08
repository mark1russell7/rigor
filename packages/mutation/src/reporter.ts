/**
 * The Stryker reporter `rigor-partial`. It appends the plan and each tested mutant to `partial.jsonl`, next to the JSON
 * report, at the time of each event. When a time limit stops Stryker, `scores` reads this file for a partial score.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

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
    }
  | { readonly event: "done"; readonly at: number };

/** The parts of a Stryker mutant result that the reporter reads. */
interface TestedMutant {
  readonly fileName: string;
  readonly status: string;
  readonly statusReason?: string;
  readonly mutatorName: string;
  readonly location: { readonly start: { readonly line: number } };
}

/** The reporter. Stryker gives it its options, and `now` and `cwd` are for the tests. */
export class PartialReporter {
  static readonly inject = ["options"] as const;
  readonly file: string;
  private readonly now: () => number;
  private readonly cwd: string;

  constructor(options: { readonly jsonReporter?: { readonly fileName?: string } }, now: () => number = Date.now, cwd: string = process.cwd()) {
    this.now = now;
    this.cwd = cwd;
    this.file = join(cwd, dirname(options.jsonReporter?.fileName ?? "reports/mutation/mutation.json"), PARTIAL_FILE);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, "");
    this.write({ event: "start", at: this.now() });
  }

  onMutationTestingPlanReady(event: { readonly mutantPlans: readonly { readonly plan: string }[] }): void {
    this.write({ event: "plan", at: this.now(), mutants: event.mutantPlans.length, run: event.mutantPlans.filter((p) => p.plan === "Run").length });
  }

  onMutantTested(result: TestedMutant): void {
    const file = relative(this.cwd, result.fileName).split(sep).join("/");
    const reason = result.statusReason === undefined ? {} : { statusReason: result.statusReason };
    this.write({ event: "mutant", at: this.now(), file, status: result.status, ...reason, mutatorName: result.mutatorName, line: result.location.start.line });
  }

  onMutationTestReportReady(): void {
    this.write({ event: "done", at: this.now() });
  }

  // A synchronous append: a stop of the process loses no line of a mutant that was tested.
  private write(line: PartialLine): void {
    appendFileSync(this.file, `${JSON.stringify(line)}\n`);
  }
}

/** The plugins of this module, in the form of `declareClassPlugin` of `@stryker-mutator/api/plugin`. */
export const strykerPlugins: readonly { readonly kind: "Reporter"; readonly name: string; readonly injectableClass: typeof PartialReporter }[] = [
  { kind: "Reporter", name: "rigor-partial", injectableClass: PartialReporter },
];
