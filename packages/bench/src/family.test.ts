import { describe, expect, it } from "vitest";
import { type FamilyItem, type PooledVerdict, type TimeOutcome, type TimeVerdict, familyPower, familyRead, timeVerdict } from "./index.ts";

/** A time verdict with only the fields that `familyRead` reads. */
const time = (outcome: TimeOutcome, pSlower: number, pFaster = 1 - pSlower, finite = 9_999): TimeVerdict =>
  ({ outcome, pSlower, pFaster, interval: { finite } }) as unknown as TimeVerdict;
const pooled = (outcome: TimeOutcome, pSlower: number, jobs: readonly TimeOutcome[]): PooledVerdict =>
  ({ outcome, pooled: time(outcome, pSlower), jobs: jobs.map((o, i) => ({ job: String(i), verdict: { outcome: o } })) }) as unknown as PooledVerdict;
const family = (first: FamilyItem["verdict"], others = 15): FamilyItem[] => [
  { case: "first", verdict: first },
  ...Array.from({ length: others }, (_, i): FamilyItem => ({ case: `case ${String(i)}`, verdict: time("same", 0.5) })),
];

describe("familyRead", () => {
  it("keeps a slower case with no correction, and reads it as cannot decide with Holm at 16 cases", () => {
    const read = familyRead(family(time("slower", 0.01)));
    expect([read.plain.slower, read.holm.slower]).toEqual([1, 0]);
    expect(read.cases[0]!.adjustedSlower).toBeCloseTo(0.16, 12);
    expect(read.lines).toContain('The case "first" reads slower, and with Holm it reads cannot decide: the adjusted p is 0.16.');
  });

  it("keeps a slower case with Holm when its p passes the first step", () => {
    const read = familyRead(family(time("slower", 0.0001)));
    expect([read.plain.slower, read.holm.slower, read.cases[0]!.holm]).toEqual([1, 1, "slower"]);
    expect(read.lines.some((line) => line.includes('"first" reads'))).toBe(false);
  });

  it("reads each job: a pooled slower with one job alone not slower is cannot decide", () => {
    const read = familyRead(family(pooled("slower", 0.0001, ["slower", "cannot decide"])));
    expect([read.cases[0]!.holm, read.cases[0]!.eachJob, read.cases[0]!.eachJobHolm]).toEqual(["slower", "cannot decide", "cannot decide"]);
    expect(read.lines).toContain('The case "first" reads slower, and a job alone does not read slower.');
    const both = familyRead(family(pooled("slower", 0.0001, ["slower", "slower"])));
    expect([both.eachJob.slower, both.eachJobHolm.slower]).toEqual([1, 1]);
    const holmOnly = familyRead(family(pooled("slower", 0.01, ["slower", "slower"])));
    expect([holmOnly.eachJob.slower, holmOnly.holm.slower, holmOnly.eachJobHolm.slower]).toEqual([1, 0, 0]);
  });

  it("corrects the side faster on its own", () => {
    const read = familyRead(family(time("faster", 0.99, 0.01)));
    expect([read.plain.faster, read.holm.faster]).toEqual([1, 0]);
    expect(read.cases[0]!.adjustedFaster).toBeCloseTo(0.16, 12);
  });

  it("states the floor of the draws against the first step of Holm", () => {
    const enough = familyRead(family(time("same", 0.5, 0.5, 999)));
    expect([enough.floor, enough.firstStep]).toEqual([0.001, 0.025 / 16]);
    expect(enough.lines[1]).toBe("The smallest p of the draws is 0.001, below the first step 0.00156 of Holm at the level 0.025.");
    const few = familyRead(family(time("same", 0.5, 0.5, 99)));
    expect(few.lines[1]).toBe("The smallest p of the draws is 0.01, not below the first step 0.00156 of Holm. No case can read slower with Holm, so give the bootstrap more runs.");
  });

  it("keeps the outcome of a case with no p, and refuses a level out of (0, 1)", () => {
    const bare = { outcome: "slower", interval: undefined } as unknown as TimeVerdict;
    const read = familyRead([{ case: "bare", verdict: bare }]);
    expect([read.cases[0]!.holm, read.floor, read.lines.length]).toEqual(["slower", undefined, 2]);
    expect(read.lines[1]).toBe("1 of 1 cases have no p, so the Holm read keeps their outcome. Give the verdicts the option pValues.");
    expect(() => familyRead([], 0)).toThrow(RangeError);
    expect(() => familyRead([], 1)).toThrow(RangeError);
  });
});

