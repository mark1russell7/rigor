import { readFileSync } from "node:fs";
import { median, twoSamplePermutation } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { type ModelRead, type ModelRow, type ModelTest, CEILING_ONLY, UNKNOWN_MODEL, armModels, limitOnModel, modelRowText, modelTest, visibleShift } from "./model.ts";

/** This function gives one read for each value. */
function readsOf(model: string, values: readonly number[], caseName = "build"): ModelRead[] {
  return values.map((value) => ({ case: caseName, model, value }));
}

/** This function gives the p of the default test of two groups. */
function modelRowP(a: readonly number[], b: readonly number[]): number {
  return twoSamplePermutation(a, b, { runs: 2000 }).p;
}

const apart = readsOf("slow", [1.1, 1.11, 1.12, 1.13, 1.14]);
const pool = [...readsOf("fast", [0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97]), ...readsOf("other", [0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96])];

describe("modelTest", () => {
  it("finds the model that reads apart, and no other model", () => {
    const test = modelTest([...apart, ...pool]);
    expect(test.differs.map((r) => r.model)).toEqual(["slow"]);
    expect(test.family).toBe(3);
    expect(test.rows.map((r) => r.status)).toEqual(["no read", "no read", "differs"]);
  });

  it("gives the facts of a row: its reads, its range and its shift against the rest", () => {
    const row = modelTest([...apart, ...pool]).rows.find((r) => r.model === "slow");
    expect(row).toMatchObject({ case: "build", reads: 5, median: 1.12, low: 1.1, high: 1.14, restReads: 15, restMedian: 0.93 });
    expect(row?.shift).toBeCloseTo(0.19, 10);
    expect(row?.p).toBeLessThan(0.05);
  });

  it("reads a model with few reads as too-few, keeps its facts, and leaves it out of the family", () => {
    const test = modelTest([...readsOf("slow", [1.1, 1.2]), ...pool]);
    const row = test.rows.find((r) => r.model === "slow");
    expect(row).toMatchObject({ status: "too-few", p: undefined, reads: 2, median: 1.15 });
    expect(test.family).toBe(2);
    expect(test.differs).toEqual([]);
  });

  it("lowers the count of reads with minReads, so the same model enters the family", () => {
    const row = modelTest([...readsOf("slow", [1.1, 1.2]), ...pool], { minReads: 2 }).rows.find((r) => r.model === "slow");
    expect(row?.status).not.toBe("too-few");
  });

  it("reads a case with one model as too-few, because it has no rest", () => {
    const test = modelTest(readsOf("one", [1, 2, 3, 4, 5, 6]));
    expect(test.rows).toEqual([expect.objectContaining({ status: "too-few", restReads: 0, restMedian: undefined, shift: undefined })]);
    expect(test.family).toBe(0);
  });

  it("reads a shift under the resolution as no read", () => {
    expect(modelTest([...apart, ...pool], { resolution: 0.18 }).differs).toHaveLength(1);
    expect(modelTest([...apart, ...pool], { resolution: 0.2 }).differs).toEqual([]);
  });

  it("corrects over all the cases: a family of more rows reads less", () => {
    // Each case alone gives a small p. Over many cases, Holm takes the same p above the level.
    const one = modelTest([...apart, ...pool], { runs: 2000 });
    const many = Array.from({ length: 8 }, (_, i) => [...apart, ...pool].map((r) => ({ ...r, case: `c${String(i)}` }))).flat();
    const held = one.differs[0]?.p ?? 1;
    expect(held).toBeLessThan(0.05);
    expect(modelTest(many, { alpha: held * 2, runs: 2000 }).differs).toEqual([]);
  });

  it("gives the same result for the same seed, and the p of one case does not depend on another case", () => {
    const reads = [...apart, ...pool];
    expect(modelTest(reads, { runs: 200 })).toEqual(modelTest(reads, { runs: 200 }));
    const alone = modelTest(reads, { runs: 200, alpha: 1 }).rows.find((r) => r.model === "slow");
    expect(alone?.median).toBe(1.12);
  });

  it("sorts the rows by case and by model, whatever the order of the reads", () => {
    const rows = modelTest([...readsOf("b", [1], "z"), ...readsOf("a", [1], "z"), ...readsOf("b", [1], "a")]).rows;
    expect(rows.map((r) => `${r.case} ${r.model}`)).toEqual(["a b", "z a", "z b"]);
  });

  it("gives no rows for no reads", () => {
    expect(modelTest([])).toEqual({ rows: [], family: 0, differs: [] });
  });

  it("refuses a value that is not finite and a bad count of reads", () => {
    expect(() => modelTest(readsOf("a", [Number.NaN]))).toThrow(/not a finite value/u);
    expect(() => modelTest(readsOf("a", [Number.POSITIVE_INFINITY]))).toThrow(RangeError);
    expect(() => modelTest([], { minReads: 1 })).toThrow(/minReads/u);
    expect(() => modelTest([], { minReads: 2.5 })).toThrow(/minReads/u);
  });
});

