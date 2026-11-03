import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { type PairedTime, caseIntervals, caseRatios, firstArm, limitVerdict, timeRounds } from "./index.ts";

/** The records of `cases` cases of 11 rounds. Arm b takes `factor` times arm a, with a seeded noise of about 2 %. */
function records(cases: number, factor: number, seed: number): PairedTime[] {
  const r = random(seed);
  const out: PairedTime[] = [];
  for (let c = 0; c < cases; c++) {
    for (let round = 0; round < 11; round++) {
      out.push({ case: `c${c}`, round, first: firstArm(round, c), a: 100 * (1 + 0.02 * (r.next() - 0.5)), b: 100 * factor * (1 + 0.02 * (r.next() - 0.5)) });
    }
  }
  return out;
}

describe("caseIntervals", () => {
  it("gives the ratio of caseRatios with an interval that holds it", () => {
    const rows = records(3, 1.5, 1);
    const intervals = caseIntervals(rows);
    expect(intervals.map((c) => c.ratio)).toEqual(caseRatios(rows).map((c) => c.ratio));
    for (const c of intervals) {
      expect(c.low).toBeLessThanOrEqual(c.ratio);
      expect(c.high).toBeGreaterThanOrEqual(c.ratio);
      expect(c.coverage).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe("limitVerdict", () => {
  const aa = records(6, 1, 2);

  it("gives within when each case is below the limit, and beyond when one case is above it", () => {
    expect(limitVerdict(records(6, 1.5, 3), aa, { limit: 2 }).outcome).toBe("within");
    const beyond = limitVerdict([...records(5, 1.5, 4), ...records(6, 3, 5).filter((r) => r.case === "c5")], aa, { limit: 2 });
    expect(beyond.outcome).toBe("beyond");
    expect(beyond.cases.find((c) => c.case === "c5")?.outcome).toBe("beyond");
  });

  it("cannot decide on a case whose widened interval holds the limit", () => {
    const v = limitVerdict(records(6, 2, 6), aa, { limit: 2 });
    expect(v.outcome).toBe("cannot decide");
    for (const c of v.cases) expect(c.bound).toBeCloseTo(c.high * v.band!.high, 12);
  });

  it("cannot decide with too few A/A cases or no candidate cases, and refuses a limit that is not above 0", () => {
    expect(limitVerdict(records(6, 1.5, 7), records(4, 1, 8), { limit: 2 }).outcome).toBe("cannot decide");
    expect(limitVerdict([], aa, { limit: 2 }).outcome).toBe("cannot decide");
    expect(() => limitVerdict(records(6, 1.5, 7), aa, { limit: 0 })).toThrow(RangeError);
  });
});

describe("timeRounds", () => {
  it("grows the batch to the target time and turns the order each round", () => {
    let t = 0;
    const result = timeRounds({ a: () => ((t += 0.01), 1), b: () => ((t += 0.02), 2) }, { case: "x", rounds: 4, offset: 1, targetMs: 10, warmMs: 5, now: () => t });
    expect(result.count).toBe(1024);
    expect(result.records.map((r) => r.first)).toEqual(["b", "a", "b", "a"]);
    for (const r of result.records) expect(r.b / r.a).toBeCloseTo(2, 9);
    expect(caseRatios(result.records)[0]!.ratio).toBeCloseTo(2, 9);
    expect(result.sink).toBeGreaterThan(0);
  });

  it("refuses a count of rounds that is not a whole number of 1 or more", () => {
    expect(() => timeRounds({ a: () => 0, b: () => 0 }, { case: "x", rounds: 0 })).toThrow(RangeError);
  });
});
