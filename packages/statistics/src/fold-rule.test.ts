import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FOLD_RULE_BAR, FOLD_RULE_MIN_FOLDS, foldRule, foldSkills } from "./fold-rule.ts";
import type { ResponseFold } from "./response.ts";

const fold = (errors: ResponseFold["errors"]): ResponseFold => ({ heldOut: [], errors });
const error = (mae: number, baselineMae: number) => ({ n: 4, mae, rmse: mae, baselineMae });

describe("foldSkills", () => {
  it("gives 1 minus the error of the model over the error of the mean, for each fold with the measure", () => {
    const record = { folds: [fold({ ms: error(1, 4) }), fold({ other: error(1, 2) }), fold({ ms: error(3, 2) }), fold({ ms: error(0, 0) })] };
    expect(foldSkills(record, "ms")).toEqual([0.75, -0.5, 0]);
    expect(foldSkills(record, "other")).toEqual([0.5]);
    expect(foldSkills(record, "none")).toEqual([]);
  });

  it("does not read a key of the prototype as a measure", () => {
    expect(foldSkills({ folds: [fold({ ms: error(1, 2) })] }, "toString")).toEqual([]);
  });
});

describe("foldRule", () => {
  it("passes a model that beats the mean on each fold with a mean skill at the bar", () => {
    const verdict = foldRule([0.2, 0.1, 0.05, 0.3, 0.1]);
    expect(verdict).toEqual({ verdict: "pass", folds: 5, beaten: 5, mean: 0.15, chance: 1 / 32, reasons: [] });
  });

  it("fails a model that does not beat the mean on one fold, or with a mean skill under the bar", () => {
    const one = foldRule([0.2, 0.1, 0, 0.3, 0.1]);
    expect(one).toMatchObject({ verdict: "fail", beaten: 4 });
    expect(one.reasons).toEqual(["The model beats the mean on 4 of 5 folds, not on each fold."]);
    const small = foldRule([0.01, 0.02, 0.01, 0.03, 0.02]);
    expect(small.verdict).toBe("fail");
    expect(small.reasons[0]).toMatch(/under the bar 0.05/);
  });

  it("has no read with too few folds, and refuses a skill that is not finite", () => {
    expect(foldRule([0.5, 0.5, 0.5, 0.5])).toMatchObject({ verdict: "no read", folds: 4, mean: 0.5, chance: 1 / 16 });
    expect(foldRule([])).toMatchObject({ verdict: "no read", folds: 0, mean: null, chance: 1 });
    expect(() => foldRule([0.5, Number.NaN, 0.5, 0.5, 0.5])).toThrow(/fold 1 is a finite number, not NaN/);
    expect(() => foldRule([0.5, Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });

  it("takes other limits, and refuses bad limits", () => {
    expect(foldRule([0.5, 0.5, 0.5], { minFolds: 3 }).verdict).toBe("pass");
    expect(foldRule([0.01, 0.01, 0.01], { minFolds: 3, bar: 0 }).verdict).toBe("pass");
    for (const minFolds of [0, 1.5, -1, Number.NaN]) expect(() => foldRule([0.5], { minFolds }), String(minFolds)).toThrow(RangeError);
    for (const bar of [Number.NaN, Number.POSITIVE_INFINITY]) expect(() => foldRule([0.5], { bar }), String(bar)).toThrow(RangeError);
  });

  it("passes exactly when there are enough folds, each skill is above 0 and the mean is at the bar", () => {
    const skill = fc.double({ min: -1, max: 1, noNaN: true });
    fc.assert(
      fc.property(fc.array(skill, { maxLength: 9 }), (skills) => {
        const verdict = foldRule(skills);
        const mean = skills.reduce((s, x) => s + x, 0) / skills.length;
        const pass = skills.length >= FOLD_RULE_MIN_FOLDS && skills.every((x) => x > 0) && mean >= FOLD_RULE_BAR;
        expect(verdict.verdict === "pass").toBe(pass);
        expect(verdict.verdict === "no read").toBe(skills.length < FOLD_RULE_MIN_FOLDS);
        expect(verdict.chance).toBe(0.5 ** skills.length);
        expect(verdict.reasons.length === 0).toBe(pass);
      }),
    );
  });
});
