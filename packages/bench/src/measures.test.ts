import { signTestPower } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { type MeasureCheckOptions, type MeasureChecks, type MeasureFindingKind, type MeasureRow, type MeasureRule, NARROW_SPREAD_SHARE, checkMeasures, jointClaim, winClaim } from "./measures.ts";

const keys = (count: number, prefix = "k"): string[] => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/** The rows of one group: the value of each key comes from `value`. */
const rows = (measure: string, group: string, count: number, value: (i: number) => number, extra: Partial<MeasureRow> = {}): MeasureRow[] =>
  keys(count).map((key, i) => ({ measure, group, key, value: value(i), ...extra }));

const FILL: MeasureRule = { measure: "fill", sense: "higher", controls: ["trick"], partners: ["order"] };
const ORDER: MeasureRule = { measure: "order", sense: "lower", controls: [], partners: [], noControl: { because: "The control has no code.", until: "2026-12-01" } };
const RULES = [FILL, ORDER];
const AS_OF = "2026-11-05";
const options = (rules: readonly MeasureRule[] = RULES): MeasureCheckOptions => ({ rules, controls: ["trick"], asOf: AS_OF });

/** Three real entries that differ on both measures, with a small change for each key, so no pair ties. */
const real = (count = 40): MeasureRow[] => [
  ...rows("fill", "a", count, (i) => 0.6 + i * 1e-4),
  ...rows("fill", "b", count, (i) => 0.7 + i * 1e-4),
  ...rows("fill", "c", count, (i) => 0.8 + i * 1e-4),
  ...rows("order", "a", count, (i) => 30 + i * 1e-3),
  ...rows("order", "b", count, (i) => 20 + i * 1e-3),
  ...rows("order", "c", count, (i) => 10 + i * 1e-3),
];

const kinds = (check: MeasureChecks): MeasureFindingKind[] => [...new Set(check.findings.map((f) => f.kind))].sort();
const has = (check: MeasureChecks, kind: MeasureFindingKind): boolean => check.findings.some((f) => f.kind === kind);

/** The trick wins fill and loses order on each key. */
const caught = (count = 40): MeasureRow[] => [...rows("fill", "trick", count, (i) => 0.95 + i * 1e-4), ...rows("order", "trick", count, (i) => 90 + i * 1e-3)];

describe("the floors of the groups", () => {
  /** The entry `near` beats the control by 1 on each key, and the entry `far` beats it by 5 on each key. */
  const data = [...rows("fill", "near", 40, (i) => i + 1), ...rows("fill", "far", 40, (i) => i + 5), ...rows("fill", "trick", 40, (i) => i)];
  const rule = (extra: Partial<MeasureRule>): MeasureRule => ({ measure: "fill", sense: "higher", controls: ["trick"], partners: [], ...extra });
  const comparison = (extra: Partial<MeasureRule>, entry: string) => checkMeasures(data, { rules: [rule(extra)], controls: ["trick"], asOf: AS_OF }).reads[0]!.comparisons.find((c) => c.better === entry)!;

  it("needs a size over the floor of the entry and over the floor of the control", () => {
    expect(comparison({ floors: { near: 0.5, far: 0, trick: 0 } }, "near")).toMatchObject({ floor: 0.5, beats: true });
    expect(comparison({ floors: { near: 2, far: 0, trick: 0 } }, "near")).toMatchObject({ floor: 2, beats: false });
    expect(comparison({ floors: { near: 0, far: 0, trick: 2 } }, "near")).toMatchObject({ floor: 2, beats: false });
  });

  it("keeps a comparison that one number for all groups removes", () => {
    expect(comparison({ resolution: 2 }, "near").beats).toBe(false);
    expect(comparison({ floors: { near: 0.5, far: 2, trick: 0.5 } }, "near").beats).toBe(true);
    expect(comparison({ floors: { near: 0.5, far: 6, trick: 0.5 } }, "far").beats).toBe(false);
  });

  it("reads the resolution for a group with no floor, and throws for a group with neither", () => {
    expect(comparison({ floors: { near: 0 }, resolution: 2 }, "near")).toMatchObject({ floor: 2, beats: false });
    expect(() => comparison({ floors: { near: 0, far: 0 } }, "near")).toThrow(/"trick" of "fill" has no floor/);
    expect(() => comparison({ floors: { near: 0, trick: 0 } }, "near")).toThrow(/"far" of "fill" has no floor/);
  });

  it("states the basis, and leaves a rule with no floors as it was", () => {
    const basis = (extra: Partial<MeasureRule>) => checkMeasures(data, { rules: [rule(extra)], controls: ["trick"], asOf: AS_OF }).measures[0]!.basis;
    expect(basis({ floors: { near: 0, far: 0, trick: 0 } })).toBe("test and resolution");
    expect(basis({})).toBe("test only");
    expect(comparison({}, "near")).not.toHaveProperty("floor");
    expect(comparison({}, "near").beats).toBe(true);
    expect(comparison({}, "far").beats).toBe(true);
    expect(comparison({ resolution: 2 }, "near")).toMatchObject({ floor: 2, beats: false });
  });

  it("reads the larger floor in the spread of the real entries, and the finding says floors", () => {
    const spread = checkMeasures(data, { rules: [rule({ floors: { near: 5, far: 0, trick: 0 } })], controls: ["trick"], asOf: AS_OF });
    expect(spread.findings.find((f) => f.kind === "no-spread")!.text).toContain("the floors of the groups");
  });
});

