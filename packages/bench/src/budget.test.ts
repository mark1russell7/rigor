import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { BUDGET_LOOKS, type BudgetRound, budgetLookSpend, budgetLooksVerdict, budgetVerdict } from "./index.ts";

/** The rounds of one case, one for each value. */
function rounds(name: string, values: readonly number[]): BudgetRound[] {
  return values.map((value, round) => ({ case: name, round, value }));
}

const options = { limit: 450, maxDifference: 200 };

describe("budgetVerdict", () => {
  it("gives within when the interval of each case is at or below the limit", () => {
    const v = budgetVerdict([...rounds("pond", [240, 250, 260, 245, 255, 450]), ...rounds("river", [90, 100, 110, 95, 105, 100])], [...rounds("pond", [230, 240, 250, 235, 245, 240]), ...rounds("river", [80, 90, 100, 85, 95, 90])], options);
    expect(v.outcome).toBe("within");
    expect(v.cases.map((c) => [c.case, c.outcome])).toEqual([
      ["pond", "within"],
      ["river", "within"],
    ]);
  });

  it("gives beyond when the interval of a case is above the limit", () => {
    const v = budgetVerdict([...rounds("board", [0, 0, 0, 0, 0, 0]), ...rounds("pond", [460, 500, 510, 520, 530, 540])], [...rounds("board", [0, 0, 0, 0, 0, 0]), ...rounds("pond", [470, 500, 510, 520, 530, 540])], options);
    expect(v.outcome).toBe("beyond");
    expect(v.cases.find((c) => c.case === "pond")?.outcome).toBe("beyond");
    expect(v.reason).toContain("1 of 2 cases");
    expect(v.reason).toContain('"pond"');
  });

  it("cannot decide when the interval of a case holds the limit", () => {
    const v = budgetVerdict(rounds("pond", [300, 320, 340, 360, 380, 500]), rounds("pond", [300, 320, 340, 360, 380, 500]), options);
    expect(v.outcome).toBe("cannot decide");
    expect(v.cases[0]?.reason).toContain("the interval holds the limit");
  });

  it("accepts medians of 0", () => {
    const v = budgetVerdict(rounds("board", [0, 0, 0, 0, 0, 0]), rounds("board", [0, 0, 0, 0, 0, 0]), options);
    expect(v.outcome).toBe("within");
    expect(v.cases[0]).toMatchObject({ median: 0, aaMedian: 0, difference: 0, low: 0, high: 0 });
  });

  it("cannot decide with too few rounds in either arm, and it says so", () => {
    const six = [100, 110, 120, 130, 140, 150];
    for (const v of [budgetVerdict(rounds("pond", six.slice(1)), rounds("pond", six), options), budgetVerdict(rounds("pond", six), rounds("pond", six.slice(1)), options)]) {
      expect(v.outcome).toBe("cannot decide");
      expect(v.cases[0]?.reason).toContain("too few rounds for the level 0.95");
    }
  });

  it("uses the level for the number of rounds", () => {
    const five = [100, 110, 120, 130, 140];
    expect(budgetVerdict(rounds("pond", five), rounds("pond", five), { ...options, caseLevel: 0.9 }).outcome).toBe("within");
  });

  it("cannot decide when the two arms of a build differ by more than the difference, at any ratio", () => {
    const wide = budgetVerdict(rounds("pond", [240, 245, 250, 250, 255, 260]), rounds("pond", [30, 35, 40, 40, 45, 50]), options);
    expect(wide.outcome).toBe("cannot decide");
    expect(wide.cases[0]?.reason).toContain("the A/A difference is above 200");
    // A ratio of 2.4 is a valid run when the difference is small.
    const near = budgetVerdict(rounds("pond", [240, 245, 250, 250, 255, 260]), rounds("pond", [95, 100, 104, 104, 108, 110]), options);
    expect(near.cases[0]).toMatchObject({ outcome: "within", difference: 146 });
  });

  it("cannot decide when the A/A arm does not have a case", () => {
    const v = budgetVerdict(rounds("pond", [1, 2, 3, 4, 5, 6]), rounds("river", [1, 2, 3, 4, 5, 6]), options);
    expect(v.outcome).toBe("cannot decide");
    expect(v.cases[0]).toMatchObject({ aaMedian: undefined, difference: undefined, aaRounds: 0 });
    expect(v.cases[0]?.reason).toContain("the A/A arm does not have the case");
  });

  it("cannot decide with no cases", () => {
    expect(budgetVerdict([], [], options)).toMatchObject({ outcome: "cannot decide", reason: "The verdict has no cases.", cases: [] });
  });

  it("names the limit, the medians, the difference and the rounds in each reason", () => {
    const v = budgetVerdict(rounds("pond", [240, 245, 250, 250, 255, 260]), rounds("pond", [230, 235, 240, 240, 245, 250]), options);
    const reason = v.cases[0]?.reason ?? "";
    for (const fact of ["median 250 of 6 rounds", "limit 450", "A/A median 240 of 6 rounds", "difference 10"]) expect(reason).toContain(fact);
    expect(v).toMatchObject({ limit: 450, maxDifference: 200, level: 0.95 });
  });

  it("does not depend on the order of the rounds", () => {
    const pond = [...rounds("pond", [240, 245, 250, 250, 255, 260]), ...rounds("board", [0, 0, 0, 0, 0, 0])];
    expect(budgetVerdict([...pond].reverse(), pond, options)).toEqual(budgetVerdict(pond, pond, options));
  });

  it("refuses a value or an option out of range, and a round that comes twice", () => {
    const six = rounds("pond", [1, 2, 3, 4, 5, 6]);
    expect(() => budgetVerdict(rounds("pond", [Number.NaN]), six, options)).toThrow(RangeError);
    expect(() => budgetVerdict(rounds("pond", [-1]), six, options)).toThrow(RangeError);
    expect(() => budgetVerdict(six, rounds("pond", [Number.POSITIVE_INFINITY]), options)).toThrow(RangeError);
    expect(() => budgetVerdict([...six, { case: "pond", round: 0, value: 1 }], six, options)).toThrow(/comes twice/);
    expect(() => budgetVerdict(six, six, { limit: -1, maxDifference: 200 })).toThrow(RangeError);
    expect(() => budgetVerdict(six, six, { limit: 450, maxDifference: Number.NaN })).toThrow(RangeError);
  });
});

