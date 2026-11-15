import { describe, expect, it } from "vitest";
import type { FreshRecord } from "./fresh.ts";
import { type WarmRecord, caseWarms, warmVerdict } from "./warm.ts";

// The records of freshRun are warm records, so the pairs of a run go to warmVerdict with no change.
export const freshIsWarm = (records: readonly FreshRecord[]): readonly WarmRecord[] => records;

/** A record of the case `name` with the warm check `b` of the arm b, and the warm check `a` of the arm a. */
const record = (name: string, b: number | undefined, a = 1): WarmRecord => ({ case: name, fields: { a: { warm: a }, b: b === undefined ? {} : { warm: b } } });

/** The records of 10 cases, one round each, with the warm values of the arm b. */
const pair = (warms: readonly number[]): WarmRecord[] => warms.map((warm, i) => record(`c${i}`, warm));

const BAND = { low: 0.95, high: 1.05 };

describe("caseWarms", () => {
  it("gives the median warm check of each case over its rounds, in the order of the first record", () => {
    const records = [record("y", 1.2), record("x", 0.9, 1.1), record("y", 1), record("y", 1.1), record("x", undefined), { case: "z" }];
    expect(caseWarms(records)).toEqual([
      { case: "y", warm: 1.1, rounds: 3 },
      { case: "x", warm: 0.9, rounds: 1 },
    ]);
    expect(caseWarms(records, "a").map((c) => [c.case, c.warm])).toEqual([
      ["y", 1],
      ["x", 1.05],
    ]);
  });

  it("refuses a warm check that is not a finite number above 0", () => {
    expect(() => caseWarms([record("x", 0)])).toThrow(RangeError);
    expect(() => caseWarms([record("x", Number.NaN)])).toThrow(/finite number above 0/);
  });
});

describe("warmVerdict", () => {
  // The A/A pair has 1 case of 10 outside the band.
  const aa = pair([1, 1.01, 0.99, 1, 1.02, 0.98, 1, 1, 1.01, 1.2]);
  const pairs = {
    "base~aa": aa,
    // 2 cases outside: 0.2 is at most 0.1 + 0.1.
    warm: pair([1, 1, 1.01, 0.99, 1, 1, 1.1, 1, 1.02, 0.8]),
    // 5 cases outside: the time of its children goes down while they count.
    cold: pair([0.8, 0.85, 0.9, 0.7, 0.88, 1, 1, 1, 1, 1]),
    // Each case is in the band, but the median is 0.96.
    drift: pair([0.96, 0.96, 0.96, 0.96, 0.96, 0.96, 0.96, 0.96, 0.96, 0.96]),
  };

  it("passes a pair near the A/A pair, and fails a pair with more cases outside or a median out of range", () => {
    const verdict = warmVerdict(pairs, { aa: "base~aa", band: BAND });
    expect(verdict.aa).toMatchObject({ cases: 10, outside: 0.1 });
    expect(verdict.arms["warm"]).toMatchObject({ cases: 10, outside: 0.2, ok: true });
    expect(verdict.arms["cold"]).toMatchObject({ outside: 0.5, ok: false });
    expect(verdict.arms["drift"]).toMatchObject({ outside: 0, median: 0.96, ok: false });
    expect(verdict.ok).toBe(false);
    // The steady cases: each pair and the A/A pair in the band.
    expect(verdict.steady).toEqual(["c5", "c7", "c8"]);
  });

  it("examines only the pairs of arms, with the slack and the range of the median", () => {
    expect(warmVerdict(pairs, { aa: "base~aa", band: BAND, arms: ["warm"] })).toMatchObject({ ok: true, steady: ["c0", "c1", "c2", "c3", "c4", "c5", "c7", "c8"] });
    expect(warmVerdict(pairs, { aa: "base~aa", band: BAND, arms: ["warm"], slack: 0 }).ok).toBe(false);
    expect(warmVerdict(pairs, { aa: "base~aa", band: BAND, arms: ["drift"], median: [0.95, 1.05] }).ok).toBe(true);
  });

  it("refuses a pair with no warm check, an unknown pair and bad options", () => {
    const none = { "base~aa": aa, next: [record("c0", undefined)] };
    expect(() => warmVerdict(none, { aa: "base~aa", band: BAND })).toThrow(/no warm check/);
    expect(() => warmVerdict(pairs, { aa: "nope", band: BAND })).toThrow(/no pair "nope"/);
    expect(() => warmVerdict(pairs, { aa: "base~aa", band: BAND, slack: -1 })).toThrow(/slack/);
    expect(() => warmVerdict(pairs, { aa: "base~aa", band: { low: 1.1, high: 1 } })).toThrow(/band/);
    expect(() => warmVerdict(pairs, { aa: "base~aa", band: BAND, median: [1.1, 1] })).toThrow(/median/);
  });
});
