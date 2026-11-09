import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import { packageRows, pageHtml, parseSiteArgs } from "./build.ts";
import { chiSquarePerDf, generatorOf, histogram, METHODS, run, seedFrom } from "./page.ts";

describe("the page", () => {
  it("reads an integer seed as a number and other text as a string", () => {
    expect(seedFrom(" 42 ")).toBe(42);
    expect(seedFrom("-7")).toBe(-7);
    expect(seedFrom("night 10-29")).toBe("night 10-29");
    expect(seedFrom("99999999999999999999")).toBe("99999999999999999999");
  });

  it("forks the generator with the label", () => {
    expect(generatorOf("42", "").seed).toBe(random(42).seed);
    expect(generatorOf("42", " lanes ").seed).toBe(random(42).fork("lanes").seed);
  });

  it("counts the values in bins, and leaves out the values out of the range", () => {
    expect(histogram([0, 0.1, 0.5, 0.99, 1, -0.1], 0, 1, 2)).toEqual([2, 2]);
  });

  it("gives a chi-squared of 0 for the expected counts, and a large one for a bad fit", () => {
    expect(chiSquarePerDf([25, 25, 25, 25], [0.25, 0.25, 0.25, 0.25])).toBe(0);
    expect(chiSquarePerDf([100, 0, 0, 0], [0.25, 0.25, 0.25, 0.25])).toBeGreaterThan(50);
  });

  it("has expected probabilities that sum to 1 for each method", () => {
    for (const m of METHODS) {
      const p = m.expected();
      expect(p).toHaveLength(m.bins);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });

  it("draws values that fit the expected counts for each method (the generator passes on its own page)", () => {
    for (const m of METHODS) {
      const result = run(m, "42", "", 20_000);
      expect(result.values).toHaveLength(12);
      expect(result.counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(19_990);
      expect(result.chi, m.id).toBeLessThan(2.5);
    }
  });
});

describe("the build", () => {
  it("reads the arguments", () => {
    expect(parseSiteArgs([])).toEqual({ out: "dist" });
    expect(parseSiteArgs(["--out", "x"])).toEqual({ out: "x" });
    expect(parseSiteArgs(["--nope"])).toHaveProperty("error");
  });

  it("writes the page with the packages, the links of the site pages and the script", () => {
    const html = pageHtml(packageRows({ generators: "0.1.0", statistics: "0.1.0", bench: "0.2.2", chaos: "0.1.0", mutation: "0.1.0" }), "2026-10-29");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("@mark1russell7/rigor-generators");
    expect(html).toContain("@mark1russell7/rigor-statistics");
    expect(html).toContain("@mark1russell7/rigor-bench");
    expect(html).toContain('href="status/"');
    expect(html).toContain('href="releases/"');
    expect(html).toContain('src="page.js"');
    expect(pageHtml([{ name: "<x>", state: "planned", gives: "a & b" }], "d")).toContain("&lt;x&gt;");
  });
});
