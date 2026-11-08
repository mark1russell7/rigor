import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  brier,
  eloExpected,
  eloUpdate,
  glicko2Idle,
  glicko2Update,
  logLoss,
  pairProbabilities,
  ratingToStrength,
  strengthToRating,
} from "./index.ts";

const strength = fc.double({ min: -20, max: 20, noNaN: true });

/* ---------- Elo ---------- */

describe("eloExpected", () => {
  it("gives 0.5 for equal ratings and 10 / 11 for a lead of 400", () => {
    expect(eloExpected(1500, 1500)).toBe(0.5);
    expect(eloExpected(1900, 1500)).toBeCloseTo(10 / 11, 15);
    expect(eloExpected(1500, 1900)).toBeCloseTo(1 / 11, 15);
  });

  it("uses the scale and the base", () => {
    expect(eloExpected(1600, 1500, { scale: 100, base: 2 })).toBeCloseTo(2 / 3, 15);
  });

  it("gives a sum of 1 for the two sides, and depends only on the difference", () => {
    fc.assert(
      fc.property(fc.double({ min: -3000, max: 3000, noNaN: true }), fc.double({ min: -3000, max: 3000, noNaN: true }), fc.double({ min: -1000, max: 1000, noNaN: true }), (ra, rb, c) => {
        expect(eloExpected(ra, rb) + eloExpected(rb, ra)).toBeCloseTo(1, 12);
        expect(eloExpected(ra + c, rb + c)).toBeCloseTo(eloExpected(ra, rb), 9);
      }),
    );
  });

  it("refuses a rating that is not finite and a bad scale", () => {
    expect(() => eloExpected(Number.NaN, 1500)).toThrow(RangeError);
    expect(() => eloExpected(1500, Infinity)).toThrow(RangeError);
    expect(() => eloExpected(1500, 1500, { scale: 0 })).toThrow(RangeError);
    expect(() => eloExpected(1500, 1500, { base: 1 })).toThrow(RangeError);
  });
});

describe("eloUpdate", () => {
  it("moves equal ratings by k / 2 after a win", () => {
    expect(eloUpdate(1500, 1500, 1)).toEqual({ a: 1516, b: 1484, expected: 0.5 });
  });

  it("moves a favourite down after a tie", () => {
    const u = eloUpdate(1900, 1500, 0.5, { k: 20 });
    expect(u.a).toBeCloseTo(1900 - 90 / 11, 10);
    expect(u.b).toBeCloseTo(1500 + 90 / 11, 10);
    expect(u.expected).toBeCloseTo(10 / 11, 15);
  });

  it("keeps the sum of the ratings, and a score at the expected score changes nothing", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 3000, noNaN: true }), fc.double({ min: 0, max: 3000, noNaN: true }), fc.constantFrom(0, 0.5, 1), (ra, rb, s) => {
        const u = eloUpdate(ra, rb, s, { k: 24 });
        expect(u.a + u.b).toBeCloseTo(ra + rb, 8);
        expect(Math.sign(u.a - ra)).toBe(Math.sign(s - u.expected));
      }),
    );
    const e = eloExpected(1700, 1500);
    const u = eloUpdate(1700, 1500, e);
    expect(u.a).toBeCloseTo(1700, 12);
  });

  it("refuses a score out of 0 to 1 and a bad k", () => {
    expect(() => eloUpdate(1500, 1500, 1.5)).toThrow(RangeError);
    expect(() => eloUpdate(1500, 1500, Number.NaN)).toThrow(RangeError);
    expect(() => eloUpdate(1500, 1500, 1, { k: -1 })).toThrow(RangeError);
  });
});

/* ---------- Glicko-2 ---------- */

