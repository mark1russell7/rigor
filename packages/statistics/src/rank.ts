/**
 * Rank correlation: do two measures put the same items in the same order? Use it to test that a cheap proxy (a
 * predicted cost, a fast measure) orders the items as the real measure does.
 */
import { random } from "@mark1russell7/rigor-generators";

function samePairs(name: string, a: readonly number[], b: readonly number[]): void {
  if (a.length !== b.length) throw new RangeError(`${name}: the lists have ${a.length} and ${b.length} values.`);
  for (const v of a) if (Number.isNaN(v)) throw new RangeError(`${name}: the first list has a NaN.`);
  for (const v of b) if (Number.isNaN(v)) throw new RangeError(`${name}: the second list has a NaN.`);
}

/** The ranks of the values, from 1. Equal values get the mean of their ranks. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1] as readonly [number, number])[0] === (order[i] as readonly [number, number])[0]) j++;
    for (let k = i; k <= j; k++) out[(order[k] as readonly [number, number])[1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/**
 * The Spearman rank correlation: the Pearson correlation of the ranks, with mean ranks for ties. The value is from
 * -1 to 1. When one list has no spread, the value is 0. It is equal to the copy in the backtest of highways.
 */
export function spearman(a: readonly number[], b: readonly number[]): number {
  samePairs("spearman", a, b);
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += ((ra[i] as number) - ma) * ((rb[i] as number) - mb);
    da += ((ra[i] as number) - ma) ** 2;
    db += ((rb[i] as number) - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** The largest number of values for which `kendallTau` examines each pair. Above it, a seeded sample of pairs. */
export const KENDALL_EXACT = 1500;
const KENDALL_SAMPLE = 200_000;

/**
 * The Kendall tau-b of two lists (Kendall, 1938). The value is from -1 to 1. A pair with a tie in both lists does
 * not count. When the lists have fewer than 2 values, or no pair counts, the value is 1. Above `KENDALL_EXACT`
 * values, a seeded sample of 200 000 pairs gives an estimate. It is equal to the copy in highways.
 */
export function kendallTau(a: readonly number[], b: readonly number[], seed: number | string = 1): number {
  samePairs("kendallTau", a, b);
  const n = a.length;
  if (n < 2) return 1;
  let concordant = 0;
  let discordant = 0;
  let tieA = 0;
  let tieB = 0;
  const visit = (i: number, j: number): void => {
    const da = Math.sign((a[i] as number) - (a[j] as number));
    const db = Math.sign((b[i] as number) - (b[j] as number));
    if (da === 0 && db === 0) return;
    if (da === 0) tieA++;
    else if (db === 0) tieB++;
    else if (da === db) concordant++;
    else discordant++;
  };
  if (n <= KENDALL_EXACT) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) visit(i, j);
  } else {
    const r = random(seed);
    for (let k = 0; k < KENDALL_SAMPLE; k++) {
      const i = r.below(n);
      const j = r.below(n);
      if (i !== j) visit(i, j);
    }
  }
  const den = Math.sqrt((concordant + discordant + tieA) * (concordant + discordant + tieB));
  return den === 0 ? 1 : (concordant - discordant) / den;
}
