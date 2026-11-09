/**
 * The frozen limits of a measure on each CPU model. A PR job of a measure, for example a p99 time, has no base arm.
 * So its gate compares the read with a limit from earlier reads on the same CPU model. The limit of a model is the mean of its reads
 * plus the noise floor of `@mark1russell7/rigor-statistics`: k sample standard deviations.
 *
 * A limit does not move by itself. When new reads go straight into the limit, a slow regression raises its own limit. So
 * the limits are data in a file of the repository. A nightly run gives only a candidate. `limitChanges` reads a change of
 * the file: a tighter limit is free, and a looser limit needs a new stated reason.
 */
import { mean, noiseFloor, sd } from "@mark1russell7/rigor-statistics";
import { type ModelRead, UNKNOWN_MODEL } from "./model.ts";

/** The format of a file of frozen limits. */
export const MODEL_LIMITS_FORMAT = "rigor-model-limits/1";

/** The direction of a good change of the measure: `lower` for a time, `higher` for a rate. */
export type Better = "lower" | "higher";

/** The rule of a limit: k standard deviations past the mean, from `minimum` reads or more. */
export interface ModelLimitRule {
  /** The number of sample standard deviations. */
  readonly k: number;
  /** The fewest reads of one model that give a limit. */
  readonly minimum: number;
  readonly better: Better;
}

/** The default rule: 3 standard deviations past the mean of 5 reads or more, for a measure where lower is better. */
export const MODEL_LIMIT_RULE: ModelLimitRule = { k: 3, minimum: 5, better: "lower" };

/** One frozen limit of one case on one CPU model, with the reads that it comes from. */
export interface ModelLimit {
  readonly limit: number;
  readonly mean: number;
  readonly sd: number;
  /** The reads of the limit, one for each job. */
  readonly values: readonly number[];
  /** The commit of the code that gave the reads. */
  readonly commit: string;
  /** The date of the freeze, as `YYYY-MM-DD`. */
  readonly date: string;
  /** The reason of a looser limit. A tighter limit or a new model does not need one. */
  readonly reason?: string;
}

/** A file of frozen limits: for each case, the limit on each CPU model. */
export interface ModelLimitsFile {
  readonly format: typeof MODEL_LIMITS_FORMAT;
  /** The name of the measure, for example "the p99 ms of the arm partition". */
  readonly measure: string;
  readonly rule: ModelLimitRule;
  /** The reason of a change of the rule or of the measure. */
  readonly ruleReason?: string;
  readonly limits: Readonly<Record<string, Readonly<Record<string, ModelLimit>>>>;
}

/**
 * The state of a candidate limit. `limit`: the reads give a limit. `too-few`: the model has fewer reads than the rule.
 * `no-spread`: each read is equal, so the reads do not sample the noise. `unknown-model`: the reads have no CPU model.
 */
export type CandidateStatus = "limit" | "too-few" | "no-spread" | "unknown-model";

/** The candidate limit of one case on one CPU model. */
export interface CandidateLimit {
  readonly case: string;
  readonly model: string;
  readonly status: CandidateStatus;
  readonly values: readonly number[];
  /** The mean, the standard deviation and the limit. They are null when the status is not `limit`. */
  readonly mean: number | null;
  readonly sd: number | null;
  readonly limit: number | null;
}

/** This function stops on a rule with a k that is not a positive number or a minimum under 2. */
function checkRule(name: string, rule: ModelLimitRule): void {
  if (!(Number.isFinite(rule.k) && rule.k > 0)) throw new RangeError(`${name}: k is a positive number, not ${rule.k}.`);
  if (!(Number.isInteger(rule.minimum) && rule.minimum >= 2)) throw new RangeError(`${name}: the minimum is a whole number of 2 or more, not ${rule.minimum}.`);
  if (rule.better !== "lower" && rule.better !== "higher") throw new RangeError(`${name}: better is "lower" or "higher", not ${String(rule.better)}.`);
}

/** This function gives the limit of values under a rule: the mean plus the floor, or minus the floor when higher is better. */
function limitOf(values: readonly number[], rule: ModelLimitRule): { mean: number; sd: number; limit: number } {
  const m = mean(values);
  const floor = noiseFloor(values, { k: rule.k, minimum: rule.minimum });
  return { mean: m, sd: sd(values), limit: rule.better === "lower" ? m + floor : m - floor };
}

/**
 * This function gives the candidate limit of each case on each CPU model, sorted by case and then by model. A read
 * with no CPU model does not give a limit, because its runner is not known.
 */
