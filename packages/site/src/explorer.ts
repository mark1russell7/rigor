/**
 * The pure part of the time-verdict explorer. The page simulates the paired-time records of a bench with seeded draws.
 * Each decision comes from `@mark1russell7/rigor-bench`: this module only draws the records and gives them to the package.
 */
import { type CaseRatio, type PairedTime, type Power, type TimeVerdict, type VerdictOptions, caseRatios, firstArm, timeVerdict, verdictPower } from "@mark1russell7/rigor-bench";
import { random, type Random } from "@mark1russell7/rigor-generators";
import { seedFrom } from "./seed.ts";

/** The settings of one simulated bench: the true ratio, the noise, the rounds of each case and the seed text. */
export interface Bench {
  /** The true ratio of the candidate time to the baseline time. A value of 0.9 is a speedup of 10%. */
  readonly ratio: number;
  /** The noise of one arm in one round: the standard deviation of its log time, near the coefficient of variation. */
  readonly noise: number;
  readonly rounds: number;
  readonly seed: string;
}

/** The count of the cases of the candidate and of the A/A arm of the run. */
export const CASES = 8;
/** The count of the earlier benches of the pool. Each one gives `CASES` A/A cases. */
export const POOL_RUNS = 4;
/** The rounds that the page offers. */
export const ROUNDS: readonly number[] = [5, 9, 15, 31];
/** The ends of the true ratio and of the noise on the page. */
export const RATIO_RANGE = { min: 0.8, max: 1.25, step: 0.01 } as const;
export const NOISE_RANGE = { min: 0.01, max: 0.3, step: 0.01 } as const;

/**
 * The options of each verdict on the page. The margin is 5% on a log scale. Above the noise cap, the A/A arm of the run is too noisy.
 * The pool comes from `simulate`, so `verdictOptions` adds it.
 */
export const MARGIN = 0.05;
export const NOISE_CAP = Math.log(1.2);

/** A preset of the page: a name, a short label and the settings. */
export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly bench: Omit<Bench, "seed">;
}

export const PRESETS: readonly Preset[] = [
  { id: "faster", label: "Clearly faster", bench: { ratio: 0.85, noise: 0.05, rounds: 9 } },
  { id: "same", label: "Within noise", bench: { ratio: 0.98, noise: 0.02, rounds: 9 } },
  { id: "slower", label: "Clearly slower", bench: { ratio: 1.15, noise: 0.05, rounds: 9 } },
  { id: "noisy", label: "Too noisy to tell", bench: { ratio: 0.92, noise: 0.28, rounds: 5 } },
];

/** The settings of the page when it opens. */
export const START: Bench = { ratio: 0.95, noise: 0.08, rounds: 9, seed: "42" };

/** The records of one simulated bench: the candidate pair and the A/A pair of the run, and the A/A records of the earlier runs. */
export interface Simulated {
  readonly candidate: PairedTime[];
  readonly aa: PairedTime[];
  readonly pool: PairedTime[];
}

/**
 * This function draws the records of one pair. Each case has its own time scale, from 3 to 30 milliseconds approximately.
 * Each arm of each round adds a normal noise to its log time. The order of each round comes from `firstArm`.
 */
function pairRecords(r: Random, ratio: number, noise: number, rounds: number, prefix: string): PairedTime[] {
  const out: PairedTime[] = [];
  for (let c = 0; c < CASES; c++) {
    const scale = 10 * Math.exp(r.normal(0, 0.6));
    for (let round = 0; round < rounds; round++) {
      const a = scale * Math.exp(r.normal(0, noise));
      const b = scale * ratio * Math.exp(r.normal(0, noise));
      out.push({ case: `${prefix}${c + 1}`, round, first: firstArm(round, c), a, b });
    }
  }
  return out;
}

/** This function draws the records of a bench. One seed gives the same records each time, in Node and in each browser. */
export function simulate(bench: Bench): Simulated {
  const r = random(seedFrom(bench.seed));
  const run = r.fork("run");
  const candidate = pairRecords(run.fork("candidate"), bench.ratio, bench.noise, bench.rounds, "case ");
  const aa = pairRecords(run.fork("aa"), 1, bench.noise, bench.rounds, "a/a ");
  const earlier = r.fork("pool");
  const pool = Array.from({ length: POOL_RUNS }, (_, i) => pairRecords(earlier.fork(`run ${i + 1}`), 1, bench.noise, bench.rounds, `run ${i + 1}: a/a `)).flat();
  return { candidate, aa, pool };
}

