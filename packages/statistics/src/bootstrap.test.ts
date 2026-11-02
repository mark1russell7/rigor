import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import {
  type BootstrapOptions,
  type Interval,
  bootstrap,
  bootstrapMedian,
  bootstrapMedianRatio,
  bootstrapTwo,
  mean,
  median,
  quantile,
  quantileSorted,
  sorted,
} from "./index.ts";

/* ---------- The reference ---------- */

// rigor-statistics 0.1.0 packages/statistics/src/bootstrap.ts, word for word, before the shared helper of 0.1.1.
// Copies in highways, packing and layout-contract match its draws, so the refactor must keep them to the bit.
function bootstrap010<T>(data: readonly T[], statistic: (sample: readonly T[]) => number, options: BootstrapOptions = {}): Interval {
  if (data.length === 0) throw new RangeError("bootstrap: the data is empty.");
  const runs = options.runs ?? 10_000;
  if (!Number.isSafeInteger(runs) || runs < 1) throw new RangeError(`bootstrap: runs is a whole number of 1 or more, not ${runs}.`);
  const tail = (1 - (options.level ?? 0.95)) / 2;
  const [lowEnd, highEnd] = options.ends ?? [tail, 1 - tail];
  if (!(lowEnd >= 0 && lowEnd < highEnd && highEnd <= 1)) throw new RangeError(`bootstrap: the ends are 0 <= low < high <= 1, not ${lowEnd} and ${highEnd}.`);
  const level = options.ends ? highEnd - lowEnd : (options.level ?? 0.95);
  if (!(level > 0 && level < 1)) throw new RangeError(`bootstrap: level is more than 0 and less than 1, not ${level}.`);
  const r = random(options.seed ?? 1);
  const n = data.length;
  const sample = new Array<T>(n);
  const values: number[] = [];
  for (let run = 0; run < runs; run++) {
    for (let i = 0; i < n; i++) sample[i] = data[r.below(n)] as T;
    const v = statistic(sample);
    if (Number.isFinite(v)) values.push(v);
  }
  const estimate = statistic(data);
  if (values.length === 0) return { estimate, low: estimate, high: estimate, level, runs, finite: 0, seed: r.seed };
  const s = sorted(values);
  const method = options.method ?? "linear";
  return { estimate, low: quantileSorted(s, lowEnd, method), high: quantileSorted(s, highEnd, method), level, runs, finite: s.length, seed: r.seed };
}

/* ---------- Helpers ---------- */

function bits(x: number): string {
  return new BigUint64Array(new Float64Array([x]).buffer)[0]!.toString(16);
}

function interval(i: Interval): string[] {
  return [bits(i.estimate), bits(i.low), bits(i.high), bits(i.level), String(i.runs), String(i.finite), String(i.seed)];
}

// Two arms with a known ratio: each median is exact, because the values are in pairs around the center.
function arm(center: number, spread: number, pairs: number, seed: string): number[] {
  const r = random(seed);
  const out: number[] = [];
  for (let i = 0; i < pairs; i++) {
    const d = Math.abs(r.normal(0, spread));
    out.push(center + d, center - d);
  }
  return out;
}

/* ---------- Tests ---------- */

describe("bootstrap after the refactor", () => {
  it("gives the numbers of rigor-statistics 0.1.0, to the bit", () => {
    const r = random("bootstrap 0.1.0 pin");
    const statistics: ((s: readonly number[]) => number)[] = [median, mean, (s) => quantile(s, 0.9, "nearest-rank"), (s) => (s[0]! > 0 ? 1 / s[0]! : Number.NaN)];
    const choices: BootstrapOptions[] = [
      { runs: 300, seed: 3 },
      { runs: 250, level: 0.9, seed: "pin" },
      { runs: 200, ends: [0.025, 0.975], seed: 17 },
      { runs: 150, ends: [0, 0.8], method: "nearest-rank", seed: 2 ** 31 + 5 },
      { runs: 50 },
    ];
    for (let t = 0; t < 40; t++) {
      const n = r.int(1, 40);
      const data = Array.from({ length: n }, () => (r.chance(0.4) ? r.int(-3, 3) : r.normal(10, 4)));
      const statistic = statistics[t % statistics.length]!;
      const options = choices[t % choices.length]!;
      expect(interval(bootstrap(data, statistic, options))).toEqual(interval(bootstrap010(data, statistic, options)));
    }
    const v = Array.from({ length: 25 }, () => r.normal(5, 2));
    expect(interval(bootstrapMedian(v, { runs: 500, seed: 3 }))).toEqual(interval(bootstrap010(v, median, { runs: 500, seed: 3 })));
  });

  it("throws the errors of 0.1.0", () => {
    expect(() => bootstrap([], mean)).toThrow("bootstrap: the data is empty.");
    expect(() => bootstrap([1], mean, { runs: 0 })).toThrow("bootstrap: runs is a whole number of 1 or more, not 0.");
    expect(() => bootstrap([1], mean, { ends: [0.5, 0.5] })).toThrow("bootstrap: the ends are");
    expect(() => bootstrap([1], mean, { level: 1 })).toThrow("bootstrap: level is more than 0");
  });
});