export function candidateLimits(reads: readonly ModelRead[], rule: ModelLimitRule = MODEL_LIMIT_RULE): CandidateLimit[] {
  checkRule("candidateLimits", rule);
  const groups = new Map<string, Map<string, number[]>>();
  for (const read of reads) {
    if (!Number.isFinite(read.value)) throw new RangeError(`candidateLimits: the read of ${read.case} on ${read.model} is not a finite number.`);
    const models = groups.get(read.case) ?? new Map<string, number[]>();
    models.set(read.model, [...(models.get(read.model) ?? []), read.value]);
    groups.set(read.case, models);
  }
  const out: CandidateLimit[] = [];
  for (const caseName of [...groups.keys()].sort()) {
    const models = groups.get(caseName)!;
    for (const model of [...models.keys()].sort()) {
      const values = models.get(model)!;
      const empty = { case: caseName, model, values, mean: null, sd: null, limit: null };
      if (model === UNKNOWN_MODEL) out.push({ ...empty, status: "unknown-model" });
      else if (values.length < rule.minimum) out.push({ ...empty, status: "too-few" });
      else if (values.every((value) => value === values[0])) out.push({ ...empty, status: "no-spread" });
      else out.push({ case: caseName, model, values, ...limitOf(values, rule), status: "limit" });
    }
  }
  return out;
}

/** The commit and the date of a freeze. */
export interface FreezeStamp {
  readonly commit: string;
  /** The date as `YYYY-MM-DD`. */
  readonly date: string;
}