/** The run of a pooled record: the text before the colon of its case name. */
export const runOf = (record: PairedTime): string => record.case.split(":")[0] ?? record.case;

/** This function gives the options of `timeVerdict` for the records of a bench: the margin, the noise cap and the pool. */
export function verdictOptions(records: Simulated): VerdictOptions {
  return { margin: MARGIN, noiseCap: NOISE_CAP, pool: { records: records.pool, run: runOf } };
}

/** The result of one bench: the records, the verdict of the package and the ratios of the A/A cases. */
export interface Explored {
  readonly records: Simulated;
  readonly verdict: TimeVerdict;
  readonly aaCases: readonly CaseRatio[];
}

/** This function draws a bench and gives the verdict of `timeVerdict`. The page adds no rule of its own. */
export function explore(bench: Bench): Explored {
  const records = simulate(bench);
  const verdict = timeVerdict(records.candidate, records.aa, verdictOptions(records));
  return { records, verdict, aaCases: caseRatios(records.aa) };
}

/**
 * This function gives the power of the rule for benches of these settings: the share of each outcome of `verdictPower`.
 * Each trial draws new candidate and A/A records. The pool stays the pool of the bench on the page.
 * The page does the test in parts, so each part has its own seed.
 */
export function power(bench: Bench, records: Simulated, trials: number, part = 1): Power {
  return verdictPower({ cases: CASES, rounds: bench.rounds, ratio: bench.ratio, sigma: bench.noise, trials, seed: `${bench.seed} power ${part}`, verdict: verdictOptions(records) });
}

/** This function adds the parts of a power test: the trials, and the share of each outcome over all the trials. */
export function mergePower(parts: readonly Power[]): Power {
  const trials = parts.reduce((n, p) => n + p.trials, 0);
  const share = (f: (p: Power) => number): number => (trials === 0 ? 0 : parts.reduce((n, p) => n + f(p) * p.trials, 0) / trials);
  const outcomes = { faster: share((p) => p.outcomes.faster), slower: share((p) => p.outcomes.slower), same: share((p) => p.outcomes.same), "cannot decide": share((p) => p.outcomes["cannot decide"]) };
  return { trials, outcomes, power: share((p) => p.power) };
}

/** This function gives one plain sentence that tells why the package gave its outcome. It uses only the facts of the verdict. */
export function plainWhy(v: TimeVerdict): string {
  if (v.outcome === "cannot decide") {
    if (v.band === undefined) return "The bench has too few cases for a band, so the gate does not decide.";
    if (v.noise?.noisy) return "The A/A arm of this run is too noisy: its spread is above the noise cap, so the gate does not decide.";
    if (v.noise?.biased) return "The A/A arm of this run is biased: its median ratio is far from 1, so the gate does not decide.";
    return "The interval holds 1 and goes out of the same zone, so the records cannot tell a change from noise.";
  }
  if (v.outcome === "same") return "The whole interval is in the same zone, so each change that the records can show is smaller than the noise.";
  if (v.outcome === "faster") return "The whole interval is below 1 and out of the same zone, so the candidate is faster.";
  return "The whole interval is above 1 and out of the same zone, so the candidate is slower.";
}

/** The ends of the axis of the diagram, on the ratio scale. The axis is symmetric on a log scale. */
export const AXIS = { low: 1 / 1.5, high: 1.5 } as const;

/** This function gives the place of a ratio on the axis from 0 to 1, on a log scale. A ratio out of the axis goes to an end. */
export function axisPlace(ratio: number): number {
  const t = (Math.log(ratio) - Math.log(AXIS.low)) / (Math.log(AXIS.high) - Math.log(AXIS.low));
  return Math.min(1, Math.max(0, t));
}

/** The ticks of the axis. */
export const TICKS: readonly number[] = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4];

/** This function gives the text of a ratio as a change of time: 0.9 is "10% faster", and 1.1 is "10% slower". */
export function changeText(ratio: number): string {
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  if (pct === 0) return "no change";
  return ratio < 1 ? `${pct}% faster` : `${pct}% slower`;
}

/** This function gives a ratio with 2 decimals, or 3 decimals for a value near 1. */
export function ratioText(ratio: number): string {
  return Math.abs(ratio - 1) < 0.01 ? ratio.toFixed(3) : ratio.toFixed(2);
}
