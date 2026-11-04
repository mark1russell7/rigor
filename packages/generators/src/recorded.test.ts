import { describe, expect, it } from "vitest";
import { random } from "./random.ts";
import { dependsOnLibm, sampler } from "./distributions.ts";
import { DIAGRAM_BOX_AREA, GIT_BLOB_BYTES, RECORDED_TABLES, recordedSpec } from "./recorded.ts";

const tables = Object.values(RECORDED_TABLES);

describe("the recorded tables", () => {
  it("are listed by their names", () => {
    expect(RECORDED_TABLES["diagram-box-area"]).toBe(DIAGRAM_BOX_AREA);
    expect(RECORDED_TABLES["git-blob-bytes"]).toBe(GIT_BLOB_BYTES);
  });

  it.each(tables.map((t) => [t.name, t] as const))("%s states its source, its license and its date", (_, table) => {
    expect(table.source).toMatch(/^https:\/\/github\.com\/.+\/[0-9a-f]{40}/);
    expect(table.license).not.toBe("");
    expect(table.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(table.count).toBeGreaterThan(1000);
  });

  it.each(tables.map((t) => [t.name, t] as const))("%s has 100 values in order, above 0", (_, table) => {
    expect(table.quantiles).toHaveLength(100);
    expect(table.quantiles[0]).toBeGreaterThan(0);
    for (let i = 1; i < 100; i++) expect(table.quantiles[i]).toBeGreaterThanOrEqual(table.quantiles[i - 1]!);
  });

  it("keeps the two paragraphs that the license of the diagrams requires", () => {
    expect(DIAGRAM_BOX_AREA.notice).toContain("Copyright (c) 1997-2013 The Regents of the University of California.");
    expect(DIAGRAM_BOX_AREA.notice).toContain("IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE");
    expect(DIAGRAM_BOX_AREA.notice).toContain("SPECIFICALLY DISCLAIMS ANY WARRANTIES");
  });
});

describe("recordedSpec", () => {
  it.each(tables.map((t) => [t.name, t] as const))("%s draws keep the recorded median within 5 percent", (_, table) => {
    const next = sampler(recordedSpec(table), random(`recorded/${table.name}`));
    const draws = Array.from({ length: 100_000 }, next).sort((a, b) => a - b);
    const median = draws[50_000]!;
    expect(Math.abs(median - table.median) / table.median).toBeLessThanOrEqual(0.05);
  });

  it("gives the same numbers on each platform", () => {
    for (const table of tables) expect(dependsOnLibm(recordedSpec(table))).toBe(false);
  });
});
