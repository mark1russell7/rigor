import { describe, expect, it } from "vitest";
import { type GrowthRound, growthVerdict } from "./growth.ts";

/** This function gives the rounds of 5 jobs. Each job has its own speed, and the cost grows as the size to the power `exponent`. */
function rounds(exponent: number, sizes: readonly number[], spread = 0.02): GrowthRound[] {
  const out: GrowthRound[] = [];
  for (let job = 0; job < 5; job++) {
    const speed = 1 + job * 0.4;
    for (const [i, size] of sizes.entries()) {
      // A small noise in each value, different for each job and size, with no random source
      const noise = 1 + spread * Math.sin(job * 7 + i * 3);
      out.push({ job: `job-${job}`, size, value: speed * noise * Math.pow(size, exponent) * 1e-3 });
    }
  }
  return out;
}

describe("growthVerdict", () => {
  const sizes = [1_000, 10_000, 100_000];

  it("a linear cost is within a limit of 15 times for each 10 times", () => {
    const verdict = growthVerdict(rounds(1, sizes), { maxGrowth: 15 });
    expect(verdict.outcome).toBe("within");
    expect(verdict.steps.map((step) => step.outcome)).toEqual(["within", "within"]);
    for (const step of verdict.steps) expect(step.exponent).toBeCloseTo(1, 1);
  });

  it("a cost that grows as n x n is beyond the same limit", () => {
    const verdict = growthVerdict(rounds(2, sizes), { maxGrowth: 15 });
    expect(verdict.outcome).toBe("beyond");
    for (const step of verdict.steps) expect(step.median).toBeCloseTo(100, -1);
  });

  it("a slow runner does not change the verdict: the ratio is read inside each job", () => {
    const slow = rounds(1, sizes).map((round) => (round.job === "job-4" ? { ...round, value: round.value * 50 } : round));
    expect(growthVerdict(slow, { maxGrowth: 15 }).outcome).toBe("within");
  });

  it("the figures of a fan-out that cost n x n per publish fail, and the figures after its fix pass (client CLI-90)", () => {
    const before: GrowthRound[] = [
      { job: "smoke", size: 1_000, value: 14 },
      { job: "smoke", size: 10_000, value: 1_428 },
    ];
    const after: GrowthRound[] = [
      { job: "smoke", size: 1_000, value: 9.0 },
      { job: "smoke", size: 10_000, value: 51.8 },
    ];
    expect(growthVerdict(before, { maxGrowth: 15 }).outcome).toBe("beyond");
    expect(growthVerdict(after, { maxGrowth: 15 }).outcome).toBe("within");
  });

  it("scales a step that is not 10 times to the factor `per`", () => {
    const verdict = growthVerdict(rounds(1, [1_000, 2_000], 0), { maxGrowth: 15 });
    expect(verdict.steps[0]?.median).toBeCloseTo(10, 0);
    expect(growthVerdict(rounds(1, [1_000, 2_000], 0), { maxGrowth: 3, per: 2 }).steps[0]?.median).toBeCloseTo(2, 1);
  });

  it("cannot decide when the jobs fall on the two sides of the limit", () => {
    const mixed: GrowthRound[] = [];
    for (const [job, growth] of [8, 9, 14, 20, 30].entries()) {
      mixed.push({ job: `j${job}`, size: 10, value: 1 }, { job: `j${job}`, size: 100, value: growth });
    }
    expect(growthVerdict(mixed, { maxGrowth: 15 }).outcome).toBe("cannot decide");
  });

  it("takes the median of the values of a job at one size", () => {
    const verdict = growthVerdict(
      [
        { job: "a", size: 10, value: 1 },
        { job: "a", size: 10, value: 1 },
        { job: "a", size: 10, value: 100 },
        { job: "a", size: 100, value: 10 },
      ],
      { maxGrowth: 15 },
    );
    expect(verdict.steps[0]?.growths).toEqual([10]);
  });

  it("refuses values, sizes and options that give no ratio", () => {
    expect(() => growthVerdict([{ job: "a", size: 10, value: 1 }], { maxGrowth: 15 })).toThrow(/fewer than 2 sizes/);
    expect(() => growthVerdict([{ job: "a", size: 10, value: 0 }], { maxGrowth: 15 })).toThrow(/value 0/);
    expect(() => growthVerdict([{ job: "a", size: -1, value: 1 }], { maxGrowth: 15 })).toThrow(/size -1/);
    expect(() => growthVerdict(rounds(1, sizes), { maxGrowth: 1 })).toThrow(/maxGrowth/);
    expect(() => growthVerdict(rounds(1, sizes), { maxGrowth: 15, per: 1 })).toThrow(/per/);
    expect(() =>
      growthVerdict(
        [
          { job: "a", size: 10, value: 1 },
          { job: "b", size: 100, value: 1 },
        ],
        { maxGrowth: 15 },
      ),
    ).toThrow(/no job gives both/);
  });
});
