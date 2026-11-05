/**
 * The check that a trick does not buy a measure. A control is a strategy made to win one measure and nothing else.
 * A real entry that wins that measure can do the same trick, so the win alone tells little. This check reads the controls of a
 * bench, and it tells which wins need a partner measure beside them. It also tells which measures separate nothing.
 *
 * A test compares paired values with the sign test of `rigor-statistics` and with the Holm correction. The keys of one stratum come
 * from one family of inputs, so they are not independent draws. The p of a test holds only under the sign test's own null: each
 * untied key is a fair coin. A result is about these keys, and this check claims nothing about other inputs.
 */
import { holm, median, signTest, signTestPower } from "@mark1russell7/rigor-statistics";

/** One value of one measure, for one entry and one input. */
export interface MeasureRow {
  /** The name of the measure. */
  readonly measure: string;
  /** The name of the entry: a real strategy or a control. */
  readonly group: string;
  /** The name of the input. Equal keys in two groups name equal work, so the two values make a pair. */
  readonly key: string;
  /** The value. It is finite. No test reads the value of a censored row. */
  readonly value: number;
  /** This field is true when the entry did not finish this input, for example over its budget. */
  readonly censored?: boolean;
  /** The way that the value was made, for example a sample or a full count. Two ways in one measure do not compare. */
  readonly method?: string;
  /** The family of the input. A key has one stratum in all its rows. Rows without a stratum make one group. */
  readonly stratum?: string;
}

/** A measure with no control yet: the reason and the date of the control. */
export interface NoControl {
  /** The reason that the measure has no control at this time. */
  readonly because: string;
  /** The date of the control, as `YYYY-MM-DD`. A date before `asOf` gives the finding `control-late`. */
  readonly until: string;
}

/** The rule of one measure. */
export interface MeasureRule {
  readonly measure: string;
  /** The direction of a better value. */
  readonly sense: "higher" | "lower";
  /** The controls made to win this measure. Each one is in `controls` of the options. */
  readonly controls: readonly string[];
  /** The measures that a control of this measure is to lose. Each one has its own rule. */
  readonly partners: readonly string[];
  /** The smallest median paired difference that counts. Without it, only the test decides, and the output says so. It has no default. */
  readonly resolution?: number;
  /** The reason and the date, for a rule with no controls. */
  readonly noControl?: NoControl;
}

/** The options of `checkMeasures`. */
export interface MeasureCheckOptions {
  readonly rules: readonly MeasureRule[];
  /** Each group that is a control. Each other group is a real entry. */
  readonly controls: readonly string[];
  /** The date of the check, as `YYYY-MM-DD`. The caller gives it, so the function stays pure. */
  readonly asOf: string;
  /** The level of each family of tests. The default is 0.05. */
  readonly alpha?: number;
}

/** One test: `better` beats `other` on the keys that the two finished. */
export interface Comparison {
  readonly better: string;
  readonly other: string;
  readonly stratum: string | undefined;
  /** The keys that both finished. */
  readonly shared: number;
  /** The shared keys with different values. The test reads only these. */
  readonly n: number;
  readonly ties: number;
  /** The keys where `better` has the better value. */
  readonly wins: number;
  /** The keys where `other` has the better value. */
  readonly losses: number;
  /** The median paired difference over the shared keys, with ties. A positive value favours `better`. */
  readonly medianDifference: number;
  /** The p of the sign test. */
  readonly p: number;
  /** The p after the Holm correction. */
  readonly adjusted: number;
  /** The size of the Holm family. */
  readonly family: number;
  /** The least count of untied keys with the power to pass in this family. */
  readonly needs: number;
  /** This field is true when `n` is under `needs`. Such a test beats nothing. */
  readonly tooFew: boolean;
  /** This field is true when the shared keys reach `needs` and ties took them under it. So the two read as equal, not as unread. */
  readonly tied: boolean;
  /** The test passes, and the median difference is over the resolution when the measure has one. */
  readonly beats: boolean;
}

/** The read of one control on one measure and one stratum. */
export interface ControlRead {
  readonly measure: string;
  readonly control: string;
  readonly stratum: string | undefined;
  /**
   * The state of the read. `wins`: no real entry with enough pairs beats the control. `beaten`: a real entry beats it.
   * `too-few`: no real entry has enough shared keys. `no-rows`: no real entry shares a finished key with it.
   */
  readonly status: "wins" | "beaten" | "too-few" | "no-rows";
  /** The real entries with fewer winning keys than the control. It is a plain count with no test. */
  readonly aheadOf: number;
  /** One test for each real entry: `better` is the real entry, and `other` is the control. */
  readonly comparisons: readonly Comparison[];
  /** The real entries that the control beats by test on this stratum. */
  readonly beatsEntries: number;
  /** The tests of the control against the real entries that have power on this stratum. */
  readonly of: number;
  /** One test for each real entry: `better` is the control, and `other` is the real entry. This family is apart from `comparisons`. */
  readonly against: readonly Comparison[];
}

