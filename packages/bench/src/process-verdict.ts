/**
 * The verdict of each case over k fresh processes. Each fresh process of Node.js is one sample, because each user gets
 * one process. In each process, a gate script times each case and gives one ratio, with the A/A band of the process.
 *
 * A case passes two checks over its first k valid processes:
 * - (a) The median ratio is at most `limit`.
 * - (b) The count of ratios above the slow line `slow` is at most `maxSlow`. Without `maxSlow`, the count is a record only.
 *
 * Check (b) is the tail rule of `tailLimitVerdict` with the rank `maxSlow + 1`. Here each process has its own A/A band,
 * and a process counts only when its band contains 1. With `slow` equal to `limit` and `maxSlow` 0, check (b) is "the
 * worst ratio is at most the limit". Thus a read can also be the median ratio of one job, and the verdict reads k jobs.
 * The limits come from earlier runs, for example with `runLimit`.
 *
 * A noisy process cannot decide a case. With the limit `noiseCap`, a process counts only when the A/A noise of its band
 * is at most the cap. Thus a case with too many noisy processes is `cannot decide`, and a gate fails on it.
 */
import { median } from "@mark1russell7/rigor-statistics";
import { type Gate, gateOf } from "./gate.ts";
import type { LimitOutcome } from "./limit.ts";

/** One ratio of one case in one process. */
export interface ProcessRead {
  /** The id of the process. */
  readonly process: string;
  readonly case: string;
  /** The ratio of the case in the process, where lower is better. It is a finite number above 0. */
  readonly ratio: number;
  /**
   * The A/A band of the process, low and high. The read is valid only when the band contains 1 and its noise is at most
   * the noise cap of the case. A read with no band is valid only when the case has no noise cap.
   */
  readonly aa?: readonly [number, number];
  /** A fault of the case in the process, for example a wrong result. A fault blocks the case. */
  readonly fault?: string;
}

/** The limits of one case. */
export interface ProcessLimits {
  /** The largest median ratio. */
  readonly limit: number;
  /** The slow line. The default is `limit`. */
  readonly slow?: number;
  /** The largest count of valid processes above the slow line. Without it, the count is a record only. */
  readonly maxSlow?: number;
  /**
   * The largest A/A noise of a valid read, on a log scale, as `readNoise` gives it. A read above it is noisy, and the case
   * does not use it. Without it, each band that contains 1 is valid. Take it from the A/A noise of earlier quiet runs.
   */
  readonly noiseCap?: number;
}

/** The options of `processVerdict`. */
export interface ProcessOptions {
  /** The count of valid processes that decides each case: a whole number of 1 or more. */
  readonly k: number;
  /** The limits of all the cases, or a function that gives the limits of one case. */
  readonly limits: ProcessLimits | ((caseName: string) => ProcessLimits);
  /**
   * The ids of all the processes of the run, in their order. A process of the list with no read of a case is missing for
   * that case, for example a process that stopped. The default is the processes of the reads, in the order of their first read.
   */
  readonly processes?: readonly string[];
}

/** The verdict of one case over the processes. */
export interface CaseProcesses {
  readonly case: string;
  readonly outcome: LimitOutcome;
  readonly limit: number;
  readonly slow: number;
  readonly maxSlow: number | undefined;
  /** The noise cap of the case, or undefined when the case has no noise cap. */
  readonly noiseCap: number | undefined;
  /** The ratios of the first k valid processes, in the order of the processes. */
  readonly ratios: readonly number[];
  /** The ids of the processes of `ratios`. */
  readonly used: readonly string[];
  /** The median of `ratios`, or undefined when there are no ratios. */
  readonly median: number | undefined;
  /** The count of `ratios` above the slow line. */
  readonly slowCount: number;
  /** The processes with a read whose A/A band does not contain 1. */
  readonly invalid: readonly string[];
  /** The processes with a noisy read: its band contains 1, but its noise is above the noise cap or not known. */
  readonly noisy: readonly string[];
  /** The processes with no read of the case. */
  readonly missing: readonly string[];
  /** The faults of the case, each as `<process>: <fault>`. */
  readonly faults: readonly string[];
  /** The count of valid processes that the case still needs. It is 0 when the case has an outcome, or when more processes cannot give one. */
  readonly more: number;
  /** The reason of the outcome, in one sentence. */
  readonly reason: string;
}

/** The verdict of a run of k processes: the gate of its cases, with the facts that it uses. */
export interface ProcessVerdict extends Gate {
  readonly k: number;
  readonly cases: readonly CaseProcesses[];
  /** The largest `more` of a case. Start at least this count of processes before the next read. */
  readonly more: number;
}

/**
 * This function gives the A/A noise of a read on a log scale. The noise is the larger distance from 0 of the logs of the
 * two ends of its band. A read with no band has no known noise, so the value is undefined.
 */