describe("the power of a test", () => {
  it("needs 10 untied keys for a family of 31 entries, and the test passes at that count", () => {
    const entries = Array.from({ length: 31 }, (_, e) => `e${e}`);
    const at = (count: number): MeasureChecks => {
      const data = entries.flatMap((e, n) => rows("fill", e, count, (i) => 10 * n + i));
      return checkMeasures([...data, ...rows("fill", "trick", count, (i) => -1000 + i)], { rules: [{ measure: "fill", sense: "higher", controls: ["trick"], partners: [] }], controls: ["trick"], asOf: AS_OF });
    };
    expect(signTestPower(10, 0.05 / 31, 1)).toBe(10);
    expect(signTestPower(9, 0.05 / 31, 1)).toBeUndefined();
    const ten = at(10).reads[0]!;
    expect(ten.comparisons[0]!).toMatchObject({ family: 31, needs: 10, tooFew: false });
    expect(ten.status).toBe("beaten");
    const nine = at(9).reads[0]!;
    expect(nine.comparisons[0]!).toMatchObject({ needs: 10, tooFew: true, tied: false });
    expect(nine.status).toBe("too-few");
  });

  it("does not call a control a winner at 5 pairs, where no test has the power", () => {
    const check = checkMeasures([...real(5), ...caught(5)], options());
    expect(check.measures[0]!.guards[0]!.status).toBe("too-few");
    expect(has(check, "uncaught")).toBe(false);
    expect(has(check, "too-few")).toBe(true);
    expect(check.findings.find((f) => f.kind === "too-few")!.text).toContain("needs 6 untied pairs");
  });

  it("needs the keys that the table of the README states", () => {
    const needs = (tests: number, sides: 1 | 2): number => {
      let n = 1;
      while (signTestPower(n, 0.05 / tests, sides) === undefined) n += 1;
      return n;
    };
    expect([needs(31, 1), needs(14 * 15, 1), needs(30 * 20, 1), needs(((31 * 30) / 2) * 20, 2)]).toEqual([10, 13, 14, 19]);
  });

  it("counts only the untied keys in the test", () => {
    const data = [...rows("fill", "a", 40, (i) => (i < 30 ? 0.5 : 0.9)), ...rows("fill", "trick", 40, () => 0.5)];
    const read = checkMeasures(data, { rules: [{ ...FILL, partners: [] }], controls: ["trick"], asOf: AS_OF }).reads[0]!.comparisons[0]!;
    expect(read).toMatchObject({ shared: 40, n: 10, ties: 30, wins: 10, losses: 0, beats: true });
  });

  it("does not let a Holm step pass a test under the need", () => {
    // The tests of b and c pass first. The test of a has only 3 keys, so its p is under the level at the last step of Holm.
    const data = [...rows("fill", "b", 40, (i) => 0.9 + i * 1e-4), ...rows("fill", "c", 40, (i) => 0.8 + i * 1e-4), ...rows("fill", "a", 3, (i) => 0.9 + i * 1e-4), ...rows("fill", "trick", 40, (i) => 0.1 + i * 1e-4)];
    const read = checkMeasures(data, { rules: [{ ...FILL, partners: [] }], controls: ["trick"], asOf: AS_OF }).reads[0]!;
    const a = read.comparisons.find((c) => c.better === "a")!;
    expect(a.tooFew).toBe(true);
    expect(a.beats).toBe(false);
  });
});

describe("the finding uncaught", () => {
  it("trips when the control wins and loses no partner", () => {
    const check = checkMeasures([...real(), ...rows("fill", "trick", 40, (i) => 0.95 + i * 1e-4), ...rows("order", "trick", 40, (i) => 1 + i * 1e-3)], options());
    const finding = check.findings.find((f) => f.kind === "uncaught")!;
    expect(finding).toMatchObject({ measure: "fill", control: "trick" });
    expect(finding.comparisons.length).toBeGreaterThan(0);
    expect(finding.comparisons[0]!).toMatchObject({ n: 40, ties: 0, family: 3 });
    expect(finding.comparisons[0]!.adjusted).toBeGreaterThan(0);
  });

  it("does not trip when the control loses a partner", () => {
    const check = checkMeasures([...real(), ...caught()], options());
    expect(check.measures[0]!.guards[0]!.status).toBe("wins");
    expect(check.measures[0]!.guards[0]!.partners).toEqual([{ partner: "order", status: "lost", beatenBy: 3, of: 3, excluded: 0, caught: true }]);
    expect(has(check, "uncaught")).toBe(false);
    expect(check.findings).toEqual([]);
  });

  it("trips when the control ties each entry on the partner over enough keys", () => {
    const data = [...rows("fill", "a", 40, (i) => 0.6 + i * 1e-4), ...rows("fill", "b", 40, (i) => 0.7 + i * 1e-4), ...rows("order", "a", 40, () => 5), ...rows("order", "b", 40, () => 5), ...rows("fill", "trick", 40, (i) => 0.9 + i * 1e-4), ...rows("order", "trick", 40, () => 5)];
    const check = checkMeasures(data, options());
    expect(check.measures[0]!.guards[0]!.partners[0]!.status).toBe("not-lost");
    expect(has(check, "uncaught")).toBe(true);
  });

  it("trips for a control with no partner", () => {
    const check = checkMeasures([...real(), ...caught()], options([{ ...FILL, partners: [] }, ORDER]));
    expect(check.findings.find((f) => f.kind === "uncaught")!.text).toContain("no partner");
  });

  it("clears a loss of 1e-9 with no resolution, and does not clear it under a resolution", () => {
    // On order, a lower value is better. Only entry c beats the control, and only by 1e-9 on each key.
    const tiny = [...real(), ...rows("fill", "trick", 40, (i) => 0.95 + i * 1e-4), ...rows("order", "trick", 40, (i) => 10 + i * 1e-3 + 1e-9)];
    const before = checkMeasures(tiny, options());
    expect(before.measures[1]!.basis).toBe("test only");
    expect(before.measures[0]!.guards[0]!.partners[0]!.status).toBe("lost");
    expect(has(before, "uncaught")).toBe(false);
    const after = checkMeasures(tiny, options([FILL, { ...ORDER, resolution: 1e-6 }]));
    expect(after.measures[1]!.basis).toBe("test and resolution");
    expect(after.measures[0]!.guards[0]!.partners[0]!.status).toBe("not-lost");
    expect(has(after, "uncaught")).toBe(true);
  });
});

describe("the partners of a control", () => {
  const partnerRule = (measure: string): MeasureRule => ({ measure, sense: "lower", controls: [], partners: [], noControl: { because: "The control has no code.", until: "2026-12-01" } });
  /** One real entry and the control, with 40 keys on fill. On each partner, the entry beats the control on `wins` keys of `n`. */
  const data = (partners: readonly string[], wins: number, n: number): MeasureRow[] => [
    ...rows("fill", "a", 40, (i) => 0.5 + i * 1e-4),
    ...rows("fill", "trick", 40, (i) => 0.9 + i * 1e-4),
    ...partners.flatMap((partner) => [...rows(partner, "a", n, (i) => (i < wins ? 1 : 9)), ...rows(partner, "trick", n, () => 5)]),
  ];
  const check = (partners: readonly string[], wins: number, n: number): MeasureChecks =>
    checkMeasures(data(partners, wins, n), options([{ ...FILL, partners }, ...partners.map(partnerRule)]));
  const THREE = ["p", "q", "r"];

  it("sets the example between the level over 3 and the level", () => {
    const read = check(["p"], 7, 8).reads.find((r) => r.measure === "p")!;
    expect(read.comparisons[0]!.adjusted).toBeGreaterThan(0.05 / 3);
    expect(read.comparisons[0]!.adjusted).toBeLessThan(0.05);
  });

  it("trips uncaught with three partners between the level over 3 and the level, and states the count", () => {
    const result = check(THREE, 7, 8);
    expect(result.measures[0]!.guards[0]!.partners.map((p) => p.status)).toEqual(["not-lost", "not-lost", "not-lost"]);
    const finding = result.findings.find((f) => f.kind === "uncaught")!;
    expect(finding.partners).toBe(3);
    expect(finding.text).toContain("its 3 partners");
  });

  it("does not trip uncaught on the same read with one partner", () => {
    const result = check(["p"], 7, 8);
    expect(result.measures[0]!.guards[0]!.partners).toEqual([{ partner: "p", status: "lost", beatenBy: 1, of: 1, excluded: 0, caught: true }]);
    expect(has(result, "uncaught")).toBe(false);
  });

  it("does not trip uncaught with three partners when a partner passes the divided level", () => {
    const result = checkMeasures([...data(["q", "r"], 7, 8), ...rows("p", "a", 40, () => 1), ...rows("p", "trick", 40, () => 5)], options([{ ...FILL, partners: THREE }, ...THREE.map(partnerRule)]));
    expect(result.measures[0]!.guards[0]!.partners.map((p) => p.status)).toEqual(["lost", "not-lost", "not-lost"]);
    expect(has(result, "uncaught")).toBe(false);
  });

  it("reads too few keys for the divided level as too-few, and that is a finding", () => {
    // Five keys pass at the level 0.05, and they have no power at the level over 3.
    const three = check(THREE, 5, 5);
    expect(three.measures[0]!.guards[0]!.partners.map((p) => p.status)).toEqual(["too-few", "too-few", "too-few"]);
    expect(has(three, "uncaught")).toBe(false);
    expect(three.findings.find((f) => f.kind === "too-few")).toMatchObject({ measure: "fill", control: "trick", partners: 3 });
    const one = check(["p"], 5, 5);
    expect(one.measures[0]!.guards[0]!.partners[0]!.status).toBe("lost");
    expect(has(one, "too-few")).toBe(false);
  });

  it("does not clear an entry at a level that does not clear the control", () => {
    const claim = (partners: readonly string[]) => winClaim(check(partners, 7, 8), "fill", "a");
    expect(claim(THREE).likeControl).toBe(true);
    expect(claim(["p"]).likeControl).toBe(false);
  });
});