/** The counts of one entry on one measure and one stratum. */
export interface EntryCount {
  readonly group: string;
  readonly stratum: string | undefined;
  readonly finished: number;
  readonly censored: number;
}

/** The read of the spread of one measure on one stratum, over the pairs of real entries. */
export interface SpreadRead {
  readonly stratum: string | undefined;
  /** The pairs of real entries that share a finished key. */
  readonly pairs: number;
  /** The pairs with a test that passes in one direction. */
  readonly separated: number;
  /** The pairs with too few shared keys for the test. A pair that ties on enough keys does not count here. */
  readonly tooFew: number;
  /** The largest absolute median paired difference of a pair. */
  readonly widest: number | undefined;
}

/** The result of one control and one partner on one stratum. */
export interface PartnerRead {
  readonly partner: string;
  /**
   * `lost`: a real entry beats the control at the level divided by the count of partners. Each partner is one more chance to clear the control.
   * `not-lost`: no real entry does. `too-few`: no test has the power at that level. `no-rows`: nothing to read.
   */
  readonly status: "lost" | "not-lost" | "too-few" | "no-rows";
}

/** The result of one control on its measure and one stratum, with its partners. */
export interface GuardRead {
  readonly control: string;
  readonly stratum: string | undefined;
  readonly status: ControlRead["status"];
  readonly partners: readonly PartnerRead[];
}

/** The read of one measure. */
export interface MeasureCheck {
  readonly measure: string;
  readonly sense: "higher" | "lower";
  /** `test only`: a measure with no resolution. `test and resolution`: a measure with one. */
  readonly basis: "test only" | "test and resolution";
  /** The only method of the rows. It is undefined when the rows give none. */
  readonly method: string | undefined;
  /** This field is true when the rows mix methods. The check then has no read of the measure. */
  readonly mixed: boolean;
  readonly guards: readonly GuardRead[];
  readonly spread: readonly SpreadRead[];
  readonly entries: readonly EntryCount[];
  /** The partners that the rule names. */
  readonly partners: readonly string[];
  /** The reason and the date, for a measure with no control. */
  readonly open: NoControl | undefined;
}

/** The kind of a finding. Each finding fails a gate. */
export type MeasureFindingKind = "uncaught" | "weak-control" | "censored-win" | "no-spread" | "too-few" | "mixed-method" | "no-rule" | "no-rows" | "no-control" | "control-late";

/** One finding of the check, with the numbers behind it. */
export interface MeasureFinding {
  readonly kind: MeasureFindingKind;
  readonly measure: string;
  readonly stratum?: string | undefined;
  readonly control?: string;
  /** The count of the partners of the rule, for a finding about the partners of a control. */
  readonly partners?: number;
  /** The finding in plain words, with its numbers. */
  readonly text: string;
  /** The tests behind the finding. */
  readonly comparisons: readonly Comparison[];
}

/** The result of `checkMeasures`. */
export interface MeasureChecks {
  /** The level of each family of tests. */
  readonly alpha: number;
  readonly measures: readonly MeasureCheck[];
  /** Each read of a control, on its own measures and on their partners. */
  readonly reads: readonly ControlRead[];
  readonly findings: readonly MeasureFinding[];
}

/** What a page says about the win of one entry on one measure. */
export interface WinClaim {
  /** This field is true only when a control was read on this measure and this entry beats each control on it. A win by another entry does not count. */
  readonly alone: boolean;
  /** The partners that a winning control loses. When this entry does not beat a control that does not win, or with no read of a control, all partners of the rule. */
  readonly show: readonly string[];
  /** This field is true when this entry does not beat a control on this measure and beats it on no partner. The win then reads the same as the trick. The status of the control does not change this. */
  readonly likeControl: boolean;
  /** The censored keys of this entry and of each control that it does not beat. A page shows them beside the win. */
  readonly censored: { readonly entry: number; readonly controls: readonly { readonly control: string; readonly censored: number }[] };
  /** The reason and the date, for a measure with no control. */
  readonly open: NoControl | undefined;
}

/** The read of one control over the set of measures of a joint claim. */
export interface JointControl {
  readonly control: string;
  /** The measures where the entry beats this control. */
  readonly beaten: readonly string[];
  /** The measures where this control beats the entry. */
  readonly lostTo: readonly string[];
  /** The measures with no read of the entry and this control: no test, or too few keys. A tie on enough keys is a read and does not count here. */
  readonly unread: readonly string[];
  /** This field is true when no measure is unread and the entry beats this control on none. This control also beats the entry on at least one. */
  readonly dominates: boolean;
}

