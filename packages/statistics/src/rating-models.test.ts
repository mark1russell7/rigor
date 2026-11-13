import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type PairComparison,
  type PairOutcome,
  bradleyTerry,
  bradleyTerrySparse,
  eloReplay,
  eloUpdate,
  fitRatings,
  glicko2Replay,
  glicko2Update,
  ratingToStrength,
  selectRatingModel,
} from "./index.ts";

/** Three items with a clear order: 0 beats 1 and 2, and 1 beats 2, with some upsets and ties. */
function ordered(rounds: number): PairComparison[] {
  const picks: PairComparison[] = [];
  for (let round = 0; round < rounds; round++) {
    picks.push({ a: 0, b: 1, outcome: round % 4 === 3 ? "b" : "a" });
    picks.push({ a: 1, b: 2, outcome: round % 5 === 4 ? "tie" : "a" });
    picks.push({ a: 2, b: 0, outcome: round % 6 === 5 ? "a" : "b" });
  }
  return picks;
}

const pickList = (items: number) =>
  fc.array(
    fc
      .record({ a: fc.integer({ min: 0, max: items - 1 }), b: fc.integer({ min: 0, max: items - 1 }), outcome: fc.constantFrom<PairOutcome>("a", "b", "tie") })
      .filter((c) => c.a !== c.b),
    { maxLength: 40 },
  );

const MAP = [3, 0, 4, 1, 2];
const renamed = (picks: readonly PairComparison[]): PairComparison[] => picks.map((c) => ({ ...c, a: MAP[c.a]!, b: MAP[c.b]! }));

describe("eloReplay", () => {
  it("makes one eloUpdate for each pick, in the order of the list", () => {
    const picks = ordered(2);
    const ratings = [1500, 1500, 1500];
    for (const { a, b, outcome } of picks) {
      const next = eloUpdate(ratings[a]!, ratings[b]!, outcome === "a" ? 1 : outcome === "b" ? 0 : 0.5, { k: 20 });
      ratings[a] = next.a;
      ratings[b] = next.b;
    }
    expect(eloReplay(3, picks, { k: 20 })).toEqual(ratings);
    // The order counts: the reverse list gives other ratings.
    expect(eloReplay(3, [...picks].reverse(), { k: 20 })).not.toEqual(ratings);
  });

  it("keeps the sum of the ratings, and permutes the ratings when the items are renamed", () => {
    fc.assert(
      fc.property(pickList(5), fc.double({ min: 1000, max: 2000, noNaN: true }), (picks, start) => {
        const ratings = eloReplay(5, picks, { start });
        expect(ratings.reduce((s, r) => s + r, 0)).toBeCloseTo(5 * start, 7);
        const moved = eloReplay(5, renamed(picks), { start });
        for (let i = 0; i < 5; i++) expect(moved[MAP[i]!]).toBe(ratings[i]);
      }),
      { numRuns: 100 },
    );
  });

  it("gives the start rating to each item of an empty log, and refuses a weight and a bad option", () => {
    expect(eloReplay(3, [], { start: 1200 })).toEqual([1200, 1200, 1200]);
    expect(eloReplay(0, [])).toEqual([]);
    expect(() => eloReplay(2, [{ a: 0, b: 1, outcome: "a", weight: 2 }])).toThrow(RangeError);
    expect(() => eloReplay(2, [{ a: 0, b: 2, outcome: "a" }])).toThrow(RangeError);
    expect(() => eloReplay(2, [{ a: 0, b: 1, outcome: "draw" as PairOutcome }])).toThrow(RangeError);
    expect(() => eloReplay(2, [], { k: -1 })).toThrow(RangeError);
    expect(() => eloReplay(2, [], { start: Number.NaN })).toThrow(RangeError);
  });
});

describe("glicko2Replay", () => {
  it("makes each pick one rating period of its two items, from their ratings before the pick", () => {
    const start = { rating: 1500, rd: 350, volatility: 0.06 };
    const [a, b, c] = glicko2Replay(3, [{ a: 0, b: 1, outcome: "a" }]);
    expect(a).toEqual(glicko2Update(start, [{ rating: 1500, rd: 350, score: 1 }]));
    expect(b).toEqual(glicko2Update(start, [{ rating: 1500, rd: 350, score: 0 }]));
    // An item with no pick does not change.
    expect(c).toEqual(start);
  });

  it("makes the RD of each item smaller with its picks, and keeps the order of the log", () => {
    const players = glicko2Replay(3, ordered(10));
    for (const player of players) expect(player.rd).toBeLessThan(350);
    expect(players[0]!.rating).toBeGreaterThan(players[1]!.rating);
    expect(players[1]!.rating).toBeGreaterThan(players[2]!.rating);
  });

  it("permutes the ratings when the items are renamed", () => {
    fc.assert(
      fc.property(pickList(5), (picks) => {
        const players = glicko2Replay(5, picks);
        const moved = glicko2Replay(5, renamed(picks));
        for (let i = 0; i < 5; i++) expect(moved[MAP[i]!]).toEqual(players[i]);
      }),
      { numRuns: 60 },
    );
  });

  it("refuses a weight and a bad start rating", () => {
    expect(() => glicko2Replay(2, [{ a: 0, b: 1, outcome: "a", weight: 0.5 }])).toThrow(RangeError);
    expect(() => glicko2Replay(2, [], { start: { rating: 1500, rd: 0, volatility: 0.06 } })).toThrow(RangeError);
    expect(() => glicko2Replay(2, [], { tau: 0 })).toThrow(RangeError);
  });
});

