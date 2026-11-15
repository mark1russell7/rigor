/**
 * The warm rule of a fresh run. Each child of `timeArm` gives its warm check `warm`: the median of the last half of its
 * samples over the median of the first half. A value near 1 tells that the time of the child did not go down while it
 * counted. The rule compares the warm checks of each arm with the warm checks of the A/A pair.
 */
import { median, quantile } from "@mark1russell7/rigor-statistics";
import type { Arm } from "./paired.ts";

/** A record with the fields of its children. A `FreshRecord` of `/fresh` is such a record. */
export interface WarmRecord {
  readonly case: string;
  readonly fields?: { readonly a: { readonly warm?: number }; readonly b: { readonly warm?: number } };
}

/** The warm value of one case: the median warm check of one arm over the rounds of the case. */
export interface CaseWarm {
  readonly case: string;
  readonly warm: number;
  /** The count of the rounds with a warm check. */
  readonly rounds: number;
}

/**
 * This function gives the warm value of each case for the arm `arm` of the records. The order is the order of the
 * first record of each case. A record with no warm check of the arm does not count. A case with no warm check is not in the list.
 */
export function caseWarms(records: readonly WarmRecord[], arm: Arm = "b"): CaseWarm[] {
  const cases = new Map<string, number[]>();
  for (const record of records) {
    const warm = record.fields?.[arm].warm;
    if (warm === undefined) continue;
    if (!(Number.isFinite(warm) && warm > 0)) throw new RangeError(`caseWarms: a warm check is a finite number above 0, not ${warm} (case ${JSON.stringify(record.case)}).`);
    const list = cases.get(record.case) ?? [];
    list.push(warm);
    cases.set(record.case, list);
  }
  return [...cases].map(([name, list]) => ({ case: name, warm: median(list), rounds: list.length }));
}

/** The warm checks of one arm over the cases. */
export interface WarmCheck {
  /** The count of the cases with a warm value. */
  readonly cases: number;
  readonly median: number;
  readonly p10: number;
  readonly p90: number;
  /** The share of the cases whose warm value is outside the band. Such a case is not a result. */
  readonly outside: number;
}

/** The ends of the band of the warm values. The `Band` of `aaBand` is such a band. */
export interface WarmBand {
  readonly low: number;
  readonly high: number;
}

/** The options of the warm rule. */
export interface WarmOptions {
  /** The id of the A/A pair in the pairs. */
  readonly aa: string;
  /** The band of the warm values, for example `aaBand(pairs[aa], { kind: "case", level: 0.8 })`. */
  readonly band: WarmBand;
  /** The pairs that the rule examines. The default is each pair except the A/A pair. */
  readonly arms?: readonly string[];
  /** The share of cases outside the band that an arm can have in addition to the share of the A/A pair. The default is 0.1. */
  readonly slack?: number;
  /** The range of the median warm value of a warm arm. The default is [0.97, 1.03]. */
  readonly median?: readonly [low: number, high: number];
}

/** The warm checks of one pair, and the result of the rule for it. */
export interface WarmArm extends WarmCheck {
  readonly ok: boolean;
}

/** The result of the warm rule. */
export interface WarmVerdict {
  /** The value `true` when each examined pair is warm. */
  readonly ok: boolean;
  /** The warm checks of the A/A pair. */
  readonly aa: WarmCheck;
  readonly arms: Readonly<Record<string, WarmArm>>;
  /** The cases with the warm value of each examined pair and of the A/A pair in the band. A time gate can read only these cases. */
  readonly steady: readonly string[];
}

/**
 * This function applies the warm rule to the pairs of a fresh run. It reads the warm checks of the arm `b` of each pair.
 * - A pair is warm when its share of cases outside the band is at most the share of the A/A pair plus `slack`.
 *   Its median warm value must also be in the range `median`.
 * - The rule compares each pair with the A/A pair. A fixed limit on the share fails, because the A/A pair also has cases outside.
 * - A pair with no warm check is an error. Thus a rule that cannot read a pair does not pass.
 */
export function warmVerdict(pairs: Readonly<Record<string, readonly WarmRecord[]>>, options: WarmOptions): WarmVerdict {
  const slack = options.slack ?? 0.1;
  const [low, high] = options.median ?? [0.97, 1.03];
  const { band } = options;
  if (!(Number.isFinite(slack) && slack >= 0)) throw new RangeError(`warmVerdict: the slack is a finite number of 0 or more, not ${slack}.`);
  if (!(low <= high) || !Number.isFinite(low) || !Number.isFinite(high)) throw new RangeError("warmVerdict: the range of the median has two finite ends, low before high.");
  if (!(band.low > 0 && band.low <= band.high && Number.isFinite(band.high))) throw new RangeError("warmVerdict: the band has two finite ends above 0, low before high.");
  const ids = options.arms ?? Object.keys(pairs).filter((id) => id !== options.aa);
  const warms = (id: string): CaseWarm[] => {
    const records = pairs[id];
    if (records === undefined) throw new RangeError(`warmVerdict: the run has no pair ${JSON.stringify(id)}.`);
    const list = caseWarms(records);
    if (list.length === 0) throw new RangeError(`warmVerdict: the pair ${JSON.stringify(id)} has no warm check. Its children give warm with 2 samples or more.`);
    return list;
  };
  const inside = (value: number): boolean => value >= band.low && value <= band.high;
  const check = (list: readonly CaseWarm[]): WarmCheck => {
    const values = list.map((c) => c.warm);
    return {
      cases: values.length,
      median: median(values),
      p10: quantile(values, 0.1),
      p90: quantile(values, 0.9),
      outside: values.filter((v) => !inside(v)).length / values.length,
    };
  };
  const aaWarms = warms(options.aa);
  const aa = check(aaWarms);
  const lists = Object.fromEntries(ids.map((id) => [id, warms(id)]));
  const arms = Object.fromEntries(
    ids.map((id) => {
      const result = check(lists[id]!);
      return [id, { ...result, ok: result.outside <= aa.outside + slack && result.median >= low && result.median <= high }];
    }),
  );
  const steadyIn = (list: readonly CaseWarm[]): Set<string> => new Set(list.filter((c) => inside(c.warm)).map((c) => c.case));
  const sets = [aaWarms, ...ids.map((id) => lists[id]!)].map(steadyIn);
  const steady = aaWarms.map((c) => c.case).filter((name) => sets.every((set) => set.has(name)));
  return { ok: Object.values(arms).every((arm) => arm.ok), aa, arms, steady };
}