/** This function stops on a commit that is not 7 to 40 hex digits, or a date that is not `YYYY-MM-DD`. */
function checkStamp(name: string, stamp: FreezeStamp): void {
  if (!/^[0-9a-f]{7,40}$/.test(stamp.commit)) throw new RangeError(`${name}: the commit is 7 to 40 hex digits, not ${stamp.commit}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp.date)) throw new RangeError(`${name}: the date is YYYY-MM-DD, not ${stamp.date}.`);
}

/** This function gives a file of frozen limits from the candidates with the status `limit`. The other candidates stay out. */
export function freezeLimits(measure: string, candidates: readonly CandidateLimit[], stamp: FreezeStamp, rule: ModelLimitRule = MODEL_LIMIT_RULE): ModelLimitsFile {
  checkRule("freezeLimits", rule);
  checkStamp("freezeLimits", stamp);
  const limits: Record<string, Record<string, ModelLimit>> = {};
  for (const c of candidates) {
    if (c.status !== "limit") continue;
    limits[c.case] = { ...limits[c.case], [c.model]: { limit: c.limit!, mean: c.mean!, sd: c.sd!, values: c.values, commit: stamp.commit, date: stamp.date } };
  }
  return { format: MODEL_LIMITS_FORMAT, measure, rule, limits };
}

/** The largest relative difference between a stored number and its recomputed value. */
const TOLERANCE = 1e-9;

/** This function tells if two numbers are equal within the relative tolerance. */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * This function gives the faults of a file of frozen limits. A fault is a wrong format, a bad rule or stamp, or too few
 * reads. A limit, a mean or a standard deviation that its values do not give is also a fault. An empty list is a valid file.
 */
export function checkModelLimits(file: ModelLimitsFile): string[] {
  const faults: string[] = [];
  if (file.format !== MODEL_LIMITS_FORMAT) return [`the format is ${String(file.format)}, not ${MODEL_LIMITS_FORMAT}`];
  try {
    checkRule("the rule", file.rule);
  } catch (error) {
    return [(error as Error).message];
  }
  for (const [caseName, models] of Object.entries(file.limits)) {
    for (const [model, entry] of Object.entries(models)) {
      const at = `${caseName} on ${model}`;
      if (model === UNKNOWN_MODEL) faults.push(`${at}: a limit needs a known CPU model`);
      try {
        checkStamp(at, entry);
      } catch (error) {
        faults.push((error as Error).message);
      }
      if (entry.values.length < file.rule.minimum) {
        faults.push(`${at}: ${entry.values.length} values, and the rule needs ${file.rule.minimum} or more`);
        continue;
      }
      if (entry.values.every((value) => value === entry.values[0])) {
        faults.push(`${at}: each value is equal, so the values do not sample the noise`);
        continue;
      }
      const again = limitOf(entry.values, file.rule);
      for (const field of ["limit", "mean", "sd"] as const) {
        if (!near(entry[field], again[field])) faults.push(`${at}: the ${field} is ${entry[field]}, and the values give ${again[field]}`);
      }
    }
  }
  return faults;
}

/** The outcome of a read against a frozen limit. `no read` is not a pass: the model of the read has no limit in the case. */
export type ModelLimitOutcome = "within" | "beyond" | "no read";

/** The read of one value against the frozen limit of its case and CPU model. */
export interface ModelLimitRead {
  readonly case: string;
  readonly model: string;
  readonly value: number;
  readonly limit: number | null;
  readonly outcome: ModelLimitOutcome;
  /** The words of the read, for a gate line. */
  readonly note: string;
}

/** This function reads one value against the frozen limit of its case and CPU model. A model with no limit gives `no read`. */
export function modelLimitRead(file: ModelLimitsFile, read: ModelRead): ModelLimitRead {
  const entry = file.limits[read.case]?.[read.model];
  if (entry === undefined) {
    return { ...read, limit: null, outcome: "no read", note: `${read.model} has no frozen limit in the case ${read.case}, so this read is not a pass` };
  }
  const within = file.rule.better === "lower" ? read.value <= entry.limit : read.value >= entry.limit;
  const side = file.rule.better === "lower" ? "at most" : "at least";
  return {
    ...read,
    limit: entry.limit,
    outcome: within ? "within" : "beyond",
    note: `${read.value} against a limit of ${side} ${entry.limit} on ${read.model}, frozen at ${entry.commit} on ${entry.date}`,
  };
}

/** The kind of a change of one limit. A looser limit lets a worse read pass. */
export type LimitChangeKind = "tighter" | "looser" | "same" | "added" | "removed";

/** The change of one limit between two files. */
export interface LimitChange {
  readonly case: string;
  readonly model: string;
  readonly kind: LimitChangeKind;
  readonly from: number | null;
  readonly to: number | null;
  /** The reason of the new limit, if it has one. */
  readonly reason?: string;
}

/** The changes between two files of frozen limits, and the changes that the rule refuses. */
export interface LimitChanges {
  readonly changes: readonly LimitChange[];
  /** The words of each refused change. An empty list accepts the new file. */
  readonly refused: readonly string[];
}

/**
 * This function reads the change from one file of frozen limits to the next. A tighter limit, a new model and a removed
 * model are free. A removed model gives `no read`, which is not a pass. A looser limit needs a reason that differs from
 * the reason of the old limit. A change of the rule or of the measure needs a new `ruleReason`.
 */
export function limitChanges(before: ModelLimitsFile, after: ModelLimitsFile): LimitChanges {
  for (const file of [before, after]) {
    if (file.format !== MODEL_LIMITS_FORMAT) throw new RangeError(`limitChanges: the format is ${String(file.format)}, not ${MODEL_LIMITS_FORMAT}.`);
  }
  const refused: string[] = [];
  const ruleMoved =
    before.measure !== after.measure || before.rule.k !== after.rule.k || before.rule.minimum !== after.rule.minimum || before.rule.better !== after.rule.better;
  if (ruleMoved && (after.ruleReason === undefined || after.ruleReason.trim() === "" || after.ruleReason === before.ruleReason)) {
    refused.push("the rule or the measure changed with no new ruleReason");
  }
  const looser = (from: number, to: number): boolean => (after.rule.better === "lower" ? to > from : to < from);
  const changes: LimitChange[] = [];
  const cases = [...new Set([...Object.keys(before.limits), ...Object.keys(after.limits)])].sort();
  for (const caseName of cases) {
    const old = before.limits[caseName] ?? {};
    const next = after.limits[caseName] ?? {};
    for (const model of [...new Set([...Object.keys(old), ...Object.keys(next)])].sort()) {
      const a = old[model];
      const b = next[model];
      const reason = b?.reason === undefined ? {} : { reason: b.reason };
      if (a === undefined) {
        changes.push({ case: caseName, model, kind: "added", from: null, to: b!.limit, ...reason });
        continue;
      }
      if (b === undefined) {
        changes.push({ case: caseName, model, kind: "removed", from: a.limit, to: null });
        continue;
      }
      const kind: LimitChangeKind = a.limit === b.limit ? "same" : looser(a.limit, b.limit) ? "looser" : "tighter";
      changes.push({ case: caseName, model, kind, from: a.limit, to: b.limit, ...reason });
      if (kind === "looser" && (b.reason === undefined || b.reason.trim() === "" || b.reason === a.reason)) {
        refused.push(`${caseName} on ${model}: the limit goes from ${a.limit} to ${b.limit} with no new reason`);
      }
    }
  }
  return { changes, refused };
}