describe("visibleShift", () => {
  const rest = [0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 1, 1.01, 1.02, 1.03, 1.04];
  const values = [0.95, 0.97, 0.99, 1.01, 1.03];

  it("gives a shift that reaches the level, and a shift under it does not reach the level", () => {
    const seen = visibleShift(values, rest, 0.05, 1, { runs: 2000 });
    expect(seen.floor).toBeLessThanOrEqual(0.05);
    expect(seen.shift).toBeGreaterThan(0);
    const at = (shift: number): number => modelRowP(values.map((v) => v - 0.99 + 0.97 + shift), rest);
    expect(at(seen.shift ?? 0)).toBeLessThanOrEqual(0.05);
    expect(at((seen.shift ?? 0) / 2)).toBeGreaterThan(0.05);
  });

  it("gives no shift when the level is under the floor of this count", () => {
    const seen = visibleShift(values, rest, 1e-9, 1, { runs: 2000 });
    expect(seen.shift).toBeUndefined();
    expect(seen.floor).toBeGreaterThan(1e-9);
  });

  it("reads the direction that it gets", () => {
    const up = visibleShift(values, rest, 0.05, 1, { runs: 2000 });
    const down = visibleShift(values, rest, 0.05, -1, { runs: 2000 });
    expect(up.shift).toBeGreaterThan(0);
    expect(down.shift).toBeGreaterThan(0);
    expect(down.shift).not.toBe(up.shift);
  });

  it("takes a pool with no spread", () => {
    // With ties, a split with 3 of the 5 moved values has the same statistic. So the smallest p of this count is near 0.25.
    const reach = visibleShift([1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], 0.5, 1, { runs: 500 });
    expect(reach.shift).toBeGreaterThan(0);
    const under = visibleShift([1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], 0.05, 1, { runs: 500 });
    expect(under.shift).toBeUndefined();
    expect(under.floor).toBeGreaterThan(0.05);
  });
});

describe("modelRowText", () => {
  const test = modelTest([...apart, ...pool], { runs: 500 });
  const row = (model: string): ModelRow => {
    const found = test.rows.find((r) => r.model === model);
    if (found === undefined) throw new Error(model);
    return found;
  };

  it("names each state in its first word", () => {
    expect(modelRowText(row("slow"), test.family)).toMatch(/^differs: build on slow has a shift of 0\.190 at 5 reads against 15, family 3, Holm p /u);
    expect(modelRowText(row("fast"), test.family)).toMatch(/^no read: build on fast has a shift of /u);
    expect(modelRowText(modelTest(readsOf("one", [1, 2])).rows[0] as ModelRow, 0)).toBe("too few: build on one has 2 reads against 0, and the test does not read it");
  });

  it("gives the visible shift with the smallest p and the level", () => {
    const text = modelRowText({ ...row("fast"), visible: 0.1234, floor: 0.0002, level: 0.0167 }, 3);
    expect(text).toContain("at 8 reads against 12, family 3. This test sees a shift of 0.123 or more: the smallest p is 0.00020, and the first level of Holm is 0.01670");
  });

  it("says that a size cannot reach the level, with no flip", () => {
    const text = modelRowText({ ...row("fast"), visible: undefined, floor: 0.001, level: 0.05 / 54 }, 54);
    expect(text).toContain("at 8 reads against 12, family 54. This size cannot reach the level: the smallest p is 0.00100, and the first level of Holm is 0.00093");
  });

  it("gives the floor at the level as a size that reaches the level", () => {
    const text = modelRowText({ ...row("fast"), visible: undefined, floor: 0.01, level: 0.01 }, 5);
    expect(text).toContain("The test did not search for the shift that it can see: the smallest p is 0.01000");
  });

  it("does not say that a model is the same", () => {
    for (const r of test.rows) expect(modelRowText(r, test.family)).not.toMatch(/same|equal|no difference/u);
  });
});

