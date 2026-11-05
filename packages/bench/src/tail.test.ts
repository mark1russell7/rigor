import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { type PairedTime, caseTails, firstArm, gateOf, tailFalseFails, tailLimitVerdict } from "./index.ts";

/** The records of one case: one record for each ratio, with arm a at 100 ms. */
function caseOf(name: string, ratios: readonly number[]): PairedTime[] {
  return ratios.map((ratio, round) => ({ case: name, round, first: firstArm(round), a: 100, b: 100 * ratio }));
}

/** An A/A arm of 6 cases whose second largest ratio is at most `second`. */
function quietArm(second = 1.05): PairedTime[] {
  return [0, 1, 2, 3, 4, 5].flatMap((c) => caseOf(`aa${c}`, [0.98, 0.99, 1, 1, 1.01, second, second + 0.02]));
}

/** The records of `cases` cases of 7 rounds with a seeded noise of about 2 %. The array `cost` holds the factor of each round. */
function seeded(cases: number, cost: readonly number[], seed: number): PairedTime[] {
  const r = random(seed);
  return Array.from({ length: cases }, (_unused, c) => c).flatMap((c) =>
    cost.map((factor, round) => ({ case: `c${c}`, round, first: firstArm(round, c), a: 100 * (1 + 0.02 * (r.next() - 0.5)), b: 100 * factor * (1 + 0.02 * (r.next() - 0.5)) })),
  );
}

const LIMIT = { median: 1.1, tail: 1.2 };

describe("caseTails", () => {
  it("gives the value at the rank from the largest", () => {
    const [row] = caseTails(caseOf("c", [1, 1.5, 1.2, 1, 1, 1, 1]), 2);
    expect(row?.tail).toBeCloseTo(1.2, 12);
    expect(row?.rounds).toBe(7);
  });

  it("uses the rank 2 by default, and the rank 1 reads the largest", () => {
    const rows = caseOf("c", [1, 1.5, 1.2, 1, 1, 1, 1]);
    expect(caseTails(rows)[0]?.tail).toBeCloseTo(1.2, 12);
    expect(caseTails(rows, 1)[0]?.tail).toBeCloseTo(1.5, 12);
  });

  it("gives no value when the rounds do not put the rank above the median", () => {
    expect(caseTails(caseOf("c", [1, 1.1, 1.2, 1.3]), 2)[0]?.tail).toBeUndefined();
    expect(caseTails(caseOf("c", [1, 1.1, 1.2, 1.3, 1.4]), 2)[0]?.tail).toBeCloseTo(1.3, 12);
  });

  it("refuses a rank that is not a whole number of 1 or more", () => {
    expect(() => caseTails(caseOf("c", [1, 1, 1]), 0)).toThrow(RangeError);
    expect(() => caseTails(caseOf("c", [1, 1, 1]), 1.5)).toThrow(RangeError);
  });
});

