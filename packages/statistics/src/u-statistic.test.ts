import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import { sampleTotalInterval, tQuantile, uStatisticInterval, wilson } from "./index.ts";

type Kernel = (i: number, j: number) => number;
type Point = readonly [number, number];
type Segment = readonly [Point, Point];

/** The sign of the turn from a to b to c. */
function turn(a: Point, b: Point, c: Point): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

/** True when the two segments cross at a point inside both. */
function cross(p: Segment, q: Segment): boolean {
  return turn(p[0], p[1], q[0]) * turn(p[0], p[1], q[1]) < 0 && turn(q[0], q[1], p[0]) * turn(q[0], q[1], p[1]) < 0;
}

/** A made-up population of `n` random segments. The kernel is 1 when two segments cross. */
function segments(n: number, seed: string, length: (u: number) => number): Kernel {
  const r = random(seed);
  const s = Array.from({ length: n }, (): Segment => {
    const a: Point = [r.next(), r.next()];
    const angle = 2 * Math.PI * r.next();
    const l = length(r.next());
    return [a, [a[0] + l * Math.cos(angle), a[1] + l * Math.sin(angle)]];
  });
  return (i, j) => (cross(s[i] as Segment, s[j] as Segment) ? 1 : 0);
}

/** A made-up skewed integer kernel: the smaller weight of two units near each other on a line, from 0 to 9. */
function skewed(n: number, seed: string): Kernel {
  const r = random(seed);
  const w = Array.from({ length: n }, () => 1 + Math.floor(9 * r.next() ** 3));
  const x = Array.from({ length: n }, () => r.next());
  return (i, j) => (Math.abs((x[i] as number) - (x[j] as number)) < 0.25 ? Math.min(w[i] as number, w[j] as number) : 0);
}

interface Population {
  readonly range: readonly [number, number];
  readonly make: (n: number, seed: string) => Kernel;
}

const KERNELS: Readonly<Record<"sparse" | "crossings" | "skewed", Population>> = {
  // Short segments: 2% to 3% of the pairs cross.
  sparse: { range: [0, 1], make: (n, seed) => segments(n, seed, (u) => 0.1 + 0.4 * u * u) },
  // Long segments: 8% to 10% of the pairs cross.
  crossings: { range: [0, 1], make: (n, seed) => segments(n, seed, (u) => 0.3 + 0.5 * u) },
  skewed: { range: [0, 9], make: skewed },
};

/** The matrix of the kernel over all pairs of the population, and the total over all pairs. */
function table(kernel: Kernel, n: number): { readonly h: number[][]; readonly total: number } {
  const h = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : kernel(i, j))));
  let total = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) total += (h[i] as number[])[j] as number;
  return { h, total };
}

/** The total of each sampled unit: the sum of the kernel over the other sampled units. */
function pairTotals(h: readonly (readonly number[])[], sample: readonly number[]): number[] {
  return sample.map((i) => sample.reduce((s, j) => s + ((h[i] as readonly number[])[j] as number), 0));
}

/** Each set of `k` of the numbers from 0 to `n - 1`, in order. */
function subsets(n: number, k: number): number[][] {
  const out: number[][] = [];
  const chosen: number[] = [];
  const walk = (start: number): void => {
    if (chosen.length === k) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i < n; i++) {
      chosen.push(i);
      walk(i + 1);
      chosen.pop();
    }
  };
  walk(0);
  return out;
}

