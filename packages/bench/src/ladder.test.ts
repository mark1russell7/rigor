import { random } from "@mark1russell7/rigor-generators";
import { quantileInterval } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { type BudgetRound, type Ladder, type Rung, type RungRecord, LADDER_FORMAT, checkLadder, ladderVerdict, rungVerdict } from "./index.ts";

/** The rounds of one case, one for each value. */
function rounds(name: string, values: readonly number[]): BudgetRound[] {
  return values.map((value, round) => ({ case: name, round, value }));
}

const quick = [90, 100, 110, 95, 105, 100];
const slow = [460, 500, 510, 520, 530, 540];
const now = "2026-11-04T12:00:00Z";

/** A rung at `tenants` with one budget of each kind. */
function rung(tenants: number, extra: Partial<Rung> = {}): Rung {
  return {
    name: String(tenants),
    at: { tenants },
    test: "load and drill",
    budgets: [
      { kind: "median", measure: "read", unit: "ms", limit: 450, maxDifference: 200 },
      { kind: "rate", measure: "failed requests", limit: 0.001 },
      { kind: "worst", measure: "lost writes", unit: "writes", limit: 0, minDrills: 3 },
    ],
    ...extra,
  };
}

const ladder = (rungs: readonly Rung[]): Ladder => ({
  format: LADDER_FORMAT,
  subject: "reference service",
  dimensions: [{ name: "tenants", describe: "one customer" }],
  rungs,
});

/** A record of `tenants` that passes each budget, unless `extra` changes it. */
function record(tenants: number, extra: Partial<RungRecord> = {}): RungRecord {
  return {
    rung: String(tenants),
    commit: "abc1234",
    at: "2026-11-04T10:00:00Z",
    real: ["2 processes"],
    synthetic: ["90 % of the tenants as data at rest"],
    evidence: [
      { kind: "median", measure: "read", rounds: rounds("read", quick), aa: rounds("read", quick) },
      { kind: "rate", measure: "failed requests", failures: 0, trials: 10_000 },
      { kind: "worst", measure: "lost writes", values: [0, 0, 0] },
    ],
    ...extra,
  };
}

describe("checkLadder", () => {
  it("gives no problems for a good ladder", () => {
    expect(checkLadder(ladder([rung(1), rung(10)]))).toEqual([]);
  });

  it("names each kind of problem", () => {
    const bad: Ladder = {
      format: LADDER_FORMAT,
      subject: " ",
      dimensions: [],
      rungs: [
        { name: "a", at: {}, test: "", budgets: [] },
        { name: "a", at: { nodes: -1 }, test: "t", budgets: [
          { kind: "rate", measure: "x", limit: 2 },
          { kind: "rate", measure: "x", limit: 0.5 },
          { kind: "worst", measure: "", unit: "s", limit: Number.NaN, minDrills: 0 },
          { kind: "median", measure: "m", unit: "s", limit: 1, maxDifference: -1 },
        ] },
      ],
    };
    const text = checkLadder(bad).join("\n");
    for (const part of ["no subject", "no dimensions", "same name", "names no dimension", "names no test", "no budgets", "unknown dimension", "above 0", "at most 1", "two budgets", "no measure", "finite and 0 or more", "whole number", "largest difference"]) {
      expect(text).toContain(part);
    }
  });

  it("refuses a dimension that does not grow, and accepts a rung that adds a dimension", () => {
    expect(checkLadder(ladder([rung(10), rung(10, { name: "ten again" })])).join()).toContain("does not grow");
    const two: Ladder = { ...ladder([rung(1), rung(10, { at: { tenants: 10, users: 5 } })]), dimensions: [{ name: "tenants", describe: "a" }, { name: "users", describe: "b" }] };
    expect(checkLadder(two)).toEqual([]);
  });

  it("refuses an empty ladder and a format of another version", () => {
    expect(checkLadder({ ...ladder([]), format: "rigor-ladder/0" as typeof LADDER_FORMAT }).join()).toContain("no rungs");
    expect(checkLadder({ ...ladder([rung(1)]), format: "rigor-ladder/0" as typeof LADDER_FORMAT }).join()).toContain("The format is");
  });
});