describe("the median of a partner", () => {
  const partnerRule: MeasureRule = { measure: "p", sense: "lower", controls: [], partners: [], noControl: { because: "The control has no code.", until: "2026-12-01" } };
  /**
   * The rows of `count` real entries and the control. The control wins fill on each key. On the partner `p`, the first `beat`
   * entries beat the control on each of 40 keys, and the others lose to it. The entries of `thin` have 3 keys on `p` only.
   */
  const field = (count: number, beat: number, thin = 0): MeasureRow[] => [
    ...Array.from({ length: count + thin }, (_, e) => [
      ...rows("fill", `e${e}`, 40, (i) => 0.5 + i * 1e-4),
      ...rows("p", `e${e}`, e < count ? 40 : 3, (i) => (e < beat ? 1 : 9) + i * 1e-3),
    ]).flat(),
    ...rows("fill", "trick", 40, (i) => 0.9 + i * 1e-4),
    ...rows("p", "trick", 40, (i) => 5 + i * 1e-3),
  ];
  const guard = (data: readonly MeasureRow[]): MeasureChecks => checkMeasures(data, options([{ ...FILL, partners: ["p"] }, partnerRule]));
  const partner = (check: MeasureChecks) => check.measures[0]!.guards[0]!.partners[0]!;

  it("reads not caught when 2 of 40 entries beat the control, and the status stays lost", () => {
    const check = guard(field(40, 2));
    expect(check.measures[0]!.guards[0]!.status).toBe("wins");
    expect(partner(check)).toEqual({ partner: "p", status: "lost", beatenBy: 2, of: 40, excluded: 0, caught: false });
    expect(has(check, "uncaught")).toBe(false);
  });

  it("reads caught when 30 of 40 entries beat the control", () => {
    expect(partner(guard(field(40, 30)))).toEqual({ partner: "p", status: "lost", beatenBy: 30, of: 40, excluded: 0, caught: true });
  });

  it("puts the line at the median: 20 of 40 is not caught, and 21 of 40 is caught", () => {
    expect(partner(guard(field(40, 20))).caught).toBe(false);
    expect(partner(guard(field(40, 21))).caught).toBe(true);
  });

  it("does not count an entry with too few keys in of", () => {
    expect(partner(guard(field(40, 2, 5)))).toMatchObject({ beatenBy: 2, of: 40, excluded: 5, caught: false });
  });

  it("shows the entries left out when 3 of 5 read entries beat the control and 35 of 40 have too few keys", () => {
    expect(partner(guard(field(5, 3, 35)))).toEqual({ partner: "p", status: "lost", beatenBy: 3, of: 5, excluded: 35, caught: true });
  });

  it("gives the same findings as the status alone", () => {
    const kept = (check: MeasureChecks) => check.findings.map((f) => f.kind);
    expect(kept(guard(field(40, 2)))).toEqual(kept(guard(field(40, 30))));
  });
});