describe("fitRatings", () => {
  const picks = ordered(10);

  it("gives empty lists for 0 items, with each model", () => {
    for (const model of ["bradley-terry", "elo", "glicko2"] as const) expect(fitRatings(model, 0, [])).toEqual({ strengths: [], se: [], tie: 0 });
    expect(() => fitRatings("elo", 0, [{ a: 0, b: 1, outcome: "a" }])).toThrow(RangeError);
  });

  it("uses the dense fit up to denseLimit items, and the sparse fit above", () => {
    const dense = fitRatings("bradley-terry", 3, picks, { bradleyTerry: { priorSd: 2 } });
    const exact = bradleyTerry(3, picks, { priorSd: 2 });
    expect(dense).toEqual({ strengths: exact.strengths, se: exact.se, tie: exact.tie });
    const sparse = fitRatings("bradley-terry", 3, picks, { bradleyTerry: { priorSd: 2 }, denseLimit: 2 });
    const mm = bradleyTerrySparse(3, picks, { priorSd: 2 });
    expect(sparse).toEqual({ strengths: mm.strengths, se: mm.se, tie: mm.tie });
    for (let i = 0; i < 3; i++) expect(sparse.strengths[i]).toBeCloseTo(dense.strengths[i]!, 7);
    // The Bradley-Terry fit takes weights. The replays do not.
    expect(() => fitRatings("bradley-terry", 2, [{ a: 0, b: 1, outcome: "a", weight: 2 }])).not.toThrow();
    expect(() => fitRatings("glicko2", 2, [{ a: 0, b: 1, outcome: "a", weight: 2 }])).toThrow(RangeError);
  });

  it("converts the ratings of the replays to log-strengths", () => {
    const elo = fitRatings("elo", 3, picks, { elo: { k: 16 } });
    expect(elo.strengths).toEqual(eloReplay(3, picks, { k: 16 }).map((rating) => ratingToStrength(rating)));
    expect(elo.se).toEqual([undefined, undefined, undefined]);
    expect(elo.tie).toBe(0);
    const glicko = fitRatings("glicko2", 3, picks);
    const players = glicko2Replay(3, picks);
    for (let i = 0; i < 3; i++) {
      expect(glicko.strengths[i]).toBe(ratingToStrength(players[i]!.rating));
      expect(glicko.se[i]).toBeCloseTo((players[i]!.rd * Math.LN10) / 400, 10);
    }
    // Each model finds the order of the log.
    for (const model of ["bradley-terry", "elo", "glicko2"] as const) {
      const { strengths } = fitRatings(model, 3, picks);
      expect(strengths[0]).toBeGreaterThan(strengths[1]!);
      expect(strengths[1]).toBeGreaterThan(strengths[2]!);
    }
  });
});

describe("selectRatingModel", () => {
  it("chooses Bradley-Terry with no test when the log has too few picks", () => {
    expect(selectRatingModel(3, ordered(3))).toEqual({ model: "bradley-terry", scores: [], trained: 9, tested: 0 });
    expect(selectRatingModel(0, [])).toEqual({ model: "bradley-terry", scores: [], trained: 0, tested: 0 });
  });

  it("scores each model on the last picks, from the best to the worst", () => {
    const choice = selectRatingModel(3, ordered(20));
    expect(choice.trained).toBe(48);
    expect(choice.tested).toBe(12);
    expect(choice.scores.map((score) => score.model).sort()).toEqual(["bradley-terry", "elo", "glicko2"]);
    for (const score of choice.scores) {
      expect(Number.isFinite(score.logLoss)).toBe(true);
      // Each model knows the order, so each one is better than a forecast of one third for each outcome.
      expect(score.logLoss).toBeLessThan(Math.log(3));
    }
    expect(choice.scores[0]?.model).toBe(choice.model);
    const losses = choice.scores.map((score) => score.logLoss);
    expect([...losses].sort((x, y) => x - y)).toEqual(losses);
  });

  it("compares only the given models, and keeps their order for equal scores", () => {
    const choice = selectRatingModel(3, ordered(20), { models: ["elo", "elo"], holdout: 0.5, minimum: 10 });
    expect(choice.tested).toBe(30);
    expect(choice.scores.map((score) => score.model)).toEqual(["elo", "elo"]);
  });

  it("refuses a bad holdout, minimum, model and weight", () => {
    expect(() => selectRatingModel(3, ordered(20), { holdout: 0 })).toThrow(RangeError);
    expect(() => selectRatingModel(3, ordered(20), { holdout: 1 })).toThrow(RangeError);
    expect(() => selectRatingModel(3, ordered(20), { minimum: -1 })).toThrow(RangeError);
    expect(() => selectRatingModel(3, ordered(20), { models: [] })).toThrow(RangeError);
    expect(() => selectRatingModel(3, ordered(20), { models: ["other" as "elo"] })).toThrow(RangeError);
    expect(() => selectRatingModel(2, [{ a: 0, b: 1, outcome: "a", weight: 2 }])).toThrow(RangeError);
  });
});