describe("rungVerdict", () => {
  it("is within when each budget of each kind is within, and it keeps what was real and synthetic", () => {
    const v = rungVerdict(rung(1), record(1), { now });
    expect(v.outcome).toBe("within");
    expect(v.budgets.map((b) => b.outcome)).toEqual(["within", "within", "within"]);
    expect(v).toMatchObject({ commit: "abc1234", real: ["2 processes"], synthetic: ["90 % of the tenants as data at rest"] });
  });

  it("cannot decide with no record, and it names the test", () => {
    const v = rungVerdict(rung(1), undefined, { now });
    expect(v.outcome).toBe("cannot decide");
    expect(v.reason).toContain("load and drill");
  });

  it("cannot decide when a record does not state what was real", () => {
    expect(rungVerdict(rung(1), record(1, { real: [] }), { now }).reason).toContain("what was real");
  });

  it("cannot decide on evidence that is missing or of another kind", () => {
    const missing = rungVerdict(rung(1), record(1, { evidence: [] }), { now });
    expect(missing.outcome).toBe("cannot decide");
    expect(missing.budgets[0]?.reason).toContain("no evidence");
    const other = rungVerdict(rung(1), record(1, { evidence: [{ kind: "worst", measure: "read", values: [1] }] }), { now });
    expect(other.budgets[0]?.reason).toContain("the budget is median, and the evidence is worst");
  });

  it("is beyond when one median is beyond, even when another budget cannot decide", () => {
    const v = rungVerdict(rung(1), record(1, { evidence: [{ kind: "median", measure: "read", rounds: rounds("read", slow), aa: rounds("read", slow) }] }), { now });
    expect(v.outcome).toBe("beyond");
    expect(v.reason).toContain('"read"');
  });

  it("reads a rate with the Wilson bound: 0 of 38,500 holds 0.01 %, and 0 of 30,000 cannot decide", () => {
    const budget: Rung = rung(1, { budgets: [{ kind: "rate", measure: "failed requests", limit: 0.0001 }] });
    const of = (trials: number) => record(1, { evidence: [{ kind: "rate", measure: "failed requests", failures: 0, trials }] });
    expect(rungVerdict(budget, of(38_500), { now }).outcome).toBe("within");
    expect(rungVerdict(budget, of(30_000), { now }).outcome).toBe("cannot decide");
    expect(rungVerdict(budget, of(0), { now }).outcome).toBe("cannot decide");
  });

  it("is beyond when the low end of the rate is above the limit", () => {
    const v = rungVerdict(rung(1), record(1, { evidence: [{ kind: "rate", measure: "failed requests", failures: 100, trials: 1000 }] }), { now });
    expect(v.budgets[1]?.outcome).toBe("beyond");
  });

  it("reads a drill budget by its worst value: one bad drill is beyond, and too few good drills cannot decide", () => {
    const of = (values: readonly number[]) => record(1, { evidence: [{ kind: "worst", measure: "lost writes", values }] });
    expect(rungVerdict(rung(1), of([0, 1]), { now }).budgets[2]?.outcome).toBe("beyond");
    expect(rungVerdict(rung(1), of([0, 0]), { now }).budgets[2]?.outcome).toBe("cannot decide");
    expect(rungVerdict(rung(1), of([]), { now }).budgets[2]?.outcome).toBe("cannot decide");
  });

  it("cannot decide on an old record when a largest age is set, and on a time that does not parse", () => {
    expect(rungVerdict(rung(1), record(1, { at: "2026-10-01T00:00:00Z" }), { now, maxAgeDays: 7 }).reason).toContain("older than 7 days");
    expect(rungVerdict(rung(1), record(1), { now, maxAgeDays: 7 }).outcome).toBe("within");
    expect(rungVerdict(rung(1), record(1, { at: "soon" }), { now, maxAgeDays: 7 }).reason).toContain("does not parse");
  });
});