describe("the finding weak-control", () => {
  /** The rule with no partner, so only the reads of the control on fill count. */
  const ALONE = [{ ...FILL, partners: [] }];
  const entries = (count: number): MeasureRow[] => Array.from({ length: count }, (_, e) => rows("fill", `e${e}`, 40, (i) => 0.1 * e + i * 1e-4)).flat();

  it("trips when the control loses to each real entry", () => {
    const check = checkMeasures([...real(), ...rows("fill", "trick", 40, (i) => 0.1 + i * 1e-4), ...rows("order", "trick", 40, (i) => 90 + i * 1e-3)], options());
    const finding = check.findings.find((f) => f.kind === "weak-control")!;
    expect(finding).toMatchObject({ measure: "fill", control: "trick" });
    expect(finding.text).toContain("beats 0 of 3 real entries");
    expect(finding.comparisons.length).toBe(3);
    expect(finding.comparisons.every((c) => c.better === "trick" && !c.beats)).toBe(true);
    expect(finding.comparisons[0]).toMatchObject({ n: 40, ties: 0, family: 3 });
  });

  it("does not trip for a control in second place of 10, which still beats most entries", () => {
    const check = checkMeasures([...entries(10), ...rows("fill", "trick", 40, (i) => 0.85 + i * 1e-4)], options(ALONE));
    const read = check.reads[0]!;
    expect(read.status).toBe("beaten");
    expect(read).toMatchObject({ beatsEntries: 9, of: 10, aheadOf: 9 });
    expect(has(check, "weak-control")).toBe(false);
  });

  it("does not trip for a control that beats 1 of 30, and the read shows that count", () => {
    const check = checkMeasures([...entries(30), ...rows("fill", "trick", 40, (i) => 0.05 + i * 1e-4)], options(ALONE));
    expect(check.reads[0]!).toMatchObject({ beatsEntries: 1, of: 30 });
    expect(has(check, "weak-control")).toBe(false);
  });

  it("trips together with no-spread when the control and the entries all tie", () => {
    const flat = ["a", "b", "trick"].flatMap((group) => rows("fill", group, 40, () => 0.5));
    const check = checkMeasures(flat, options(ALONE));
    expect(check.reads[0]!).toMatchObject({ status: "wins", beatsEntries: 0, of: 2 });
    expect(has(check, "weak-control")).toBe(true);
    expect(has(check, "no-spread")).toBe(true);
  });

  it("gives too-few and not weak-control when no read has power", () => {
    const check = checkMeasures([...rows("fill", "a", 3, (i) => 0.5 + i), ...rows("fill", "trick", 3, (i) => 0.1 + i)], options(ALONE));
    expect(check.reads[0]!).toMatchObject({ status: "too-few", beatsEntries: 0, of: 0 });
    expect(has(check, "too-few")).toBe(true);
    expect(has(check, "weak-control")).toBe(false);
  });

  it("keeps the status wins when no test separates, trips with power, and alone stays false", () => {
    // The signs alternate, so no test passes in either direction on 40 keys.
    const mixed = [...rows("fill", "a", 40, (i) => (i % 2 === 0 ? 0.4 : 0.6)), ...rows("fill", "trick", 40, () => 0.5)];
    const check = checkMeasures(mixed, options(ALONE));
    expect(check.reads[0]!).toMatchObject({ status: "wins", beatsEntries: 0, of: 1 });
    expect(has(check, "weak-control")).toBe(true);
    expect(winClaim(check, "fill", "a").alone).toBe(false);
  });

  it("keeps the status wins with no finding of weak-control when the control beats one entry and another separates from nothing", () => {
    const data = [...rows("fill", "a", 40, (i) => (i % 2 === 0 ? 0.4 : 0.6)), ...rows("fill", "b", 40, (i) => 0.1 + i * 1e-4), ...rows("fill", "trick", 40, () => 0.5)];
    const check = checkMeasures(data, options(ALONE));
    expect(check.reads[0]!).toMatchObject({ status: "wins", beatsEntries: 1, of: 2 });
    expect(has(check, "weak-control")).toBe(false);
    expect(winClaim(check, "fill", "a").alone).toBe(false);
  });

  it("counts all strata, so a stratum with a beaten entry clears the control", () => {
    const part = (stratum: string, group: string, value: number): MeasureRow[] => keys(40, stratum).map((key, i) => ({ measure: "fill", group, key, stratum, value: value + i * 1e-4 }));
    const beatsInOne = [...part("s", "a", 0.5), ...part("t", "a", 0.5), ...part("s", "trick", 0.9), ...part("t", "trick", 0.1)];
    expect(has(checkMeasures(beatsInOne, options(ALONE)), "weak-control")).toBe(false);
    const beatsInNone = [...part("s", "a", 0.5), ...part("t", "a", 0.5), ...part("s", "trick", 0.2), ...part("t", "trick", 0.1)];
    expect(has(checkMeasures(beatsInNone, options(ALONE)), "weak-control")).toBe(true);
  });

  it("reads each control apart, so only the broken one of two controls trips", () => {
    const rule = { ...FILL, controls: ["trick", "broken"] };
    const data = [...real(), ...caught(), ...rows("fill", "broken", 40, (i) => 0.1 + i * 1e-4), ...rows("order", "broken", 40, (i) => 90 + i * 1e-3)];
    const check = checkMeasures(data, { rules: [rule, ORDER], controls: ["trick", "broken"], asOf: AS_OF });
    expect(check.findings.filter((f) => f.kind === "weak-control").map((f) => f.control)).toEqual(["broken"]);
  });

  it("uses the resolution in the family of the control too", () => {
    const close = [...rows("fill", "a", 40, (i) => 0.5 + i * 1e-4), ...rows("fill", "trick", 40, (i) => 0.5 + i * 1e-4 + 1e-9)];
    expect(has(checkMeasures(close, options(ALONE)), "weak-control")).toBe(false);
    expect(has(checkMeasures(close, options([{ ...FILL, partners: [], resolution: 1e-6 }])), "weak-control")).toBe(true);
  });
});

describe("the finding censored-win", () => {
  const stopped = (r: MeasureRow, i: number): MeasureRow => (i < 10 ? { ...r, censored: true } : r);

  it("trips when the control wins with more censored keys than an entry, and gives the two counts", () => {
    const trick = caught();
    const check = checkMeasures([...real(), ...trick.map((r, i) => (r.measure === "fill" ? stopped(r, i) : r))], options());
    const finding = check.findings.find((f) => f.kind === "censored-win")!;
    expect(finding.text).toContain("10 censored keys");
    expect(finding.text).toContain("a 0");
    const claim = winClaim(check, "fill", "a");
    expect(claim.censored).toEqual({ entry: 0, controls: [{ control: "trick", censored: 10 }] });
    expect(check.measures[0]!.entries.find((c) => c.group === "trick")).toMatchObject({ finished: 30, censored: 10 });
    expect(check.reads[0]!.comparisons[0]!.shared).toBe(30);
  });

  it("does not trip when each entry has as many censored keys", () => {
    const fill = real().map((r, i) => (r.measure === "fill" && i % 40 < 10 ? { ...r, censored: true } : r));
    const trick = caught().map((r, i) => (r.measure === "fill" ? stopped(r, i) : r));
    expect(has(checkMeasures([...fill, ...trick], options()), "censored-win")).toBe(false);
  });
});

describe("the report of a narrow spread", () => {
  /** The rows of one entry for each value of `levels`. Entries at one level tie on each key, and other pairs differ on each key. */
  const levelled = (levels: readonly number[], count = 60): MeasureRow[] => levels.flatMap((level, e) => rows("x", `e${e}`, count, (i) => level + i * 1e-6));
  const rule: MeasureRule = { measure: "x", sense: "higher", controls: [], partners: [], noControl: ORDER.noControl! };
  const read = (data: readonly MeasureRow[], extra: Partial<MeasureRule> = {}) => {
    const check = checkMeasures(data, { rules: [{ ...rule, ...extra }], controls: [], asOf: AS_OF });
    return { spread: check.measures[0]!.spread[0]!, check };
  };
  /** The entries all sit at one level with a tie on each key, and the last entry alone stands away. */
  const outlier = (count: number): MeasureRow[] => [...Array.from({ length: count }, (_, e) => rows("x", `e${e}`, 60, () => 0.5)).flat(), ...rows("x", "far", 60, () => 0.9)];

  it("reads narrow when one entry alone gives each separated pair, and no-spread stays silent", () => {
    const { spread, check } = read(outlier(23));
    expect(spread).toMatchObject({ entries: 24, separated: 23, share: 1 / 23, apart: ["far"], narrow: true });
    expect(has(check, "no-spread")).toBe(false);
  });

  it("does not read narrow on two tiers, where a real split separates half of the pairs", () => {
    const { spread } = read(levelled([...Array.from({ length: 12 }, () => 0.5), ...Array.from({ length: 12 }, () => 0.9)]));
    expect(spread.share).toBeCloseTo(12 / 23);
    expect(spread.narrow).toBe(false);
  });

  it("does not read narrow when each pair separates", () => {
    const { spread } = read(levelled([0.1, 0.2, 0.3, 0.4]));
    expect(spread).toMatchObject({ entries: 4, separated: 6, share: 1, narrow: false });
    expect(spread.apart).toHaveLength(4);
  });

  it("does not read narrow when no pair separates, and the finding no-spread stays", () => {
    const { spread, check } = read(outlier(3).filter((row) => row.group !== "far"));
    expect(spread).toMatchObject({ separated: 0, share: 0, apart: [], narrow: false });
    expect(has(check, "no-spread")).toBe(true);
  });

  it("gives no finding for a narrow read", () => {
    expect(read(outlier(23)).check.findings).toEqual([]);
  });

  it("takes a pair with no read out of the share, so too few keys do not read as narrow", () => {
    const data = [...rows("x", "a", 60, () => 0.5), ...rows("x", "b", 60, () => 0.9), ...rows("x", "c", 3, () => 0.7)];
    const { spread } = read(data);
    expect(spread.tooFew).toBe(2);
    expect(spread).toMatchObject({ entries: 2, share: 1, narrow: false });
  });

  it("has no share when no pair has a read", () => {
    const { spread } = read([...rows("x", "a", 3, (i) => i), ...rows("x", "b", 3, (i) => 2 * i + 1)]);
    expect(spread).toMatchObject({ entries: 0, apart: [], narrow: false });
    expect(spread.share).toBeUndefined();
  });

  it("gives the finding and no narrow read when a resolution takes the separated pairs away", () => {
    const data = [...outlier(23)];
    expect(read(data, { resolution: 0.5 }).spread).toMatchObject({ separated: 0, narrow: false });
    expect(has(read(data, { resolution: 0.5 }).check, "no-spread")).toBe(true);
  });

  it("reads the limit on each side: a share at the limit is not narrow", () => {
    expect(NARROW_SPREAD_SHARE).toBe(0.1);
    expect(read(outlier(9)).spread.share).toBeCloseTo(1 / 9);
    expect(read(outlier(9)).spread.narrow).toBe(false);
    expect(read(outlier(10)).spread.share).toBeCloseTo(1 / 10);
    expect(read(outlier(10)).spread.narrow).toBe(false);
    expect(read(outlier(11)).spread.narrow).toBe(true);
  });
});

