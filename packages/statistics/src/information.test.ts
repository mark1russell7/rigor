import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { answerValue, bayesRisk, entropy, informationGain, rankQuestions } from "./index.ts";

/** A distribution with n values from positive weights. */
const weights = (n: number): fc.Arbitrary<number[]> =>
  fc.array(uniformDouble({ min: 0.001, max: 1 }), { minLength: n, maxLength: n }).map((w) => {
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / sum);
  });

const table = fc
  .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 5 }))
  .chain(([h, x]) => fc.tuple(weights(h), fc.array(weights(x), { minLength: h, maxLength: h })));

describe("entropy", () => {
  it("gives 0 for one sure outcome and log2(n) for n equal outcomes", () => {
    expect(entropy([1])).toBe(0);
    expect(entropy([0, 1, 0])).toBe(0);
    expect(entropy([0.5, 0.5])).toBeCloseTo(1, 12);
    expect(entropy([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(2, 12);
    expect(entropy([0.5, 0.25, 0.25])).toBeCloseTo(1.5, 12);
  });

  it("refuses a list that is not a distribution", () => {
    expect(() => entropy([])).toThrow(RangeError);
    expect(() => entropy([0.5, 0.4])).toThrow(/sum/);
    expect(() => entropy([1.5, -0.5])).toThrow(/0 or more/);
    expect(() => entropy([Number.NaN, 1])).toThrow(RangeError);
  });
});

describe("informationGain", () => {
  it("gives the full entropy of the prior for an observation that tells each value", () => {
    expect(informationGain([0.5, 0.5], [[1, 0], [0, 1]])).toBeCloseTo(1, 12);
    expect(informationGain([0.25, 0.25, 0.5], [[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBeCloseTo(1.5, 12);
  });

  it("gives 0 for an observation with the same row for each value", () => {
    expect(informationGain([0.3, 0.7], [[0.2, 0.8], [0.2, 0.8]])).toBeCloseTo(0, 12);
  });

  it("gives the gain of a noisy test", () => {
    // A test that is right with the probability 0.9 on a fair variable: 1 - H(0.9, 0.1) bits.
    expect(informationGain([0.5, 0.5], [[0.9, 0.1], [0.1, 0.9]])).toBeCloseTo(1 - entropy([0.9, 0.1]), 12);
  });

  it("is the entropy of the prior minus the expected entropy of the posterior", () => {
    fc.assert(
      fc.property(table, ([prior, likelihood]) => {
        const outcomes = likelihood[0]?.length ?? 0;
        let expected = 0;
        for (let x = 0; x < outcomes; x++) {
          const joint = prior.map((p, h) => p * (likelihood[h]?.[x] ?? 0));
          const px = joint.reduce((a, b) => a + b, 0);
          if (px > 0) expected += px * entropy(joint.map((j) => j / px));
        }
        const gain = informationGain(prior, likelihood);
        expect(gain).toBeCloseTo(entropy(prior) - expected, 9);
        expect(gain).toBeGreaterThanOrEqual(0);
        expect(gain).toBeLessThanOrEqual(entropy(prior));
      }),
    );
  });

  it("does not change when the values of the variable change their order", () => {
    fc.assert(
      fc.property(table, ([prior, likelihood]) => {
        expect(informationGain([...prior].reverse(), [...likelihood].reverse())).toBeCloseTo(informationGain(prior, likelihood), 9);
      }),
    );
  });

  it("refuses a likelihood that does not match the prior", () => {
    expect(() => informationGain([0.5, 0.5], [[1, 0]])).toThrow(/rows/);
    expect(() => informationGain([0.5, 0.5], [[1, 0], [1]])).toThrow(/outcomes/);
    expect(() => informationGain([0.5, 0.5], [[0.6, 0.6], [0.5, 0.5]])).toThrow(/row 0/);
    expect(() => informationGain([0.9], [[1]])).toThrow(/prior/);
  });
});

/** A loss table with the given count of values: 1 to 4 actions, each with a loss from 0 to 100 for each value. */
const lossTable = (values: number): fc.Arbitrary<number[][]> =>
  fc.array(fc.array(uniformDouble({ min: 0, max: 100 }), { minLength: values, maxLength: values }), { minLength: 1, maxLength: 4 });

describe("bayesRisk", () => {
  it("gives the entropy for the log loss", () => {
    fc.assert(fc.property(weights(4), (prior) => {
      expect(bayesRisk(prior, "log")).toBeCloseTo(entropy(prior), 12);
    }));
  });

  it("gives the smallest expected loss of a row for a loss table", () => {
    expect(bayesRisk([0.5, 0.5], [[0, 10], [4, 4]])).toBe(4);
    expect(bayesRisk([0.9, 0.1], [[0, 10], [4, 4]])).toBeCloseTo(1, 12);
  });

  it("refuses a loss table that does not fit the distribution", () => {
    expect(() => bayesRisk([0.5, 0.5], [])).toThrow(/no actions/);
    expect(() => bayesRisk([0.5, 0.5], [[1, 2, 3]])).toThrow(/3 values, not 2/);
    expect(() => bayesRisk([0.5, 0.5], [[1, Number.POSITIVE_INFINITY]])).toThrow(/finite/);
  });
});

describe("answerValue", () => {
  it("gives informationGain back with the log loss", () => {
    fc.assert(fc.property(table, ([prior, likelihood]) => {
      expect(answerValue(prior, likelihood, "log")).toBeCloseTo(informationGain(prior, likelihood), 9);
    }));
  });

  it("gives the expected value of perfect information for an answer that tells each value", () => {
    // Before the answer the safe action costs 4. After it, the first value costs 0 and the second costs 4.
    expect(answerValue([0.5, 0.5], [[1, 0], [0, 1]], [[0, 10], [4, 4]])).toBeCloseTo(2, 12);
  });

  it("gives 0 when no answer changes the best action", () => {
    expect(answerValue([0.5, 0.5], [[1, 0], [0, 1]], [[1, 1], [5, 5]])).toBe(0);
    expect(answerValue([0.3, 0.7], [[0.4, 0.6], [0.4, 0.6]], [[0, 10], [4, 4]])).toBeCloseTo(0, 12);
  });

  it("is 0 or more, and at most the value of perfect information", () => {
    fc.assert(
      fc.property(
        table.chain(([prior, likelihood]) => fc.tuple(fc.constant(prior), fc.constant(likelihood), lossTable(prior.length))),
        ([prior, likelihood, loss]) => {
          const identity = prior.map((_, h) => prior.map((__, x) => (h === x ? 1 : 0)));
          const value = answerValue(prior, likelihood, loss);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(answerValue(prior, identity, loss) + 1e-9);
        },
      ),
    );
  });
});

describe("rankQuestions", () => {
  const loss = [[0, 10], [4, 4]];
  const tells = { id: "tells", likelihood: [[1, 0], [0, 1]] };
  const hints = { id: "hints", likelihood: [[0.8, 0.2], [0.2, 0.8]] };
  const nothing = { id: "nothing", likelihood: [[0.5, 0.5], [0.5, 0.5]] };

  it("puts the question with the largest expected value first", () => {
    const ranked = rankQuestions([nothing, hints, tells], [0.5, 0.5], loss);
    expect(ranked.map((choice) => choice.question.id)).toEqual(["tells", "hints", "nothing"]);
    expect(ranked[0]?.value).toBeCloseTo(2, 12);
    expect(ranked[2]?.value).toBe(0);
  });

  it("puts the lower cost first when two values are equal, then the order of the candidates", () => {
    const dear = { ...tells, id: "dear", cost: 5 };
    const cheap = { ...tells, id: "cheap", cost: 1 };
    const free = { ...tells, id: "free" };
    expect(rankQuestions([dear, cheap, free], [0.5, 0.5], loss).map((choice) => choice.question.id)).toEqual(["free", "cheap", "dear"]);
    expect(rankQuestions([nothing, { ...nothing, id: "second" }], [0.5, 0.5], loss).map((choice) => choice.question.id)).toEqual(["nothing", "second"]);
  });

  it("gives the order of the information gain with the log loss", () => {
    const ranked = rankQuestions([nothing, hints, tells], [0.5, 0.5], "log");
    expect(ranked.map((choice) => choice.question.id)).toEqual(["tells", "hints", "nothing"]);
    expect(ranked[1]?.value).toBeCloseTo(informationGain([0.5, 0.5], hints.likelihood), 12);
  });
});
