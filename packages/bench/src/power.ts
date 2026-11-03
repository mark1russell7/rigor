/**
 * The power test of a time verdict. It draws seeded benches with a known speedup and counts the verdicts that find it.
 * It also draws benches with equal arms and counts the false verdicts.
 */
import { random } from "@mark1russell7/rigor-generators";
import { firstArm, type PairedTime } from "./paired.ts";
import { type TimeOutcome, type VerdictOptions, timeVerdict, verdictMargin } from "./verdict.ts";

/** The options of a power test. */
export interface PowerOptions {
  /** The count of the cases of the candidate and of the A/A arm. */
  readonly cases: number;
  /** The count of the rounds of each case. The default is 5. */
  readonly rounds?: number;
  /** The true ratio of the candidate time to the baseline time, for example 0.93 for a speedup of 7%. */
  readonly ratio: number;
  /** The standard deviation of the log time of one arm in one round. The default is 0.1. */
  readonly sigma?: number;
  /** The count of the seeded benches. The default is 200. */
  readonly trials?: number;
  /** The seed of the draws. The default is 1. */
  readonly seed?: number | string;
  /** The options of the verdict of each bench. */
  readonly verdict?: VerdictOptions;
}

/** The result of a power test: the share of each outcome over the trials. */
export interface Power {
  readonly trials: number;
  readonly outcomes: Readonly<Record<TimeOutcome, number>>;
  /**
   * The share of the trials whose outcome is the true one. For the rule `difference`, a ratio in the margin of the verdict has the true outcome `same`.
   * That margin is the larger of `margin` and the noise of the pooled band. The pool is the same in each trial, so each trial has the same margin.
   * Out of that margin, and for the rule `band`, the true outcome is `faster` below 1, `slower` above 1 and `same` at 1.
   */
  readonly power: number;
}

/**
 * This function draws `trials` benches and gives the share of each verdict. Each case has its own log scale.
 * Each arm of each round adds a normal noise of `sigma` to the log time.
 */
export function verdictPower(options: PowerOptions): Power {
  const rounds = options.rounds ?? 5;
  const sigma = options.sigma ?? 0.1;
  const trials = options.trials ?? 200;
  if (!Number.isSafeInteger(options.cases) || options.cases < 1) throw new RangeError(`verdictPower: cases is a whole number of 1 or more, not ${options.cases}.`);
  if (!(options.ratio > 0 && Number.isFinite(options.ratio))) throw new RangeError(`verdictPower: the ratio is a finite number above 0, not ${options.ratio}.`);
  const r = random(options.seed ?? 1);
  const bench = (ratio: number, prefix: string): PairedTime[] => {
    const out: PairedTime[] = [];
    for (let c = 0; c < options.cases; c++) {
      const scale = 10 * Math.exp(r.normal());
      for (let round = 0; round < rounds; round++) {
        const a = scale * Math.exp(r.normal(0, sigma));
        const b = scale * ratio * Math.exp(r.normal(0, sigma));
        out.push({ case: `${prefix}${c}`, round, first: firstArm(round, c), a, b });
      }
    }
    return out;
  };
  const truth = trueOutcome(options.ratio, options.verdict);
  const counts: Record<TimeOutcome, number> = { faster: 0, slower: 0, same: 0, "cannot decide": 0 };
  for (let t = 0; t < trials; t++) {
    const aa = bench(1, "aa");
    const candidate = bench(options.ratio, "c");
    counts[timeVerdict(candidate, aa, options.verdict).outcome]++;
  }
  const outcomes = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / trials])) as Record<TimeOutcome, number>;
  return { trials, outcomes, power: outcomes[truth] };
}

/** This function gives the true outcome of a ratio. The margin of the rule `difference` comes first, as in `timeVerdict`. */
function trueOutcome(ratio: number, verdict: VerdictOptions = {}): TimeOutcome {
  if ((verdict.rule ?? "difference") === "difference" && Math.abs(Math.log(ratio)) <= verdictMargin(verdict)) return "same";
  return ratio < 1 ? "faster" : ratio > 1 ? "slower" : "same";
}