describe("the finding no-spread", () => {
  it("trips for a constant measure, and not as too-few", () => {
    const data = [...rows("fill", "a", 40, () => 0.5), ...rows("fill", "b", 40, () => 0.5), ...rows("order", "a", 40, (i) => 2 + i), ...rows("order", "b", 40, (i) => 1 + i)];
    const check = checkMeasures([...data, ...caught()], options());
    const finding = check.findings.find((f) => f.kind === "no-spread" && f.measure === "fill")!;
    expect(finding.text).toContain("widest median difference is 0");
    expect(check.findings.some((f) => f.kind === "too-few" && f.measure === "fill")).toBe(false);
  });

  it("trips by the resolution for a small spread that the test separates", () => {
    const data = [...rows("x", "a", 60, (i) => 0.987 + i * 1e-6), ...rows("x", "b", 60, (i) => 0.992 + i * 1e-6)];
    const rule: MeasureRule = { measure: "x", sense: "higher", controls: [], partners: [], noControl: ORDER.noControl! };
    expect(has(checkMeasures(data, { rules: [rule], controls: [], asOf: AS_OF }), "no-spread")).toBe(false);
    const check = checkMeasures(data, { rules: [{ ...rule, resolution: 0.01 }], controls: [], asOf: AS_OF });
    expect(check.findings.find((f) => f.kind === "no-spread")!.text).toContain("resolution 0.01");
    expect(check.measures[0]!.spread[0]!).toMatchObject({ pairs: 1, separated: 0, tooFew: 0 });
  });

  it("does not trip when one pair separates", () => {
    expect(has(checkMeasures([...real(), ...caught()], options()), "no-spread")).toBe(false);
  });

  it("gives too-few and not no-spread when no pair has enough keys", () => {
    const data = [...rows("x", "a", 3, (i) => i), ...rows("x", "b", 3, (i) => 2 * i + 1)];
    const check = checkMeasures(data, { rules: [{ measure: "x", sense: "higher", controls: [], partners: [], noControl: ORDER.noControl! }], controls: [], asOf: AS_OF });
    expect(kinds(check)).toEqual(["too-few"]);
  });
});

describe("the finding mixed-method", () => {
  it("trips for two methods and gives no read of the measure", () => {
    const check = checkMeasures([...rows("fill", "a", 40, (i) => i, { method: "sample" }), ...rows("fill", "b", 40, (i) => i, { method: "full" }), ...caught().map((r) => ({ ...r, method: "sample" }))], options());
    expect(has(check, "mixed-method")).toBe(true);
    expect(check.measures[0]!).toMatchObject({ mixed: true, guards: [], spread: [] });
  });

  it("trips for a missing method beside a present one", () => {
    expect(has(checkMeasures([...rows("order", "a", 40, (i) => i, { method: "full" }), ...rows("order", "b", 40, (i) => i)], options([ORDER])), "mixed-method")).toBe(true);
  });

  it("does not trip for one method, and states it", () => {
    const check = checkMeasures(rows("order", "a", 40, (i) => i, { method: "full" }), options([ORDER]));
    expect(has(check, "mixed-method")).toBe(false);
    expect(check.measures[0]!.method).toBe("full");
  });
});

describe("the findings of the rules", () => {
  it("gives no-rule for a measure with rows and no rule, and not for a measure with a rule", () => {
    expect(has(checkMeasures(rows("other", "a", 3, (i) => i), options([])), "no-rule")).toBe(true);
    expect(has(checkMeasures(rows("order", "a", 3, (i) => i), options([ORDER])), "no-rule")).toBe(false);
  });

  it("gives no-rows for a measure, a control and a partner with no rows, and reads none as not beaten", () => {
    expect(checkMeasures([], options([ORDER])).findings.map((f) => f.kind)).toEqual(["no-rows"]);
    const noControl = checkMeasures(real(), options());
    expect(noControl.findings.filter((f) => f.kind === "no-rows").map((f) => f.text).join()).toContain("no rows on fill");
    expect(has(noControl, "weak-control")).toBe(false);
    expect(has(noControl, "uncaught")).toBe(false);
    const noPartner = checkMeasures([...real(), ...rows("fill", "trick", 40, (i) => 0.95 + i * 1e-4)], options());
    expect(noPartner.findings.filter((f) => f.kind === "no-rows").map((f) => f.text).join()).toContain("partner order");
    expect(noPartner.measures[0]!.guards[0]!.partners[0]!.status).toBe("no-rows");
    expect(has(noPartner, "uncaught")).toBe(false);
    expect(has(checkMeasures([...real(), ...caught()], options()), "no-rows")).toBe(false);
  });

  it("gives no-control for a rule with no control and no reason", () => {
    const bare: MeasureRule = { measure: "order", sense: "lower", controls: [], partners: [] };
    expect(has(checkMeasures(rows("order", "a", 3, (i) => i), options([bare])), "no-control")).toBe(true);
    expect(has(checkMeasures(rows("order", "a", 3, (i) => i), options([ORDER])), "no-control")).toBe(false);
  });

  it("gives control-late only for a date before asOf", () => {
    const at = (asOf: string): MeasureChecks => checkMeasures(rows("order", "a", 3, (i) => i), { rules: [ORDER], controls: [], asOf });
    expect(has(at("2026-12-02"), "control-late")).toBe(true);
    expect(has(at("2026-12-01"), "control-late")).toBe(false);
    expect(at("2026-12-01").measures[0]!.open).toEqual(ORDER.noControl);
  });
});

