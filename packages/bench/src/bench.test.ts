import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { type PairedTime, aaBand, caseRatios, checkPairedTime, firstArm, timeVerdict } from "./index.ts";

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
    expect(v.reason).toMatch(/in the band/);
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