export function readNoise(read: ProcessRead): number | undefined {
  return read.aa === undefined ? undefined : Math.max(Math.abs(Math.log(read.aa[0])), Math.abs(Math.log(read.aa[1])));
}

/**
 * This function tells if a read is valid. Its A/A band contains 1, and its noise is at most `noiseCap`. Without
 * `noiseCap`, a read with no band is valid. With `noiseCap`, a read with no band is not valid, because its noise is not known.
 */
export function isValidRead(read: ProcessRead, noiseCap?: number): boolean {
  if (read.aa === undefined) return noiseCap === undefined;
  return containsOne(read.aa) && (noiseCap === undefined || readNoise(read)! <= noiseCap);
}

/** This function tells if a band contains 1. */
function containsOne(band: readonly [number, number]): boolean {
  return band[0] <= 1 && band[1] >= 1;
}

/**
 * This function gives the verdict of each case over k processes, and the gate of the cases.
 * - A case with a fault in a process is `beyond`. A case with a missing process is `cannot decide`.
 * - The case reads its first k valid processes, in the order of the processes. Each other valid process is not used.
 * - A process is valid when its A/A band contains 1, and its noise is at most the noise cap of the case.
 * - The case is `beyond` when check (a) or check (b) fails, and else `within`.
 * - With fewer than k valid processes, the case is `cannot decide`, and `more` tells the count that it still needs.
 * - A case is `beyond` before k valid processes when the reads already fail a check for each value of the other processes.
 *   This occurs when more than `maxSlow` ratios are above the slow line, or when more than half of k ratios are above the limit.
 * - The function refuses a bad option, a bad read and two reads of one case in one process.
 * - It also refuses a read of a process that the option `processes` does not name.
 */
export function processVerdict(reads: readonly ProcessRead[], options: ProcessOptions): ProcessVerdict {
  const { k } = options;
  if (!(Number.isInteger(k) && k >= 1)) throw new RangeError(`processVerdict: k is a whole number of 1 or more, not ${k}.`);
  const order = options.processes ?? [...new Set(reads.map((r) => r.process))];
  const known = new Set(order);
  if (known.size !== order.length) throw new RangeError("processVerdict: the list of processes names a process twice.");
  const byCase = new Map<string, Map<string, ProcessRead>>();
  for (const read of reads) {
    checkRead(read, known);
    const list = byCase.get(read.case) ?? new Map<string, ProcessRead>();
    if (list.has(read.process)) throw new RangeError(`processVerdict: the process ${JSON.stringify(read.process)} has two reads of the case ${JSON.stringify(read.case)}.`);
    list.set(read.process, read);
    byCase.set(read.case, list);
  }
  const cases = [...byCase].map(([name, list]) => caseVerdict(name, list, order, k, limitsOf(options.limits, name)));
  return { ...gateOf(cases), k, cases, more: Math.max(0, ...cases.map((c) => c.more)) };
}

/** This function gives one line of a case: its outcome, the median, the slow count and the ratio of each process. */
export function processCaseLine(c: CaseProcesses): string {
  const median = c.median === undefined ? "no median" : `median ${round(c.median)}`;
  const most = c.maxSlow === undefined ? "a record only" : `at most ${c.maxSlow}`;
  const ratios = c.ratios.length === 0 ? "" : `, ratios ${c.ratios.map((r) => round(r)).join(", ")}`;
  const cap = c.noiseCap === undefined ? "" : `, noise cap ${c.noiseCap}, ${c.noisy.length} noisy`;
  return `${c.outcome} ${c.case}: ${median} of ${c.ratios.length} valid processes (limit ${c.limit}${cap}), ${c.slowCount} above the slow line ${c.slow} (${most})${ratios}. ${c.reason}`;
}

/** This function examines one read. */
function checkRead(read: ProcessRead, known: ReadonlySet<string>): void {
  const where = `the read of the case ${JSON.stringify(read.case)} in the process ${JSON.stringify(read.process)}`;
  if (!known.has(read.process)) throw new RangeError(`processVerdict: the list of processes does not name the process of ${where}.`);
  if (!(Number.isFinite(read.ratio) && read.ratio > 0)) throw new RangeError(`processVerdict: the ratio of ${where} is a finite number above 0, not ${read.ratio}.`);
  if (read.aa !== undefined) {
    const [low, high] = read.aa;
    if (!(Number.isFinite(low) && Number.isFinite(high) && low <= high)) throw new RangeError(`processVerdict: the A/A band of ${where} is two finite numbers, low then high, not ${low} and ${high}.`);
  }
}

/** The limits of one case, with the default slow line. */
interface CaseLimits {
  readonly limit: number;
  readonly slow: number;
  readonly maxSlow: number | undefined;
  readonly noiseCap: number | undefined;
}