describe("uStatisticInterval", () => {
  it("centres an order-2 sample on S * C(n, 2) / C(m, 2), to the bit", () => {
    const n = 60;
    const { h } = table(KERNELS.skewed.make(n, "centre"), n);
    const sample = random("centre-draw").sample(
      Array.from({ length: n }, (_, i) => i),
      12,
    );
    const totals = pairTotals(h, sample);
    let s = 0;
    for (let a = 0; a < sample.length; a++) for (let b = a + 1; b < sample.length; b++) s += (h[sample[a] as number] as number[])[sample[b] as number] as number;
    expect(totals.reduce((x, y) => x + y, 0)).toBe(2 * s);
    const m = sample.length;
    for (const method of ["tight", "conservative"] as const) {
      const i = uStatisticInterval(totals, { order: 2, population: n, method, range: [0, 9] });
      expect(i.estimate).toBe((s * ((n * (n - 1)) / 2)) / ((m * (m - 1)) / 2));
      expect(i.mean.estimate).toBe(s / ((m * (m - 1)) / 2));
      expect(i.subsets).toBe((n * (n - 1)) / 2);
      expect(i.low).toBeLessThanOrEqual(i.estimate);
      expect(i.high).toBeGreaterThanOrEqual(i.estimate);
    }
  });

  it("agrees with a plain total of a sample at order 1", () => {
    const r = random("order-1");
    const values = Array.from({ length: 8 }, () => r.int(0, 30));
    const n = 40;
    const m = values.length;
    const i = uStatisticInterval(values, { order: 1, population: n, method: "tight" });
    expect(i.estimate).toBe(sampleTotalInterval(values, { population: n, runs: 10 }).estimate);
    // The textbook interval of a total: (n / m) sum, plus or minus t n sqrt((1 - m / n) s^2 / m).
    const mean = values.reduce((x, y) => x + y, 0) / m;
    const s2 = values.reduce((x, y) => x + (y - mean) ** 2, 0) / (m - 1);
    const half = tQuantile(0.975, m - 1) * n * Math.sqrt(((1 - m / n) * s2) / m);
    expect(i.low).toBeCloseTo(n * mean - half, 9);
    expect(i.high).toBeCloseTo(n * mean + half, 9);
    expect(i.df).toBe(m - 1);
  });

  it("gives a zero width when the sample is the whole population", () => {
    const n = 20;
    const { h, total } = table(KERNELS.crossings.make(n, "whole"), n);
    const totals = pairTotals(
      h,
      Array.from({ length: n }, (_, i) => i),
    );
    for (const method of ["tight", "conservative"] as const) {
      const i = uStatisticInterval(totals, { order: 2, population: n, method, range: [0, 1] });
      expect(i.estimate).toBe(total);
      expect(i.low).toBe(total);
      expect(i.high).toBe(total);
    }
  });

  // This test reads every sample of small populations. It states the finite population correction from the
  // variance over all samples, not from the formula of a plain total. The square of the standard error is
  // equal to the variance for a linear kernel, and it is larger for the other kernels.
  it.each([
    [9, 4, 1],
    [9, 4, 2],
    [9, 7, 2],
    [10, 5, 2],
    [10, 9, 2],
    [9, 5, 3],
    [10, 8, 3],
  ])("has an exact variance for a linear kernel and a larger variance for others, over all samples of %s, m %s, order %s", (n, m, order) => {
    const r = random(`exact/${n}/${m}/${order}`);
    const unit = Array.from({ length: n }, () => 3 * r.next());
    const kernels: Record<string, (set: readonly number[]) => number> = {
      linear: (set) => set.reduce((x, i) => x + (unit[i] as number), 0),
      binary: () => (r.next() < 0.15 ? 1 : 0),
      skewed: (set) => Math.floor(5 * r.next() ** 3) + set.reduce((x, i) => x + (unit[i] as number), 0),
    };
    for (const [name, kernel] of Object.entries(kernels)) {
      const value = new Map<string, number>();
      for (const set of subsets(n, order)) value.set(set.join(","), kernel(set));
      let sum = 0;
      let squares = 0;
      let variance = 0;
      const all = subsets(n, m);
      for (const sample of all) {
        const totals = new Array<number>(m).fill(0);
        for (const set of subsets(m, order)) {
          const v = value.get(set.map((j) => sample[j]).join(",")) as number;
          for (const j of set) totals[j] = (totals[j] as number) + v;
        }
        const i = uStatisticInterval(totals, { order, population: n, method: "tight" });
        sum += i.estimate;
        squares += i.estimate ** 2;
        variance += (i.standardError as number) ** 2;
      }
      const truth = squares / all.length - (sum / all.length) ** 2;
      const estimated = variance / all.length;
      if (name === "linear" || order === 1) expect(estimated / truth).toBeCloseTo(1, 9);
      else expect(estimated).toBeGreaterThan(truth);
    }
  });

  // The coverage of the total over all pairs, at the level 0.95. Each cell draws 200 samples without replacement.
  // The cells at m / n = 1/2 and m / n = 0.9 examine the finite population correction.
  const CELLS: readonly (readonly [number, number])[] = [
    [40, 8],
    [40, 10],
    [40, 12],
    [40, 20],
    [40, 36],
    [60, 8],
    [60, 10],
    [60, 12],
    [60, 20],
    [60, 40],
    [120, 8],
    [120, 10],
    [120, 12],
    [120, 20],
    [120, 40],
    [120, 60],
    [120, 108],
  ];
  const SAMPLES = 200;

  /** The hits of each method in one cell. */
  function coverage(kernelName: string, n: number, m: number): { conservative: number; tight: number } {
    const kernel = KERNELS[kernelName as keyof typeof KERNELS];
    const { h, total } = table(kernel.make(n, `u-statistic/${kernelName}/${n}`), n);
    const draws = random(`u-statistic/${kernelName}/${n}/${m}`);
    const ids = Array.from({ length: n }, (_, i) => i);
    const hits = { conservative: 0, tight: 0 };
    for (let k = 0; k < SAMPLES; k++) {
      const totals = pairTotals(h, draws.sample(ids, m));
      for (const method of ["conservative", "tight"] as const) {
        const i = uStatisticInterval(totals, { order: 2, population: n, method, range: kernel.range });
        if (i.low <= total && total <= i.high) hits[method]++;
      }
    }
    return hits;
  }

  // The measured hits of the method "tight", of 200, with the Wilson interval of each count.
  // sparse:
  //   40/8 76 (0.316 to 0.449), 40/10 106 (0.461 to 0.598), 40/12 133 (0.597 to 0.727),
  //   40/20 174 (0.816 to 0.910), 40/36 192 (0.923 to 0.980), 60/8 113 (0.496 to 0.632),
  //   60/10 150 (0.686 to 0.805), 60/12 159 (0.734 to 0.845), 60/20 184 (0.874 to 0.950),
  //   60/40 186 (0.886 to 0.958), 120/8 102 (0.441 to 0.578), 120/10 135 (0.607 to 0.736),
  //   120/12 156 (0.718 to 0.832), 120/20 189 (0.904 to 0.969), 120/40 194 (0.936 to 0.986),
  //   120/60 195 (0.943 to 0.989), 120/108 187 (0.892 to 0.962).
  // crossings:
  //   40/8 180 (0.851 to 0.934), 40/10 194 (0.936 to 0.986), 40/12 182 (0.862 to 0.942),
  //   40/20 183 (0.868 to 0.946), 40/36 189 (0.904 to 0.969), 60/8 183 (0.868 to 0.946),
  //   60/10 193 (0.930 to 0.983), 60/12 194 (0.936 to 0.986), 60/20 190 (0.910 to 0.973),
  //   60/40 193 (0.930 to 0.983), 120/8 188 (0.898 to 0.965), 120/10 189 (0.904 to 0.969),
  //   120/12 188 (0.898 to 0.965), 120/20 193 (0.930 to 0.983), 120/40 192 (0.923 to 0.980),
  //   120/60 189 (0.904 to 0.969), 120/108 185 (0.880 to 0.954).
  // skewed:
  //   40/8 181 (0.856 to 0.938), 40/10 187 (0.892 to 0.962), 40/12 189 (0.904 to 0.969),
  //   40/20 188 (0.898 to 0.965), 40/36 193 (0.930 to 0.983), 60/8 181 (0.856 to 0.938),
  //   60/10 180 (0.851 to 0.934), 60/12 186 (0.886 to 0.958), 60/20 183 (0.868 to 0.946),
  //   60/40 180 (0.851 to 0.934), 120/8 177 (0.833 to 0.922), 120/10 175 (0.822 to 0.914),
  //   120/12 178 (0.839 to 0.926), 120/20 182 (0.862 to 0.942), 120/40 185 (0.880 to 0.954),
  //   120/60 185 (0.880 to 0.954), 120/108 190 (0.910 to 0.973).
  // The sparse kernel gives many small samples with no crossing. Then each total is 0, and the interval is the
  // point 0. At m = 8, no kernel reaches 0.95. The skewed kernel is below 0.95 in each cell with m / n of 2/3 or less.
  // A probe of the correction at the cells 40/36 and 120/108: with no correction, each kernel holds 200 of 200.
  // With the factor (1 - m / n)^2 on the variance, the kernels hold 91 to 107 of 200.
  const TIGHT: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    sparse: { "40/8": 76, "40/10": 106, "40/12": 133, "40/20": 174, "40/36": 192, "60/8": 113, "60/10": 150, "60/12": 159, "60/20": 184, "60/40": 186, "120/8": 102, "120/10": 135, "120/12": 156, "120/20": 189, "120/40": 194, "120/60": 195, "120/108": 187 },
    crossings: { "40/8": 180, "40/10": 194, "40/12": 182, "40/20": 183, "40/36": 189, "60/8": 183, "60/10": 193, "60/12": 194, "60/20": 190, "60/40": 193, "120/8": 188, "120/10": 189, "120/12": 188, "120/20": 193, "120/40": 192, "120/60": 189, "120/108": 185 },
    skewed: { "40/8": 181, "40/10": 187, "40/12": 189, "40/20": 188, "40/36": 193, "60/8": 181, "60/10": 180, "60/12": 186, "60/20": 183, "60/40": 180, "120/8": 177, "120/10": 175, "120/12": 178, "120/20": 182, "120/40": 185, "120/60": 185, "120/108": 190 },
  };
  // At m / n = 1/2 and 0.9 with n = 120 or m = 36, the Wilson interval of each kernel holds 0.95.
  const CORRECTION_CELLS = ["120/60", "40/36", "120/108"];

  it.each(Object.keys(KERNELS))("covers the total with the two methods, for the kernel %s", (kernelName) => {
    const measured: Record<string, number> = {};
    for (const [n, m] of CELLS) {
      const hits = coverage(kernelName, n, m);
      // The method "conservative" has a proof. The Wilson lower end of its coverage is at the level or more.
      expect(wilson(hits.conservative, SAMPLES).low, `conservative ${kernelName} ${n}/${m}`).toBeGreaterThanOrEqual(0.95);
      measured[`${n}/${m}`] = hits.tight;
      if (CORRECTION_CELLS.includes(`${n}/${m}`)) {
        const share = wilson(hits.tight, SAMPLES);
        expect(share.low, `tight ${kernelName} ${n}/${m}`).toBeLessThanOrEqual(0.95);
        expect(share.high, `tight ${kernelName} ${n}/${m}`).toBeGreaterThanOrEqual(0.95);
      }
    }
    expect(measured).toEqual(TIGHT[kernelName]);
  });

  it("keeps the interval of the mean in the range of the kernel", () => {
    const i = uStatisticInterval([0, 0, 1, 1, 0, 0, 0, 0], { order: 2, population: 40, method: "conservative", range: [0, 1] });
    expect(i.mean.low).toBe(0);
    expect(i.low).toBe(0);
    expect(i.mean.high).toBeLessThanOrEqual(1);
    const t = uStatisticInterval([0, 0, 1, 1, 0, 0, 0, 0], { order: 2, population: 40, method: "tight", range: [0, 1] });
    expect(t.mean.low).toBe(0);
    const free = uStatisticInterval([0, 0, 1, 1, 0, 0, 0, 0], { order: 2, population: 40, method: "tight" });
    expect(free.mean.low).toBeLessThan(0);
  });

  it("refuses a bad input", () => {
    const ok = [1, 2, 1, 0];
    const bad: Parameters<typeof uStatisticInterval>[1][] = [
      { order: 0, population: 10, method: "tight" },
      { order: 1.5, population: 10, method: "tight" },
      { order: 4, population: 10, method: "tight" },
      { order: 2, population: 3, method: "tight" },
      { order: 2, population: 10.5, method: "tight" },
      { order: 2, population: 10, method: "other" as "tight" },
      { order: 2, population: 10, method: "tight", level: 1 },
      { order: 2, population: 10, method: "tight", level: 0 },
      { order: 2, population: 10, method: "conservative" },
      { order: 2, population: 10, method: "conservative", range: [1, 1] },
      { order: 2, population: 10, method: "conservative", range: [0, Number.NaN] },
      // A total of 2 is more than the 3 other units times the kernel maximum 0.5.
      { order: 2, population: 10, method: "tight", range: [0, 0.5] },
    ];
    for (const options of bad) expect(() => uStatisticInterval(ok, options), JSON.stringify(options)).toThrow(/^uStatisticInterval: /);
    expect(() => uStatisticInterval([1, Number.NaN, 2], { order: 1, population: 10, method: "tight" })).toThrow(RangeError);
    expect(() => uStatisticInterval([1], { order: 1, population: 10, method: "tight" })).toThrow(RangeError);
    expect(() => uStatisticInterval([], { order: 1, population: 10, method: "tight" })).toThrow(RangeError);
  });
});