describe("tailLimitVerdict", () => {
  it("gives within when the median and the tail of each case are at most their limits", () => {
    const v = tailLimitVerdict(caseOf("c", [1, 1.01, 1.02, 1.03, 1.04, 1.1, 1.15]), quietArm(), { limit: LIMIT, aaCap: 1.3 });
    expect(v.outcome).toBe("within");
    expect(v.cases[0]?.outcome).toBe("within");
    expect(v.rank).toBe(2);
  });

  it("gives beyond on a median over its limit, with no regard to the A/A arm", () => {
    const v = tailLimitVerdict(caseOf("c", [1.12, 1.12, 1.12, 1.12, 1.12, 1.12, 1.12]), quietArm(1.25), { limit: LIMIT, aaCap: 1.3 });
    expect(v.outcome).toBe("beyond");
    expect(v.cases[0]).toMatchObject({ overMedian: true, overTail: false, outcome: "beyond" });
  });

  it("passes a median just under its limit, and so states what the limit lets through", () => {
    const v = tailLimitVerdict(caseOf("c", [1.09, 1.09, 1.09, 1.09, 1.09, 1.09, 1.09]), quietArm(), { limit: LIMIT, aaCap: 1.3 });
    expect(v.outcome).toBe("within");
  });

  it("gives beyond on a tail over its limit and over the tail of the A/A arm, with the median under its limit", () => {
    const v = tailLimitVerdict(caseOf("c", [1, 1, 1, 1, 1, 1.3, 1.3]), quietArm(), { limit: LIMIT, aaCap: 1.3 });
    expect(v.outcome).toBe("beyond");
    expect(v.cases[0]).toMatchObject({ overMedian: false, overTail: true, outcome: "beyond" });
  });

  it("does not fail a tail that is inside the tail of the A/A arm of the run", () => {
    const v = tailLimitVerdict(caseOf("c", [1, 1, 1, 1, 1, 1.22, 1.3]), quietArm(1.25), { limit: LIMIT, aaCap: 1.3 });
    expect(v.aaTail).toBeCloseTo(1.25, 12);
    expect(v.outcome).toBe("within");
  });

  it("does not fail one slow round, because a cost in 1 round cannot be told from noise", () => {
    const v = tailLimitVerdict(caseOf("c", [1, 1, 1, 1, 1, 1, 1.9]), quietArm(), { limit: LIMIT, aaCap: 1.3 });
    expect(v.outcome).toBe("within");
    expect(v.cases[0]?.tail).toBeCloseTo(1, 12);
  });

  it("cannot decide on a loud A/A arm, because each row under that tail passes", () => {
    const v = tailLimitVerdict(caseOf("c", [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]), quietArm(1.31), { limit: LIMIT, aaCap: 1.3 });
    expect(v.outcome).toBe("cannot decide");
    expect(v.cases[0]?.outcome).toBe("cannot decide");
    expect(v.reason).toContain("1.31");
  });

  it("decides at the cap itself", () => {
    expect(tailLimitVerdict(caseOf("c", [1, 1, 1, 1, 1, 1, 1]), quietArm(1.3), { limit: LIMIT, aaCap: 1.3 }).outcome).toBe("within");
  });

  it("cannot decide with too few cases in the A/A arm", () => {
    const aa = caseOf("aa0", [1, 1, 1, 1, 1, 1, 1]);
    const v = tailLimitVerdict(caseOf("c", [1, 1, 1, 1, 1, 1, 1]), aa, { limit: LIMIT, aaCap: 1.3 });
    expect(v.outcome).toBe("cannot decide");
    expect(v.aaTail).toBeUndefined();
    expect(tailLimitVerdict(caseOf("c", [1, 1, 1, 1, 1, 1, 1]), aa, { limit: LIMIT, aaCap: 1.3, minimum: 1 }).outcome).toBe("within");
  });

  it("does not count an A/A case with too few rounds", () => {
    const short = [0, 1, 2, 3, 4, 5].flatMap((c) => caseOf(`aa${c}`, [1, 1, 1]));
    expect(tailLimitVerdict(caseOf("c", [1, 1, 1, 1, 1, 1, 1]), short, { limit: LIMIT, aaCap: 1.3 }).outcome).toBe("cannot decide");
  });

  it("cannot decide on a candidate with no cases", () => {
    const v = tailLimitVerdict([], quietArm(), { limit: LIMIT, aaCap: 1.3 });
    expect(v.outcome).toBe("cannot decide");
    expect(v.cases).toEqual([]);
  });

  it("cannot decide on a case with too few rounds, but a case that is beyond still decides", () => {
    const short = caseOf("short", [1, 1, 1]);
    expect(tailLimitVerdict(short, quietArm(), { limit: LIMIT, aaCap: 1.3 }).outcome).toBe("cannot decide");
    const both = [...short, ...caseOf("c", [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5])];
    const v = tailLimitVerdict(both, quietArm(), { limit: LIMIT, aaCap: 1.3 });
    expect(v.outcome).toBe("beyond");
    expect(v.cases[0]?.outcome).toBe("cannot decide");
  });

  it("reads the limit of each case from a function", () => {
    const rows = [...caseOf("low", [1.05, 1.05, 1.05, 1.05, 1.05, 1.05, 1.05]), ...caseOf("high", [1.05, 1.05, 1.05, 1.05, 1.05, 1.05, 1.05])];
    const v = tailLimitVerdict(rows, quietArm(), { limit: (name) => (name === "low" ? { median: 1, tail: 1.2 } : LIMIT), aaCap: 1.3 });
    expect(v.cases.map((c) => [c.case, c.outcome])).toEqual([
      ["low", "beyond"],
      ["high", "within"],
    ]);
    expect(v.cases[0]?.limit.median).toBe(1);
  });

  it("uses the rank of the options on both arms", () => {
    const rows = caseOf("c", [1, 1, 1, 1, 1, 1, 1.9]);
    const v = tailLimitVerdict(rows, quietArm(), { limit: LIMIT, aaCap: 1.3, rank: 1 });
    expect(v.rank).toBe(1);
    expect(v.aaTail).toBeCloseTo(1.07, 12);
    expect(v.outcome).toBe("beyond");
  });

  it("refuses limits and a cap that are not finite numbers above 0", () => {
    const rows = caseOf("c", [1, 1, 1]);
    expect(() => tailLimitVerdict(rows, quietArm(), { limit: { median: 0, tail: 1 }, aaCap: 1.3 })).toThrow(RangeError);
    expect(() => tailLimitVerdict(rows, quietArm(), { limit: { median: 1, tail: Number.NaN }, aaCap: 1.3 })).toThrow(RangeError);
    expect(() => tailLimitVerdict(rows, quietArm(), { limit: LIMIT, aaCap: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => tailLimitVerdict(rows, quietArm(), { limit: LIMIT, aaCap: 1.3, minimum: 0 })).toThrow(RangeError);
  });

  it("fails a seeded cost of 15 % in each round, and passes the same bench with no cost", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const aa = seeded(6, [1, 1, 1, 1, 1, 1, 1], seed + 10);
      expect(tailLimitVerdict(seeded(4, [1.15, 1.15, 1.15, 1.15, 1.15, 1.15, 1.15], seed), aa, { limit: LIMIT, aaCap: 1.3 }).outcome).toBe("beyond");
      expect(tailLimitVerdict(seeded(4, [1, 1, 1, 1, 1, 1, 1], seed), aa, { limit: LIMIT, aaCap: 1.3 }).outcome).toBe("within");
    }
  });

  it("fails a seeded cost in 2 rounds of 7 by the tail alone, and passes the same cost in 1 round of 7", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const aa = seeded(6, [1, 1, 1, 1, 1, 1, 1], seed + 10);
      const two = tailLimitVerdict(seeded(1, [1, 1.4, 1, 1, 1, 1.4, 1], seed), aa, { limit: LIMIT, aaCap: 1.3 });
      expect(two.cases[0]).toMatchObject({ overMedian: false, overTail: true, outcome: "beyond" });
      expect(tailLimitVerdict(seeded(1, [1, 1.4, 1, 1, 1, 1, 1], seed), aa, { limit: LIMIT, aaCap: 1.3 }).outcome).toBe("within");
    }
  });
});