describe("a test with no search", () => {
  it("gives no shift, and its words say that it did not search", () => {
    const test = modelTest([...readsOf("slow", [0.93, 0.94, 0.95, 0.96, 0.97]), ...pool], { runs: 200, searchVisible: false });
    const row = test.rows.find((r) => r.model === "slow");
    expect(row?.visible).toBeUndefined();
    expect(row?.floor).toBeGreaterThan(0);
    expect(row?.level).toBe(0.05 / test.family);
    expect(modelRowText(row as ModelRow, test.family)).toMatch(/^no read: /u);
  });

  it("gives the same floor as the search, so a low count says so with no search", () => {
    const reads = [...readsOf("slow", [1.1, 1.2, 1.3]), ...readsOf("fast", [1.15, 1.25, 1.35, 1.4])];
    const options = { runs: 500, minReads: 3 };
    const searched = modelTest(reads, options).rows.find((r) => r.model === "slow");
    const plain = modelTest(reads, { ...options, searchVisible: false }).rows.find((r) => r.model === "slow");
    expect(plain?.floor).toBe(searched?.floor);
    expect(plain?.level).toBe(searched?.level);
    expect(modelRowText(plain as ModelRow, 2)).toContain("This size cannot reach the level");
  });
});

describe("the question of a family", () => {
  it("reads only the rows of the question, so the family is the count of those rows", () => {
    const test = modelTest([...apart, ...pool], { asked: (row) => row.model === "slow", runs: 500 });
    expect(test.family).toBe(1);
    expect(test.rows.map((r) => r.status)).toEqual(["not asked", "not asked", "differs"]);
    expect(modelRowText(test.rows[0] as ModelRow, test.family)).toBe("not asked: build on fast has 8 reads, and it is outside the family");
  });

  it("reads a model of the question with few reads as too-few", () => {
    const test = modelTest([...readsOf("slow", [1.1, 1.2]), ...pool], { asked: (row) => row.model === "slow", runs: 500 });
    expect(test.rows.find((r) => r.model === "slow")?.status).toBe("too-few");
    expect(test.family).toBe(0);
  });
});

/** The 26 reads of 18 cases on 7 CPU models from one bench, as a fixture of the flip. */
function fixtureReads(): ModelRead[] {
  const table = JSON.parse(readFileSync(new URL("./model.fixture.json", import.meta.url), "utf8")) as Record<string, Record<string, readonly number[]>>;
  return Object.entries(table).flatMap(([caseName, models]) => Object.entries(models).flatMap(([model, values]) => readsOf(model, values, caseName)));
}