/** This function gives the limits of one case, with the default slow line, and examines them. */
function limitsOf(limits: ProcessOptions["limits"], name: string): CaseLimits {
  const l = typeof limits === "function" ? limits(name) : limits;
  const slow = l.slow ?? l.limit;
  if (!(Number.isFinite(l.limit) && l.limit > 0)) throw new RangeError(`processVerdict: the limit of the case ${JSON.stringify(name)} is a finite number above 0, not ${l.limit}.`);
  if (!(Number.isFinite(slow) && slow > 0)) throw new RangeError(`processVerdict: the slow line of the case ${JSON.stringify(name)} is a finite number above 0, not ${slow}.`);
  if (l.maxSlow !== undefined && !(Number.isInteger(l.maxSlow) && l.maxSlow >= 0)) throw new RangeError(`processVerdict: maxSlow of the case ${JSON.stringify(name)} is a whole number of 0 or more, not ${l.maxSlow}.`);
  if (l.noiseCap !== undefined && !(Number.isFinite(l.noiseCap) && l.noiseCap >= 0)) throw new RangeError(`processVerdict: the noise cap of the case ${JSON.stringify(name)} is a finite number of 0 or more, not ${l.noiseCap}.`);
  return { limit: l.limit, slow, maxSlow: l.maxSlow, noiseCap: l.noiseCap };
}

/** This function gives the verdict of one case. */
function caseVerdict(
  name: string,
  list: ReadonlyMap<string, ProcessRead>,
  order: readonly string[],
  k: number,
  limits: CaseLimits,
): CaseProcesses {
  const { limit, slow, maxSlow, noiseCap } = limits;
  const present = order.flatMap((p) => list.get(p) ?? []);
  const faults = present.filter((r) => r.fault !== undefined).map((r) => `${r.process}: ${r.fault}`);
  const missing = order.filter((p) => !list.has(p));
  // A read is invalid when its band does not contain 1, and noisy when its band contains 1 but it is not valid.
  const biased = (r: ProcessRead): boolean => r.aa !== undefined && !containsOne(r.aa);
  const invalid = present.filter(biased).map((r) => r.process);
  const noisy = present.filter((r) => !biased(r) && !isValidRead(r, noiseCap)).map((r) => r.process);
  const usedReads = present.filter((r) => isValidRead(r, noiseCap)).slice(0, k);
  const ratios = usedReads.map((r) => r.ratio);
  const m = ratios.length === 0 ? undefined : median(ratios);
  const slowCount = ratios.filter((r) => r > slow).length;
  const aboveLimit = ratios.filter((r) => r > limit).length;
  const facts = { case: name, limit, slow, maxSlow, noiseCap, ratios, used: usedReads.map((r) => r.process), median: m, slowCount, invalid, noisy, missing, faults };
  const slowFails = maxSlow !== undefined && slowCount > maxSlow;
  const slowText = `${slowCount} valid processes are above the slow line ${slow}, and the limit is ${maxSlow}`;
  if (faults.length > 0) return { ...facts, outcome: "beyond", more: 0, reason: `${faults.length} processes have a fault. The first is ${JSON.stringify(faults[0])}.` };
  if (missing.length > 0) {
    return { ...facts, outcome: "cannot decide", more: 0, reason: `${missing.length} of ${order.length} processes have no read of the case. The first is ${JSON.stringify(missing[0])}.` };
  }
  if (ratios.length < k) {
    // More than half of k ratios above the limit put the median of each set of k ratios above the limit.
    if (aboveLimit > Math.floor(k / 2)) return { ...facts, outcome: "beyond", more: 0, reason: `${aboveLimit} of the ${k} processes are above the limit ${limit}, so the median is above it. The run has ${ratios.length} valid processes.` };
    if (slowFails) return { ...facts, outcome: "beyond", more: 0, reason: `${slowText}. The run has ${ratios.length} valid processes of ${k}.` };
    const more = k - ratios.length;
    const without = `${invalid.length} processes have an A/A band without 1`;
    const why = noiseCap === undefined ? `and ${without}` : `${without}, and ${noisy.length} processes are noisy for the noise cap ${noiseCap}`;
    return { ...facts, outcome: "cannot decide", more, reason: `The case has ${ratios.length} valid processes of ${k}, ${why}. It needs ${more} more.` };
  }
  const medianFails = m! > limit;
  if (medianFails || slowFails) {
    const parts = [...(medianFails ? [`the median ${round(m!)} is above the limit ${limit}`] : []), ...(slowFails ? [slowText] : [])];
    return { ...facts, outcome: "beyond", more: 0, reason: `${capital(parts.join(", and "))}.` };
  }
  const count = maxSlow === undefined ? `${slowCount} valid processes are above the slow line, a record only` : `${slowCount} valid processes are above the slow line, and the limit is ${maxSlow}`;
  return { ...facts, outcome: "within", more: 0, reason: `The median ${round(m!)} is at most the limit ${limit}, and ${count}.` };
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
