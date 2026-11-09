import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STUDIES, study } from "./registry.ts";
import { U_STATISTIC_BAR, U_STATISTIC_CELLS, type UStatisticCell } from "./u-statistic-interval.ts";

describe("the registry of calibration studies", () => {
  it("has the same names as the choice study of the workflow", () => {
    const workflow = readFileSync(join(import.meta.dirname, "../../../../.github/workflows/calibration.yml"), "utf8");
    const block = /study:[\s\S]*?options:\n((?:\s+- .+\n)+)/.exec(workflow)?.[1] ?? "";
    const options = [...block.matchAll(/- (\S+)/g)].map((m) => m[1]);
    expect(options).toEqual(Object.keys(STUDIES));
    expect(options[0]).toBe("u-statistic-interval");
  });

  it("refuses an unknown study, and names the studies", () => {
    expect(() => study("nothing")).toThrow(/The studies are u-statistic-interval/);
  });

  it("keeps the bar of the u-statistic study as the reviewer fixed it", () => {
    const s = study("u-statistic-interval");
    expect(s.bar).toEqual({ level: 0.95, alpha: 0.05, pooledLow: 0.94 });
    expect(s.bar).toBe(U_STATISTIC_BAR);
    expect(s.draws).toBe(1000);
    expect(U_STATISTIC_CELLS).toHaveLength(17);
  });

  it("writes the raw counts and the seeds of each cell, and is the same for the same seed", () => {
    const options = { seed: "unit", draws: 4, cells: ["skewed 40/8", "120/108"] };
    const record = study("u-statistic-interval").run(options);
    const cells = record.cells as readonly UStatisticCell[];
    expect(cells.map((c) => c.name)).toEqual(["sparse 120/108", "crossings 120/108", "skewed 40/8", "skewed 120/108"]);
    const first = cells[2] as UStatisticCell;
    expect(first).toMatchObject({ kernel: "skewed", n: 40, m: 8, sample: 8, draws: 4, seed: "u-statistic-interval/unit/skewed/40/8", populationSeed: "u-statistic-interval/unit/skewed/40" });
    for (const c of cells) {
      expect(c.hits).toBeGreaterThanOrEqual(0);
      expect(c.hits).toBeLessThanOrEqual(4);
      expect(c.fallbacks).toBeLessThanOrEqual(4);
    }
    expect(record.result.steps.map((s) => s.sample)).toEqual([8, 108]);
    expect(study("u-statistic-interval").run(options)).toEqual(record);
    expect(() => study("u-statistic-interval").run({ seed: "unit", cells: ["none"] })).toThrow(/no cell/);
    expect(() => study("u-statistic-interval").run({ seed: "unit", draws: 0 })).toThrow(/draws is a whole number/);
  });
});
