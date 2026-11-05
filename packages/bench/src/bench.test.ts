import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { type PairedTime, aaBand, armOrder, caseRatios, checkPairedTime, firstArm, timeVerdict, verdictPower } from "./index.ts";

/** The records of `cases` cases and `rounds` rounds. Arm b takes `factor` times arm a, with a seeded noise of about `spread`. */
function records(cases: number, rounds: number, factor: number, spread: number, seed: number, prefix = "c"): PairedTime[] {
  const r = random(seed);
  const out: PairedTime[] = [];
  for (let c = 0; c < cases; c++) {
    for (let round = 0; round < rounds; round++) {
      const a = 100 * (1 + spread * (r.next() - 0.5));
      const b = 100 * factor * (1 + spread * (r.next() - 0.5));
      out.push({ case: `${prefix}${c}`, round, first: firstArm(round, c), a, b });
    }
  }
  return out;
}

describe("armOrder", () => {
  const countOf = (arms: readonly number[], rounds: number): Map<string, number> => {
    const before = new Map<string, number>();
    for (let round = 0; round < rounds; round++) {
      const order = armOrder(arms, round);
      for (const [at, a] of order.entries()) for (const b of order.slice(at + 1)) before.set(`${a},${b}`, (before.get(`${a},${b}`) ?? 0) + 1);
    }
    return before;
  };

  it("mirrors the order at each odd round, and turns it at each even round", () => {
    expect(Array.from({ length: 7 }, (_, round) => armOrder(["a", "b", "c"], round).join(""))).toEqual(["abc", "cba", "bca", "acb", "cab", "bac", "abc"]);
    expect(Array.from({ length: 4 }, (_, round) => armOrder(["a", "b"], round).join(""))).toEqual(["ab", "ba", "ba", "ab"]);
    expect(armOrder(["a"], 3)).toEqual(["a"]);
  });

  it("gives each pair of arms each order within 1 after each count of rounds, at each count of arms", () => {
    const faults: string[] = [];
    for (let count = 2; count <= 9; count++) {
      const arms = Array.from({ length: count }, (_, at) => at);
      for (let rounds = 1; rounds <= 4 * count; rounds++) {
        const before = countOf(arms, rounds);
        for (const a of arms) for (const b of arms) if (a < b && Math.abs((before.get(`${a},${b}`) ?? 0) - (before.get(`${b},${a}`) ?? 0)) > 1) faults.push(`${count} arms, ${rounds} rounds: ${a} and ${b}`);
      }
    }
    expect(faults).toEqual([]);
  });

  it("gives each arm each place the same count of times over 2 rounds for each arm", () => {
    for (let count = 2; count <= 9; count++) {
      const arms = Array.from({ length: count }, (_, at) => at);
      const seen = arms.map(() => arms.map(() => 0));
      for (let round = 0; round < 2 * count; round++) {
        for (const [place, arm] of armOrder(arms, round).entries()) {
          const row = seen[arm];
          if (row !== undefined) row[place] = (row[place] ?? 0) + 1;
        }
      }
      expect(seen.flat().every((n) => n === 2)).toBe(true);
    }
  });

  it("gives records of a pair that caseRatios accepts, where a plain turn gives records that it refuses", () => {
    const arms = ["base", "branch", "aa"];
    const records = (orderOf: (round: number) => readonly string[]): PairedTime[] =>
      Array.from({ length: 7 }, (_, round) => {
        const order = orderOf(round);
        return { case: "c", round, first: order.indexOf("base") < order.indexOf("branch") ? "a" : "b", a: 1, b: 1 };
      });
    expect(caseRatios(records((round) => armOrder(arms, round)))).toHaveLength(1);
    const plain = (round: number): readonly string[] => arms.map((_, at) => arms[(at + round) % arms.length] as string);
    expect(() => caseRatios(records(plain))).toThrow("The order turns each round");
  });

  it("does not change its input, and refuses no arms and a bad round", () => {
    const arms = [1, 2, 3];
    armOrder(arms, 1);
    expect(arms).toEqual([1, 2, 3]);
    expect(() => armOrder([], 0)).toThrow(RangeError);
    expect(() => armOrder([1], -1)).toThrow(RangeError);
    expect(() => armOrder([1], 0.5)).toThrow(RangeError);
  });
});