/** The read of one measure of a joint claim. */
export interface JointMeasure {
  readonly measure: string;
  /** The controls that the entry beats on this measure. */
  readonly beats: readonly string[];
  /** The controls that tie the entry on this measure: enough shared keys, and too few keys that differ. */
  readonly tied: readonly string[];
  /** The controls with no read on this measure. A measure with no control has an empty list here and an empty list in `beats`. */
  readonly unread: readonly string[];
}

/**
 * The verdict of a joint claim. `dominated`: a control dominates the entry. `not-ahead`: on a measure with each read made, the entry beats no control.
 * `no-read`: a read that is not there decides the claim, and that is not a pass. `survives`: no control dominates the entry, and the entry beats a control on each measure.
 */
export type JointVerdict = "survives" | "dominated" | "not-ahead" | "no-read";

/** What one real entry earned on a set of measures taken together. */
export interface JointClaim {
  readonly entry: string;
  readonly stratum: string | undefined;
  readonly verdict: JointVerdict;
  /** The controls that dominate the entry. */
  readonly dominatedBy: readonly string[];
  /** The measures where the entry beats no control. */
  readonly notAhead: readonly string[];
  readonly controls: readonly JointControl[];
  readonly measures: readonly JointMeasure[];
}

const DEFAULT_ALPHA = 0.05;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The rows of one measure: for each stratum, for each group, the rows by key. */
type StratumRows = Map<string | undefined, Map<string, Map<string, MeasureRow>>>;

function checkedDate(name: string, date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!DATE.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new RangeError(`checkMeasures: ${name} is a date as YYYY-MM-DD, not ${JSON.stringify(date)}.`);
  return date;
}

/** This function refuses the rules that contradict each other, because a wrong rule reads as a passed check. */
function checkedRules(options: MeasureCheckOptions): Map<string, MeasureRule> {
  const controls = new Set(options.controls);
  const rules = new Map<string, MeasureRule>();
  for (const rule of options.rules) {
    if (rules.has(rule.measure)) throw new RangeError(`checkMeasures: the measure ${JSON.stringify(rule.measure)} has two rules.`);
    rules.set(rule.measure, rule);
  }
  for (const rule of options.rules) {
    const name = JSON.stringify(rule.measure);
    for (const control of rule.controls) if (!controls.has(control)) throw new RangeError(`checkMeasures: the control ${JSON.stringify(control)} of ${name} is not in the controls of the options.`);
    for (const partner of rule.partners) {
      if (partner === rule.measure) throw new RangeError(`checkMeasures: ${name} names itself as a partner.`);
      if (!rules.has(partner)) throw new RangeError(`checkMeasures: the partner ${JSON.stringify(partner)} of ${name} has no rule.`);
    }
    if (rule.resolution !== undefined && !(Number.isFinite(rule.resolution) && rule.resolution >= 0)) throw new RangeError(`checkMeasures: the resolution of ${name} is finite and 0 or more, not ${rule.resolution}.`);
    if (rule.noControl !== undefined) {
      if (rule.controls.length > 0) throw new RangeError(`checkMeasures: ${name} has controls and also noControl.`);
      checkedDate(`the date of ${name}`, rule.noControl.until);
    }
  }
  return rules;
}

/** This function groups the rows. It refuses a value that is not finite, a repeat, and a key in two strata. */
function groupedRows(rows: readonly MeasureRow[]): Map<string, StratumRows> {
  const strata = new Map<string, string | undefined>();
  const measures = new Map<string, StratumRows>();
  for (const row of rows) {
    const where = `${JSON.stringify(row.key)} of ${JSON.stringify(row.group)} on ${JSON.stringify(row.measure)}`;
    if (!Number.isFinite(row.value)) throw new RangeError(`checkMeasures: the value of ${where} is not finite: ${row.value}.`);
    if (strata.has(row.key) && strata.get(row.key) !== row.stratum) throw new RangeError(`checkMeasures: the key ${JSON.stringify(row.key)} has two strata.`);
    strata.set(row.key, row.stratum);
    const measure = measures.get(row.measure) ?? (new Map() as StratumRows);
    measures.set(row.measure, measure);
    const groups = measure.get(row.stratum) ?? new Map<string, Map<string, MeasureRow>>();
    measure.set(row.stratum, groups);
    const keys = groups.get(row.group) ?? new Map<string, MeasureRow>();
    groups.set(row.group, keys);
    if (keys.has(row.key)) throw new RangeError(`checkMeasures: the row ${where} comes twice. State how the repeats reduce to one row.`);
    keys.set(row.key, row);
  }
  return measures;
}