describe("the refusals", () => {
  const one: MeasureRow = { measure: "order", group: "a", key: "k", value: 1 };

  it("refuses a value that is not finite, even on a censored row", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) expect(() => checkMeasures([{ ...one, value }], options([ORDER]))).toThrow(RangeError);
    expect(() => checkMeasures([{ ...one, value: Number.NaN, censored: true }], options([ORDER]))).toThrow(RangeError);
  });

  it("refuses a repeat of measure, group and key", () => {
    expect(() => checkMeasures([one, { ...one, value: 2 }], options([ORDER]))).toThrow(/comes twice/);
    expect(() => checkMeasures([one, { ...one, group: "b" }], options([ORDER]))).not.toThrow();
  });

  it("refuses a key in two strata", () => {
    expect(() => checkMeasures([{ ...one, stratum: "s" }, { ...one, group: "b", stratum: "t" }], options([ORDER]))).toThrow(/two strata/);
    expect(() => checkMeasures([{ ...one, stratum: "s" }, { ...one, group: "b" }], options([ORDER]))).toThrow(/two strata/);
  });

  it("refuses rules that contradict each other", () => {
    expect(() => checkMeasures([], options([ORDER, ORDER]))).toThrow(/two rules/);
    expect(() => checkMeasures([], { rules: [FILL, ORDER], controls: [], asOf: AS_OF })).toThrow(/not in the controls/);
    expect(() => checkMeasures([], options([FILL]))).toThrow(/has no rule/);
    expect(() => checkMeasures([], options([{ ...ORDER, partners: ["order"] }]))).toThrow(/names itself/);
    expect(() => checkMeasures([], options([{ ...FILL, partners: [], noControl: ORDER.noControl! }]))).toThrow(/also noControl/);
    expect(() => checkMeasures([], options([{ ...ORDER, resolution: -1 }]))).toThrow(/resolution/);
  });

  it("refuses a floor that is negative or not finite", () => {
    expect(() => checkMeasures([], options([{ ...ORDER, floors: { c: -1 } }]))).toThrow(/floor of "c"/);
    expect(() => checkMeasures([], options([{ ...ORDER, floors: { c: Number.NaN } }]))).toThrow(/floor of "c"/);
  });

  it("refuses a date that is not a real date, and an alpha out of range", () => {
    expect(() => checkMeasures([], { ...options([ORDER]), asOf: "2026-13-01" })).toThrow(/asOf/);
    expect(() => checkMeasures([], { ...options([ORDER]), asOf: "2026-02-30" })).toThrow(/asOf/);
    expect(() => checkMeasures([], options([{ ...ORDER, noControl: { because: "x", until: "soon" } }]))).toThrow(/date/);
    expect(() => checkMeasures([], { ...options([ORDER]), alpha: 0 })).toThrow(/alpha/);
    expect(() => checkMeasures([], { ...options([ORDER]), alpha: 1 })).toThrow(/alpha/);
  });
});

describe("winClaim", () => {
  it("gives likeControl true for the entry that does not beat the control on the partner, even when another entry does", () => {
    // Entry a beats the control on order. Entry b matches the control there, so its win reads the same as the trick.
    const data = [...rows("fill", "a", 40, (i) => 0.6 + i * 1e-4), ...rows("fill", "b", 40, (i) => 0.7 + i * 1e-4), ...rows("order", "a", 40, (i) => 1 + i * 1e-3), ...rows("order", "b", 40, (i) => 50 + i * 1e-3), ...rows("fill", "trick", 40, (i) => 0.9 + i * 1e-4), ...rows("order", "trick", 40, (i) => 50 + i * 1e-3)];
    const check = checkMeasures(data, options());
    expect(winClaim(check, "fill", "a")).toMatchObject({ alone: false, show: ["order"], likeControl: false });
    expect(winClaim(check, "fill", "b")).toMatchObject({ alone: false, show: ["order"], likeControl: true });
  });

  it("gives alone true only when each read control lost", () => {
    const beaten = checkMeasures([...real(), ...rows("fill", "trick", 40, (i) => 0.1 + i * 1e-4), ...rows("order", "trick", 40, (i) => 90 + i * 1e-3)], options());
    expect(winClaim(beaten, "fill", "a")).toMatchObject({ alone: true, show: [], likeControl: false });
    const thin = checkMeasures([...real(3), ...caught(3)], options());
    expect(winClaim(thin, "fill", "a")).toMatchObject({ alone: false, show: ["order"], likeControl: true });
  });

  /** Entry x beats the control on fill and on order. Entry y has the values of the control on `fill`, and z is behind both. */
  const copy = (y: (i: number) => number): MeasureRow[] => [
    ...rows("fill", "x", 40, (i) => 0.9 + i * 1e-4),
    ...rows("fill", "y", 40, y),
    ...rows("fill", "z", 40, (i) => 0.5 + i * 1e-4),
    ...rows("fill", "trick", 40, (i) => 0.8 + i * 1e-4),
    ...rows("order", "x", 40, (i) => 1 + i * 1e-3),
    ...rows("order", "y", 40, (i) => 50 + i * 1e-3),
    ...rows("order", "z", 40, (i) => 60 + i * 1e-3),
    ...rows("order", "trick", 40, (i) => 50 + i * 1e-3),
  ];

  it("does not call a copy of the trick alone when another entry beats the control", () => {
    const check = checkMeasures(copy((i) => 0.8 + i * 1e-4), options());
    expect(check.measures[0]!.guards[0]!.status).toBe("beaten");
    expect(winClaim(check, "fill", "y")).toMatchObject({ alone: false, show: ["order"], likeControl: true, censored: { entry: 0, controls: [{ control: "trick", censored: 0 }] } });
    expect(winClaim(check, "fill", "x")).toMatchObject({ alone: true, show: [], likeControl: false });
  });

  it("calls the same entry alone when it beats the control itself", () => {
    const check = checkMeasures(copy((i) => 0.85 + i * 1e-4), options());
    expect(winClaim(check, "fill", "y")).toMatchObject({ alone: true, show: [], likeControl: false, censored: { entry: 0, controls: [] } });
  });

  it("does not call a measure with no control alone, and gives its reason", () => {
    const check = checkMeasures(real(), options([{ ...ORDER, partners: ["fill"] }, { ...FILL, controls: [], noControl: ORDER.noControl! }]));
    expect(winClaim(check, "order", "a")).toEqual({ alone: false, show: ["fill"], likeControl: false, censored: { entry: 0, controls: [] }, open: ORDER.noControl });
  });

  it("refuses a measure with no rule and an entry with no rows", () => {
    const check = checkMeasures(real(), options());
    expect(() => winClaim(check, "none", "a")).toThrow(RangeError);
    expect(() => winClaim(check, "fill", "none")).toThrow(RangeError);
  });
});

