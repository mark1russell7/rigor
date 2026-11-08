import { describe, expect, it } from "vitest";
import { type CoverageBar, type CoverageCell, binomialTest, coverageMinSample, holm, wilson } from "./index.ts";

const BAR: CoverageBar = { level: 0.95, alpha: 0.05, pooledLow: 0.94 };

/** This function gives made-up cells: one cell for each kernel name at each sample size, with the same counts. */
function cells(rows: readonly (readonly [sample: number, hits: number, draws: number, kernels?: number])[]): CoverageCell[] {
  return rows.flatMap(([sample, hits, draws, kernels = 2]) =>
    Array.from({ length: kernels }, (_, k) => ({ name: `k${k} m${sample}`, sample, hits, draws })),
  );
}

describe("coverageMinSample", () => {
  it("gives the smallest m when each step passes the two tests", () => {
    const result = coverageMinSample(
      cells([
        [8, 955, 1000],
        [20, 958, 1000],
        [40, 962, 1000],
      ]),
      BAR,
    );
    expect(result.minSample).toBe(8);
    expect(result.steps.map((s) => [s.sample, s.cells, s.reason])).toEqual([
      [8, 6, "qualifies"],
      [20, 4, "qualifies"],
      [40, 2, "qualifies"],
    ]);
    expect(result.steps[0]?.hits).toBe(2 * (955 + 958 + 962));
    expect(result.steps[0]?.draws).toBe(6000);
    expect(result.steps[0]?.pooled).toEqual(wilson(2 * (955 + 958 + 962), 6000));
  });

  it("fails test 1 when one cell rejects the level after Holm, and qualifies at the next m", () => {
    const input = cells([
      [8, 960, 1000],
      [20, 960, 1000],
      [40, 960, 1000],
    ]);
    const low = { name: "low m8", sample: 8, hits: 900, draws: 1000 };
    const result = coverageMinSample([...input, low], BAR);
    const first = result.steps[0];
    expect(first?.reason).toBe("cell-rejected");
    expect(first?.rejected).toEqual(["low m8"]);
    // The pooled coverage passes test 2, so only test 1 fails.
    expect(first?.pooled.low).toBeGreaterThanOrEqual(0.94);
    expect(first?.smallestAdjusted).toBe(holm([...input, low].map((c) => binomialTest(c.hits, c.draws, 0.95, "less")))[6]?.adjusted);
    expect(result.minSample).toBe(20);
  });

  it("does not reject a cell that is low only before the Holm correction", () => {
    // P(X <= 935) at n = 1000 and p = 0.95 is about 0.02: below alpha alone, above it after Holm over 6 cells.
    const p = binomialTest(935, 1000, 0.95, "less");
    expect(p).toBeLessThan(0.05);
    expect(6 * p).toBeGreaterThan(0.05);
    const result = coverageMinSample([...cells([[8, 975, 1000, 5]]), { name: "near", sample: 8, hits: 935, draws: 1000 }], BAR);
    expect(result.steps[0]?.rejected).toEqual([]);
    expect(result.minSample).toBe(8);
  });

  it("fails test 2 only when no cell rejects but the pooled lower end is below the bar", () => {
    // Each cell of 92 of 100 has a p of about 0.13, so no cell rejects. The 20 cells pool to 0.92.
    expect(binomialTest(92, 100, 0.95, "less")).toBeGreaterThan(0.05);
    const result = coverageMinSample(
      cells([
        [8, 92, 100, 20],
        [40, 99, 100, 2],
      ]),
      BAR,
    );
    expect(result.steps[0]?.reason).toBe("pooled-low");
    expect(result.steps[0]?.rejected).toEqual([]);
    expect(result.steps[0]?.pooled.low).toBeLessThan(0.94);
    expect(result.steps[1]?.reason).toBe("qualifies");
    expect(result.minSample).toBe(40);
  });

  it("gives Infinity when no m qualifies, and names the two failed tests", () => {
    const result = coverageMinSample(
      cells([
        [8, 990, 1000],
        [20, 990, 1000],
        [108, 870, 1000],
      ]),
      BAR,
    );
    expect(result.minSample).toBe(Number.POSITIVE_INFINITY);
    expect(result.steps.map((s) => s.reason)).toEqual(["cell-rejected", "cell-rejected-and-pooled-low", "cell-rejected-and-pooled-low"]);
    expect(result.steps[2]?.rejected).toEqual(["k0 m108", "k1 m108"]);
    expect(coverageMinSample([], BAR)).toEqual({ minSample: Number.POSITIVE_INFINITY, steps: [] });
  });

  it("reads each step on its own, so a larger m can fail when a smaller m passes", () => {
    // At m >= 8 the Holm family has 12 cells and the pooled coverage is high. At m >= 40 only the 2 low cells stay.
    const result = coverageMinSample(
      cells([
        [8, 990, 1000, 10],
        [40, 940, 1000],
      ]),
      BAR,
    );
    expect(result.steps.map((s) => s.reason)).toEqual(["qualifies", "pooled-low"]);
    expect(result.minSample).toBe(8);
  });

  it("refuses a bad cell or a bad bar", () => {
    const ok = cells([[8, 9, 10]]);
    expect(() => coverageMinSample([{ name: "x", sample: 8, hits: 11, draws: 10 }], BAR)).toThrow(/more than its draws/);
    expect(() => coverageMinSample([{ name: "x", sample: 0, hits: 1, draws: 10 }], BAR)).toThrow(/sample is a whole number/);
    expect(() => coverageMinSample([{ name: "x", sample: 8, hits: 1, draws: 0 }], BAR)).toThrow(/draws is a whole number/);
    expect(() => coverageMinSample([{ name: "x", sample: 8, hits: 1.5, draws: 10 }], BAR)).toThrow(/hits is a whole number/);
    expect(() => coverageMinSample(ok, { ...BAR, level: 1 })).toThrow(/level/);
    expect(() => coverageMinSample(ok, { ...BAR, alpha: 0 })).toThrow(/alpha/);
    expect(() => coverageMinSample(ok, { ...BAR, pooledLow: 1.2 })).toThrow(/pooledLow/);
    expect(() => coverageMinSample(ok, { ...BAR, z: -1 })).toThrow(/z is/);
  });
});