describe("the flip of the CPU model test on 26 reads", () => {
  /** This function prints a figure of a flip, so that a reader of the log of CI can check it. */
  const report = (label: string, text: string): void => {
    console.info(`flip ${label}: ${text}`);
  };
  const reads = fixtureReads();
  const fast = { searchVisible: false };
  const named = (test: ModelTest): string[] => test.differs.map((r) => `${r.case} ${r.model}`);
  const rowOf = (test: ModelTest, model: string): ModelRow => {
    const found = test.rows.find((r) => r.case === "avoid" && r.model === model);
    if (found === undefined) throw new Error(`no row of ${model}`);
    return found;
  };
  /** This function moves the reads of the row of avoid on a model. */
  const moved = (model: string, move: number): ModelRead[] => reads.map((r) => (r.case === "avoid" && r.model === model ? { ...r, value: r.value + move } : r));
  const clean = (): ModelTest => modelTest(reads, fast);

  it("reads 468 values in a family of 54, and the clean copy has no row that differs", { timeout: 120_000 }, () => {
    expect(reads).toHaveLength(468);
    const test = clean();
    report("clean, family 54", `${String(reads.length)} values, family ${String(test.family)}, ${String(test.differs.length)} rows differ`);
    report("clean, family 54", modelRowText(rowOf(test, "9V45"), test.family));
    expect(test.family).toBe(54);
    expect(test.differs).toEqual([]);
    for (const row of test.rows) expect(modelRowText(row, test.family)).toMatch(/^(no read|too few): /u);
  });

  it("the fault reads differs on a model with 8 reads, so the family of 54 can fail", { timeout: 120_000 }, () => {
    const flipped = modelTest(moved("7763", 0.2), fast);
    report("+0.2 on avoid 7763, family 54", modelRowText(rowOf(flipped, "7763"), flipped.family));
    expect(named(flipped)).toEqual(["avoid 7763"]);
  });

  it("a fault of 0.09 on 5 reads does not read differs at a family of 54, at any size", { timeout: 120_000 }, () => {
    // 5 reads against 21 have 65 780 splits, so the p is exact. The level is 0.05 / 54, and 3 high values of 5 hold the median.
    const flipped = modelTest(moved("9V45", 0.09), fast);
    report("+0.09 on avoid 9V45, family 54", `${modelRowText(rowOf(flipped, "9V45"), flipped.family)}, Holm p ${(rowOf(flipped, "9V45").p ?? 1).toFixed(4)}`);
    expect(named(flipped)).toEqual([]);
    expect(rowOf(flipped, "9V45").status).toBe("no read");
    const far = modelTest(moved("9V45", 1), fast);
    report("+1 on avoid 9V45, family 54", `${modelRowText(rowOf(far, "9V45"), far.family)}, Holm p ${(rowOf(far, "9V45").p ?? 1).toFixed(4)}`);
    expect(named(far)).toEqual([]);
    expect(rowOf(far, "9V45").p).toBeGreaterThan(0.05);
  });

  it("a fault of 0.09 from the median of the rest does not read differs at a family of 54", { timeout: 120_000 }, () => {
    const medianOf = (keep: (r: ModelRead) => boolean): number => median(reads.filter((r) => r.case === "avoid" && keep(r)).map((r) => r.value));
    const toRest = medianOf((r) => r.model !== "9V45") - medianOf((r) => r.model === "9V45");
    const flipped = modelTest(moved("9V45", toRest + 0.09), fast);
    report("+0.09 from the median of the rest on avoid 9V45, family 54", `${modelRowText(rowOf(flipped, "9V45"), flipped.family)}, Holm p ${(rowOf(flipped, "9V45").p ?? 1).toFixed(4)}`);
    expect(named(flipped)).toEqual([]);
    expect(rowOf(flipped, "9V45").status).toBe("no read");
  });

  it("no shift of the 5 reads reaches the level of a family of 54, because of the smallest p of the median", { timeout: 120_000 }, () => {
    const family54 = visibleShift(
      reads.filter((r) => r.case === "avoid" && r.model === "9V45").map((r) => r.value),
      reads.filter((r) => r.case === "avoid" && r.model !== "9V45").map((r) => r.value),
      0.05 / 54,
      1,
      { runs: 108_000 },
    );
    report("the search at family 54", `the smallest p is ${family54.floor.toFixed(5)}, the level is ${(0.05 / 54).toFixed(5)}, and the shift is ${String(family54.shift)}`);
    expect(family54.shift).toBeUndefined();
    expect(family54.floor).toBeGreaterThan(0.05 / 54);
  });

  it("each row of 5 reads at the family of 54 says that this size cannot reach the level, with no flip", { timeout: 120_000 }, () => {
    const test = clean();
    const target = test.rows.find((r) => r.case === "avoid" && r.model === "9V45") as ModelRow;
    expect(target.level).toBe(0.05 / 54);
    expect(target.floor).toBeGreaterThan(0.05 / 54);
    expect(modelRowText(target, test.family)).toContain("This size cannot reach the level");
  });

  describe("at the family of 2 of the question: avoid and build on 9V45", () => {
    const asked = (row: { readonly case: string; readonly model: string }): boolean => row.model === "9V45" && (row.case === "avoid" || row.case === "build");
    const isAsked = (r: ModelRead): boolean => asked(r);
    const restMedianOf = (caseName: string): number => {
      const rest = reads.filter((r) => r.case === caseName && r.model !== "9V45").map((r) => r.value);
      return median(rest);
    };
    const medianOf = (caseName: string): number => median(reads.filter((r) => r.case === caseName && r.model === "9V45").map((r) => r.value));
    /**
     * This function gives a copy with no fault: each asked row keeps its spread, and its median moves to the median of the
     * rest. The clean fixture is not the copy with no fault, because its reads raised the question. The argument adds a
     * shift to one case.
     */
    const copyWith = (fault?: { readonly caseName: string; readonly shift: number }): ModelRead[] =>
      reads.map((r) => (isAsked(r) ? { ...r, value: r.value - medianOf(r.case) + restMedianOf(r.case) + (fault?.caseName === r.case ? fault.shift : 0) } : r));
    const rowIn = (test: ModelTest, caseName: string): ModelRow => {
      const found = test.rows.find((r) => r.case === caseName && r.model === "9V45");
      if (found === undefined) throw new Error(`no row of ${caseName}`);
      return found;
    };
    // The faults are stated from the estimates of the visible shift, 0.021 on avoid and 0.025 on build, with the spread of these reads.
    const above = { avoid: 0.03, build: 0.035 };
    const below = { avoid: 0.01, build: 0.012 };

    it("the copy with no fault has a family of 2 and no row that differs", { timeout: 120_000 }, () => {
      const test = modelTest(copyWith(), { asked });
      report("no fault, family 2", modelRowText(rowIn(test, "avoid"), test.family));
      report("no fault, family 2", modelRowText(rowIn(test, "build"), test.family));
      expect(test.family).toBe(2);
      expect(test.differs).toEqual([]);
      expect(rowIn(test, "avoid").visible).toBeGreaterThan(below.avoid);
      expect(rowIn(test, "avoid").visible).toBeLessThan(above.avoid);
      expect(rowIn(test, "build").visible).toBeGreaterThan(below.build);
      expect(rowIn(test, "build").visible).toBeLessThan(above.build);
    });

    it("a fault above the visible shift reads differs, on its own row only", { timeout: 120_000 }, () => {
      const avoid = modelTest(copyWith({ caseName: "avoid", shift: above.avoid }), { ...fast, asked });
      const build = modelTest(copyWith({ caseName: "build", shift: above.build }), { ...fast, asked });
      report(`+${String(above.avoid)} on avoid, family 2`, modelRowText(rowIn(avoid, "avoid"), avoid.family));
      report(`+${String(above.build)} on build, family 2`, modelRowText(rowIn(build, "build"), build.family));
      expect(named(avoid)).toEqual(["avoid 9V45"]);
      expect(named(build)).toEqual(["build 9V45"]);
    });

    it("a fault below the visible shift reads no read, and its words do not say that the model is the same", { timeout: 120_000 }, () => {
      for (const caseName of ["avoid", "build"] as const) {
        const test = modelTest(copyWith({ caseName, shift: below[caseName] }), { asked });
        const text = modelRowText(rowIn(test, caseName), test.family);
        report(`+${String(below[caseName])} on ${caseName}, family 2`, `${text}, Holm p ${(rowIn(test, caseName).p ?? 1).toFixed(4)}`);
        expect(test.differs).toEqual([]);
        expect(text).toMatch(/^no read: /u);
        expect(text).not.toMatch(/same|equal|no difference/u);
      }
    });
  });
});