describe("ladderVerdict", () => {
  const rungs = [rung(1, { locked: true }), rung(10, { locked: true }), rung(100)];

  it("gives the held rung and the next rung", () => {
    const v = ladderVerdict(ladder(rungs), [record(1), record(10)], { now });
    expect(v).toMatchObject({ held: "10", next: "100", failed: false });
  });

  it("does not count a high rung over a gap", () => {
    const v = ladderVerdict(ladder(rungs), [record(1, { evidence: [] }), record(10), record(100)], { now });
    expect(v).toMatchObject({ held: undefined, next: "1", failed: true });
  });

  it("gives no next rung when each rung is within", () => {
    expect(ladderVerdict(ladder(rungs), [record(1), record(10), record(100)], { now })).toMatchObject({ held: "100", next: undefined, failed: false });
  });

  it("fails when a locked rung has no record, so a skipped test is not a pass", () => {
    const v = ladderVerdict(ladder(rungs), [record(1)], { now });
    expect(v.failed).toBe(true);
    expect(v.reason).toContain('"10"');
  });

  it("does not fail for a rung that is not locked", () => {
    expect(ladderVerdict(ladder(rungs), [record(1), record(10), record(100, { evidence: [] })], { now }).failed).toBe(false);
  });

  it("reads the newest record, so an old pass does not hide a new failure", () => {
    const failed = record(1, { at: "2026-11-04T11:00:00Z", evidence: [{ kind: "worst", measure: "lost writes", values: [5, 0, 0] }] });
    expect(ladderVerdict(ladder(rungs), [failed, record(1), record(10)], { now }).failed).toBe(true);
    expect(ladderVerdict(ladder(rungs), [record(1), failed, record(10)], { now }).failed).toBe(true);
  });

  it("fails a locked rung when its record is older than the largest age", () => {
    const old = { at: "2026-10-01T00:00:00Z" };
    expect(ladderVerdict(ladder(rungs), [record(1, old), record(10)], { now, maxAgeDays: 7 }).failed).toBe(true);
  });

  it("gives the same result with the records in any order", () => {
    const list = [record(1), record(10)];
    expect(ladderVerdict(ladder(rungs), [...list].reverse(), { now })).toEqual(ladderVerdict(ladder(rungs), list, { now }));
  });

  it("throws for a ladder with problems", () => {
    expect(() => ladderVerdict(ladder([]), [], { now })).toThrow(RangeError);
  });
});