/** This function gives the least count of untied keys with the power to pass at `level`. */
function pairsNeeded(level: number, sides: 1 | 2): number {
  let n = 1;
  while (signTestPower(n, level, sides) === undefined) n += 1;
  return n;
}

/** The numbers of one pair before the correction. */
interface RawTest {
  readonly better: string;
  readonly other: string;
  readonly stratum: string | undefined;
  readonly shared: number;
  readonly wins: number;
  readonly losses: number;
  readonly medianDifference: number;
}

/** This function compares two groups on the keys that both finished. A positive difference favours `better`. */
function rawTest(better: string, other: string, stratum: string | undefined, groups: Map<string, Map<string, MeasureRow>>, sense: MeasureRule["sense"]): RawTest | undefined {
  const a = groups.get(better);
  const b = groups.get(other);
  if (a === undefined || b === undefined) return undefined;
  const differences: number[] = [];
  for (const [key, row] of a) {
    const pair = b.get(key);
    if (pair === undefined || row.censored === true || pair.censored === true) continue;
    differences.push(sense === "higher" ? row.value - pair.value : pair.value - row.value);
  }
  if (differences.length === 0) return undefined;
  const wins = differences.filter((d) => d > 0).length;
  const losses = differences.filter((d) => d < 0).length;
  return { better, other, stratum, shared: differences.length, wins, losses, medianDifference: median(differences) };
}

/** This function corrects one family of tests, over all strata. A test with too few keys beats nothing, even when a step of Holm passes it. */
function corrected(tests: readonly RawTest[], sides: 1 | 2, alpha: number, resolution: number | undefined): Comparison[] {
  if (tests.length === 0) return [];
  const family = tests.length;
  const needs = pairsNeeded(alpha / family, sides);
  const ps = tests.map((t) => signTest(t.wins, t.losses, sides));
  const steps = holm(ps, alpha);
  return tests.map((t, i) => {
    const n = t.wins + t.losses;
    const tooFew = n < needs;
    const size = sides === 1 ? t.medianDifference : Math.abs(t.medianDifference);
    const clears = resolution === undefined || size > resolution;
    return { ...t, n, ties: t.shared - n, p: ps[i] as number, adjusted: steps[i]?.adjusted as number, family, needs, tooFew, tied: tooFew && t.shared >= needs, beats: !tooFew && steps[i]?.reject === true && clears };
  });
}

const stratumText = (stratum: string | undefined): string => (stratum === undefined ? "" : ` in the stratum ${JSON.stringify(stratum)}`);

/** This function tells that a test has too few keys to read, so a tie on enough keys is a read. */
const unread = (c: Comparison): boolean => c.tooFew && !c.tied;

/** The reads of one control on one measure: one for each stratum of the measure. */
function controlReads(measure: string, control: string, data: StratumRows | undefined, rule: MeasureRule, real: readonly string[], alpha: number): ControlRead[] {
  if (data === undefined) return [];
  const tests = [...data].flatMap(([stratum, groups]) => real.flatMap((entry) => rawTest(entry, control, stratum, groups, rule.sense) ?? []));
  const comparisons = corrected(tests, 1, alpha, rule.resolution);
  const attacks = corrected(
    [...data].flatMap(([stratum, groups]) => real.flatMap((entry) => rawTest(control, entry, stratum, groups, rule.sense) ?? [])),
    1,
    alpha,
    rule.resolution,
  );
  return [...data.keys()].map((stratum) => {
    const here = comparisons.filter((c) => c.stratum === stratum);
    const against = attacks.filter((c) => c.stratum === stratum);
    const status: ControlRead["status"] = here.length === 0 ? "no-rows" : here.some((c) => c.beats) ? "beaten" : here.every(unread) ? "too-few" : "wins";
    return { measure, control, stratum, status, aheadOf: here.filter((c) => c.losses > c.wins).length, comparisons: here, beatsEntries: against.filter((c) => c.beats).length, of: against.filter((c) => !unread(c)).length, against };
  });
}

/** The read of the spread of one measure: one family over all pairs of real entries and all strata. */
function spreadReads(data: StratumRows, rule: MeasureRule, real: readonly string[], alpha: number): { reads: SpreadRead[]; comparisons: Comparison[] } {
  const tests = [...data].flatMap(([stratum, groups]) => real.flatMap((entry, i) => real.slice(i + 1).flatMap((other) => rawTest(entry, other, stratum, groups, rule.sense) ?? [])));
  const comparisons = corrected(tests, 2, alpha, rule.resolution);
  const reads = [...data.keys()].map((stratum) => {
    const here = comparisons.filter((c) => c.stratum === stratum);
    const widest = here.length === 0 ? undefined : Math.max(...here.map((c) => Math.abs(c.medianDifference)));
    return { stratum, pairs: here.length, separated: here.filter((c) => c.beats).length, tooFew: here.filter(unread).length, widest };
  });
  return { reads, comparisons };
}