describe("budgetLooksVerdict", () => {
  /** Six values with one above the limit: the interval of 6 rounds holds the limit. */
  const noisy = [300, 320, 340, 360, 380, 533];
  const quiet = [300, 320, 340, 360, 380, 400];
  /** The same run with 12 rounds: one value above the limit stays out of the interval of 12 rounds. */
  const twelve = [...noisy, ...quiet];

  it("spends less than 0.05 with the default looks", () => {
    expect(budgetLookSpend(BUDGET_LOOKS)).toBeCloseTo(0.0442, 4);
  });

  it("gives the verdict of budgetVerdict at the first look", () => {
    const v = budgetLooksVerdict(rounds("pond", quiet), rounds("pond", quiet), options);
    expect(v).toMatchObject({ outcome: "within", more: [], fails: false });
    expect(v.cases[0]).toEqual(budgetVerdict(rounds("pond", quiet), rounds("pond", quiet), options).cases[0]);
  });

  it("asks for the next look of an undecided case only", () => {
    const v = budgetLooksVerdict([...rounds("pond", noisy), ...rounds("river", quiet)], [...rounds("pond", quiet), ...rounds("river", quiet)], options);
    expect(v.outcome).toBe("cannot decide");
    expect(v.more).toEqual([{ case: "pond", rounds: 12 }]);
    expect(v.fails).toBe(false);
  });

  it("decides at the second look when the outlier leaves the interval", () => {
    const v = budgetLooksVerdict(rounds("pond", twelve), rounds("pond", twelve), options);
    expect(v.cases[0]).toMatchObject({ outcome: "within", rounds: 12, high: 400 });
    expect(v.more).toEqual([]);
  });

  it("keeps the first outcome of a case when later rounds come", () => {
    const later = [...quiet, 900, 900, 900, 900, 900, 900];
    const v = budgetLooksVerdict(rounds("pond", later), rounds("pond", later), options);
    expect(v.cases[0]).toMatchObject({ outcome: "within", rounds: 6 });
  });

  it("fails only when the interval is above the limit", () => {
    const high = [460, 500, 510, 520, 530, 540];
    const v = budgetLooksVerdict(rounds("pond", high), rounds("pond", high), options);
    expect(v).toMatchObject({ outcome: "beyond", more: [], fails: true });
  });

  it("gives a final cannot decide at the last look, and that does not fail", () => {
    const spread = Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? 300 : 600));
    const v = budgetLooksVerdict(rounds("pond", spread), rounds("pond", spread), options);
    expect(v).toMatchObject({ outcome: "cannot decide", more: [], fails: false });
    expect(v.cases[0]?.rounds).toBe(24);
  });

  it("does not depend on the order of the rounds", () => {
    const pond = rounds("pond", twelve);
    expect(budgetLooksVerdict([...pond].reverse(), pond, options)).toEqual(budgetLooksVerdict(pond, pond, options));
  });

  it("asks for the first look of a case with too few rounds", () => {
    const v = budgetLooksVerdict(rounds("pond", [1, 2, 3]), rounds("pond", [1, 2, 3]), options);
    expect(v.more).toEqual([{ case: "pond", rounds: 6 }]);
  });

  it.each([
    ["a tight shape", 0.2, 1],
    ["a wide shape", 1, 2],
  ])("keeps the false-fail rate at or under 0.05 at the limit, for %s", (_name, sigma, seed) => {
    const r = random(seed);
    const arm = (): BudgetRound[] => rounds("pond", Array.from({ length: 24 }, () => 450 * Math.exp(r.normal(0, sigma))));
    const runs = 2000;
    let fails = 0;
    for (let run = 0; run < runs; run++) if (budgetLooksVerdict(arm(), arm(), { limit: 450, maxDifference: 1e9 }).fails) fails += 1;
    expect(fails / runs).toBeLessThanOrEqual(0.05);
  });

  it("refuses looks that spend too much, are out of order, or are too small", () => {
    const six = rounds("pond", quiet);
    const many = [6, 12, 24, 48].map((n) => ({ rounds: n, level: 0.95 }));
    expect(() => budgetLooksVerdict(six, six, { ...options, looks: many })).toThrow(/spend/);
    expect(() => budgetLookSpend([])).toThrow(RangeError);
    expect(() =>
      budgetLookSpend([
        { rounds: 12, level: 0.95 },
        { rounds: 6, level: 0.95 },
      ]),
    ).toThrow(/rising order/);
    expect(() => budgetLookSpend([{ rounds: 5, level: 0.95 }])).toThrow(/too few/);
  });
});