describe("tailLimitVerdict with expected cases", () => {
  const options = { limit: LIMIT, aaCap: 1.3 };

  it("reads a case that the run lost as cannot decide, and without the list the same run reads within", () => {
    const run = caseOf("kept", [1, 1, 1, 1, 1, 1, 1]);
    expect(tailLimitVerdict(run, quietArm(), options).outcome).toBe("within");
    const v = tailLimitVerdict(run, quietArm(), { ...options, expected: ["kept", "lost"] });
    expect(v.outcome).toBe("cannot decide");
    expect(v.reason).toBe('1 of 2 cases have no record. The first is "lost".');
    expect(v.cases.map((c) => [c.case, c.outcome, c.rounds, c.ratio])).toEqual([
      ["kept", "within", 7, 1],
      ["lost", "cannot decide", 0, undefined],
    ]);
  });

  it("reads within when the run has each expected case, and a case outside the list still counts", () => {
    const run = [...caseOf("kept", [1, 1, 1, 1, 1, 1, 1]), ...caseOf("other", [1, 1, 1, 1, 1, 1, 1])];
    const v = tailLimitVerdict(run, quietArm(), { ...options, expected: ["kept", "kept"] });
    expect(v.outcome).toBe("within");
    expect(v.cases.map((c) => c.case)).toEqual(["kept", "other"]);
  });

  it("keeps beyond over a lost case, because a case over its limit blocks", () => {
    const v = tailLimitVerdict(caseOf("slow", [2, 2, 2, 2, 2, 2, 2]), quietArm(), { ...options, expected: ["slow", "lost"] });
    expect(v.outcome).toBe("beyond");
    expect(gateOf(v.cases).outcome).toBe("block");
  });

  it("reads each expected case of an empty run as cannot decide", () => {
    const v = tailLimitVerdict([], quietArm(), { ...options, expected: ["lost"] });
    expect(v.outcome).toBe("cannot decide");
    expect(v.reason).toBe('1 of 1 cases have no record. The first is "lost".');
  });

  it("lists a lost case in a loud run too", () => {
    const v = tailLimitVerdict(caseOf("kept", [1, 1, 1, 1, 1, 1, 1]), quietArm(1.5), { ...options, expected: ["lost"] });
    expect(v.outcome).toBe("cannot decide");
    expect(v.cases.map((c) => c.case)).toEqual(["kept", "lost"]);
  });

  it("asks the limit of a lost case, so a limit function sees each expected name", () => {
    const asked: string[] = [];
    const limit = (name: string): typeof LIMIT => {
      asked.push(name);
      return LIMIT;
    };
    tailLimitVerdict([], quietArm(), { limit, aaCap: 1.3, expected: ["lost"] });
    expect(asked).toEqual(["lost"]);
  });
});