function countsOf(data: StratumRows | undefined): EntryCount[] {
  const counts: EntryCount[] = [];
  for (const [stratum, groups] of data ?? []) {
    for (const [group, keys] of groups) {
      const censored = [...keys.values()].filter((row) => row.censored === true).length;
      counts.push({ group, stratum, finished: keys.size - censored, censored });
    }
  }
  return counts;
}

/** This function gives the methods of a measure. A row with no method counts as one more method beside a named one. */
function methodsOf(data: StratumRows | undefined): readonly (string | undefined)[] {
  const methods = new Set<string | undefined>();
  for (const groups of data?.values() ?? []) for (const keys of groups.values()) for (const row of keys.values()) methods.add(row.method);
  return [...methods];
}

/** This function tells that a test clears a control on one of `partners` partners. One passed partner is enough, so the level divides by their count. */
const clearsPartner = (c: Comparison, partners: number, alpha: number): boolean => c.beats && c.adjusted * partners <= alpha;

/** This function reads a control on one of `partners` partners. A test with too few shared keys for the divided level has no power, so a miss there is not a read. */
const partnerStatus = (read: ControlRead | undefined, partners: number, alpha: number): PartnerRead["status"] => {
  if (read === undefined || read.status === "no-rows") return "no-rows";
  if (read.comparisons.some((c) => clearsPartner(c, partners, alpha))) return "lost";
  const needs = pairsNeeded(alpha / ((read.comparisons[0]?.family ?? 1) * partners), 1);
  return read.comparisons.every((c) => c.shared < needs) ? "too-few" : "not-lost";
};

/** The inputs of the reads, with the reads that the check already made. */
interface Reading {
  readonly rules: Map<string, MeasureRule>;
  readonly data: Map<string, StratumRows>;
  readonly real: readonly string[];
  readonly alpha: number;
  readonly mixed: ReadonlySet<string>;
  readonly memo: Map<string, ControlRead[]>;
}

function readsOf(reading: Reading, measure: string, control: string): ControlRead[] {
  const memoKey = JSON.stringify([measure, control]);
  const known = reading.memo.get(memoKey);
  if (known !== undefined) return known;
  const rule = reading.rules.get(measure) as MeasureRule;
  const reads = reading.mixed.has(measure) ? [] : controlReads(measure, control, reading.data.get(measure), rule, reading.real, reading.alpha);
  reading.memo.set(memoKey, reads);
  return reads;
}

/** The findings of the rows and the controls of one rule that have nothing to read. */
function missingFindings(rule: MeasureRule, reading: Reading): MeasureFinding[] {
  const findings: MeasureFinding[] = [];
  const hasRows = (measure: string, group: string): boolean => [...(reading.data.get(measure)?.values() ?? [])].some((groups) => groups.has(group));
  const missing = (text: string, control?: string): void => {
    findings.push({ kind: "no-rows", measure: rule.measure, ...(control === undefined ? {} : { control }), text, comparisons: [] });
  };
  if (!reading.data.has(rule.measure)) missing(`The measure ${rule.measure} has a rule and no rows.`);
  for (const control of rule.controls) {
    if (reading.data.has(rule.measure) && !hasRows(rule.measure, control)) missing(`The control ${control} has no rows on ${rule.measure}, so it reads as nothing and not as "not beaten".`, control);
    for (const partner of rule.partners) {
      if (!hasRows(partner, control)) missing(`The control ${control} has no rows on the partner ${partner} of ${rule.measure}, so it reads as nothing and not as "not beaten".`, control);
    }
  }
  return findings;
}

/** The findings of the win of a control on one stratum: the partners and the censored keys. */
function winFindings(rule: MeasureRule, read: ControlRead, guard: GuardRead, counts: readonly EntryCount[], partnerReads: readonly ControlRead[]): MeasureFinding[] {
  const findings: MeasureFinding[] = [];
  const where = stratumText(read.stratum);
  const count = guard.partners.length;
  const thin = guard.partners.filter((p) => p.status === "too-few").map((p) => p.partner);
  const noRows = guard.partners.some((p) => p.status === "no-rows");
  const behind = partnerReads.flatMap((r) => r.comparisons);
  if (!guard.partners.some((p) => p.status === "lost")) {
    if (thin.length > 0) {
      findings.push({ kind: "too-few", measure: rule.measure, stratum: read.stratum, control: read.control, partners: count, text: `The control ${read.control} wins ${rule.measure}${where} and loses no partner. Of its ${count} partners, ${thin.join(", ")} have too few keys for a read.`, comparisons: behind });
    } else if (!noRows) {
      const list = count === 0 ? "It has no partner." : `It loses none of its ${count} partners, ${guard.partners.map((p) => p.partner).join(", ")}.`;
      findings.push({ kind: "uncaught", measure: rule.measure, stratum: read.stratum, control: read.control, partners: count, text: `The control ${read.control} wins ${rule.measure}${where}. ${list}`, comparisons: [...read.comparisons, ...behind] });
    }
  }
  const own = counts.find((c) => c.group === read.control && c.stratum === read.stratum)?.censored ?? 0;
  const fewer = counts.filter((c) => c.group !== read.control && c.stratum === read.stratum && read.comparisons.some((t) => t.better === c.group) && c.censored < own);
  if (fewer.length > 0) {
    const list = fewer.map((c) => `${c.group} ${c.censored}`).join(", ");
    findings.push({ kind: "censored-win", measure: rule.measure, stratum: read.stratum, control: read.control, text: `The control ${read.control} wins ${rule.measure}${where} with ${own} censored keys, more than ${list}. Its win can come from the easy keys.`, comparisons: read.comparisons.filter((t) => fewer.some((c) => c.group === t.better)) });
  }
  return findings;
}