describe("glicko2Update", () => {
  // The worked example of Glickman, "Example of the Glicko-2 system" (2012), with tau 0.5.
  const player = { rating: 1500, rd: 200, volatility: 0.06 };
  const games = [
    { rating: 1400, rd: 30, score: 1 },
    { rating: 1550, rd: 100, score: 0 },
    { rating: 1700, rd: 300, score: 0 },
  ];

  it("gives the result of the worked example of the paper", () => {
    const after = glicko2Update(player, games, { tau: 0.5 });
    // The paper rounds mu' to -0.2069 and phi' to 0.8722 before it converts them, so it shows 1464.06 and 151.52.
    expect((after.rating - 1500) / 173.7178).toBeCloseTo(-0.2069, 4);
    expect(after.rd / 173.7178).toBeCloseTo(0.8722, 4);
    expect(Math.abs(after.rating - 1464.06)).toBeLessThan(0.01);
    expect(Math.abs(after.rd - 151.52)).toBeLessThan(0.01);
    expect(Math.abs(after.volatility - 0.05999)).toBeLessThan(1e-5);
    expect(after.volatility).toBeCloseTo(0.059996, 6);
  });

  it("does not change its inputs, and gives the same result two times", () => {
    const frozen = Object.freeze(games.map((g) => Object.freeze({ ...g })));
    const a = glicko2Update(Object.freeze({ ...player }), frozen);
    const b = glicko2Update(player, games);
    expect(a).toEqual(b);
    expect(games[0]).toEqual({ rating: 1400, rd: 30, score: 1 });
  });

  it("gives the idle growth of the RD for a period with no games", () => {
    expect(glicko2Update(player, [])).toEqual(glicko2Idle(player));
  });

  it("raises the rating after a win and lowers it after a loss against an equal opponent", () => {
    fc.assert(
      fc.property(fc.double({ min: 1000, max: 2000, noNaN: true }), fc.double({ min: 30, max: 350, noNaN: true }), fc.double({ min: 0.01, max: 0.2, noNaN: true }), (rating, rd, volatility) => {
        const p = { rating, rd, volatility };
        const win = glicko2Update(p, [{ rating, rd: 50, score: 1 }]);
        const loss = glicko2Update(p, [{ rating, rd: 50, score: 0 }]);
        expect(win.rating).toBeGreaterThan(rating);
        expect(loss.rating).toBeLessThan(rating);
        expect(win.rating - rating).toBeCloseTo(rating - loss.rating, 6);
        expect(win.rd).toBeLessThan(glicko2Idle({ ...p, volatility: win.volatility }).rd);
      }),
    );
  });

  it("refuses a bad player, a bad game and a bad tau", () => {
    expect(() => glicko2Update({ ...player, rd: 0 }, games)).toThrow(RangeError);
    expect(() => glicko2Update({ ...player, volatility: -1 }, games)).toThrow(RangeError);
    expect(() => glicko2Update(player, [{ rating: 1500, rd: 50, score: 2 }])).toThrow(RangeError);
    expect(() => glicko2Update(player, games, { tau: 0 })).toThrow(RangeError);
  });
});

describe("glicko2Idle", () => {
  it("grows the RD by the volatility and keeps the rating and the volatility", () => {
    const after = glicko2Idle({ rating: 1500, rd: 200, volatility: 0.06 });
    expect(after.rating).toBe(1500);
    expect(after.volatility).toBe(0.06);
    expect(after.rd).toBeCloseTo(Math.sqrt(200 ** 2 + (173.7178 * 0.06) ** 2), 10);
  });
});

/* ---------- Probabilities and scales ---------- */

