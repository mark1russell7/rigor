import { random } from "@mark1russell7/rigor-generators";

/**
 * An open-loop schedule fixes the time of each arrival before the first request starts. No time
 * depends on a reply. Thus a slow system cannot slow its own load, and a measure can count from the
 * planned time.
 *
 * A profile is a rate over time, in straight pieces. One algorithm gives each arrival process. The
 * cumulative rate turns a process of rate 1 into a process that follows the profile, by the
 * time-rescaling theorem. `uniform` and `poisson` differ only in that process of rate 1.
 */

/** This value is the format of a schedule. */
export const SCHEDULE_FORMAT = "rigor-schedule/1";

/** A phase is one straight piece of a profile. Its rate moves from `from` to `to`, in arrivals each second, over `ms`. */
export interface Phase {
  readonly ms: number;
  readonly from: number;
  readonly to: number;
}

/** A profile is a list of phases, one after the other. */
export type Profile = readonly Phase[];

/** This word names the arrival process. `uniform` has no random part, and `poisson` has independent gaps. */
export type Arrivals = "uniform" | "poisson";

/** These options select the arrival process. Only `poisson` has a seed. */
export type ScheduleOptions = { readonly arrivals: "uniform" } | { readonly arrivals: "poisson"; readonly seed: number | string };

/** A schedule is data, thus a record can keep the plan that a driver followed. */
export interface Schedule {
  readonly format: typeof SCHEDULE_FORMAT;
  readonly arrivals: Arrivals;
  readonly seed: number | string | null;
  readonly profile: Profile;
  /** These are the planned times, in ms from the start, in order. */
  readonly times: readonly number[];
}

/** This function gives one phase with a fixed rate. */
export function constant(rate: number, ms: number): Profile {
  return [{ ms, from: rate, to: rate }];
}

/** This function gives one phase with a rate that moves in a line. */
export function ramp(from: number, to: number, ms: number): Profile {
  return [{ ms, from, to }];
}

/** This function gives one fixed phase for each rate, each with the length `ms`. */
export function steps(rates: readonly number[], ms: number): Profile {
  return rates.flatMap((rate) => constant(rate, ms));
}

/** This function gives a fixed rate with one interval at a higher rate. */
export function spike(base: number, peak: number, shape: { readonly before: number; readonly width: number; readonly after: number }): Profile {
  return [...constant(base, shape.before), ...constant(peak, shape.width), ...constant(base, shape.after)];
}

/** This function gives each problem of a profile. An empty list means that the profile is valid. */
export function checkProfile(profile: Profile): readonly string[] {
  const out: string[] = [];
  if (profile.length === 0) out.push("The profile has no phases.");
  profile.forEach((phase, index) => {
    if (!(phase.ms > 0) || !Number.isFinite(phase.ms)) out.push(`The phase ${index}: the length is more than 0, not ${phase.ms}.`);
    for (const rate of [phase.from, phase.to]) if (!(rate >= 0) || !Number.isFinite(rate)) out.push(`The phase ${index}: a rate is 0 or more, not ${rate}.`);
  });
  return out;
}

/** This function gives the number of arrivals of a phase on average. */
const areaOf = (phase: Phase): number => (((phase.from + phase.to) / 2) * phase.ms) / 1000;

/** This function gives the number of arrivals of a profile on average: the area under its rate. */
export function expectedArrivals(profile: Profile): number {
  return profile.reduce((sum, phase) => sum + areaOf(phase), 0);
}

/**
 * This function gives the time in a phase, in ms, at which its cumulative rate reaches `area`. The
 * form has no division by the slope, thus it holds for a flat phase and for a phase that starts at 0.
 * Rounding can move the last arrival of a falling ramp past the end of the root, thus the root stops at 0.
 */
const inverse = (phase: Phase, area: number): number => {
  if (area === 0) return 0;
  const seconds = phase.ms / 1000;
  const root = Math.sqrt(Math.max(0, phase.from * phase.from + (2 * (phase.to - phase.from) * area) / seconds));
  return Math.min(phase.ms, (2 * area * 1000) / (phase.from + root));
};

/** This function gives the positions of the process of rate 1, up to `total`. */
const unitProcess = (total: number, options: ScheduleOptions): number[] => {
  const out: number[] = [];
  if (options.arrivals === "uniform") {
    // the middle of each unit gives an exact count, and a first arrival half a gap after the start
    for (let at = 0.5; at < total; at += 1) out.push(at);
    return out;
  }
  const rng = random(options.seed);
  for (let at = -Math.log(1 - rng.next()); at < total; at += -Math.log(1 - rng.next())) out.push(at);
  return out;
};

/**
 * This function gives the schedule of a profile. The same profile and the same options give the same
 * times on one platform. A `poisson` schedule uses `Math.log`, thus a record keeps its times, and a
 * later run reads them from the record. This function throws a `RangeError` for a profile with problems.
 */
export function schedule(profile: Profile, options: ScheduleOptions): Schedule {
  const problems = checkProfile(profile);
  if (problems.length > 0) throw new RangeError(`schedule: ${problems.join(" ")}`);
  const times: number[] = [];
  let phase = 0;
  let before = 0;
  let start = 0;
  for (const at of unitProcess(expectedArrivals(profile), options)) {
    while (phase < profile.length - 1 && at >= before + areaOf(profile[phase] as Phase)) {
      before += areaOf(profile[phase] as Phase);
      start += (profile[phase] as Phase).ms;
      phase += 1;
    }
    times.push(start + inverse(profile[phase] as Phase, at - before));
  }
  return { format: SCHEDULE_FORMAT, arrivals: options.arrivals, seed: options.arrivals === "poisson" ? options.seed : null, profile, times };
}