describe("the p of a time verdict", () => {
  const rounds = (ratio: number, prefix: string) =>
    Array.from({ length: 12 }, (_, i) => ({ case: `${prefix}${String(i)}`, round: 0, first: i % 2 === 0 ? ("a" as const) : ("b" as const), a: 10 + (i % 3) * 0.01, b: (10 + ((i + 1) % 3) * 0.01) * ratio }));

  it("gives pSlower and pFaster from the draws of the interval with the option pValues, and the interval has no p key", () => {
    const slow = timeVerdict(rounds(1.2, "c"), rounds(1, "aa"), { bootstrap: { runs: 999 }, pValues: true });
    expect(slow.outcome).toBe("slower");
    expect(slow.pSlower).toBe(1 / 1000);
    expect(slow.pFaster).toBe(1);
    expect(Object.keys(slow.interval!)).not.toContain("pAbove");
  });

  it("gives no p field by default, with the same interval and outcome", () => {
    const options = { bootstrap: { runs: 999, seed: 4 } };
    const plain = timeVerdict(rounds(1.01, "c"), rounds(1, "aa"), options);
    const withP = timeVerdict(rounds(1.01, "c"), rounds(1, "aa"), { ...options, pValues: true });
    expect(plain).not.toHaveProperty("pSlower");
    expect(plain).not.toHaveProperty("pFaster");
    expect(withP.pSlower).toBeTypeOf("number");
    expect([plain.interval, plain.outcome]).toEqual([withP.interval, withP.outcome]);
  });
});

describe("familyPower, the flip at the settings of a 16-case bench", () => {
  // 16 cases, 12 rounds in each of 2 jobs, a noise of 0.01 for each arm, the margin log(1.015). Fewer runs keep the test short: the floor 1 / 1001 is below the first step 0.025 / 16.
  const bench = { family: 16, rounds: 12, jobs: 2, sigma: 0.01, trials: 30, verdict: { margin: Math.log(1.015), bootstrap: { runs: 1000 } } };

  it("reads a false slower in many families with no correction, and in few with Holm or with each job", () => {
    const aa = familyPower(bench);
    expect(aa.falseSlower.plain).toBeGreaterThan(0.1);
    expect(aa.falseSlower.holm).toBeLessThanOrEqual(0.05);
    expect(aa.falseSlower.eachJob).toBeLessThanOrEqual(0.05);
    expect(aa.falseSlower.eachJobHolm).toBeLessThanOrEqual(aa.falseSlower.holm);
  }, 120_000);

  it("reads a slowdown of 3 % at 80 % or more with each read, and a slowdown of 1 % at less than 80 % with Holm", () => {
    const three = familyPower({ ...bench, ratio: 1.03 });
    for (const share of Object.values(three.firstSlower)) expect(share).toBeGreaterThanOrEqual(0.8);
    const one = familyPower({ ...bench, ratio: 1.01 });
    expect(one.firstSlower.holm).toBeLessThan(0.8);
    expect(one.firstSlower.plain).toBeGreaterThan(one.firstSlower.holm);
  }, 120_000);

  it("loses power of the read of each job when the jobs shift", () => {
    const still = familyPower({ ...bench, ratio: 1.02, trials: 20 });
    const shifted = familyPower({ ...bench, ratio: 1.02, trials: 20, jobShift: 0.02 });
    expect(shifted.firstSlower.eachJob).toBeLessThan(still.firstSlower.eachJob);
  }, 120_000);

  it("reads a real slowdown as slower with Holm at the default of 10 000 runs", () => {
    const real = familyPower({ ...bench, ratio: 1.05, trials: 1, verdict: { margin: Math.log(1.015) } });
    expect(real.firstSlower).toEqual({ plain: 1, holm: 1, eachJob: 1, eachJobHolm: 1 });
    expect(real.falseSlower.holm).toBe(0);
  }, 120_000);

  it("refuses a count that is not a whole number of 1 or more, and a ratio of 0", () => {
    expect(() => familyPower({ family: 0 })).toThrow(RangeError);
    expect(() => familyPower({ family: 2, trials: 1.5 })).toThrow(RangeError);
    expect(() => familyPower({ family: 2, ratio: 0 })).toThrow(RangeError);
    expect(() => familyPower({ family: 2, jobShift: -0.01 })).toThrow(RangeError);
  });
});
