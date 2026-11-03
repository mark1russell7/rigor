import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mulberry32, random } from "@mark1russell7/rigor-generators";
import {
  bootstrap,
  bootstrapClusters,
  bootstrapMedian,
  brier,
  calibration,
  compareRatios,
  holm,
  kendallTau,
  mean,
  median,
  noiseFloor,
  noiseVerdict,
  pairedPermutation,
  quantile,
  quantileSorted,
  ranks,
  sd,
  signTest,
  signTestPower,
  spearman,
  summarize,
  wilson,
} from "./index.ts";

/* ---------- The copies in the engines, word for word, as the references of the moves ---------- */

// highways packages/core/src/bench/measures/stats.ts
function highwaysQuantile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const at = Math.max(0, Math.min(1, p)) * (s.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(s.length - 1, lo + 1);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}

// lag packages/experiments/src/e8-async-context/runner/stats.ts (nearest rank)
function lagQuantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

// coeval packages/core/bench/cases.ts
function coevalMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

// packing packages/packing/bench/promote.ts
function packingSignTestP(better: number, worse: number): number {
  const n = better + worse;
  if (n === 0 || better === 0) return 1;
  const logs: number[] = [];
  let logChoose = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) logChoose += Math.log((n - i + 1) / i);
    if (i >= better) logs.push(logChoose - n * Math.LN2);
  }
  const top = Math.max(...logs);
  const sum = logs.reduce((s, l) => s + Math.exp(l - top), 0);
  return Math.min(1, Math.exp(top) * sum);
}

// packing packages/packing/bench/promote.ts (its quantile is the linear one)
function packingBootstrapMedian(ratios: readonly number[], runs: number, level: number, seed: number): { low: number; high: number } {
  const n = ratios.length;
  const sorted = ratios.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rnd = mulberry32(seed);
  const counts = new Uint32Array(n);
  const lowRank = Math.floor((n - 1) / 2);
  const highRank = Math.ceil((n - 1) / 2);
  const medians: number[] = [];
  for (let run = 0; run < runs; run++) {
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[Math.floor(rnd() * n)]! += 1;
    let seen = 0;
    let low = NaN;
    let high = NaN;
    for (let k = 0; k < n; k++) {
      seen += counts[k]!;
      if (Number.isNaN(low) && seen > lowRank) low = sorted[k]!;
      if (seen > highRank) {
        high = sorted[k]!;
        break;
      }
    }
    medians.push(low === high ? low : (low + high) / 2);
  }
  const side = (1 - level) / 2;
  return { low: highwaysQuantile(medians, side), high: highwaysQuantile(medians, 1 - side) };
}

// highways packages/core/src/bench/screen/gap.ts
function highwaysBootstrapMedian(values: readonly number[], runs: number, level: number, seed: number): { lo: number; hi: number } {
  const r = mulberry32(seed);
  const medians: number[] = [];
  const sample = new Array<number>(values.length);
  for (let i = 0; i < runs; i++) {
    for (let j = 0; j < values.length; j++) sample[j] = values[Math.floor(r() * values.length)]!;
    medians.push(highwaysQuantile(sample, 0.5));
  }
  const tail = (1 - level) / 2;
  return { lo: highwaysQuantile(medians, tail), hi: highwaysQuantile(medians, 1 - tail) };
}

// layout-contract packages/joint/src/analysis.ts
function layoutBootstrap(rows: readonly { cluster: string; value: number; weight?: number }[], resamples: number, seed: number) {
  const quantileOf = (sorted: readonly number[], q: number): number => {
    if (sorted.length === 0) return 0;
    const at = (sorted.length - 1) * q;
    const lo = Math.floor(at);
    const hi = Math.ceil(at);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
  };
  const ratio = rows.some((r) => r.weight !== undefined);
  const stat = (list: readonly { value: number; weight?: number }[]): number => {
    const num = list.reduce((s, r) => s + r.value, 0);
    const den = ratio ? list.reduce((s, r) => s + (r.weight ?? 0), 0) : list.length;
    return den === 0 ? Number.NaN : num / den;
  };
  const point = stat(rows);
  const clusters = new Map<string, { value: number; weight?: number }[]>();
  for (const r of rows) {
    const list = clusters.get(r.cluster) ?? [];
    list.push(r);
    clusters.set(r.cluster, list);
  }
  const keys = [...clusters.keys()];
  const rnd = mulberry32(seed);
  const samples: number[] = [];
  for (let i = 0; i < resamples && keys.length > 0; i++) {
    const drawn: { value: number; weight?: number }[] = [];
    for (let j = 0; j < keys.length; j++) drawn.push(...clusters.get(keys[Math.floor(rnd() * keys.length)]!)!);
    const v = stat(drawn);
    if (Number.isFinite(v)) samples.push(v);
  }
  samples.sort((a, b) => a - b);
  return { mean: point, lo: samples.length === 0 ? point : quantileOf(samples, 0.025), hi: samples.length === 0 ? point : quantileOf(samples, 0.975), stat };
}

