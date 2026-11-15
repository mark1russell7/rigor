import { random } from "@mark1russell7/rigor-generators";
import { medianInterval, quantile } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { type SlopeRound, gateOf, roundSlope, slopeVerdict } from "./index.ts";

const SIZES = [1000, 2000, 4000, 8000];

/** The rounds of `runs` runs of 7 rounds. A rung takes `size ** power` with a seeded noise of about `noise`. The A/A ratio of a run alternates above and below `aa`. */
function ladder(runs: number, power: number, seed: number, noise = 0.02, aa: (run: number) => number = () => 1): SlopeRound[] {
  const r = random(seed);
  const out: SlopeRound[] = [];
  for (let run = 0; run < runs; run++) {
    for (let round = 0; round < 7; round++) {
      out.push({
        run: `job-${run}`,
        rungs: SIZES.map((size) => ({ size, value: size ** power * (1 + noise * (r.next() - 0.5)) })),
        aa: aa(run) * (round % 2 === 0 ? 1 + noise / 2 : 1 - noise / 2),
      });
    }
  }
  return out;
}

const LINEAR = { limit: 1.2, holds: 1, band: 0.05 };

describe("roundSlope", () => {
  it("gives the power of the growth", () => {
    expect(roundSlope(SIZES.map((size) => ({ size, value: 3 * size })))).toBeCloseTo(1, 9);
    expect(roundSlope(SIZES.map((size) => ({ size, value: size ** 2 })))).toBeCloseTo(2, 9);
    expect(roundSlope([1, 1, 4].map((size) => ({ size, value: size ** 1.5 })))).toBeCloseTo(1.5, 9);
  });

  it("refuses fewer than 3 rungs, one size only, and a size or a value that is not above 0", () => {
    expect(() => roundSlope([{ size: 1, value: 1 }, { size: 2, value: 2 }])).toThrow(/3 rungs or more/);
    expect(() => roundSlope([1, 1, 1].map((size) => ({ size, value: 2 })))).toThrow(/2 different sizes/);
    expect(() => roundSlope([0, 1, 2].map((size) => ({ size, value: 2 })))).toThrow(/a size is/);
    expect(() => roundSlope([1, 2, 3].map((size) => ({ size, value: size === 2 ? Number.NaN : size })))).toThrow(/a value is/);
  });
});

describe("slopeVerdict", () => {
  it("gives within for a linear ladder, and beyond for a square ladder", () => {
    const linear = slopeVerdict(ladder(3, 1, 1), LINEAR);
    expect(linear.outcome).toBe("within");
    expect(linear.slopes).toHaveLength(21);
    expect(linear.slope).toBeCloseTo(1, 1);
    expect(linear.reason).toMatch(/is at most the limit 1.2, and it meets the band 0.95 to 1.05\.$/);
    const square = slopeVerdict(ladder(3, 2, 2), LINEAR);
    expect(square.outcome).toBe("beyond");
    expect(square.reason).toMatch(/is above the limit 1.2\.$/);
  });

  it("gives beyond for a slope under the band of the claim linear, and within for the claim at most the limit", () => {
    const fixedPart = ladder(3, 0.5, 3);
    expect(slopeVerdict(fixedPart, LINEAR)).toMatchObject({ outcome: "beyond", reason: expect.stringMatching(/outside the band 0.95 to 1.05/) });
    expect(slopeVerdict(fixedPart, { limit: 1.2 }).outcome).toBe("within");
  });

  it("cannot decide when the interval holds the limit", () => {
    // The claim "at most 1.2" alone: with the band around 1, this interval is outside the band, thus beyond.
    const verdict = slopeVerdict(ladder(3, 1.2, 4, 0.2), { limit: 1.2 });
    expect(slopeVerdict(ladder(3, 1.2, 4, 0.2), LINEAR).outcome).toBe("beyond");
    expect(verdict.low).toBeLessThan(1.2);
    expect(verdict.high).toBeGreaterThan(1.2);
    expect(verdict.outcome).toBe("cannot decide");
  });

  it("gives the interval of the kind spread or median at the level", () => {
    const rounds = ladder(2, 1, 5, 0.1);
    const spread = slopeVerdict(rounds, { ...LINEAR, level: 0.8 });
    expect(spread.low).toBeCloseTo(quantile(spread.slopes, 0.1), 12);
    expect(spread.high).toBeCloseTo(quantile(spread.slopes, 0.9), 12);
    const med = slopeVerdict(rounds, { ...LINEAR, interval: "median" });
    const interval = medianInterval(med.slopes, 0.9);
    expect([med.low, med.high]).toEqual([interval.low, interval.high]);
  });

  it("drops the rounds of a run whose A/A band does not contain 1", () => {
    const rounds = ladder(3, 1, 6, 0.02, (run) => (run === 1 ? 1.2 : 1));
    const verdict = slopeVerdict(rounds, LINEAR);
    expect(verdict.runs.map((r) => [r.run, r.counts])).toEqual([["job-0", true], ["job-1", false], ["job-2", true]]);
    expect(verdict.runs[1]!.aaLow).toBeGreaterThan(1);
    expect(verdict.slopes).toHaveLength(14);
    expect(verdict.runs.every((r) => r.rounds === 7)).toBe(true);
  });

  it("cannot decide when fewer runs count than minRuns", () => {
    const none = slopeVerdict(ladder(2, 1, 7, 0.02, () => 1.2), LINEAR);
    expect(none).toMatchObject({ outcome: "cannot decide", slopes: [] });
    expect(none.reason).toMatch(/^0 of 2 runs count, and a read needs 1 or more\./);
    expect(Number.isNaN(none.slope)).toBe(true);
    expect(slopeVerdict(ladder(2, 1, 8), { ...LINEAR, minRuns: 3 }).outcome).toBe("cannot decide");
    expect(slopeVerdict(ladder(3, 1, 8), { ...LINEAR, minRuns: 3 }).outcome).toBe("within");
  });

  it("gives an outcome that gateOf reads", () => {
    expect(gateOf([{ case: "walk", outcome: slopeVerdict(ladder(3, 1, 1), LINEAR).outcome }]).outcome).toBe("pass");
    expect(gateOf([{ case: "walk", outcome: slopeVerdict(ladder(3, 2, 2), LINEAR).outcome }]).outcome).toBe("block");
  });

  it("refuses bad options and bad rounds", () => {
    const rounds = ladder(1, 1, 9);
    expect(() => slopeVerdict([], LINEAR)).toThrow(/no rounds/);
    expect(() => slopeVerdict(rounds, { limit: Number.NaN })).toThrow(/limit/);
    expect(() => slopeVerdict(rounds, { limit: 1.2, holds: 1.5 })).toThrow(/at most the limit/);
    expect(() => slopeVerdict(rounds, { ...LINEAR, band: -0.1 })).toThrow(/band/);
    expect(() => slopeVerdict(rounds, { ...LINEAR, level: 1 })).toThrow(/level/);
    expect(() => slopeVerdict(rounds, { ...LINEAR, aaLevel: 0 })).toThrow(/A\/A level/);
    expect(() => slopeVerdict(rounds, { ...LINEAR, minRuns: 0 })).toThrow(/fewest runs/);
    expect(() => slopeVerdict(rounds, { ...LINEAR, interval: "mean" as "median" })).toThrow(/"spread" or "median"/);
    expect(() => slopeVerdict([{ ...rounds[0]!, run: "" }], LINEAR)).toThrow(/run of each round/);
    expect(() => slopeVerdict([{ ...rounds[0]!, aa: 0 }], LINEAR)).toThrow(/A\/A ratio/);
  });
});
