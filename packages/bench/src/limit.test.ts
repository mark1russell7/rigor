import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { type PairedTime, caseIntervals, caseRatios, firstArm, limitVerdict } from "./index.ts";

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

  /** The records of 20 cases: `slow` cases take 3 times arm a, and the other cases take 1.5 times. */
  const tail = (slow: number, seed: number): PairedTime[] =>
    records(20, 1.5, seed).map((r) => (Number(r.case.slice(1)) < slow ? { ...r, b: r.b * 2 } : r));

  it("permits a share of the cases out of the limit with the option share", () => {
    const one = tail(1, 9);
    expect(limitVerdict(one, aa, { limit: 2 })).toMatchObject({ outcome: "beyond", share: 1, allowed: 0 });
    const shared = limitVerdict(one, aa, { limit: 2, share: 0.95 });
    expect(shared).toMatchObject({ outcome: "within", share: 0.95, allowed: 1 });
    expect(shared.reason).toMatch(/1 of 20 cases are not within, and the share 0.95 permits 1.$/);
    const two = limitVerdict(tail(2, 10), aa, { limit: 2, share: 0.95 });
    expect(two.outcome).toBe("beyond");
    expect(two.reason).toMatch(/^2 of 20 cases are above the limit 2, and the share 0.95 permits 1./);
  });

  it("cannot decide when too many cases hold the limit, and counts the allowed cases with no float error", () => {
    const near = records(20, 2, 11);
    expect(limitVerdict(near, aa, { limit: 2, share: 0.95 }).outcome).toBe("cannot decide");
    expect(limitVerdict(records(10, 1.5, 12), aa, { limit: 2, share: 0.9 }).allowed).toBe(1);
    expect(limitVerdict(records(19, 1.5, 13), aa, { limit: 2, share: 0.95 }).allowed).toBe(0);
    for (const share of [0, -0.1, 1.5, Number.NaN]) expect(() => limitVerdict(near, aa, { limit: 2, share }), String(share)).toThrow(/the share is above 0 and at most 1/);
  });
});