// highways packages/core/src/bench/screen/set.ts
function highwaysSignTestPower(families: number, level = 0.05): number | undefined {
  for (let k = Math.ceil(families / 2); k <= families; k++) {
    let tail = 0;
    let c = 1;
    for (let i = 0; i <= families - k; i++) {
      tail += c;
      c = (c * (families - i)) / (i + 1);
    }
    if (Math.min(1, (2 * tail) / 2 ** families) < level) return k;
  }
  return undefined;
}

/* ---------- Data ---------- */

function lists(count: number, seed: number): number[][] {
  const r = random(seed);
  return Array.from({ length: count }, () => {
    const n = r.int(1, 40);
    // Ties and negative values on purpose: a small set of values, or a wide spread.
    return Array.from({ length: n }, () => (r.chance(0.5) ? r.int(-3, 3) : r.normal(10, 4)));
  });
}

const bits = (x: number): string => Object.is(x, -0) ? "-0" : x.toString();

describe("the descriptive statistics", () => {
  it("gives the linear quantile of the copies in highways and packing, to the bit", () => {
    for (const v of lists(300, 1)) for (const p of [0, 0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975, 1]) expect(bits(quantile(v, p))).toBe(bits(highwaysQuantile(v, p)));
  });

  it("gives the nearest-rank quantile of the copies in lag, to the bit", () => {
    for (const v of lists(300, 2)) for (const p of [0, 0.01, 0.5, 0.9, 0.99, 1]) expect(quantile(v, p, "nearest-rank")).toBe(lagQuantile(v, p));
  });

  /** The exact rank ceil(k * (n - 1) / d) of p = k / d, with integer arithmetic only. */
  const exactRank = (k: number, d: number, n: number): number => {
    const top = k * (n - 1) + d - 1;
    return (top - (top % d)) / d;
  };

  /** The list 0, 1, ..., n - 1. Its value at an index is the index, so a quantile is its own rank. */
  const ranks = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

  it("gives the higher quantile, sorted[ceil(p * (n - 1))], as NumPy", () => {
    for (const v of lists(300, 5)) {
      const s = [...v].sort((a, b) => a - b);
      for (const k of [0, 1, 25, 50, 55, 75, 90, 99, 100]) {
        const want = s[exactRank(k, 100, s.length)] as number;
        expect(bits(quantile(v, k / 100, "higher"))).toBe(bits(want));
        expect(bits(quantileSorted(s, k / 100, "higher"))).toBe(bits(want));
      }
    }
    expect(quantileSorted([1, 2, 3, 4], 0.25, "higher")).toBe(2);
    expect(quantileSorted([1, 2, 3, 4], 0.5, "higher")).toBe(3);
    expect(quantileSorted([1, 2, 3, 4], 1, "higher")).toBe(4);
    expect(quantileSorted([1, 2, 3, 4], 0, "higher")).toBe(1);
  });

  it("gives the exact higher rank when p * (n - 1) has a float error above a whole rank", () => {
    // 0.55 * 100 is 55.00000000000001 and 0.55 * 180 is 99.00000000000001. A plain ceil gives 56 and 100.
    expect(0.55 * 100).toBeGreaterThan(55);
    expect(0.55 * 180).toBeGreaterThan(99);
    expect(quantileSorted(ranks(101), 0.55, "higher")).toBe(55);
    expect(quantileSorted(ranks(181), 0.55, "higher")).toBe(99);
  });

  it("gives the exact integer rank ceil(i * (n - 1) / 20) for the computed p = i * 0.05, for n = 1 to 200", () => {
    let errors = 0;
    for (let n = 1; n <= 200; n++) {
      const s = ranks(n);
      for (let i = 0; i <= 20; i++) {
        const p = i * 0.05;
        if (Math.ceil(p * (n - 1)) !== exactRank(i, 20, n)) errors++;
        expect(quantileSorted(s, p, "higher")).toBe(exactRank(i, 20, n));
      }
    }
    // The grid has float errors, so the test examines the guard.
    expect(errors).toBeGreaterThan(0);
  });

  it("gives the upper median sorted[floor(n / 2)] as the 0.5 higher quantile, for n = 1 to 50", () => {
    const r = random(6);
    for (let n = 1; n <= 50; n++) {
      const v = Array.from({ length: n }, () => r.normal(0, 5));
      const s = [...v].sort((a, b) => a - b);
      expect(quantile(v, 0.5, "higher")).toBe(s[Math.floor(n / 2)]);
    }
  });

  it("throws for the higher method as for the other methods", () => {
    expect(() => quantile([], 0.5, "higher")).toThrow(RangeError);
    expect(() => quantile([1, Number.NaN], 0.5, "higher")).toThrow(RangeError);
    expect(() => quantile([1], -0.1, "higher")).toThrow(RangeError);
    expect(() => quantile([1], 1.5, "higher")).toThrow(RangeError);
    expect(() => quantile([1], Number.NaN, "higher")).toThrow(RangeError);
  });

  it("gives the median of the copies in coeval, lag and crawler, to the bit", () => {
    for (const v of lists(300, 3)) expect(bits(median(v))).toBe(bits(coevalMedian(v)));
  });

  it("gives a median within 1 ulp of the 0.5 quantile", () => {
    for (const v of lists(300, 4)) {
      const m = median(v);
      const q = quantile(v, 0.5);
      expect(Math.abs(m - q)).toBeLessThanOrEqual(Math.max(Number.EPSILON * Math.abs(m), Number.MIN_VALUE));
    }
  });

  it("gives the known values of a small list", () => {
    const v = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(v)).toBe(5);
    expect(sd(v)).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(median(v)).toBe(4.5);
    expect(quantileSorted([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantileSorted([1, 2, 3, 4], 0.25, "nearest-rank")).toBe(1);
    expect(summarize(v)).toEqual({ n: 8, mean: 5, sd: sd(v), min: 2, q1: 4, median: 4.5, q3: 5.5, max: 9, iqr: 1.5 });
    expect(summarize([3]).sd).toBeNaN();
  });

  it("throws for an empty list, a NaN and a p out of 0 to 1", () => {
    expect(() => median([])).toThrow(RangeError);
    expect(() => mean([1, Number.NaN])).toThrow(RangeError);
    expect(() => quantile([1], 1.5)).toThrow(RangeError);
    expect(() => sd([1])).toThrow(RangeError);
  });
});

describe("the bootstrap", () => {
  it("gives the interval of the median of packing, to the bit (packing draws from the sorted list)", () => {
    for (const [i, v] of lists(20, 5).entries()) {
      const want = packingBootstrapMedian(v, 400, 0.95, 58 + i);
      const got = bootstrapMedian([...v].sort((a, b) => a - b), { runs: 400, seed: 58 + i });
      expect([bits(got.low), bits(got.high)]).toEqual([bits(want.low), bits(want.high)]);
    }
  });

  it("gives the interval of the median of highways, to the bit (its statistic is the 0.5 quantile)", () => {
    for (const [i, v] of lists(20, 6).entries()) {
      const want = highwaysBootstrapMedian(v, 400, 0.9, 7 + i);
      const got = bootstrap(v, (s) => quantile(s, 0.5), { runs: 400, level: 0.9, seed: 7 + i });
      expect([bits(got.low), bits(got.high)]).toEqual([bits(want.lo), bits(want.hi)]);
    }
  });

  it("gives the cluster bootstrap of layout-contract, to the bit", () => {
    const r = random(9);
    for (let t = 0; t < 10; t++) {
      const rows = Array.from({ length: r.int(3, 60) }, () => ({ cluster: `c${r.below(8)}`, value: r.normal(1, 0.3), weight: r.range(0.5, 2) }));
      const want = layoutBootstrap(rows, 300, 40 + t);
      const got = bootstrapClusters(rows, (row) => row.cluster, want.stat, { runs: 300, seed: 40 + t, ends: [0.025, 0.975] });
      expect([bits(got.estimate), bits(got.low), bits(got.high)]).toEqual([bits(want.mean), bits(want.lo), bits(want.hi)]);
    }
  });

  it("covers the true median at about its level", () => {
    // 200 samples of 30 normal values with a median of 0: the 90% interval holds 0 in approximately 90% of them.
    const r = random(11);
    let covered = 0;
    for (let t = 0; t < 200; t++) {
      const v = Array.from({ length: 30 }, () => r.normal());
      const i = bootstrapMedian(v, { runs: 500, level: 0.9, seed: t });
      if (i.low <= 0 && 0 <= i.high) covered++;
    }
    const band = wilson(covered, 200);
    expect(band.low).toBeLessThan(0.9 + 0.05);
    expect(band.high).toBeGreaterThan(0.9 - 0.05);
  });

  it("counts only the finite runs, and gives the estimate when no run is finite", () => {
    const i = bootstrap([1, 2, 3], () => Number.NaN, { runs: 10 });
    expect(i.finite).toBe(0);
    expect(Number.isNaN(i.low)).toBe(true);
    expect(() => bootstrap([], mean)).toThrow(RangeError);
  });
});

describe("the tests", () => {
  it("gives the one-sided sign test of packing, to the bit", () => {
    for (let n = 0; n <= 300; n += 7) for (let b = 0; b <= n; b += 3) expect(signTest(b, n - b)).toBe(packingSignTestP(b, n - b));
    expect(signTest(9, 1)).toBeCloseTo(11 / 1024, 15);
    expect(signTest(112, 40)).toBeLessThan(1e-8);
  });

  it("gives the sign test power of highways", () => {
    for (let n = 1; n <= 200; n++) expect(signTestPower(n)).toBe(highwaysSignTestPower(n));
    expect(signTestPower(5)).toBeUndefined();
    expect(signTestPower(6)).toBe(6);
  });

  it("gives the Wilson interval", () => {
    const w = wilson(5, 10);
    expect(w.low).toBeCloseTo(0.236593, 5);
    expect(w.high).toBeCloseTo(0.763407, 5);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
    expect(wilson(0, 20).low).toBe(0);
    expect(() => wilson(3, 2)).toThrow(RangeError);
  });

  it("gives the Holm correction in the order of the input", () => {
    const result = holm([0.01, 0.04, 0.03, 0.005]);
    [0.03, 0.06, 0.06, 0.02].forEach((want, i) => expect(result[i]?.adjusted).toBeCloseTo(want, 15));
    expect(result.map((r) => r.reject)).toEqual([true, false, false, true]);
  });

  it("gives a small p for a real shift and a large p for none in the paired permutation test", () => {
    const r = random(13);
    const base = Array.from({ length: 40 }, () => r.normal(10, 1));
    const shifted = base.map((b) => b + 0.5 + r.normal(0, 0.3));
    const same = base.map((b) => b + r.normal(0, 0.3));
    expect(pairedPermutation(shifted, base, { runs: 2000 }).p).toBeLessThan(0.01);
    expect(pairedPermutation(same, base, { runs: 2000 }).p).toBeGreaterThan(0.05);
  });
});

describe("the rank correlations", () => {
  it("gives mean ranks for ties", () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  it("gives 1, -1 and 0", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(spearman([1, 2, 3], [5, 5, 5])).toBe(0);
    expect(kendallTau([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
    expect(kendallTau([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(kendallTau([1, 2, 3], [1, 3, 2])).toBeCloseTo(1 / 3, 12);
  });
});

describe("the comparison with a baseline", () => {
  it("counts the ties, the wins and the gains beyond the noise", () => {
    const ratios = [1, 1, 1.02, 1.001, 0.97, 0.999, 1.1];
    const c = compareRatios(ratios, { noise: 0.005 });
    expect([c.n, c.ties, c.wins, c.losses, c.gains, c.drops]).toEqual([7, 2, 3, 2, 2, 1]);
    expect(c.effect?.n).toBe(5);
    expect(c.effect?.median).toBe(1.001);
    expect(c.gainShare).toBeCloseTo(2 / 7, 12);
  });

  it("reads a ratio below 1 as a gain for a time", () => {
    const c = compareRatios([0.8, 0.9, 1.2], { better: "lower" });
    expect([c.wins, c.losses]).toEqual([2, 1]);
  });

  it("gives the noise floor of 5 seeds or more, and refuses fewer", () => {
    expect(noiseFloor([1, 2, 3, 4, 5])).toBeCloseTo(2 * Math.sqrt(2.5), 12);
    expect(() => noiseFloor([1, 2, 3])).toThrow(RangeError);
    expect(noiseFloor([1, 2, 3], { minimum: 3, k: 1 })).toBe(1);
  });

  it("takes a margin of practical effect, and keeps the old floor without one", () => {
    const values = [0.1, 0.12, 0.11, 0.09, 0.1];
    expect(noiseFloor(values, { margin: 0 })).toBe(noiseFloor(values));
    expect(noiseFloor(values, { margin: 0.5 })).toBe(0.5);
    expect(noiseFloor(values, { margin: 0.001 })).toBe(2 * sd(values));
    expect(() => noiseFloor(values, { margin: -1 })).toThrow(/margin/);
    expect(() => noiseFloor(values, { margin: Number.NaN })).toThrow(/margin/);
  });

  it("gives the state of a difference over the seeds: gain, loss, noise, or no spread", () => {
    const gain = noiseVerdict([0.1, 0.12, 0.11, 0.09, 0.1]);
    expect(gain.state).toBe("gain");
    expect(gain.mean).toBeCloseTo(0.104, 12);
    expect(gain.threshold).toBe(gain.spread);
    expect(noiseVerdict([-0.1, -0.12, -0.11, -0.09, -0.1]).state).toBe("loss");
    expect(noiseVerdict([-0.1, -0.12, -0.11, -0.09, -0.1], { better: "lower" }).state).toBe("gain");
    expect(noiseVerdict([0.1, -0.1, 0.05, -0.05, 0]).state).toBe("noise");
    // A real difference under the margin is not a result.
    const small = noiseVerdict([0.1, 0.12, 0.11, 0.09, 0.1], { margin: 0.2 });
    expect([small.state, small.threshold]).toEqual(["noise", 0.2]);
    // Equal values do not sample the noise: the state is no-spread, also beyond the margin.
    const flat = noiseVerdict([0.3, 0.3, 0.3, 0.3, 0.3], { margin: 0.1 });
    expect([flat.state, flat.sd, flat.spread]).toEqual(["no-spread", 0, 0]);
    expect(() => noiseVerdict([1, 2])).toThrow(/5 or more/);
  });

  it("gives an sd of exactly 0 and the state no-spread for n copies of any finite value", () => {
    // The mean of 5 copies of this value is not the value, so the old sd was 1.24e-16.
    const x = 0.868730285466694;
    expect(sd([x, x, x, x, x])).toBe(0);
    expect(noiseVerdict([x, x, x, x, x]).state).toBe("no-spread");
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.integer({ min: 5, max: 40 }), (v, n) => {
        const values = Array.from({ length: n }, () => v);
        expect(sd(values)).toBe(0);
        expect(noiseVerdict(values).state).toBe("no-spread");
      }),
      { seed: 57, numRuns: 2000 },
    );
  });
});

describe("the calibration", () => {
  it("gives the Brier score and the hit rate of each level", () => {
    const f = [
      { p: 0.8, hit: true },
      { p: 0.8, hit: true },
      { p: 0.8, hit: false },
      { p: 0.3, hit: false },
    ];
    expect(brier(f)).toBeCloseTo((0.04 + 0.04 + 0.64 + 0.09) / 4, 12);
    const levels = calibration(f);
    expect(levels.map((l) => [l.stated, l.n, l.hits])).toEqual([
      [0.3, 1, 0],
      [0.8, 3, 2],
    ]);
    expect(() => brier([{ p: 1.2, hit: true }])).toThrow(RangeError);
  });
});