describe("the strata", () => {
  /** The rows of two strata: the control wins fill only on stratum s, and it loses order on both. */
  const strata = (): MeasureRow[] => {
    const part = (stratum: string, prefix: string, group: string, measure: string, value: (i: number) => number): MeasureRow[] => keys(40, prefix).map((key, i) => ({ measure, group, key, stratum, value: value(i) }));
    return [
      ...part("s", "s", "a", "fill", (i) => 0.5 + i * 1e-4),
      ...part("t", "t", "a", "fill", (i) => 0.5 + i * 1e-4),
      ...part("s", "s", "a", "order", (i) => 1 + i * 1e-3),
      ...part("t", "t", "a", "order", (i) => 1 + i * 1e-3),
      ...part("s", "s", "trick", "fill", (i) => 0.9 + i * 1e-4),
      ...part("t", "t", "trick", "fill", (i) => 0.1 + i * 1e-4),
      ...part("s", "s", "trick", "order", (i) => 9 + i * 1e-3),
      ...part("t", "t", "trick", "order", (i) => 9 + i * 1e-3),
    ];
  };

  it("gives one read for each stratum, with one Holm family over the strata", () => {
    const check = checkMeasures(strata(), options());
    const guards = check.measures[0]!.guards;
    expect(guards.map((g) => [g.stratum, g.status])).toEqual([["s", "wins"], ["t", "beaten"]]);
    expect(check.reads.find((r) => r.measure === "fill" && r.stratum === "s")!.comparisons[0]!.family).toBe(2);
    expect(winClaim(check, "fill", "a", "s")).toMatchObject({ alone: false, likeControl: false, show: ["order"] });
    expect(winClaim(check, "fill", "a", "t")).toMatchObject({ alone: true, show: [] });
  });

  it("reads a small stratum as too-few in its row, with no finding while another stratum has a read", () => {
    const small: MeasureRow[] = [
      { measure: "fill", group: "a", key: "x0", stratum: "x", value: 0.1 },
      { measure: "fill", group: "trick", key: "x0", stratum: "x", value: 0.9 },
      { measure: "order", group: "a", key: "x0", stratum: "x", value: 1 },
      { measure: "order", group: "trick", key: "x0", stratum: "x", value: 9 },
    ];
    const check = checkMeasures([...strata(), ...small], options());
    expect(check.measures[0]!.guards.find((g) => g.stratum === "x")!.status).toBe("too-few");
    expect(has(check, "too-few")).toBe(false);
  });

  it("gives the same read as no stratum when the rows have none", () => {
    const check = checkMeasures([...real(), ...caught()], options());
    expect(check.measures[0]!.guards.map((g) => g.stratum)).toEqual([undefined]);
    expect(winClaim(check, "fill", "a")).toMatchObject({ show: ["order"] });
  });
});

describe("the size of a read", () => {
  it("reads 64 entries over 2,000 keys", { timeout: 120_000 }, () => {
    const entries = Array.from({ length: 64 }, (_, e) => `e${e}`);
    const data = [...entries.flatMap((e, n) => rows("fill", e, 2000, (i) => n + i * 1e-6)), ...rows("fill", "trick", 2000, (i) => 100 + i * 1e-6)];
    const check = checkMeasures(data, { rules: [{ ...FILL, partners: [] }], controls: ["trick"], asOf: AS_OF });
    expect(check.measures[0]!.spread[0]!.pairs).toBe(2016);
    expect(has(check, "uncaught")).toBe(true);
  });
});