/** The read of one rule, with its findings. */
function checkRule(rule: MeasureRule, reading: Reading, asOf: string): { check: MeasureCheck; findings: MeasureFinding[]; reads: ControlRead[] } {
  const data = reading.data.get(rule.measure);
  const methods = methodsOf(data);
  const mixed = reading.mixed.has(rule.measure);
  const counts = countsOf(data);
  const findings = missingFindings(rule, reading);
  const reads: ControlRead[] = [];
  const guards: GuardRead[] = [];

  if (mixed) {
    findings.push({ kind: "mixed-method", measure: rule.measure, text: `The measure ${rule.measure} mixes the methods ${methods.map((m) => m ?? "(none)").join(", ")}. The check has no read of it until the rows are split or marked.`, comparisons: [] });
  }
  if (rule.controls.length === 0) {
    if (rule.noControl === undefined) findings.push({ kind: "no-control", measure: rule.measure, text: `The measure ${rule.measure} has no control and no noControl with a date.`, comparisons: [] });
    else if (rule.noControl.until < asOf) findings.push({ kind: "control-late", measure: rule.measure, text: `The control of ${rule.measure} was due on ${rule.noControl.until}, and the date of the check is ${asOf}.`, comparisons: [] });
  }

  for (const control of rule.controls) {
    for (const read of readsOf(reading, rule.measure, control)) {
      const partnerReads = rule.partners.map((partner) => readsOf(reading, partner, control).find((r) => r.stratum === read.stratum));
      const partners = rule.partners.map((partner, i) => ({ partner, status: partnerStatus(partnerReads[i], rule.partners.length, reading.alpha) }));
      const guard = { control, stratum: read.stratum, status: read.status, partners };
      guards.push(guard);
      reads.push(read, ...partnerReads.filter((r) => r !== undefined));
      if (read.status === "wins") findings.push(...winFindings(rule, read, guard, counts, partnerReads.filter((r) => r !== undefined)));
    }
  }
  const controlComparisons = guards.length === 0 ? [] : reads.filter((r) => r.measure === rule.measure).flatMap((r) => r.comparisons);
  if (rule.controls.length > 0 && guards.length > 0 && !mixed) {
    if (guards.every((g) => g.status === "too-few" || g.status === "no-rows")) {
      const needs = Math.max(0, ...controlComparisons.map((c) => c.needs));
      findings.push({ kind: "too-few", measure: rule.measure, text: `No control of ${rule.measure} has enough pairs for a read. A test needs ${needs} untied pairs.`, comparisons: controlComparisons });
    } else {
      for (const control of rule.controls) {
        const own = reads.filter((r) => r.measure === rule.measure && r.control === control);
        const of = own.reduce((sum, r) => sum + r.of, 0);
        if (of > 0 && own.every((r) => r.beatsEntries === 0)) {
          findings.push({ kind: "weak-control", measure: rule.measure, control, text: `The control ${control} beats 0 of ${of} real entries on ${rule.measure} by test, in all strata. The trick buys nothing.`, comparisons: own.flatMap((r) => r.against) });
        }
      }
    }
  }

  let spread: SpreadRead[] = [];
  if (data !== undefined && !mixed) {
    const { reads: spreadRows, comparisons } = spreadReads(data, rule, reading.real, reading.alpha);
    spread = spreadRows;
    const testable = comparisons.filter((c) => !unread(c));
    if (comparisons.length > 0 && testable.length === 0) {
      findings.push({ kind: "too-few", measure: rule.measure, text: `No pair of real entries has enough keys for a read of the spread of ${rule.measure}. A test needs ${comparisons[0]?.needs} untied pairs.`, comparisons: [] });
    } else if (testable.length > 0 && !comparisons.some((c) => c.beats)) {
      const widest = Math.max(...comparisons.map((c) => Math.abs(c.medianDifference)));
      const basis = rule.resolution === undefined ? "by the test only" : `by the test and the resolution ${rule.resolution}`;
      findings.push({ kind: "no-spread", measure: rule.measure, text: `No pair of the ${comparisons.length} pairs of real entries separates on ${rule.measure}, ${basis}. The widest median difference is ${widest}.`, comparisons: [...comparisons].sort((a, b) => a.adjusted - b.adjusted).slice(0, 1) });
    }
  }

  const check: MeasureCheck = {
    measure: rule.measure,
    sense: rule.sense,
    basis: rule.resolution === undefined ? "test only" : "test and resolution",
    method: mixed ? undefined : methods[0],
    mixed,
    guards,
    spread,
    entries: counts,
    partners: rule.partners,
    open: rule.noControl,
  };
  return { check, findings, reads };
}