describe("firstArm", () => {
  it("turns the order each round, and an odd offset starts with arm b", () => {
    expect([0, 1, 2, 3].map((r) => firstArm(r))).toEqual(["a", "b", "a", "b"]);
    expect([0, 1, 2].map((r) => firstArm(r, 1))).toEqual(["b", "a", "b"]);
    expect(firstArm(0, -1)).toBe("b");
  });

  it("refuses a round that is not a whole number of 0 or more", () => {
    expect(() => firstArm(-1)).toThrow(RangeError);
    expect(() => firstArm(0.5)).toThrow(RangeError);
    expect(() => firstArm(0, 0.5)).toThrow(RangeError);
  });
});

describe("checkPairedTime", () => {
  it("refuses a time that is not a finite number above 0, and a wrong arm or round", () => {
    const ok: PairedTime = { case: "x", round: 0, first: "a", a: 1, b: 2 };
    expect(checkPairedTime(ok)).toBe(ok);
    for (const bad of [{ a: 0 }, { b: Number.NaN }, { b: Infinity }, { round: -1 }, { first: "c" }, { case: "" }]) {
      expect(() => checkPairedTime({ ...ok, ...bad } as PairedTime)).toThrow(RangeError);
    }
  });
});

describe("caseRatios", () => {
  it("gives the median ratio of each case in the order of the first record", () => {
    const list: PairedTime[] = [
      { case: "q", round: 0, first: "a", a: 10, b: 20 },
      { case: "p", round: 0, first: "a", a: 10, b: 5 },
      { case: "q", round: 1, first: "b", a: 10, b: 30 },
      { case: "q", round: 2, first: "a", a: 10, b: 10 },
    ];
    const ratios = caseRatios(list);
    expect(ratios.map((r) => r.case)).toEqual(["q", "p"]);
    expect(ratios[0]!.ratio).toBeCloseTo(2, 12);
    expect(ratios[0]!.rounds).toBe(3);
    expect(ratios[1]!.ratio).toBeCloseTo(0.5, 12);
  });

  it("refuses 2 records of one round and an order that did not turn", () => {
    const one: PairedTime = { case: "x", round: 0, first: "a", a: 1, b: 1 };
    expect(() => caseRatios([one, one])).toThrow(/2 records of one round/);
    expect(() => caseRatios([one, { ...one, round: 1 }, { ...one, round: 2 }])).toThrow(/order turns/);
  });
});

describe("aaBand", () => {
  it("holds the A/A ratios, and refuses fewer than 5 cases", () => {
    const aa = records(20, 5, 1, 0.1, 7);
    const band = aaBand(aa);
    expect(band.cases).toBe(20);
    expect(band.low).toBeCloseTo(1 / band.high, 12);
    expect(band.high).toBeGreaterThan(1);
    expect(band.high).toBeLessThan(1.1);
    expect(band.median).toBeGreaterThan(band.low);
    expect(band.median).toBeLessThan(band.high);
    expect(() => aaBand(records(4, 5, 1, 0.1, 7))).toThrow(/needs 5 or more/);
  });
});

