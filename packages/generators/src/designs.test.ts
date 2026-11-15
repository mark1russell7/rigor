import { describe, expect, it } from "vitest";
import { familyMap, familyPoints, latinHypercube, randomDesign, saltelliDesign, stratifiedDesign, type InputFamily } from "./designs.ts";
import { canonicalHash } from "./hash.ts";
import { distributionOf } from "./quantiles.ts";
import { random } from "./random.ts";

const variance = (xs: readonly number[]): number => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
};

describe("the unit designs", () => {
  it("gives a Latin hypercube with one point in each stratum of each column", () => {
    for (const n of [1, 7, 100]) {
      for (const d of [1, 5]) {
        const rows = latinHypercube(n, d, random(`lhs-${n}-${d}`));
        expect(rows).toHaveLength(n);
        for (let j = 0; j < d; j++) {
          const strata = rows.map((row) => Math.floor(row[j]! * n)).sort((a, b) => a - b);
          expect(strata).toEqual(Array.from({ length: n }, (_, k) => k));
        }
      }
    }
  });

  it("gives a stratified grid with one point in each cell", () => {
    const rows = stratifiedDesign(4, 3, random("grid"));
    expect(rows).toHaveLength(64);
    const cells = rows.map((row) => row.reduce((cell, x, j) => cell + Math.floor(x * 4) * 4 ** j, 0));
    expect(cells).toEqual(Array.from({ length: 64 }, (_, k) => k));
    expect(() => stratifiedDesign(10, 7, random(1))).toThrow(RangeError);
  });

  it("gives the Saltelli matrices: ab[i] is a with the column i of b", () => {
    for (const base of ["random", "latin"] as const) {
      const { a, b, ab } = saltelliDesign(20, 4, random("saltelli"), base);
      expect(ab).toHaveLength(4);
      ab.forEach((m, i) =>
        m.forEach((row, k) => row.forEach((x, j) => expect(x).toBe(j === i ? b[k]![j] : a[k]![j]))),
      );
      expect(a).not.toEqual(b);
    }
  });

  it("keeps each coordinate in [0, 1) and refuses an empty design", () => {
    const all = [randomDesign(50, 3, random(2)), latinHypercube(50, 3, random(2)), stratifiedDesign(5, 2, random(2))].flat(2);
    expect(all.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(() => latinHypercube(0, 2, random(1))).toThrow(RangeError);
    expect(() => randomDesign(3, 1.5, random(1))).toThrow(RangeError);
  });

  // For an additive function, the variance of the Latin hypercube mean falls as 1/n^3, and the random mean as 1/n.
  // On 2026-11-09 the ratio was 0.00042, near 1/n^2. The bound 1/1000 holds this gain.
  it("gives a mean of x1 + x2 + x3 with less than 1/1000 of the variance of the random design", () => {
    const meanOf = (rows: number[][]) => rows.reduce((s, row) => s + row[0]! + row[1]! + row[2]!, 0) / rows.length;
    const seeds = Array.from({ length: 200 }, (_, s) => s);
    const lhs = variance(seeds.map((s) => meanOf(latinHypercube(50, 3, random(`v-${s}`)))));
    const plain = variance(seeds.map((s) => meanOf(randomDesign(50, 3, random(`v-${s}`)))));
    expect(lhs).toBeLessThan(plain / 1000);
  });
});

describe("the map to a family", () => {
  const family: InputFamily = {
    name: "boxes",
    dimensions: [
      { name: "count", min: 1, max: 6, integer: true },
      { name: "width", min: 10, max: 1000, scale: "log" },
      { name: "gap", min: 0, max: 2 },
      { name: "area", min: 1, max: 50, distribution: { family: "lognormal", mu: 2, sigma: [0.5, 1] } },
    ],
  };

  it("gives values in the range of each dimension", () => {
    const points = familyPoints(family, latinHypercube(500, 4, random("ranges")), random("map"));
    for (const p of points) {
      expect(Number.isInteger(p["count"])).toBe(true);
      expect(p["count"]).toBeGreaterThanOrEqual(1);
      expect(p["count"]).toBeLessThanOrEqual(6);
      expect(p["width"]).toBeGreaterThanOrEqual(10);
      expect(p["width"]).toBeLessThanOrEqual(1000);
      expect(p["gap"]).toBeGreaterThanOrEqual(0);
      expect(p["gap"]).toBeLessThan(2);
      expect(p["area"]).toBeGreaterThanOrEqual(1);
      expect(p["area"]).toBeLessThanOrEqual(50);
    }
    // With a Latin hypercube, each of the 6 counts gets 500 / 6 points, plus or minus 1.
    const counts = [1, 2, 3, 4, 5, 6].map((c) => points.filter((p) => p["count"] === c).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("gives the uniform ends: min at 0, and max for an integer dimension near 1", () => {
    const map = familyMap(family, random("ends"));
    const low = map([0, 0, 0, 0]);
    expect([low["count"], low["width"], low["gap"]]).toEqual([1, 10, 0]);
    const high = map([0.999999, 0.999999, 0.999999, 0.999999]);
    expect(high["count"]).toBe(6);
    expect(high["width"]).toBeCloseTo(1000, 1);
  });

  it("cuts a distribution to the range (the Kolmogorov distance to the cut cdf)", () => {
    const spec = { family: "lognormal", mu: 1, sigma: 1 } as const;
    const cut: InputFamily = { name: "cut", dimensions: [{ name: "x", min: 1, max: 8, distribution: spec }] };
    const n = 20_000;
    const xs = familyPoints(cut, randomDesign(n, 1, random("ks")), random("cut"))
      .map((p) => p["x"]!)
      .sort((a, b) => a - b);
    const d = distributionOf(spec, random("cut"));
    const low = d.cdf(1);
    const high = d.cdf(8);
    let distance = 0;
    xs.forEach((x, i) => {
      const f = (d.cdf(x) - low) / (high - low);
      distance = Math.max(distance, Math.abs(f - i / n), Math.abs(f - (i + 1) / n));
    });
    // The 0.001 critical value of the distance for 20 000 draws is 1.95 / sqrt(20 000) = 0.0138.
    expect(distance).toBeLessThan(0.0138);
    expect(xs[0]).toBeGreaterThanOrEqual(1);
    expect(xs[n - 1]).toBeLessThanOrEqual(8);
  });

  it("cuts a discrete distribution to its values in the range, in proportion", () => {
    const zipf: InputFamily = { name: "z", dimensions: [{ name: "rank", min: 3, max: 5, distribution: { family: "zipf", n: 10, exponent: 1 } }] };
    const points = familyPoints(zipf, stratifiedDesign(600, 1, random("zipf")), random(1)).map((p) => p["rank"]!);
    expect(new Set(points)).toEqual(new Set([3, 4, 5]));
    // The weights 1/3, 1/4 and 1/5 give the shares 20/47, 15/47 and 12/47 of the 600 strata.
    const shares = [3, 4, 5].map((k) => points.filter((x) => x === k).length);
    expect(shares.map((s, i) => Math.abs(s - (600 * [20, 15, 12][i]!) / 47))).toSatisfy((e: number[]) => e.every((x) => x <= 1));
    expect(familyMap(zipf, random(1))([0])["rank"]).toBe(3);
  });

  it("gives the same points for the same seed, and a new dimension does not change the others", () => {
    const unit = latinHypercube(30, 4, random("same"));
    const once = familyPoints(family, unit, random("seed"));
    expect(familyPoints(family, unit, random("seed"))).toEqual(once);
    const wider: InputFamily = { ...family, dimensions: [...family.dimensions, { name: "extra", min: 0, max: 1 }] };
    const more = familyPoints(wider, unit.map((row) => [...row, 0.5]), random("seed"));
    expect(more.map(({ extra: _, ...rest }) => rest)).toEqual(once);
  });

  it("gives the same uniform points on each platform (no libm in the path)", () => {
    const uniform: InputFamily = { name: "u", dimensions: [{ name: "a", min: -3, max: 3 }, { name: "k", min: 0, max: 9, integer: true }] };
    const points = familyPoints(uniform, latinHypercube(16, 2, random("hash")), random(0));
    expect(canonicalHash(points)).toMatchInlineSnapshot(`"19d48644723afdfc4ed84c6b20d1de855132267635397e6a43403b5663952b6b"`);
  });

  it("refuses a bad dimension", () => {
    const bad = (dimension: InputFamily["dimensions"][number]) => () => familyMap({ name: "bad", dimensions: [dimension] }, random(1));
    expect(bad({ name: "x", min: 2, max: 1 })).toThrow(/finite range/);
    expect(bad({ name: "x", min: 0, max: 1, scale: "log" })).toThrow(/above 0/);
    expect(bad({ name: "x", min: 0.5, max: 3, integer: true })).toThrow(/integer ends/);
    expect(bad({ name: "x", min: 1, max: 2, scale: "log", distribution: { family: "beta", a: 2, b: 2 } })).toThrow(/no scale/);
    expect(bad({ name: "x", min: 2, max: 3, distribution: { family: "beta", a: 2, b: 2 } })).toThrow(/no probability/);
    expect(() => familyMap({ name: "bad", dimensions: [] }, random(1))).toThrow(RangeError);
    expect(() => familyMap({ name: "bad", dimensions: [{ name: "x", min: 0, max: 1 }, { name: "x", min: 0, max: 1 }] }, random(1))).toThrow(/not unique/);
    const map = familyMap(family, random(1));
    expect(() => map([0, 0, 0])).toThrow(/4 coordinates/);
    expect(() => map([0, 0, 1, 0])).toThrow(/below 1/);
  });
});