/**
 * This function reads the controls and the spread of each measure of a bench.
 *
 * - A control wins a measure when no real entry beats it on the keys that both finished. A tie counts for the control.
 * - A real entry beats a control when the Holm-corrected sign test passes and the median paired difference is over the resolution.
 * - One Holm family holds the tests of one control on one measure over all real entries and all strata.
 * - One more Holm family holds the tests of one control against the real entries, with the same need and resolution. A control that beats none of them is weak.
 * - One Holm family holds the tests of the spread of one measure over all pairs of real entries and all strata.
 * - A test with fewer untied keys than `signTestPower` needs for that family reads `tooFew` and beats nothing.
 * - A test with enough shared keys and too few untied keys is `tied`. The two entries read as equal, so a constant measure is `no-spread` and not `too-few`.
 * - A control loses a partner only at the level divided by the count of its partners. One passed partner clears `uncaught`, so each partner is one more chance.
 *
 * The function throws a `RangeError` for a value that is not finite, a repeat of measure, group and key, or a key in two strata.
 * It also throws one for rules that contradict each other.
 * The rules, the controls and the date are stated, so the result depends only on the arguments.
 */
export function checkMeasures(rows: readonly MeasureRow[], options: MeasureCheckOptions): MeasureChecks {
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`checkMeasures: alpha is over 0 and under 1, not ${alpha}.`);
  const asOf = checkedDate("asOf", options.asOf);
  const rules = checkedRules(options);
  const data = groupedRows(rows);
  const controls = new Set(options.controls);
  const real = [...new Set(rows.map((row) => row.group))].filter((group) => !controls.has(group));
  const mixed = new Set([...data.keys()].filter((measure) => methodsOf(data.get(measure)).length > 1));
  const reading: Reading = { rules, data, real, alpha, mixed, memo: new Map() };

  const findings: MeasureFinding[] = [];
  for (const measure of data.keys()) {
    if (!rules.has(measure)) findings.push({ kind: "no-rule", measure, text: `The measure ${measure} has rows and no rule.`, comparisons: [] });
  }
  const measures: MeasureCheck[] = [];
  const reads = new Map<string, ControlRead>();
  for (const rule of options.rules) {
    const result = checkRule(rule, reading, asOf);
    measures.push(result.check);
    findings.push(...result.findings);
    for (const read of result.reads) reads.set(JSON.stringify([read.measure, read.control, read.stratum ?? null]), read);
  }
  return { alpha, measures, reads: [...reads.values()], findings };
}

/**
 * This function tells what a page says about the win of one real entry on one measure.
 * The claim is about this entry: only this entry beating the control, on this measure or on a partner, clears the entry. A win by another entry clears nothing.
 * With a stratum, the function reads that stratum. Without one, it reads the rows with no stratum.
 * The function throws a `RangeError` for a measure with no read and for an entry that the rows do not hold.
 */