describe("pairProbabilities", () => {
  it("gives the Bradley-Terry and the Davidson values by hand", () => {
    expect(pairProbabilities(0, 0)).toEqual({ a: 0.5, b: 0.5, tie: 0 });
    const plain = pairProbabilities(Math.log(3), 0);
    expect(plain.a).toBeCloseTo(3 / 4, 15);
    expect(plain.b).toBeCloseTo(1 / 4, 15);
    // Strengths 4 and 1 with nu 1: the denominator is 4 + 1 + 1 * sqrt(4) = 7.
    const davidson = pairProbabilities(Math.log(4), 0, 1);
    expect(davidson.a).toBeCloseTo(4 / 7, 15);
    expect(davidson.b).toBeCloseTo(1 / 7, 15);
    expect(davidson.tie).toBeCloseTo(2 / 7, 15);
  });

  it("gives a sum of 1, swaps with the items, and does not change when a constant goes to the two strengths", () => {
    fc.assert(
      fc.property(strength, strength, fc.double({ min: 0, max: 50, noNaN: true }), fc.double({ min: -100, max: 100, noNaN: true }), (sa, sb, tie, c) => {
        const p = pairProbabilities(sa, sb, tie);
        expect(p.a + p.b + p.tie).toBeCloseTo(1, 12);
        const swapped = pairProbabilities(sb, sa, tie);
        expect(swapped.a).toBeCloseTo(p.b, 12);
        expect(swapped.tie).toBeCloseTo(p.tie, 12);
        const shifted = pairProbabilities(sa + c, sb + c, tie);
        expect(shifted.a).toBeCloseTo(p.a, 9);
        expect(shifted.b).toBeCloseTo(p.b, 9);
        expect(shifted.tie).toBeCloseTo(p.tie, 9);
      }),
    );
  });

  it("stays finite at a very large difference", () => {
    const p = pairProbabilities(2000, -2000, 3);
    expect(p.a).toBe(1);
    expect(p.b).toBe(0);
    expect(p.tie).toBe(0);
  });

  it("refuses a strength that is not finite and a negative tie parameter", () => {
    expect(() => pairProbabilities(Number.NaN, 0)).toThrow(RangeError);
    expect(() => pairProbabilities(0, 0, -1)).toThrow(RangeError);
  });
});

describe("strengthToRating and ratingToStrength", () => {
  it("give 1500 + 400 * log10(e) * strength by default", () => {
    expect(strengthToRating(0)).toBe(1500);
    expect(strengthToRating(1)).toBeCloseTo(1500 + 400 * Math.LOG10E, 10);
    expect(strengthToRating(Math.log(10))).toBeCloseTo(1900, 10);
    expect(strengthToRating(1, { center: 0, scale: 1, base: Math.E })).toBeCloseTo(1, 15);
  });

  it("are inverses, and eloExpected of two ratings is the Bradley-Terry win probability", () => {
    fc.assert(
      fc.property(strength, strength, (sa, sb) => {
        expect(ratingToStrength(strengthToRating(sa))).toBeCloseTo(sa, 9);
        expect(ratingToStrength(strengthToRating(sa, { center: 1000, scale: 173, base: 2 }), { center: 1000, scale: 173, base: 2 })).toBeCloseTo(sa, 9);
        expect(eloExpected(strengthToRating(sa), strengthToRating(sb))).toBeCloseTo(pairProbabilities(sa, sb).a, 9);
      }),
    );
  });

  it("refuses a value that is not finite", () => {
    expect(() => strengthToRating(Infinity)).toThrow(RangeError);
    expect(() => ratingToStrength(Number.NaN)).toThrow(RangeError);
  });
});

/* ---------- Log-loss ---------- */

describe("logLoss", () => {
  it("gives the values by hand", () => {
    expect(logLoss([{ p: 0.5, hit: true }])).toBeCloseTo(Math.LN2, 15);
    expect(logLoss([{ p: 1, hit: true }])).toBe(0);
    expect(logLoss([{ p: 0.8, hit: true }, { p: 0.8, hit: false }])).toBeCloseTo((-Math.log(0.8) - Math.log(0.2)) / 2, 15);
    expect(logLoss([{ p: 0, hit: true }])).toBe(Infinity);
  });

  it("is lowest for the true probability, as the Brier score", () => {
    const outcomes = [true, true, true, false];
    const at = (p: number) => outcomes.map((hit) => ({ p, hit }));
    expect(logLoss(at(0.75))).toBeLessThan(logLoss(at(0.7)));
    expect(logLoss(at(0.75))).toBeLessThan(logLoss(at(0.8)));
    expect(brier(at(0.75))).toBeLessThan(brier(at(0.7)));
  });

  it("refuses an empty list and a p out of 0 to 1", () => {
    expect(() => logLoss([])).toThrow(RangeError);
    expect(() => logLoss([{ p: 1.1, hit: true }])).toThrow(RangeError);
    expect(() => logLoss([{ p: Number.NaN, hit: false }])).toThrow(RangeError);
  });
});
