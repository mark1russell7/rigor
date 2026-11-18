import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { type PairedTime, aaSpread, aaStats, caseIntervals, caseRatios, firstArm, limitVerdict } from "./index.ts";

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

  it("keeps the band of the A/A cases by default, and gives its noise to each case", () => {
    const verdict = limitVerdict(records(6, 1.5, 3), aa, { limit: 2 });
    expect(verdict.band).toBeDefined();
    for (const c of verdict.cases) {
      expect(c.noise).toBe(verdict.band!.noise);
      expect(c.bound).toBe(c.high * verdict.band!.high);
      expect(c.floor).toBe(c.low * verdict.band!.low);
    }
  });
});

describe("limitVerdict with the A/A noise of the rounds", () => {
  it("decides a bench of 1 case, where the band of the A/A cases cannot", () => {
    const aaOne = records(1, 1, 21);
    expect(limitVerdict(records(1, 1.5, 22), aaOne, { limit: 2 }).outcome).toBe("cannot decide");
    const within = limitVerdict(records(1, 1.5, 22), aaOne, { limit: 2, aaFrom: "rounds" });
    expect(within).toMatchObject({ outcome: "within", band: undefined });
    expect(limitVerdict(records(1, 3, 23), aaOne, { limit: 2, aaFrom: "rounds" }).outcome).toBe("beyond");
    expect(limitVerdict(records(1, 2, 24), aaOne, { limit: 2, aaFrom: "rounds" }).outcome).toBe("cannot decide");
  });

  it("widens each case with the interval of the A/A median of the same case", () => {
    const aaRounds = records(3, 1, 25);
    const verdict = limitVerdict(records(3, 1.5, 26), aaRounds, { limit: 2, aaFrom: "rounds" });
    const own = caseIntervals(aaRounds);
    for (const c of verdict.cases) {
      const a = own.find((x) => x.case === c.case)!;
      const noise = Math.max(Math.abs(Math.log(a.low)), Math.abs(Math.log(a.high)));
      expect(c.noise).toBe(noise);
      expect(c.bound).toBeCloseTo(c.high * Math.exp(noise), 12);
      expect(c.floor).toBeCloseTo(c.low * Math.exp(-noise), 12);
    }
  });

  it("cannot decide on a case with no A/A rounds", () => {
    const verdict = limitVerdict(records(2, 1.5, 27), records(1, 1, 28), { limit: 2, aaFrom: "rounds" });
    expect(verdict.cases.map((c) => [c.case, c.outcome])).toEqual([["c0", "within"], ["c1", "cannot decide"]]);
    expect(verdict.outcome).toBe("cannot decide");
    expect(limitVerdict(records(2, 1.5, 27), records(1, 1, 28), { limit: 2, aaFrom: "rounds", share: 0.5 }).outcome).toBe("within");
  });

  it("refuses an unknown source of the A/A noise", () => {
    expect(() => limitVerdict(records(1, 1.5, 22), records(1, 1, 21), { limit: 2, aaFrom: "jobs" as "rounds" })).toThrow(/"cases" or "rounds"/);
  });
});

describe("limitVerdict with a noise cap", () => {
  /** The A/A records of `cases` cases of 11 rounds, with a seeded noise of approximately `width` (0.4 is 40 %). */
  function loud(cases: number, width: number, seed: number): PairedTime[] {
    const r = random(seed);
    return records(cases, 1, seed).map((x) => ({ ...x, b: x.a * (1 + width * (r.next() - 0.5)) }));
  }

  it("cannot decide a case with a noisy A/A arm, also with a bound below the limit", () => {
    const aa = loud(1, 0.4, 31);
    const free = limitVerdict(records(1, 1.2, 32), aa, { limit: 2, aaFrom: "rounds" });
    expect(free.outcome).toBe("within");
    expect(free.cases[0]?.noiseCheck).toBeUndefined();
    const capped = limitVerdict(records(1, 1.2, 32), aa, { limit: 2, aaFrom: "rounds", noiseCap: 0.05 });
    expect(capped.outcome).toBe("cannot decide");
    expect(capped.cases[0]?.noiseCheck).toMatchObject({ cap: 0.05, noisy: true });
    expect(capped.cases[0]?.noiseCheck?.spread).toBeCloseTo(aaStats(aa)[0]!.spread, 12);
    expect(capped.reason).toMatch(/^1 of 1 cases are noisy for the noise cap 0.05. The first is "c0", with the A\/A spread 0\.\d+\.$/);
  });

  it("keeps the outcome of a quiet case, with the facts of its check", () => {
    const v = limitVerdict(records(1, 1.5, 22), records(1, 1, 21), { limit: 2, aaFrom: "rounds", noiseCap: 0.05 });
    expect(v.outcome).toBe("within");
    expect(v.cases[0]?.noiseCheck).toMatchObject({ cap: 0.05, noisy: false, biased: false });
    expect(limitVerdict(records(1, 3, 23), records(1, 1, 21), { limit: 2, aaFrom: "rounds", noiseCap: 0.05 }).outcome).toBe("beyond");
  });

  it("cannot decide a case with a biased A/A arm", () => {
    const v = limitVerdict(records(1, 1.5, 22), records(1, 1.1, 33), { limit: 2, aaFrom: "rounds", noiseCap: 0.05 });
    expect(v.outcome).toBe("cannot decide");
    expect(v.cases[0]?.noiseCheck).toMatchObject({ biased: true });
    expect(v.cases[0]?.noiseCheck?.aaMedian).toBeCloseTo(1.1, 1);
  });

  it("uses the spread of the A/A arm for each case with the A/A noise of the cases", () => {
    const quiet = records(6, 1, 2);
    expect(limitVerdict(records(6, 1.5, 3), quiet, { limit: 2, noiseCap: 0.05 }).outcome).toBe("within");
    const aa = loud(6, 1, 34);
    const v = limitVerdict(records(6, 1.5, 3), aa, { limit: 2, noiseCap: 0.05 });
    expect(v.outcome).toBe("cannot decide");
    for (const c of v.cases) expect(c.noiseCheck).toMatchObject({ spread: aaSpread(aa), noisy: true });
  });

  it("refuses a bad noise cap and a bad spread level", () => {
    const one = records(1, 1.5, 22);
    for (const noiseCap of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => limitVerdict(one, one, { limit: 2, aaFrom: "rounds", noiseCap }), String(noiseCap)).toThrow(/the noise cap is a finite number/);
    }
    for (const spreadLevel of [0, 1, Number.NaN]) {
      expect(() => limitVerdict(one, one, { limit: 2, aaFrom: "rounds", noiseCap: 0.1, spreadLevel }), String(spreadLevel)).toThrow(/the spread level/);
    }
  });
});