export function winClaim(check: MeasureChecks, measure: string, entry: string, stratum?: string): WinClaim {
  const read = check.measures.find((m) => m.measure === measure);
  if (read === undefined) throw new RangeError(`winClaim: the measure ${JSON.stringify(measure)} has no rule.`);
  const count = read.entries.find((c) => c.group === entry && c.stratum === stratum);
  if (count === undefined) throw new RangeError(`winClaim: the entry ${JSON.stringify(entry)} has no rows on ${JSON.stringify(measure)}${stratumText(stratum)}.`);
  const guards = read.guards.filter((g) => g.stratum === stratum);
  const winning = guards.filter((g) => g.status === "wins");
  const lostByControl = (guard: GuardRead): readonly string[] => guard.partners.filter((p) => p.status === "lost").map((p) => p.partner);
  const testsOf = (of: string, control: string): readonly Comparison[] => check.reads.find((r) => r.measure === of && r.control === control && r.stratum === stratum)?.comparisons ?? [];
  const notBeaten = guards.filter((g) => !testsOf(measure, g.control).some((c) => c.better === entry && c.beats));
  const clearsOnPartner = (guard: GuardRead): boolean => guard.partners.some((p) => testsOf(p.partner, guard.control).some((c) => c.better === entry && clearsPartner(c, guard.partners.length, check.alpha)));
  const countOf = (control: string): number => read.entries.find((c) => c.group === control && c.stratum === stratum)?.censored ?? 0;
  const alone = guards.length > 0 && notBeaten.length === 0;
  const onlyWinners = notBeaten.length > 0 && notBeaten.every((g) => g.status === "wins");
  const show = onlyWinners ? [...new Set(winning.flatMap(lostByControl))] : alone ? [] : read.partners;
  return {
    alone,
    show,
    likeControl: notBeaten.some((guard) => !clearsOnPartner(guard)),
    censored: { entry: count.censored, controls: notBeaten.map((g) => ({ control: g.control, censored: countOf(g.control) })) },
    open: read.open,
  };
}

/**
 * This function tells what one real entry earned on a set of measures taken together. Each win of a control loses a partner, so one measure cannot call a win.
 * A control dominates the entry when the entry beats it on no measure of the set, and it beats the entry on at least one. A tie does not clear a control.
 * The entry survives when no control dominates it and it beats at least one control on each measure. The function adds no test: it reads the tests of `check`.
 * With a stratum, the function reads that stratum. Without one, it reads the rows with no stratum.
 * The function throws a `RangeError` for an empty set, a repeat, a measure with no rule and an entry that the rows do not hold.
 */
export function jointClaim(check: MeasureChecks, measures: readonly string[], entry: string, stratum?: string): JointClaim {
  if (measures.length === 0) throw new RangeError("jointClaim: the set of measures is empty.");
  if (new Set(measures).size !== measures.length) throw new RangeError("jointClaim: the set of measures has a repeat.");
  for (const measure of measures) {
    const read = check.measures.find((m) => m.measure === measure);
    if (read === undefined) throw new RangeError(`jointClaim: the measure ${JSON.stringify(measure)} has no rule.`);
    if (!read.mixed && !read.entries.some((c) => c.group === entry && c.stratum === stratum)) throw new RangeError(`jointClaim: the entry ${JSON.stringify(entry)} has no rows on ${JSON.stringify(measure)}${stratumText(stratum)}.`);
  }
  const reads = check.reads.filter((r) => r.stratum === stratum && measures.includes(r.measure));
  const names = [...new Set(reads.map((r) => r.control))];
  const testOf = (measure: string, control: string): { readonly mine: Comparison | undefined; readonly theirs: Comparison | undefined } => {
    const read = reads.find((r) => r.measure === measure && r.control === control);
    return { mine: read?.comparisons.find((c) => c.better === entry), theirs: read?.against.find((c) => c.other === entry) };
  };
  const noRead = (test: Comparison | undefined): boolean => test === undefined || unread(test);
  const controls = names.map((control): JointControl => {
    const beaten = measures.filter((m) => testOf(m, control).mine?.beats === true);
    const lostTo = measures.filter((m) => testOf(m, control).theirs?.beats === true);
    const missing = measures.filter((m) => noRead(testOf(m, control).mine));
    return { control, beaten, lostTo, unread: missing, dominates: beaten.length === 0 && lostTo.length > 0 && missing.length === 0 };
  });
  const measureReads = measures.map((measure): JointMeasure => ({
    measure,
    beats: names.filter((c) => testOf(measure, c).mine?.beats === true),
    tied: names.filter((c) => testOf(measure, c).mine?.tied === true),
    unread: names.filter((c) => noRead(testOf(measure, c).mine)),
  }));
  const dominatedBy = controls.filter((c) => c.dominates).map((c) => c.control);
  const notAhead = measureReads.filter((m) => m.beats.length === 0).map((m) => m.measure);
  // A measure with no control at all has nothing to read, so it cannot close the claim as `not-ahead`.
  const closed = measureReads.some((m) => m.beats.length === 0 && m.unread.length === 0 && names.some((c) => testOf(m.measure, c).mine !== undefined));
  // An unread test can hide a win of the entry, so a control that leads on another measure stays open.
  const undecided = controls.some((c) => c.beaten.length === 0 && c.lostTo.length > 0 && c.unread.length > 0);
  const verdict: JointVerdict = dominatedBy.length > 0 ? "dominated" : closed ? "not-ahead" : notAhead.length > 0 || undecided ? "no-read" : "survives";
  return { entry, stratum, verdict, dominatedBy, notAhead, controls, measures: measureReads };
}