describe("timeVerdict", () => {
  const aa = records(20, 5, 1, 0.1, 11, "aa");
  const options = { bootstrap: { runs: 2000, seed: 3 } };

  it("finds a faster and a slower candidate beyond the band", () => {
    const faster = timeVerdict(records(20, 5, 0.8, 0.1, 12), aa, options);
    expect(faster.outcome).toBe("faster");
    expect(faster.comparison!.gains).toBeGreaterThan(15);
    const slower = timeVerdict(records(20, 5, 1.25, 0.1, 13), aa, options);
    expect(slower.outcome).toBe("slower");
    expect(slower.comparison!.drops).toBeGreaterThan(15);
  });

  it("gives same for an equal candidate with a narrow interval", () => {
    const v = timeVerdict(records(40, 5, 1, 0.02, 14), aa, options);
    expect(v.outcome).toBe("same");
    expect(v.reason).toMatch(/in the margin/);
  });

  it("gives cannot decide when the interval crosses an end of the band", () => {
    const v = timeVerdict(records(6, 1, 1.03, 0.3, 15), aa, options);
    expect(v.outcome).toBe("cannot decide");
    expect(v.reason).toMatch(/crosses/);
  });

  it("gives cannot decide without an A/A arm, or without candidate cases", () => {
    const none = timeVerdict(records(20, 5, 0.5, 0.1, 16), [], options);
    expect(none.outcome).toBe("cannot decide");
    expect(none.band).toBeUndefined();
    expect(none.interval).toBeDefined();
    expect(none.reason).toMatch(/A\/A arm has 0 cases/);
    expect(timeVerdict([], aa).outcome).toBe("cannot decide");
  });

  it("gives the same verdict for the same seed", () => {
    const c = records(20, 5, 0.97, 0.1, 17);
    expect(timeVerdict(c, aa, options)).toEqual(timeVerdict(c, aa, options));
  });
});

describe("the rules and the bands", () => {
  const aa = records(20, 5, 1, 0.1, 21, "aa");
  const bootstrap = { runs: 1000, seed: 5 };

  it("keeps the rule band of 0.1.0 as an option, with the band case", () => {
    const v = timeVerdict(records(20, 5, 0.8, 0.1, 22), aa, { rule: "band", kind: "case", bootstrap });
    expect(v.rule).toBe("band");
    expect(v.band!.kind).toBe("case");
    expect(v.outcome).toBe("faster");
  });

  it("gives a band median that is narrower than the band case", () => {
    const wide = aaBand(aa, { kind: "case" });
    const narrow = aaBand(aa, { kind: "median", bootstrap });
    expect(narrow.kind).toBe("median");
    expect(narrow.noise).toBeLessThan(wide.noise);
    expect(narrow.low).toBeCloseTo(1 / narrow.high, 12);
  });

  it("counts the gains and the drops at the two ends of the band", () => {
    const list: PairedTime[] = [0.5, 0.9, 1, 1.1, 2].map((ratio, c) => ({ case: `k${c}`, round: 0, first: "a", a: 10, b: 10 * ratio }));
    const band = aaBand(aa, { kind: "case" });
    const v = timeVerdict(list, aa, { bootstrap });
    const below = list.filter((r) => r.b / r.a < band.low).length;
    const above = list.filter((r) => r.b / r.a > band.high).length;
    expect(v.comparison!.gains).toBe(below);
    expect(v.comparison!.drops).toBe(above);
  });

  it("refuses a margin below 0", () => {
    expect(() => timeVerdict(records(5, 3, 1, 0.1, 23), aa, { margin: -1 })).toThrow(RangeError);
  });
});

describe("verdictPower", () => {
  it("finds a large speedup, and rarely a change on equal arms", () => {
    const verdict = { bootstrap: { runs: 500, seed: 1 } };
    expect(verdictPower({ cases: 10, ratio: 0.7, trials: 20, seed: 1, verdict }).power).toBeGreaterThan(0.9);
    const equal = verdictPower({ cases: 10, ratio: 1, trials: 40, seed: 2, verdict });
    expect(equal.outcomes.faster + equal.outcomes.slower).toBeLessThan(0.15);
    expect(Object.values(equal.outcomes).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
  });

  it("refuses a bad count of cases or a bad ratio", () => {
    expect(() => verdictPower({ cases: 0, ratio: 1 })).toThrow(RangeError);
    expect(() => verdictPower({ cases: 5, ratio: 0 })).toThrow(RangeError);
  });
});