describe("jointClaim", () => {
  const SET = ["fill", "order"];
  const RULES_2: readonly MeasureRule[] = [
    { measure: "fill", sense: "higher", controls: ["a-trick", "b-trick"], partners: ["order"] },
    { measure: "order", sense: "lower", controls: ["a-trick", "b-trick"], partners: ["fill"] },
  ];
  const read = (data: readonly MeasureRow[]): MeasureChecks => checkMeasures(data, { rules: RULES_2, controls: ["a-trick", "b-trick"], asOf: AS_OF });
  /** One group with one level on each measure, with a small change for each key. */
  const group = (name: string, fill: number, order: number, count = 40, extra: Partial<MeasureRow> = {}): MeasureRow[] => [
    ...rows("fill", name, count, (i) => fill + i * 1e-4, extra),
    ...rows("order", name, count, (i) => order + i * 1e-3, extra),
  ];

  it("lets an entry survive that beats a control on each measure, when each control beats it on another", () => {
    const check = read([...group("real", 0.5, 50), ...group("a-trick", 0.9, 90), ...group("b-trick", 0.1, 10)]);
    const claim = jointClaim(check, SET, "real");
    expect(claim.verdict).toBe("survives");
    expect(claim.dominatedBy).toEqual([]);
    expect(claim.measures.map((m) => m.beats)).toEqual([["b-trick"], ["a-trick"]]);
    expect(claim.controls.map((c) => [c.control, c.beaten, c.lostTo])).toEqual([
      ["a-trick", ["order"], ["fill"]],
      ["b-trick", ["fill"], ["order"]],
    ]);
  });

  it("calls an entry dominated when one control beats it on each measure, and names only that control", () => {
    const check = read([...group("real", 0.5, 50), ...group("a-trick", 0.9, 10), ...group("b-trick", 0.1, 90)]);
    const claim = jointClaim(check, SET, "real");
    expect(claim.verdict).toBe("dominated");
    expect(claim.dominatedBy).toEqual(["a-trick"]);
    expect(claim.controls.find((c) => c.control === "b-trick")!.dominates).toBe(false);
  });

  it("does not let a tie clear a control", () => {
    const tied = [...rows("fill", "real", 40, () => 0.5), ...rows("order", "real", 40, (i) => 50 + i * 1e-3), ...rows("fill", "a-trick", 40, () => 0.5), ...rows("order", "a-trick", 40, (i) => 10 + i * 1e-3), ...group("b-trick", 0.1, 90)];
    const claim = jointClaim(read(tied), SET, "real");
    expect(claim.measures[0]!.tied).toEqual(["a-trick"]);
    expect(claim.dominatedBy).toEqual(["a-trick"]);
    expect(claim.verdict).toBe("dominated");
  });

  it("reads not-ahead when the entry beats no control on a measure, and no control dominates", () => {
    const check = read([...group("real", 0.5, 50), ...group("a-trick", 0.9, 90), ...group("b-trick", 0.8, 95)]);
    const claim = jointClaim(check, SET, "real");
    expect(claim.verdict).toBe("not-ahead");
    expect(claim.notAhead).toEqual(["fill"]);
    expect(claim.dominatedBy).toEqual([]);
  });

  it("reads no-read at 3 keys, where no test has the power, and not a pass", () => {
    const check = read([...group("real", 0.5, 50, 3), ...group("a-trick", 0.9, 90, 3), ...group("b-trick", 0.1, 10, 3)]);
    const claim = jointClaim(check, SET, "real");
    expect(claim.verdict).toBe("no-read");
    expect(claim.controls.every((c) => c.unread.length === 2 && !c.dominates)).toBe(true);
    expect(claim.measures.map((m) => m.unread)).toEqual([["a-trick", "b-trick"], ["a-trick", "b-trick"]]);
  });

  it("does not call a control dominant while a test against it is unread", () => {
    const few = (name: string, value: number): MeasureRow[] => rows("order", name, 3, (i) => value + i * 1e-3);
    const data = [...rows("fill", "real", 40, (i) => 0.5 + i * 1e-4), ...few("real", 50), ...rows("fill", "a-trick", 40, (i) => 0.9 + i * 1e-4), ...few("a-trick", 90), ...rows("fill", "b-trick", 40, (i) => 0.1 + i * 1e-4), ...few("b-trick", 90)];
    const claim = jointClaim(read(data), SET, "real");
    const trick = claim.controls.find((c) => c.control === "a-trick")!;
    expect(trick.lostTo).toEqual(["fill"]);
    expect(trick.unread).toEqual(["order"]);
    expect(trick.dominates).toBe(false);
    expect(claim.verdict).toBe("no-read");
  });

  describe("the level over the controls of a measure", () => {
    /** The entry beats `a-trick` on `fill` on `wins` keys, and it ties on `ties` keys. `b-trick` wins `fill`, and the entry beats both on `order`. */
    const narrow = (wins: number, ties: number): MeasureRow[] => {
      const count = wins + ties;
      return [
        ...rows("fill", "real", count, (i) => 0.5 + i * 1e-4),
        ...rows("fill", "a-trick", count, (i) => (i < wins ? 0.1 + i * 1e-4 : 0.5 + i * 1e-4)),
        ...rows("fill", "b-trick", count, (i) => 0.9 + i * 1e-4),
        ...rows("order", "real", 40, (i) => 50 + i * 1e-3),
        ...rows("order", "a-trick", 40, (i) => 90 + i * 1e-3),
        ...rows("order", "b-trick", 40, (i) => 90 + i * 1e-3),
      ];
    };

    it("does not let a plain beat clear the level over 2 controls, with the power to clear it", () => {
      const claim = jointClaim(read(narrow(5, 1)), SET, "real");
      const fill = claim.measures[0]!;
      expect(fill.beats).toEqual(["a-trick"]);
      expect(fill.clears).toEqual([]);
      expect(claim.notAhead).toEqual(["fill"]);
      expect(claim.verdict).toBe("not-ahead");
    });

    it("reads no-read when the keys are too few for the level over 2 controls", () => {
      const claim = jointClaim(read(narrow(5, 0)), SET, "real");
      expect(claim.measures[0]!.beats).toEqual(["a-trick"]);
      expect(claim.measures[0]!.clears).toEqual([]);
      expect(claim.verdict).toBe("no-read");
    });

    it("lets a beat clear when it passes that level", () => {
      const claim = jointClaim(read(narrow(6, 0)), SET, "real");
      expect(claim.measures[0]!.clears).toEqual(["a-trick"]);
      expect(claim.verdict).toBe("survives");
    });

    it("leaves a plain beat in the lists of the control, so that it does not dominate", () => {
      const trick = jointClaim(read(narrow(5, 1)), SET, "real").controls.find((c) => c.control === "a-trick")!;
      expect(trick.beaten).toEqual(["fill", "order"]);
      expect(trick.dominates).toBe(false);
    });
  });

  it("names a control that ties the entry on each measure, and keeps the verdict", () => {
    const level = (name: string): MeasureRow[] => group(name, 0.5, 50);
    const data = [...level("real"), ...level("a-trick"), ...group("b-trick", 0.1, 90)];
    const claim = jointClaim(read(data), SET, "real");
    expect(claim.equalledBy).toEqual(["a-trick"]);
    expect(claim.verdict).toBe("survives");
    expect(claim.measures.map((m) => m.tied)).toEqual([["a-trick"], ["a-trick"]]);
  });

  it("does not name a control as equal while a test against it is unread", () => {
    const claim = jointClaim(read([...group("real", 0.5, 50, 3), ...group("a-trick", 0.5, 50, 3), ...group("b-trick", 0.1, 90, 3)]), SET, "real");
    expect(claim.equalledBy).toEqual([]);
    expect(claim.verdict).toBe("no-read");
  });

  it("reads no-read for a measure with no control, because nothing was read on it", () => {
    const rules: readonly MeasureRule[] = [
      { measure: "fill", sense: "higher", controls: ["a-trick"], partners: ["order"] },
      { measure: "order", sense: "lower", controls: [], partners: [], noControl: { because: "The control has no code.", until: "2026-12-01" } },
    ];
    const check = checkMeasures([...group("real", 0.5, 50), ...rows("fill", "a-trick", 40, (i) => 0.1 + i * 1e-4)], { rules, controls: ["a-trick"], asOf: AS_OF });
    const claim = jointClaim(check, SET, "real");
    expect(claim.verdict).toBe("no-read");
    expect(claim.notAhead).toEqual(["order"]);
    expect(claim.measures[1]!.beats).toEqual([]);
    expect(claim.measures[1]!.unread).toEqual(["a-trick"]);
  });

  it("gives no credit for the win of another entry", () => {
    const check = read([...group("real", 0.5, 50), ...group("other", 0.95, 5), ...group("a-trick", 0.9, 10), ...group("b-trick", 0.1, 90)]);
    expect(jointClaim(check, SET, "real").dominatedBy).toEqual(["a-trick"]);
    expect(jointClaim(check, SET, "other").verdict).toBe("survives");
  });

  it("reads each stratum on its own", () => {
    const at = (stratum: string, name: string, fill: number, order: number): MeasureRow[] =>
      (["fill", "order"] as const).flatMap((measure) => keys(40, stratum).map((key, i): MeasureRow => ({ measure, group: name, key, stratum, value: (measure === "fill" ? fill + i * 1e-4 : order + i * 1e-3) })));
    const data = [...at("s1", "real", 0.5, 50), ...at("s1", "a-trick", 0.9, 90), ...at("s1", "b-trick", 0.1, 10), ...at("s2", "real", 0.5, 50), ...at("s2", "a-trick", 0.9, 10), ...at("s2", "b-trick", 0.1, 90)];
    const check = read(data);
    expect(jointClaim(check, SET, "real", "s1").verdict).toBe("survives");
    expect(jointClaim(check, SET, "real", "s2").verdict).toBe("dominated");
  });

  it("refuses an empty set, a repeat, a measure with no rule and an entry with no rows", () => {
    const check = read([...group("real", 0.5, 50), ...group("a-trick", 0.9, 90), ...group("b-trick", 0.1, 10)]);
    expect(() => jointClaim(check, [], "real")).toThrow(RangeError);
    expect(() => jointClaim(check, ["fill", "fill"], "real")).toThrow(RangeError);
    expect(() => jointClaim(check, ["nothing"], "real")).toThrow(RangeError);
    expect(() => jointClaim(check, SET, "nobody")).toThrow(RangeError);
  });
});