describe("a quantile budget", () => {
  const budget = { kind: "quantile", measure: "read p99", unit: "ms", quantile: 0.99, limit: 500 } as const;
  const on = rung(1, { budgets: [budget] });
  const verdictOf = (values: readonly number[]) => rungVerdict(on, record(1, { evidence: [{ kind: "quantile", measure: "read p99", values }] }), { now }).budgets[0];
  const flat = (n: number, value: number): number[] => Array.from({ length: n }, () => value);

  it("is within when the upper bound of the quantile is at the limit or under it", () => {
    expect(verdictOf(flat(400, 100))?.outcome).toBe("within");
  });

  it("cannot decide with too few values, and says how many it needs", () => {
    const v = verdictOf(flat(367, 100));
    expect(v?.outcome).toBe("cannot decide");
    expect(v?.reason).toContain("368 values needed");
  });

  it("is beyond when the lower bound is over the limit, and one value can show that", () => {
    expect(verdictOf(flat(400, 900))?.outcome).toBe("beyond");
    expect(verdictOf([900])?.outcome).toBe("beyond");
  });

  it("cannot decide when the limit is in the interval", () => {
    const values = [...flat(990, 100), ...flat(10, 900)];
    expect(verdictOf(values)?.outcome).toBe("cannot decide");
  });

  it("cannot decide with no values or with a NaN", () => {
    expect(verdictOf([])?.outcome).toBe("cannot decide");
    expect(verdictOf([1, Number.NaN])?.outcome).toBe("cannot decide");
  });

  it("gives a problem for a quantile or a level out of range", () => {
    expect(checkLadder(ladder([rung(1, { budgets: [{ ...budget, quantile: 1 }] })])).join()).toContain("a quantile is");
    expect(checkLadder(ladder([rung(1, { budgets: [{ ...budget, level: 0 }] })])).join()).toContain("a level is");
    expect(checkLadder(ladder([on]))).toEqual([]);
  });

  describe("with censored values", () => {
    const censoredOf = (values: readonly number[], censored: readonly number[]) => rungVerdict(on, record(1, { evidence: [{ kind: "quantile", measure: "read p99", values, censored }] }), { now }).budgets[0];
    /** The number of the largest values of 1,000 that lie above the upper rank. */
    const margin = 1000 - quantileInterval(flat(1000, 100), 0.99).highRank;

    it("is not within when a censored value is at the upper rank: its bound is low, and its true value has no bound", () => {
      expect(verdictOf(flat(400, 100))?.outcome).toBe("within");
      expect(censoredOf(flat(399, 100), [100])?.outcome).toBe("cannot decide");
    });

    it("is within when each censored value lies above the upper rank", () => {
      expect(margin).toBeGreaterThan(0);
      expect(censoredOf(flat(1000 - margin, 100), flat(margin, 100))?.outcome).toBe("within");
      expect(censoredOf(flat(1000 - margin - 1, 100), flat(margin + 1, 100))?.outcome).toBe("cannot decide");
    });

    it("is beyond when the censored bounds alone pass the limit", () => {
      expect(censoredOf(flat(395, 100), flat(5, 900))?.outcome).toBe("cannot decide");
      expect(censoredOf(flat(380, 100), flat(20, 900))?.outcome).toBe("beyond");
    });

    it("decides with no reply at all only for beyond", () => {
      expect(censoredOf([], flat(400, 900))?.outcome).toBe("beyond");
      expect(censoredOf([], flat(400, 100))?.outcome).toBe("cannot decide");
    });

    it("cannot decide with a censored value that is not a finite number", () => {
      expect(censoredOf(flat(400, 100), [Number.NaN])?.outcome).toBe("cannot decide");
      expect(censoredOf(flat(400, 100), [Number.POSITIVE_INFINITY])?.outcome).toBe("cannot decide");
    });

    it("gives the same verdict for an empty list and for no list", () => {
      expect(censoredOf(flat(400, 100), [])).toEqual(verdictOf(flat(400, 100)));
    });

    it("counts each censored value, and says that the point is a lower bound", () => {
      const reason = censoredOf(flat(399, 100), [700])?.reason;
      expect(reason).toContain("399 values and 1 censored");
      expect(reason).toContain("at least");
    });

    it("gives a rung no pass from values that a censored arrival would change", () => {
      const evidence = [{ kind: "quantile", measure: "read p99", values: flat(399, 100), censored: [100] }] as const;
      expect(rungVerdict(on, record(1, { evidence }), { now }).outcome).toBe("cannot decide");
    });

    it("keeps each decision true: a decided verdict on bounds is the verdict on the true values", () => {
      const rng = random("censored-quantile");
      const decided = { within: 0, beyond: 0 };
      for (let draw = 0; draw < 200; draw += 1) {
        const size = 1000 + Math.floor(rng.next() * 1000);
        const share = rng.next() * 0.02;
        const scale = 40 + rng.next() * 300;
        const truth = Array.from({ length: size }, () => -Math.log(1 - rng.next()) * scale);
        const values: number[] = [];
        const censored: number[] = [];
        for (const value of truth) {
          if (rng.next() < share) censored.push(value * rng.next());
          else values.push(value);
        }
        const bounds = censoredOf(values, censored)?.outcome;
        if (bounds === "within" || bounds === "beyond") {
          decided[bounds] += 1;
          expect(verdictOf(truth)?.outcome).toBe(bounds);
        }
      }
      expect(decided.within).toBeGreaterThan(0);
      expect(decided.beyond).toBeGreaterThan(0);
    });
  });
});