describe("limitOnModel", () => {
  const limits = { gain: 0.98, ceiling: 1.04, models: ["7763", "8370C"] };

  it("holds the gain on a model with a read of the gain", () => {
    expect(limitOnModel(limits, "7763")).toEqual({ limit: 0.98, holdsGain: true, note: undefined });
  });

  it("gives the ceiling, with its words, on a model outside the list and on a model with no earlier reads", () => {
    expect(limitOnModel(limits, "9V45")).toEqual({ limit: 1.04, holdsGain: false, note: CEILING_ONLY });
    expect(limitOnModel(limits, "a new model")).toEqual({ limit: 1.04, holdsGain: false, note: CEILING_ONLY });
  });

  it("refuses a ceiling under the gain limit, and takes a ceiling equal to it", () => {
    expect(() => limitOnModel({ ...limits, ceiling: 0.9 }, "7763")).toThrow(RangeError);
    expect(limitOnModel({ ...limits, ceiling: 0.98 }, "9V45").limit).toBe(0.98);
  });
});

describe("armModels", () => {
  it("reads one known model on both arms as one", () => {
    expect(armModels([{ a: "x", b: "x" }, { a: "x", b: "x" }])).toEqual({ a: ["x"], b: ["x"], one: true });
  });

  it("reads two models as not one, across the arms and inside one arm", () => {
    expect(armModels([{ a: "x", b: "y" }]).one).toBe(false);
    expect(armModels([{ a: "y", b: "y" }, { a: "x", b: "y" }])).toEqual({ a: ["x", "y"], b: ["y"], one: false });
  });

  it("reads a record with no model as unknown, and unknown is not one known model", () => {
    expect(armModels([{ a: undefined, b: undefined }])).toEqual({ a: [UNKNOWN_MODEL], b: [UNKNOWN_MODEL], one: false });
  });

  it("gives no models for no pairs, and no pairs are not one model", () => {
    expect(armModels([])).toEqual({ a: [], b: [], one: false });
  });
});