describe("the gate of a tail limit verdict", () => {
  it("gateOf reads the cases: pass, block and no read", () => {
    const options = { limit: LIMIT, aaCap: 1.3 };
    const ok = caseOf("kept", [1, 1, 1, 1, 1, 1, 1]);
    expect(gateOf(tailLimitVerdict(ok, quietArm(), options).cases).outcome).toBe("pass");
    expect(gateOf(tailLimitVerdict(caseOf("slow", [2, 2, 2, 2, 2, 2, 2]), quietArm(), options).cases).outcome).toBe("block");
    expect(gateOf(tailLimitVerdict(ok, quietArm(1.5), options).cases).outcome).toBe("no read");
    expect(gateOf(tailLimitVerdict(ok, quietArm(), { ...options, expected: ["lost"] }).cases).noRead).toEqual(["lost"]);
  });
});

describe("tailFalseFails", () => {
  it("gives no case on a quiet A/A arm", () => {
    expect(tailFalseFails(quietArm(), { limit: LIMIT })).toEqual([]);
  });

  it("gives a case with a tail over its limit and over the tail of the other cases", () => {
    const aa = [...quietArm(), ...caseOf("loud", [1, 1, 1, 1, 1, 1.3, 1.3])];
    expect(tailFalseFails(aa, { limit: LIMIT })).toEqual(["loud"]);
  });

  it("reads each case against the other cases, because a case cannot be the noise of itself", () => {
    const aa = [...quietArm(), ...caseOf("loud", [1, 1, 1, 1, 1, 1.3, 1.3]), ...caseOf("louder", [1, 1, 1, 1, 1, 1.4, 1.4])];
    expect(tailFalseFails(aa, { limit: LIMIT })).toEqual(["louder"]);
  });

  it("gives a case that fails by a limit under 1, so the caller can state those cases", () => {
    expect(tailFalseFails(quietArm(), { limit: (name) => (name === "aa0" ? { median: 0.9, tail: 1.2 } : LIMIT) })).toEqual(["aa0"]);
  });

  it("gives no case on an arm with one case, because that case has no others to read", () => {
    expect(tailFalseFails(caseOf("c", [1, 1, 1, 1, 1, 1.3, 1.3]), { limit: LIMIT })).toEqual([]);
  });

  it("uses the rank of the options", () => {
    const aa = [...quietArm(), ...caseOf("spike", [1, 1, 1, 1, 1, 1, 1.5])];
    expect(tailFalseFails(aa, { limit: LIMIT })).toEqual([]);
    expect(tailFalseFails(aa, { limit: LIMIT, rank: 1 })).toEqual(["spike"]);
  });
});