describe("bootstrapTwo", () => {
  const a = arm(2, 0.1, 30, "a");
  const b = arm(1, 0.05, 20, "b");
  const ratio = (x: readonly number[], y: readonly number[]): number => mean(x) / mean(y);

  it("gives the same interval for the same seed, and a different interval for a different seed", () => {
    const one = bootstrapTwo(a, b, ratio, { runs: 400, seed: 5 });
    expect(interval(bootstrapTwo(a, b, ratio, { runs: 400, seed: 5 }))).toEqual(interval(one));
    const two = bootstrapTwo(a, b, ratio, { runs: 400, seed: 6 });
    expect([two.low, two.high]).not.toEqual([one.low, one.high]);
    expect(one.estimate).toBe(ratio(a, b));
  });

  it("draws all the items of a, then all the items of b, in each run, from one stream", () => {
    // The data are the indexes, so the samples show the draws. A statistic that reads only a does not give the
    // interval of bootstrap(a), because the draws of b come between the draws of two runs.
    const na = 7;
    const nb = 4;
    const ia = Array.from({ length: na }, (_, i) => i);
    const ib = Array.from({ length: nb }, (_, i) => i);
    const seen: number[][] = [];
    bootstrapTwo(
      ia,
      ib,
      (x, y) => {
        seen.push([...x, ...y]);
        return 0;
      },
      { runs: 6, seed: "order" },
    );
    const r = random("order");
    const want: number[][] = [];
    for (let run = 0; run < 6; run++) {
      const draws: number[] = [];
      for (let i = 0; i < na; i++) draws.push(r.below(na));
      for (let i = 0; i < nb; i++) draws.push(r.below(nb));
      want.push(draws);
    }
    // The last call is the estimate on all the data.
    want.push([...ia, ...ib]);
    expect(seen).toEqual(want);
  });

  it("throws a RangeError for an empty sample or bad options", () => {
    expect(() => bootstrapTwo([], b, ratio)).toThrow(RangeError);
    expect(() => bootstrapTwo(a, [], ratio)).toThrow(RangeError);
    expect(() => bootstrapTwo(a, b, ratio, { runs: 1.5 })).toThrow("bootstrapTwo: runs is a whole number");
    expect(() => bootstrapTwo(a, b, ratio, { level: 0 })).toThrow(RangeError);
  });

  it("gives the estimate as low and high when no run is finite", () => {
    const i = bootstrapTwo([1, 2], [3], () => Number.NaN, { runs: 10 });
    expect(i.finite).toBe(0);
    expect(Number.isNaN(i.low) && Number.isNaN(i.high)).toBe(true);
  });
});

describe("bootstrapMedianRatio", () => {
  it("gives the exact ratio as estimate, low and high for two constant lists", () => {
    const i = bootstrapMedianRatio(new Array<number>(12).fill(6), new Array<number>(9).fill(3),{ runs: 200, seed: 1 });
    expect([i.estimate, i.low, i.high, i.finite]).toEqual([2, 2, 2, 200]);
  });

  it("holds the known ratio of two arms, and is narrower than the spread of the samples", () => {
    const a = arm(2, 0.1, 50, "numerator arm");
    const b = arm(1, 0.05, 50, "denominator arm");
    expect(a.length).toBe(100);
    expect(b.length).toBe(100);
    const i = bootstrapMedianRatio(a, b, { runs: 2000, seed: "shift" });
    expect(i.estimate).toBeCloseTo(2, 12);
    expect(i.low).toBeLessThanOrEqual(2);
    expect(i.high).toBeGreaterThanOrEqual(2);
    expect(i.low).toBeGreaterThan(quantile(a, 0.1) / quantile(b, 0.9));
    expect(i.high).toBeLessThan(quantile(a, 0.9) / quantile(b, 0.1));
    expect(i.finite).toBe(2000);
  });

  it("does not count a run whose denominator median is 0", () => {
    const numerator = [1, 2, 3];
    const denominator = [0, 0, 1, 1, 1];
    const runs = 300;
    const i = bootstrapMedianRatio(numerator, denominator, { runs, seed: 4 });
    // The same draws, replayed: a run counts only when the median of its denominator is not 0.
    const r = random(4);
    let finite = 0;
    for (let run = 0; run < runs; run++) {
      for (let k = 0; k < numerator.length; k++) r.below(numerator.length);
      const drawn = Array.from({ length: denominator.length }, () => denominator[r.below(denominator.length)]!);
      if (median(drawn) !== 0) finite++;
    }
    expect(i.finite).toBe(finite);
    expect(i.finite).toBeGreaterThan(0);
    expect(i.finite).toBeLessThan(runs);
    expect(Number.isFinite(i.low) && Number.isFinite(i.high)).toBe(true);
    expect(i.estimate).toBe(2);
  });

  it("gives no finite run when each denominator median is 0, and throws for an empty arm", () => {
    const i = bootstrapMedianRatio([1, 2], [0, 0, 0], { runs: 20 });
    expect(i.finite).toBe(0);
    expect(i.low).toBe(Number.POSITIVE_INFINITY);
    expect(() => bootstrapMedianRatio([], [1])).toThrow(RangeError);
    expect(() => bootstrapMedianRatio([1], [])).toThrow(RangeError);
  });
});
